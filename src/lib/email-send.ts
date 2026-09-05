/**
 * Resend 发送通道（从 cron 路由抽出，供 digest 与实时单发共用）
 * RESEND_API_KEY 缺失或接口非 2xx 时抛错，由调用方决定重试/死信/吞错。
 */
const DEFAULT_EMAIL_FROM = "IndieStack <onboarding@indiestack.dev>";

export async function sendResendEmail(input: {
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
