/**
 * 营销邮件通道（v0.5.0 A05）
 * 独立于 notifications 表：受众来自 marketing_subscriptions（仅 status=subscribed），
 * 每封营销邮件必须带该收件人的退订链接（公开退订路由凭 token 操作）。
 * 发送失败上抛，由调用方决定吞错（订阅确认）或记录（批量营销）。
 */
import { renderActionEmail } from "@/lib/email-template";
import { sendResendEmail } from "@/lib/email-send";

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

export function confirmUrl(token: string): string {
  return `${siteUrl()}/api/marketing/confirm?token=${token}`;
}

export function unsubscribeUrl(token: string): string {
  return `${siteUrl()}/api/marketing/unsubscribe?token=${token}`;
}

/** 订阅确认邮件（double opt-in 第二步） */
export async function sendMarketingConfirmationEmail(email: string, token: string): Promise<void> {
  const subject = "确认订阅 IndieStack 更新邮件";
  const html = renderActionEmail({
    siteUrl: siteUrl(),
    subject,
    bodyText: "你刚在 IndieStack 开启了营销邮件。请点击下方按钮确认订阅；若非本人操作，无需任何处理。",
    ctaUrl: confirmUrl(token),
    ctaLabel: "确认订阅",
    footerNote: `不想收到此类邮件？<a href="${unsubscribeUrl(token)}" style="color:#94a3b8">点此退订</a>`,
  });
  await sendResendEmail({ to: email, subject, html });
}

/** 营销邮件发送入口：正文由调用方渲染，退订页脚强制附加 */
export async function sendMarketingEmail(input: {
  to: string;
  token: string;
  subject: string;
  html: string;
}): Promise<void> {
  const htmlWithFooter = `${input.html}
<p style="margin:16px 0 0;color:#94a3b8;font-size:12px">
  你收到此邮件是因为订阅了 IndieStack 更新。
  <a href="${unsubscribeUrl(input.token)}" style="color:#94a3b8">点此退订</a>
</p>`;
  await sendResendEmail({ to: input.to, subject: input.subject, html: htmlWithFooter });
}
