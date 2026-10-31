/**
 * 通知邮件 Worker（cron）
 * 由 Vercel Cron 每天 09:00 UTC 调度（见 `vercel.json` 与 `src/lib/observability/cron-contract.ts`）；
 * 拉取待发邮件通知，按用户偏好分组后每人一封摘要发出。
 *
 * GET|POST /api/cron/digest
 * Header: `Authorization: Bearer <CRON_SECRET>`（Vercel Cron 自动附加）或 `x-cron-secret`（手动调用）
 *
 * **为什么 GET 也要导出**：Vercel Cron 触发用的是 **HTTP GET**（见
 * `docs/operations/environments.md` 的 2026-10-10 实测记录）。本路由曾只导出 POST，于是平台每天
 * 拿到 Next.js 的 `405 Method Not Allowed`，本 worker 因此**自 2026-09-20 进入 `vercel.json`
 * （`5360b500`）以来一次都没执行过**——注意起点是「被调度」那天，不是路由文件诞生那天（`e76eea74`
 * 建文件是 2026-09-05，那之后有两周它根本没在 crons 里）。
 * 405 发生在进路由之前：鉴权指标、业务指标、`/api/health`、production smoke 全都看不见它。
 * 形态与 `push-retry` 对齐：两条方法共用同一个 `handle`，鉴权仍在 `handle` 内，GET 不是免鉴权通道。
 *
 * 2026-09-22 去掉「本地时刻恰为 08:00 才发」的错峰门控：Hobby plan 每路径每天只能调度一次，
 * 一个固定 UTC 时刻不可能落进所有人的早晨，那道门控的实际效果是让除 UTC-1 时区带外的用户
 * 永远收不到摘要。现在的语义是**一天一封、在调度时刻送达**，发送时刻不再贴合本地时区。
 * 单用户发送失败累加重试计数，达到上限由拉取侧死信过滤，不阻断整轮。
 * 任何按用户条件跳过投递的分支都必须上报 `cron.digest.skipped{reason}`，
 * 这条由 `pnpm check:cron-contract` 静态核对（`src/lib/observability/cron-skip-coverage.ts`）——
 * 错峰门控那次事故就是「跳过了但没人知道」。
 */

import { NextRequest } from "next/server";
import { jsonNoStore } from "@/lib/api-response";
import { logApiError } from "@/lib/api-log";
import { shouldSendEmail } from "@/lib/notification-prefs";
import { judgeDigestRound } from "@/lib/notifications/digest-verdict";
import { checkCronAuth } from "@/lib/cron-auth";
import { recordCronRejected } from "@/lib/cron-metrics";
import { renderEmailHtml } from "@/lib/email-template";
import { sendResendEmail } from "@/lib/email-send";
import {
  listUnsentEmailNotifications,
  countUnsentEmailNotifications,
  markEmailSent,
  markEmailFailed,
  markEmailSkipped,
  type EmailSkipReason,
  EMAIL_BACKLOG_ALERT_THRESHOLD,
  type Notification,
} from "@/lib/repositories/notifications";
import { recordWorkerRun } from "@/lib/repositories/worker-runs";
import { trackEvent, flushEvents } from "@/lib/appark";
import { recordMetric } from "@/lib/metrics";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

type ProfileRow = {
  email: string | null;
  notification_settings: Database["public"]["Tables"]["profiles"]["Row"]["notification_settings"];
};

async function getProfiles(emails: Map<string, ProfileRow>): Promise<void> {
  if (emails.size === 0) return;
  const admin = createAdminClient();
  const userIds = Array.from(emails.keys());
  const { data, error } = await admin
    .from("profiles")
    .select("id,email,notification_settings")
    .in("id", userIds);
  if (error) throw error;
  for (const row of data ?? []) {
    emails.set(String((row as { id?: string }).id), {
      email: (row as { email?: string | null }).email ?? null,
      notification_settings: (row as { notification_settings?: Database["public"]["Tables"]["profiles"]["Row"]["notification_settings"] }).notification_settings ?? null,
    });
  }
}

/**
 * 读出失败原因。`getProfiles` 抛的是 PostgREST 的错误对象而不是 `Error` 实例，
 * `String(error)` 只会得到 `"[object Object]"`——那样 `email_worker_runs.error` 就白记了，
 * 而这张表存在的全部理由就是「worker 一直在失败」要看得出失败成什么。
 */
function failureText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return String(error);
}

/**
 * 跳过回执（A05）：写进原因才算「这行真的离开了队列」。
 *
 * 这里**不**把异常抛穿出去，理由与 #33 修掉的那件事同一条：抛穿会落到 `POST` 的 catch 里
 * 记一轮 `pulled>0 / sent=0 / failed=0`，正好命中「空发送轮次」的定义，把一轮确实处理过的
 * 运行说成空转。抛穿也不能让写入变成功——那一行仍会留在队列里下一轮被拉起。
 * 所以报 `cron.digest.receipt_failed{stage="skip"}` 加一条日志：可见，但不伪造。
 */
async function markSkippedWithReceipt(
  items: Notification[],
  reason: EmailSkipReason,
): Promise<void> {
  try {
    await markEmailSkipped(
      items.map((n) => n.id),
      reason,
    );
  } catch (error) {
    recordMetric("cron.digest.receipt_failed", 1, {
      unit: "count",
      attributes: { stage: "skip" },
    });
    await logApiError(
      "[Cron Digest] 跳过原因写入失败（这些行仍留在待发队列里，下一轮还会被拉起）",
      error,
    );
  }
}

/** 单用户发送失败回执：保留既有 metadata，累加重试计数并记录错误（达到上限由拉取侧死信过滤跳过） */
async function recordEmailFailures(items: Notification[], error: unknown): Promise<void> {
  const message = failureText(error);
  for (const n of items) {
    const metadata = n.metadata as Record<string, unknown> | null;
    const attempts = Number(metadata?.email_attempts ?? 0);
    await markEmailFailed(n.id, {
      ...metadata,
      email_attempts: attempts + 1,
      email_error: message.slice(0, 500),
    });
  }
}

/**
 * 失败轮次的运行记录。
 *
 * `pulled` 与 `progress` 都必须是**已经发生的事实**，不能是 0 占位：崩在发送中途的那一轮，
 * 队列头部正压着东西、而且可能已经有人的邮件真的寄出去了。把它记成 `{pulled:0,sent:0}` 会让
 * A05 的「空发送轮次」（只数 `pulled>0 && sent===0 && failed===0`）把一轮**成功**的发送
 * 报成空转——那是比「看不见」更糟：看板会教人相信一个假信号。
 */
async function recordFailedRun(
  startedAt: number,
  error: unknown,
  pulled: number,
  progress: DigestProgress,
  /**
   * 本轮开始时取到的积压数；`null` = 崩在取数之前，这一轮**没有**这个读数。
   *
   * 与 `pulled`/`progress` 同一条纪律：只写已经发生的事实。填 0 会让这一轮看起来
   * 是「空队列时崩的」，而跨天趋势会把 0 当成「积压已经清零」的证据。
   */
  backlog: number | null,
): Promise<void> {
  const message = failureText(error);
  try {
    await recordWorkerRun({
      pulled,
      sent: progress.sent,
      groups: progress.groups,
      failed: progress.failed,
      durationMs: Date.now() - startedAt,
      error: message.slice(0, 500),
      backlog,
      // 与 sent/failed 同一口径：中断前跳过了几条就记几条。它不是「整轮的最终值」，
      // 但和其他三列一样是**已发生的事实**，不会因为记成 0 而谎报「这一轮一条都没跳过」。
      skipped: progress.skipped,
    });
  } catch (recordError) {
    await logApiError("[Cron Digest] 失败轮次写入运行记录失败", recordError);
  }
}

/** 一轮 digest 的进度；就地累加，好让整轮抛错时也能记下已经发生了什么。 */
interface DigestProgress {
  sent: number;
  groups: number;
  failed: number;
  /**
   * 本轮按用户条件跳过的条数（无邮箱 / 偏好关闭，含**部分**关闭）。
   *
   * **它是 A05 判定的一半输入**，所以必须**真的记下来**：
   * 早先这里靠 `result.skipped ?? 0` 取值，而 `DigestProgress` 根本没有这个字段，
   * 于是它恒为 0 —— 一个「跳过率」指标恒等于零，
   * 比没有这个指标更坏（它看起来是被测过的）。
   */
  skipped: number;
}

/**
 * 按用户偏好把本轮拉到的通知分成两堆：可投递的与「被偏好挡下」的。
 *
 * 抽成函数有两个理由，第二个是硬性的：① 这段划分的语义（两堆都必须被消费，
 * 否则被挡下的那批永不出队）值得有个名字；② 内联时 `runDigest` 的圈复杂度
 * 会顶到 16（上限 15，`eslint` 的 complexity 规则）——而这个上限调高就等于
 * 承认「这个函数已经没人能一眼读完」。
 */
function splitByPreference(
  prefs: Parameters<typeof shouldSendEmail>[0],
  items: Notification[],
): { filtered: Notification[]; blocked: Notification[] } {
  const filtered: Notification[] = [];
  const blocked: Notification[] = [];
  for (const n of items) {
    const deliverable = shouldSendEmail(prefs, n.type as Parameters<typeof shouldSendEmail>[1]);
    if (deliverable) filtered.push(n);
    else blocked.push(n);
  }
  return { filtered, blocked };
}

async function runDigest(
  siteUrl: string,
  notifications: Notification[],
  progress: DigestProgress,
): Promise<DigestProgress> {
  const byUser = new Map<string, Notification[]>();
  const profiles = new Map<string, ProfileRow>();
  for (const n of notifications) {
    const key = n.user_id;
    if (!byUser.has(key)) byUser.set(key, []);
    byUser.get(key)?.push(n);
    profiles.set(key, { email: null, notification_settings: null });
  }

  await getProfiles(profiles);

  for (const [userId, items] of byUser) {
    const profile = profiles.get(userId);
    // 没有邮箱就没有可投递目标。这不是故障，所以既不 `markEmailSent`（伪造投递事实）也不
    // `markEmailFailed`（没有「重试几次」可言）——A05 定的口径是写原因让它**离开队列**：
    // 在此之前这类行永远占住 `created_at` 升序 + limit 100 的队首，攒够 100 条之后
    // 新的、可投递的通知再也拉不到（实时通道 `email-notify.ts` 对同样条件也是早退，条目会持续产生）。
    // 原因写入失败时**不**降级成「照样跳过就算完」：那一行会留在队列里被反复拉起，
    // 所以照 `receipt_failed{stage="skip"}` 报出去，让「跳过了但没出队」这件事可见。
    if (!profile?.email) {
      recordMetric("cron.digest.skipped", items.length, {
        unit: "count",
        attributes: { reason: "no_email" },
      });
      progress.skipped += items.length;
      await markSkippedWithReceipt(items, "no_email");
      continue;
    }

    const prefs = (profile.notification_settings ?? {}) as Parameters<typeof shouldSendEmail>[0];
    /**
     * **分成两堆，而不是只留一堆**。
     *
     * 此前这里只有 `filtered = items.filter(shouldSendEmail)`，出队回执又只在
     * `filtered.length === 0` 时对**全部** items 调用——于是「偏好**部分**关闭」这一格
     * （用户开着总开关、关掉 `securityAlerts` 之类）掉进两个分支之间：
     * 被挡下的那几条既不在 `filtered` 里（不会 `markEmailSent`），
     * 也没走 `filtered.length === 0`（不会 `markEmailSkipped`）⇒ `email_sent=false`
     * 且 `email_skipped_reason` 仍是 null ⇒ **永远留在队列里**，每轮被重新拉起。
     * 这正是 A05 要修的那个形状（不可投递的行占住 `created_at` 升序 + limit 100 的队首），
     * 只不过它只在混合类型的用户身上出现，而当时的用例只覆盖了「全开」和「全关」两格。
     *
     * 顺带这也是 `check:cron-contract` 抓不到它的原因：那条规则的判据是「带条件的
     * `continue` 必须留下计数证据」，而这条路径**没有 `continue`**——它悄悄少传了一堆行。
     */
    const { filtered, blocked: blockedByPreference } = splitByPreference(prefs, items);
    if (filtered.length === 0) {
      // 用户把所有相关类型都关掉了：这是选择而不是故障，但必须可见，
      // 否则「拉到了却没发出去」与错峰门控那次一样无法区分。
      recordMetric("cron.digest.skipped", items.length, {
        unit: "count",
        attributes: { reason: "preference" },
      });
      progress.skipped += items.length;
      await markSkippedWithReceipt(items, "preferences_off");
      continue;
    }
    /**
     * **剩下的这一格此前没有分支**：偏好**部分**关闭时，被挡下的那几条
     * 既不在 `filtered` 里（不会 `markEmailSent`），也不满足上面那个
     * `filtered.length === 0`（不会 `markEmailSkipped`）⇒ `email_sent=false`
     * 且 `email_skipped_reason` 仍是 null ⇒ **永远留在队列里**，每轮被重新拉起。
     * 这正是 A05 要修的那个形状（不可投递的行占住 `created_at` 升序 + limit 100 的队首），
     * 只不过它只在混合类型的用户身上出现，而当时的用例只覆盖了「全开」和「全关」两格。
     *
     * 顺带这也是 `check:cron-contract` 抓不到它的原因：那条规则的判据是「带条件的
     * `continue` 必须留下计数证据」，而这条路径**没有 `continue`**——它悄悄少传了一堆行。
     * （本轮修它时，把这段逻辑挪到 `filtered.length === 0` 之前，门禁立刻以
     * `CRON_SKIP_UNCOUNTED` 变红——它要求那条 `continue` 的分支**自己**带证据。
     * 所以两格各留一份：可见性不能靠「另一处已经记过了」来成立。）
     */
    if (blockedByPreference.length > 0) {
      recordMetric("cron.digest.skipped", blockedByPreference.length, {
        unit: "count",
        attributes: { reason: "preference" },
      });
      progress.skipped += blockedByPreference.length;
      await markSkippedWithReceipt(blockedByPreference, "preferences_off");
    }

    const subject = `IndieStack 通知摘要（${filtered.length} 条）`;
    const html = renderEmailHtml(siteUrl, subject, filtered);
    try {
      await sendResendEmail({ to: profile.email, subject, html });
    } catch (error) {
      // 单用户失败不阻断整轮，留待重试或死信
      try {
        await recordEmailFailures(filtered, error);
      } catch (receiptError) {
        // 发送确实失败了，所以 failed 照记；没写进去的是**重试次数**，
        // 那意味着这一批的 `email_attempts` 冻结，下一轮还会被拉起来——必须说清是哪一半坏了。
        recordMetric("cron.digest.receipt_failed", 1, {
          unit: "count",
          attributes: { stage: "retry" },
        });
        await logApiError("[Cron Digest] 失败回执写入失败（该行重试次数未累加，下一轮仍会重发）", receiptError);
      }
      progress.failed += filtered.length;
      continue;
    }

    // provider 已经收下这封信，所以 sent 先累加：后面回执写不写得动都不改变「寄出去了」这件事。
    progress.groups += 1;
    progress.sent += filtered.length;
    for (const n of filtered) {
      try {
        await markEmailSent(n.id);
      } catch (receiptError) {
        recordMetric("cron.digest.receipt_failed", 1, {
          unit: "count",
          attributes: { stage: "sent" },
        });
        await logApiError(
          "[Cron Digest] 邮件已发出，但发送回执写入失败（下一轮摘要可能重复寄出）",
          receiptError,
        );
      }
    }
  }

  return progress;
}

async function handle(request: NextRequest) {
  // E03：拒绝原因进指标，否则 CRON_SECRET 漏配（平台每轮调用都 401）在指标上完全静默
  const auth = checkCronAuth(request.headers, process.env.CRON_SECRET);
  if (auth !== "authorized") {
    recordCronRejected("digest", auth);
    return jsonNoStore({ error: "Unauthorized" }, { status: 401 });
  }

  const siteUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  // 整轮耗时：包含积压查询与拉取，口径与 push-retry worker 一致
  const startedAt = Date.now();
  /** 本轮实际拉到的条数；catch 分支要靠它把失败轮次记成真实数字。 */
  let pulled = 0;
  /**
   * 本轮开始时的积压读数（迁移 035 的 `backlog` 列）。
   *
   * **提到 try 外面并初始化为 `null`，不是 0**：崩在 `countUnsentEmailNotifications()`
   * 之前的那一轮拿不到这个数，而失败分支照样要落一行运行记录。写 0 会让跨天趋势
   * 把「取数失败」读成「积压已清零」——那是 A05 最想抓的反面形态，且看起来像好消息。
   * `null` 会一路传到 `toDailyDigestReadings`，那里的纪律是「没有读数的轮次连同日期
   * 一起排除在趋势之外」（宁可判「数据不足」）。
   */
  let backlog: number | null = null;
  /** 发送进度就累加在这里：整轮抛错时也要能记下「已经寄出去了哪些」。 */
  const progress: DigestProgress = { sent: 0, groups: 0, failed: 0, skipped: 0 };

  try {
    // C03 积压告警：待发通知超阈值时 Sentry 上报（logApiError → captureException，
    // 同消息自动分组），每轮 cron 最多提醒一次
    backlog = await countUnsentEmailNotifications();
    recordMetric("email.backlog", backlog, { unit: "count" });
    if (backlog > EMAIL_BACKLOG_ALERT_THRESHOLD) {
      await logApiError(
        `[Cron Digest] 队列积压 ${backlog} 条（阈值 ${EMAIL_BACKLOG_ALERT_THRESHOLD}）`,
        new Error("email_backlog_threshold_exceeded"),
      );
    }

    const notifications = await listUnsentEmailNotifications();
    pulled = notifications.length;
    if (pulled === 0) {
      const durationMs = Date.now() - startedAt;
      // 空队列这一轮的两笔观测读数都是**真实的 0**：backlog=0 是刚取到的，
      // skipped=0 是「一条都没拉起，所以不可能跳过任何一条」。
      // 与失败分支的 `null` 区别开：那里是「不知道」。
      await recordWorkerRun({
        pulled: 0,
        sent: 0,
        groups: 0,
        failed: 0,
        durationMs,
        backlog,
        skipped: 0,
      });
      recordMetric("cron.digest.completed", durationMs, {
        unit: "ms",
        attributes: { pulled: 0, sent: 0, groups: 0, failed: 0 },
      });
      // **必须带 skipped**：空队列这一轮确实跳过了 0 条，所以值是 0，
      // 但字段**要在**——否则同一个端点会因为走哪条 return 而返回两种形状，
      // 而读日志/写脚本的人正是按「形状固定」来解析它的。
      return jsonNoStore({ sent: 0, groups: 0, failed: 0, skipped: 0 });
    }

    const result = await runDigest(siteUrl, notifications, progress);
    const durationMs = Date.now() - startedAt;

    // A05 的观察窗口：**「积压高」与「队列卡死」是两件事，原来只有前者会喊。**
    // 积压高但每轮都在发出，是正常的业务量；积压高且「拉满 limit 却一封没发」，
    // 说明队首被不可投递的行占死了——`listUnsentEmailNotifications` 是
    // `created_at` 升序 + limit 100，可投递的新通知再也拉不到。
    // 两种形态在积压数字上长得一样，所以这里补一条独立信号（判定口径见
    // `src/lib/notifications/digest-verdict.ts`，那里也有对应的纯函数与单测）。
    const roundVerdict = judgeDigestRound({
      date: new Date().toISOString().slice(0, 10),
      pulled,
      sent: result.sent,
      // `failed` 必须一起给：只凭 `sent=0` 判「队首被占死」会把一次 provider 故障
      // 诊断成队列语义问题（详见 `digest-verdict.ts` 里那一栏的注释）。
      failed: result.failed,
      backlog,
      skipped: result.skipped,
    });
    recordMetric("cron.digest.verdict", 1, {
      unit: "count",
      attributes: { code: roundVerdict.code, attention: String(roundVerdict.attention) },
    });
    if (roundVerdict.attention) {
      await logApiError(
        `[Cron Digest] 队列判定 ${roundVerdict.code}：${roundVerdict.reason}`,
        new Error(`digest_verdict_${roundVerdict.code}`),
      );
    }
    // C02 运行记录：落表失败不影响发送结果返回
    try {
      await recordWorkerRun({
        pulled,
        sent: result.sent,
        groups: result.groups,
        failed: result.failed,
        durationMs,
        // A05 跨天趋势的两个输入：**本轮各自的观测值**，不是当前快照。
        // 不传这两笔，序列里那些天的 backlog/skipped 会是 NULL，
        // 而 `toDailyDigestReadings` 只能把它们排除在趋势之外。
        backlog,
        skipped: result.skipped,
      });
    } catch (metricsError) {
      await logApiError("[Cron Digest] 运行记录写入失败", metricsError);
    }
    // APM 关键流程埋点（C01）：cron 运行指标上报后尽力 flush
    recordMetric("cron.digest.completed", durationMs, {
      unit: "ms",
      attributes: { pulled, ...result },
    });
    trackEvent("cron.digest", { pulled, ...result });
    try {
      await flushEvents();
    } catch {
      // flush 自身已吞错，此处仅兜底
    }
    return jsonNoStore(result);
  } catch (error) {
    recordMetric("cron.digest.failed", 1, {
      attributes: { error_type: error instanceof Error ? error.name : "unknown" },
    });
    await recordFailedRun(startedAt, error, pulled, progress, backlog);
    await logApiError("[Cron Digest] 执行失败", error);
    return jsonNoStore({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * Vercel Cron 用 **GET** 触发本路由；POST 保留给手动运维调用。
 * 两条必须指向同一个 `handle`：分开写会让「调度器真正走的那条方法」落在测试覆盖面之外，
 * 而 405 那次事故恰恰就是只有 POST 有实现、有测试。
 */
export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
