/**
 * 通知邮件 Worker（cron）
 * 由 Vercel Cron 每天 09:00 UTC 调度（见 `vercel.json` 与 `src/lib/observability/cron-contract.ts`）；
 * 拉取待发邮件通知，按用户偏好分组后每人一封摘要发出。
 *
 * POST /api/cron/digest
 * Header: x-cron-secret = ***.CRON_SECRET
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
      await markSkippedWithReceipt(items, "no_email");
      continue;
    }

    const prefs = (profile.notification_settings ?? {}) as Parameters<typeof shouldSendEmail>[0];
    const filtered = items.filter((n) => shouldSendEmail(prefs, n.type as Parameters<typeof shouldSendEmail>[1]));
    if (filtered.length === 0) {
      // 用户把所有相关类型都关掉了：这是选择而不是故障，但必须可见，
      // 否则「拉到了却没发出去」与错峰门控那次一样无法区分。
      recordMetric("cron.digest.skipped", items.length, {
        unit: "count",
        attributes: { reason: "preference" },
      });
      await markSkippedWithReceipt(items, "preferences_off");
      continue;
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

export async function POST(request: NextRequest) {
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
  /** 发送进度就累加在这里：整轮抛错时也要能记下「已经寄出去了哪些」。 */
  const progress: DigestProgress = { sent: 0, groups: 0, failed: 0 };

  try {
    // C03 积压告警：待发通知超阈值时 Sentry 上报（logApiError → captureException，
    // 同消息自动分组），每轮 cron 最多提醒一次
    const backlog = await countUnsentEmailNotifications();
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
      await recordWorkerRun({ pulled: 0, sent: 0, groups: 0, failed: 0, durationMs });
      recordMetric("cron.digest.completed", durationMs, {
        unit: "ms",
        attributes: { pulled: 0, sent: 0, groups: 0, failed: 0 },
      });
      return jsonNoStore({ sent: 0, groups: 0, failed: 0 });
    }

    const result = await runDigest(siteUrl, notifications, progress);
    const durationMs = Date.now() - startedAt;
    // C02 运行记录：落表失败不影响发送结果返回
    try {
      await recordWorkerRun({
        pulled,
        sent: result.sent,
        groups: result.groups,
        failed: result.failed,
        durationMs,
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
    await recordFailedRun(startedAt, error, pulled, progress);
    await logApiError("[Cron Digest] 执行失败", error);
    return jsonNoStore({ error: "Internal server error" }, { status: 500 });
  }
}
