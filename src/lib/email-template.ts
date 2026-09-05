/**
 * 邮件 HTML 模板（从 cron 路由抽出，供 digest 与实时单发共用）
 * 600px 表格布局，与 Supabase Auth 邮件骨架同源（docs/design/email-templates.md）。
 */
import { foldDigestNotifications, type DigestEntry } from "@/lib/email-digest";
import type { Notification } from "@/lib/repositories/notifications";

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

/** 渲染通知邮件正文：单条通知即时单发、多条通知摘要共用同一骨架 */
export function renderEmailHtml(siteUrl: string, subject: string, notifications: Notification[]): string {
  const body = `
            <h2 style="margin:0 0 16px;color:#0f172a">${escapeHtml(subject)}</h2>
            <ul style="margin:0 0 24px;padding-left:18px;line-height:1.6">${buildNotificationList(notifications)}</ul>
            <a href="${escapeHtml(siteUrl)}"
               style="display:inline-block;padding:12px 32px;background:#2563eb;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:600">
              查看通知
            </a>`;
  // 用函数形式替换：replacement 字符串中的 $&/$' 等特殊模式会被展开，用户内容需原样注入
  return renderSkeleton(siteUrl, "{{BODY}}").replace("{{BODY}}", () => body);
}

/**
 * 通用单 CTA 邮件（订阅确认等操作类邮件）：
 * 与通知邮件同一骨架，正文为一段文字 + 单按钮，可附页脚备注（如退订链接）。
 */
export function renderActionEmail(input: {
  siteUrl: string;
  subject: string;
  bodyText: string;
  ctaUrl: string;
  ctaLabel: string;
  footerNote?: string;
}): string {
  const body = `
            <h2 style="margin:0 0 16px;color:#0f172a">${escapeHtml(input.subject)}</h2>
            <p style="margin:0 0 24px;color:#475569;line-height:1.6">${escapeHtml(input.bodyText)}</p>
            <a href="${escapeHtml(input.ctaUrl)}"
               style="display:inline-block;padding:12px 32px;background:#2563eb;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:600">
              ${escapeHtml(input.ctaLabel)}
            </a>${input.footerNote ? `
            <p style="margin:24px 0 0;color:#94a3b8;font-size:12px">${input.footerNote}</p>` : ""}`;
  return renderSkeleton(input.siteUrl, "{{BODY}}").replace("{{BODY}}", () => body);
}

function renderSkeleton(siteUrl: string, body: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc">
      <tr><td align="center" style="padding:32px 16px">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden">
          <tr><td style="background:linear-gradient(135deg,#0f172a,#1e1b4b);padding:24px;text-align:center">
            <span style="color:#ffffff;font-size:20px;font-weight:700">IndieStack</span>
          </td></tr>
          <tr><td style="padding:32px">${body}</td></tr>
          <tr><td style="padding:16px;background:#f1f5f9;text-align:center">
            <span style="color:#94a3b8;font-size:12px">If you didn't request this, please ignore this email.</span>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}
