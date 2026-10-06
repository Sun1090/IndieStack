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
  /** 读数不足以判断（缺日期、负数、单点）。 */
  | "INSUFFICIENT_DATA";

export interface DigestVerdict {
  code: DigestVerdictCode;
  /** 是否应把这条判为「需要人看一眼」。 */
  attention: boolean;
  /** 给人看的一句话，说清凭什么这么判。 */
  reason: string;
}

/** 单轮就能判的形态：拉满 `PULL_LIMIT` 却一封没发。 */
const PULL_LIMIT = 100;

/** 一条读数自身是否可信。 */
function isPlausible(reading: DigestRoundReading): boolean {
  return (
    typeof reading.date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(reading.date) &&
    Number.isFinite(reading.pulled) &&
    Number.isFinite(reading.sent) &&
    Number.isFinite(reading.backlog) &&
    Number.isFinite(reading.skipped) &&
    reading.pulled >= 0 &&
    reading.sent >= 0 &&
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
  if (reading.pulled >= PULL_LIMIT && reading.sent === 0) {
    return {
      code: "QUEUE_STUCK",
      attention: true,
      reason:
        `拉满 ${reading.pulled} 条却一封没发：listUnsentEmailNotifications 是 ` +
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