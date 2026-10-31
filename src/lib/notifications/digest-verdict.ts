/**
 * A05 的观察窗口判定：把「跳过率上升但积压下降」变成**可跑的结论**。
 *
 * ## 为什么要有这一条
 *
 * A05（站内已读 = 不必寄）的语义落在迁移 `034_email_skip_reason.sql` 与
 * `src/lib/repositories/notifications.ts` 上——「根本不可投递」的行现在会
 * 显式**离开待发队列**并记下原因，而不是永远占住队首。
 *
 * 落地之后有两个指标会同时动：
 * - `cron.digest.skipped{reason}` **必然上升**（原来那些行是卡在队列里，
 *   现在被判定为不可投递并出队了）；
 * - `email.backlog` **应当下降**（队首不再被不可投递的行占住）。
 *
 * **所以「跳过率上升」本身不是故障**，这一点必须写死：
 * A05 之前它是一个坏消息，A05 之后它是**预期**。
 * 任何「跳过率涨了就告警」的规则，都会在 A05 落地后变成一个天天误报的信号位。
 *
 * 真正要抓的是**另一半**：跳过率上升、而**积压不降**。
 * 那正是 A05 要修的症状没修掉的样子——
 * `listUnsentEmailNotifications` 是 `created_at` 升序 + limit 100，
 * 攒满 100 条之后，可投递的新通知再也拉不到，表现为每轮 `pulled=100, sent=0`。
 *
 * ## 为什么判定与取数分开
 *
 * 这里只做**纯判定**：输入是几个已取到的读数，输出是结论与理由。
 * 取数（查 Prometheus / 跑一次 digest）不在这里——
 * 那样这个判定就能被单测穷举，而不必先有一个能用的指标后端。
 */

/** 一次 digest 轮次的读数。 */
export interface DigestRoundReading {
  /** UTC 日期（`YYYY-MM-DD`）。用于序列对齐，防止把两天的读数拼成趋势。 */
  date: string;
  /** 该轮 `listUnsentEmailNotifications` 拉到的条数。 */
  pulled: number;
  /** 该轮实际发出的条数。 */
  sent: number;
  /**
   * 该轮发送失败的条数。
   *
   * **它是 `QUEUE_STUCK` 与「provider 炸了」的分界线**。此前这个接口没有这一栏，
   * 于是 `pulled=100, sent=0` 只有一种解释——「队首被占死了」。
   * 而一次 Resend 全线故障会让 100 条**全部失败**，读数与前者**一模一样**：
   * 判成 `QUEUE_STUCK` 就会把人指去查迁移 034 与 `email_skipped_reason` 的写入，
   * 那是一次「诊断指向错误方向」，比没有诊断更费时间。
   * 同仓库的 `queue-diagnostics.ts` 里 `emptySendRounds` 一直排除 `failed>0`，
   * 两套口径此前从没有过交叉用例——这就是它没被发现的原因。
   */
  failed: number;
  /** 该轮结束时队列里的待发条数（`email.backlog`）。 */
  backlog: number;
  /** 该轮按用户条件跳过的条数（`cron.digest.skipped` 的合计）。 */
  skipped: number;
}

export type DigestVerdictCode =
  /** A05 按预期生效：跳过上升且积压在降。 */
  | "A05_DRAINING"
  /** 积压不高，无需判断。 */
  | "HEALTHY_LOW_BACKLOG"
  /** 跳过在涨但积压没降——A05 要修的症状仍在。 */
  | "BACKLOG_NOT_DRAINING"
  /** 拉满 100 条却一封没发：队首被占死的典型形态。 */
  | "QUEUE_STUCK"
  /** 拉满 100 条、一封没发，但失败数 > 0：投递侧故障，不是队列语义问题。 */
  | "DELIVERY_FAILING"
  /** 读数不足以判断（缺日期、负数、单点）。 */
  | "INSUFFICIENT_DATA";

export interface DigestVerdict {
  code: DigestVerdictCode;
  /** 是否应把这条判为「需要人看一眼」。 */
  attention: boolean;
  /** 给人看的一句话，说清凭什么这么判。 */
  reason: string;
}

/**
 * 全部判定码的**运行时清单**（类型联合是编译期的，测试拿不到它）。
 *
 * 用处只有一个：让「新增一个 code 却忘了在面板文案里给它一句话」变成会红的事。
 * `trend-copy.ts` 的 `switch` 有一个 `default` 分支，它必须处理**未知** code
 * （宁可显示「读数不足」），但那条善意的兜底同时也是一个藏身处——
 * 一个真实存在的新 code 落进去，面板就在一次真故障上告诉人「数据不够」。
 *
 * 所以这里双向钉住：`satisfies` 保证每个元素都是合法 code，
 * 下面的 `_codesFullyCovered` 保证**没有 code 漏在清单之外**。
 * 漏一个 → `Exclude` 不再是 `never` → 类型是 `never` → 赋值 `true` 编译失败。
 * 这与 `EMAIL_SKIP_REASONS`（迁移 CHECK 与 TypeScript 两处对账）是同一个做法。
 */
export const DIGEST_VERDICT_CODES = [
  "A05_DRAINING",
  "HEALTHY_LOW_BACKLOG",
  "BACKLOG_NOT_DRAINING",
  "QUEUE_STUCK",
  "DELIVERY_FAILING",
  "INSUFFICIENT_DATA",
] as const satisfies readonly DigestVerdictCode[];

type UncoveredCodes = Exclude<DigestVerdictCode, (typeof DIGEST_VERDICT_CODES)[number]>;
/** 编译期断言：`UncoveredCodes` 必须是 `never`，否则下面一行无法通过类型检查。 */
const _codesFullyCovered: UncoveredCodes extends never ? true : never = true;
void _codesFullyCovered;

/**
 * 单轮就能判的形态：拉满取数上限却一封没发。
 *
 * **必须等于 `listUnsentEmailNotifications` 的 limit**，但**不从 repositories import**：
 * 那个模块会拉进 Supabase 客户端，而本文件是纯判定模块（无 IO、无副作用）——
 * 一旦耦合，digest 路由的测试就必须连带 mock 整个数据层，
 * 而纯判定最值钱的地方正是「不用 mock 就能穷举」。
 * 绑定关系由 `digest-verdict.cross.test.ts` 从**外面**核对：
 * 那个测试同时 import 两边，所以上限漂移它一定会红。
 */
export const DIGEST_PULL_LIMIT = 100;

/** 一条读数自身是否可信。 */
function isPlausible(reading: DigestRoundReading): boolean {
  return (
    typeof reading.date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(reading.date) &&
    Number.isFinite(reading.pulled) &&
    Number.isFinite(reading.sent) &&
    Number.isFinite(reading.failed) &&
    Number.isFinite(reading.backlog) &&
    Number.isFinite(reading.skipped) &&
    reading.pulled >= 0 &&
    reading.sent >= 0 &&
    reading.failed >= 0 &&
    reading.backlog >= 0 &&
    reading.skipped >= 0 &&
    // sent > pulled 在数学上不可能，出现即说明取数或口径有问题
    reading.sent <= reading.pulled
  );
}

/**
 * 判一轮。
 *
 * **注意 `INSUFFICIENT_DATA` 判为 `attention: true`**：
 * 拿不到读数时最不该下的结论就是「没问题」。
 * 这与 `check-deploy-freshness` 里那条「未知不算通过」是同一个原则。
 */
export function judgeDigestRound(reading: DigestRoundReading): DigestVerdict {
  if (!isPlausible(reading)) {
    return {
      code: "INSUFFICIENT_DATA",
      attention: true,
      reason:
        `这一轮的读数不可信（${JSON.stringify(reading)}）。` +
        "**这不等于「队列健康」**——最不该下的结论恰恰是「没问题」。",
    };
  }

  // 队首被占死：拉满了 limit 却一封没发。这是 A05 未生效时最刺眼的形态。
  //
  // **但「一封没发」不是一个原因，是两个**。先看失败数：
  // 同一读数 (pulled=100, sent=0) 既可能是队首被不可投递的行占死（A05 的症状），
  // 也可能是一次 Resend 全线故障——后者 100 条**全部**失败，而 `sent` 一样是 0。
  // 两种世界的读数长得一样，所以判据必须多一栏才分得开；否则 `reason` 会把人
  // 指向「查迁移 034 / 查 email_skipped_reason 的写入」，而那一次的方向是错的。
  if (reading.pulled >= DIGEST_PULL_LIMIT && reading.sent === 0 && reading.failed > 0) {
    return {
      code: "DELIVERY_FAILING",
      attention: true,
      reason:
        `拉满 ${reading.pulled} 条、一封没发，但其中 ${reading.failed} 条是**发送失败**：` +
        "这是投递侧（provider / 网络 / 密钥）故障，**不是**队首被占死。" +
        "先查 email_worker_runs 里这一轮的 error 与通知行的 email_error（以及 Resend 状态）；" +
        "判据上它与 QUEUE_STUCK 共用「拉满且 sent=0」这个形状，只靠 failed 分家。",
    };
  }

  if (reading.pulled >= DIGEST_PULL_LIMIT && reading.sent === 0) {
    return {
      code: "QUEUE_STUCK",
      attention: true,
      reason:
        `拉满 ${reading.pulled} 条（取数上限 ${DIGEST_PULL_LIMIT}）却一封没发，且没有任何一条是发送失败（failed=0）：` +
        "listUnsentEmailNotifications 是 " +
        "created_at 升序 + limit 100，队首被不可投递的行占死，可投递的新通知再也拉不到。" +
        "先确认迁移 034 已 applied（A05 的载体），再查 email_skipped_reason 的写入是否成功。",
    };
  }

  if (reading.backlog === 0 && reading.skipped > 0) {
    return {
      code: "A05_DRAINING",
      attention: false,
      reason:
        `队列已清空（backlog=0），本轮跳过 ${reading.skipped} 条。` +
        "**跳过率上升在 A05 之后是预期**：那些行原来卡在队首，现在被判定为不可投递并出队了。",
    };
  }

  return {
    code: "HEALTHY_LOW_BACKLOG",
    attention: false,
    reason: `积压 ${reading.backlog} 条、拉取 ${reading.pulled} / 发出 ${reading.sent}，未见异常形态。`,
  };
}

/** 一段序列的判定：看积压是在**降**还是**不降**。 */
export function judgeDigestSeries(readings: readonly DigestRoundReading[]): DigestVerdict {
  if (readings.length === 0) {
    return {
      code: "INSUFFICIENT_DATA",
      attention: true,
      reason: "一条读数都没有。**空序列不等于健康**——它只说明没人在看。",
    };
  }

  const bad = readings.filter((r) => !isPlausible(r));
  if (bad.length > 0) {
    return {
      code: "INSUFFICIENT_DATA",
      attention: true,
      reason: `${bad.length}/${readings.length} 轮读数不可信，先修取数再谈判定。`,
    };
  }

  // 日期必须互不相同：否则「积压下降」可能只是同一天的两次读数抖动，
  // 那不构成趋势。
  const dates = new Set(readings.map((r) => r.date));
  if (dates.size !== readings.length) {
    return {
      code: "INSUFFICIENT_DATA",
      attention: true,
      reason:
        "序列里有重复日期——「积压下降」可能只是同一天两次读数的抖动，" +
        "那不构成趋势。按天取数再判。",
    };
  }

  // 逐轮先判一遍：任何一轮卡死都直接报，不被平均值掩盖。
  for (const reading of readings) {
    const single = judgeDigestRound(reading);
    if (single.attention) return single;
  }

  // 排序后看首尾。至少要有两天才谈得上「趋势」。
  const sorted = [...readings].sort((a, b) => a.date.localeCompare(b.date));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  if (sorted.length === 1) {
    return judgeDigestRound(last);
  }

  const skippedRising = last.skipped > first.skipped;
  const backlogFalling = last.backlog < first.backlog;

  if (skippedRising && backlogFalling) {
    return {
      code: "A05_DRAINING",
      attention: false,
      reason:
        `积压 ${first.backlog} → ${last.backlog}（下降），同期跳过 ${first.skipped} → ${last.skipped}（上升）。` +
        "**这正是 A05 的预期形态**：不可投递的行不再占队首，于是既被判定出队、也让位给了可投递的通知。",
    };
  }

  if (skippedRising && !backlogFalling) {
    return {
      code: "BACKLOG_NOT_DRAINING",
      attention: true,
      reason:
        `跳过在涨（${first.skipped} → ${last.skipped}）但积压没降（${first.backlog} → ${last.backlog}）。` +
        "**A05 要修的症状仍在**：行被判定为跳过了，却没真的离开队列。" +
        "先查 034 是否 applied，以及 markSkippedWithReceipt 的写入是否成功。",
    };
  }

  return {
    code: "HEALTHY_LOW_BACKLOG",
    attention: false,
    reason: `积压 ${first.backlog} → ${last.backlog}、跳过 ${first.skipped} → ${last.skipped}，未见 A05 相关的异常形态。`,
  };
}