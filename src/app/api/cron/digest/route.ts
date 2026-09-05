/**
 * 通知邮件 Worker（cron）
 * 外部 cron 定期调用；拉取待发邮件通知，按用户偏好过滤后统一发送。
 *
 * POST /api/cron/digest
 * Header: x-cron-secret = ***.CRON_SECRET
 */

import { NextRequest } from "next/server";
import { jsonNoStore } from "@/lib/api-response";
import { logApiError } from "@/lib/api-log";
import { shouldSendEmail } from "@/lib/notification-prefs";
import { foldDigestNotifications, type DigestEntry } from "@/lib/email-digest";
import {
  listUnsentEmailNotifications,
  markEmailSent,
  markEmailFailed,
  type Notification,
} from "@/lib/repositories/notifications";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

const DEFAULT_EMAIL_FROM = "IndieStack <onboarding@indiestack.dev>";

type ProfileRow = {
  email: string | null;
  notification_settings: Database["public"]["Tables"]["profiles"]["Row"]["notification_settings"];
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderEntry(entry: DigestEntry): string {
  if (entry.kind === "folded") {
    return `<li>${escapeHtml(entry.label)}通知 ×${entry.count} 条</li>`;
  }
  const title = escapeHtml(entry.title);
  const body = entry.body ? escapeHtml(entry.body) : "";
  return `<li>${title}${body ? `<br><span style="color:#64748b">${body}</span>` : ""}</li>`;
}

function buildNotificationList(notifications: Notification[]): string {
  const { entries, overflow } = foldDigestNotifications(notifications);
  const items = entries.map(renderEntry);
  if (overflow > 0) {
    items.push(`<li>…另有 ${overflow} 条通知，请登录查看</li>`);
  }
  return items.join("");
}

function renderEmailHtml(siteUrl: string, subject: string, notifications: Notification[]): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc">
      <tr><td align="center" style="padding:32px 16px">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden">
          <tr><td style="background:linear-gradient(135deg,#0f172a,#1e1b4b);padding:24px;text-align:center">
            <span style="color:#ffffff;font-size:20px;font-weight:700">IndieStack</span>
          </td></tr>
          <tr><td style="padding:32px">
            <h2 style="margin:0 0 16px;color:#0f172a">${escapeHtml(subject)}</h2>
            <ul style="margin:0 0 24px;padding-left:18px;line-height:1.6">${buildNotificationList(notifications)}</ul>
            <a href="${escapeHtml(siteUrl)}"
               style="display:inline-block;padding:12px 32px;background:#2563eb;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:600">
              查看通知
            </a>
          </td></tr>
          <tr><td style="padding:16px;background:#f1f5f9;text-align:center">
            <span style="color:#94a3b8;font-size:12px">If you didn't request this, please ignore this email.</span>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

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

async function runDigest(siteUrl: string, notifications: Notification[]): Promise<{
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
    profiles.set(key, { email: null, notification_settings: null });
  }

  await getProfiles(profiles);

  let sent = 0;
  let groups = 0;
  let failed = 0;
  for (const [userId, items] of byUser) {
    const profile = profiles.get(userId);
    const prefs = (profile?.notification_settings ?? {}) as Parameters<typeof shouldSendEmail>[0];
    const filtered = items.filter((n) => shouldSendEmail(prefs, n.type as Parameters<typeof shouldSendEmail>[1]));
    if (filtered.length === 0) continue;
    if (!profile?.email) continue;

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

async function sendResendEmail(input: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY missing");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM ?? DEFAULT_EMAIL_FROM,
      to: [input.to],
      subject: input.subject,
      html: input.html,
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`resend ${response.status}: ${detail}`);
  }
}

export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-cron-secret");
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret || secret !== expectedSecret) {
    return jsonNoStore({ error: "Unauthorized" }, { status: 401 });
  }

  const siteUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  try {
    const notifications = await listUnsentEmailNotifications();
    if (notifications.length === 0) {
      return jsonNoStore({ sent: 0, groups: 0, failed: 0 });
    }

    const result = await runDigest(siteUrl, notifications);
    return jsonNoStore(result);
  } catch (error) {
    await logApiError("[Cron Digest] 执行失败", error);
    return jsonNoStore({ error: "Internal server error" }, { status: 500 });
  }
}
