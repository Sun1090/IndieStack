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

/** 单用户发送失败回执：保留既有 metadata，累加重试计数并记录错误（达到上限由拉取侧死信过滤跳过） */
async function recordEmailFailures(items: Notification[], error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
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
 * 失败轮次也要落表：否则 `email_worker_runs` 只记录成功与空队列，
 * 「worker 一直在失败」在 admin 看板上表现为「根本没有运行记录」。落表失败不覆盖原始错误。
 */
async function recordFailedRun(startedAt: number, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  try {
    await recordWorkerRun({
      pulled: 0,
      sent: 0,
      groups: 0,
      failed: 0,
      durationMs: Date.now() - startedAt,
      error: message.slice(0, 500),
    });
  } catch (recordError) {
    await logApiError("[Cron Digest] 失败轮次写入运行记录失败", recordError);
  }
}

async function runDigest(
  siteUrl: string,
  notifications: Notification[],
): Promise<{ sent: number; groups: number; failed: number }> {
  const byUser = new Map<string, Notification[]>();
  const profiles = new Map<string, ProfileRow>();
  for (const n of notifications) {
    const key = n.user_id;
    if (!byUser.has(key)) byUser.set(key, []);
    byUser.get(key)?.push(n);
    profiles.set(key, { email: null, notification_settings: null });
  }

  await getProfiles(profiles);

  let sent = 0;
  let groups = 0;
  let failed = 0;
  for (const [userId, items] of byUser) {
    const profile = profiles.get(userId);
    // 没有邮箱就没有可投递目标。这类条目既不发送也不累加 `email_attempts`，因此永远留在队列里：
    // 靠 `email.backlog` 可见，但同时长期占住按 `created_at` 升序的前 100 条拉取窗口
    // （偏好全关时实时通道 `email-notify.ts:91` 同样早退，所以条目会持续积累）——
    // 让跳过的条目真正出队属于 v0.12.0 的 A05，不要在这里用 `markEmailSent` 假装发过。
    if (!profile?.email) continue;

    const prefs = (profile.notification_settings ?? {}) as Parameters<typeof shouldSendEmail>[0];
    const filtered = items.filter((n) => shouldSendEmail(prefs, n.type as Parameters<typeof shouldSendEmail>[1]));
    if (filtered.length === 0) continue;

    const subject = `IndieStack 通知摘要（${filtered.length} 条）`;
    const html = renderEmailHtml(siteUrl, subject, filtered);
    try {
      await sendResendEmail({ to: profile.email, subject, html });
    } catch (error) {
      // 单用户失败不阻断整轮，留待重试或死信
      await recordEmailFailures(filtered, error);
      failed += filtered.length;
      continue;
    }

    groups += 1;
    for (const n of filtered) await markEmailSent(n.id);
    sent += filtered.length;
  }

  return { sent, groups, failed };
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
    const pulled = notifications.length;
    if (pulled === 0) {
      const durationMs = Date.now() - startedAt;
      await recordWorkerRun({ pulled: 0, sent: 0, groups: 0, failed: 0, durationMs });
      recordMetric("cron.digest.completed", durationMs, {
        unit: "ms",
        attributes: { pulled: 0, sent: 0, groups: 0, failed: 0 },
      });
      return jsonNoStore({ sent: 0, groups: 0, failed: 0 });
    }

    const result = await runDigest(siteUrl, notifications);
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
    await recordFailedRun(startedAt, error);
    await logApiError("[Cron Digest] 执行失败", error);
    return jsonNoStore({ error: "Internal server error" }, { status: 500 });
  }
}
