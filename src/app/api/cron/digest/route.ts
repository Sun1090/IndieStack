/**
 * 通知邮件 Worker（cron）
 * 外部 cron 定期调用；拉取待发邮件通知，按用户偏好与时区过滤后统一发送。
 *
 * POST /api/cron/digest
 * Header: x-cron-secret = ***.CRON_SECRET
 *
 * v0.5.0：按用户时区错峰——仅发送处于本地 08:00 的用户（建议 cron 每小时调度）；
 * 单用户发送失败累加重试计数，达到上限由拉取侧死信过滤，不阻断整轮。
 */

import { NextRequest } from "next/server";
import { jsonNoStore } from "@/lib/api-response";
import { logApiError } from "@/lib/api-log";
import { shouldSendEmail } from "@/lib/notification-prefs";
import { isDigestHour } from "@/lib/email-digest";
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
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

type ProfileRow = {
  email: string | null;
  timezone: string | null;
  notification_settings: Database["public"]["Tables"]["profiles"]["Row"]["notification_settings"];
};

async function getProfiles(emails: Map<string, ProfileRow>): Promise<void> {
  if (emails.size === 0) return;
  const admin = createAdminClient();
  const userIds = Array.from(emails.keys());
  const { data, error } = await admin
    .from("profiles")
    .select("id,email,notification_settings,timezone")
    .in("id", userIds);
  if (error) throw error;
  for (const row of data ?? []) {
    emails.set(String((row as { id?: string }).id), {
      email: (row as { email?: string | null }).email ?? null,
      timezone: (row as { timezone?: string | null }).timezone ?? null,
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

async function runDigest(siteUrl: string, notifications: Notification[], now: Date): Promise<{
  sent: number;
  groups: number;
  failed: number;
}> {
  const byUser = new Map<string, Notification[]>();
  const profiles = new Map<string, ProfileRow>();
  for (const n of notifications) {
    const key = n.user_id;
    if (!byUser.has(key)) byUser.set(key, []);
    byUser.get(key)?.push(n);
    profiles.set(key, { email: null, timezone: null, notification_settings: null });
  }

  await getProfiles(profiles);

  let sent = 0;
  let groups = 0;
  let failed = 0;
  for (const [userId, items] of byUser) {
    const profile = profiles.get(userId);
    if (!profile?.email) continue;
    // A04 错峰：仅发送处于本地 digest 时刻的用户，未配置/非法时区回退默认时区
    if (!isDigestHour(profile.timezone, now)) continue;

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
  const secret = request.headers.get("x-cron-secret");
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret || secret !== expectedSecret) {
    return jsonNoStore({ error: "Unauthorized" }, { status: 401 });
  }

  const siteUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  // 经 Date.now 取当前时间，便于测试以 Date.now spy 固定错峰门控的时钟
  const now = new Date(Date.now());

  try {
    // C03 积压告警：待发通知超阈值时 Sentry 上报（logApiError → captureException，
    // 同消息自动分组），每轮 cron 最多提醒一次
    const backlog = await countUnsentEmailNotifications();
    if (backlog > EMAIL_BACKLOG_ALERT_THRESHOLD) {
      await logApiError(
        `[Cron Digest] 队列积压 ${backlog} 条（阈值 ${EMAIL_BACKLOG_ALERT_THRESHOLD}）`,
        new Error("email_backlog_threshold_exceeded"),
      );
    }

    const notifications = await listUnsentEmailNotifications();
    const pulled = notifications.length;
    if (pulled === 0) {
      await recordWorkerRun({ pulled: 0, sent: 0, groups: 0, failed: 0, durationMs: 0 });
      return jsonNoStore({ sent: 0, groups: 0, failed: 0 });
    }

    const startedAt = Date.now();
    const result = await runDigest(siteUrl, notifications, now);
    // C02 运行记录：落表失败不影响发送结果返回
    try {
      await recordWorkerRun({
        pulled,
        sent: result.sent,
        groups: result.groups,
        failed: result.failed,
        durationMs: Date.now() - startedAt,
      });
    } catch (metricsError) {
      await logApiError("[Cron Digest] 运行记录写入失败", metricsError);
    }
    return jsonNoStore(result);
  } catch (error) {
    await logApiError("[Cron Digest] 执行失败", error);
    return jsonNoStore({ error: "Internal server error" }, { status: 500 });
  }
}
