/**
 * 实时通知邮件（v0.5.0 A03）
 * 高优先级类型在事件触发时即时单发，不经 cron 等待；
 * 发送失败不抛错，通知留在队列由 cron digest 重试（at-least-once 兜底）。
 */
import type { Notification } from "@/lib/repositories/notifications";
import { renderEmailHtml } from "@/lib/email-template";
import { sendResendEmail } from "@/lib/email-send";
import { shouldSendEmail } from "@/lib/notification-prefs";
import { logApiError } from "@/lib/api-log";
import {
  createNotification,
  markEmailSent,
  type NewNotification,
  type NotificationType,
} from "@/lib/repositories/notifications";
import { createAdminClient } from "@/lib/supabase/admin";

/** 实时单发类型：其余类型仅站内展示，邮件侧由 digest 统一打包 */
export const REALTIME_EMAIL_TYPES: ReadonlySet<NotificationType> = new Set([
  "security_alert",
  "team_invite",
  "role_changed",
  "payment_succeeded",
]);

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

async function fetchProfile(userId: string): Promise<{
  email: string | null;
  notification_settings: Parameters<typeof shouldSendEmail>[0];
} | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("id,email,notification_settings")
    .eq("id", userId)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    email: (data as { email?: string | null }).email ?? null,
    notification_settings: ((data as { notification_settings?: Record<string, unknown> })
      .notification_settings ?? {}) as Parameters<typeof shouldSendEmail>[0],
  };
}

/**
 * 事件触发通知：写入站内通知 + 高优先级类型即时单发邮件。
 * 站内写入失败向上抛（调用方各自吞错）；邮件侧任何失败只记日志，
 * 发送成功即回执 email_sent，cron 拉取自然跳过；失败则由 cron 兜底重试。
 */
export async function notifyUser(input: NewNotification): Promise<void> {
  const notificationId = await createNotification(input);

  if (!REALTIME_EMAIL_TYPES.has(input.type)) return;
  try {
    const profile = await fetchProfile(input.userId);
    if (!profile?.email) return;
    if (!shouldSendEmail(profile.notification_settings, input.type)) return;

    const notification: Notification = {
      id: notificationId ?? "",
      user_id: input.userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      link: input.link ?? null,
      metadata: null,
      created_at: new Date().toISOString(),
      is_read: false,
      email_sent: false,
    };
    const subject = `IndieStack 通知：${input.title}`;
    await sendResendEmail({
      to: profile.email,
      subject,
      html: renderEmailHtml(siteUrl(), subject, [notification]),
    });
    if (notificationId) await markEmailSent(notificationId);
  } catch (error) {
    await logApiError("[Email Notify] 实时通知邮件发送失败（留待 cron 重试）", error);
  }
}
