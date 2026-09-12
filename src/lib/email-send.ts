/**
 * Resend 发送通道（从 cron 路由抽出，供 digest 与实时单发共用）
 * RESEND_API_KEY 缺失或接口非 2xx 时抛错，由调用方决定重试/死信/吞错。
 * RESEND_API_URL 可覆盖端点：E2E 用它指向本地捕获端点，验证请求体而无需真实出网。
 *
 * 发送契约（F08 provider contract tests 锁定，勿单边改动）：
 *   POST {RESEND_API_URL ?? 默认端点}
 *   headers: Content-Type: application/json; Authorization: Bearer {RESEND_API_KEY}
 *   body: { from: RESEND_FROM ?? 默认, to: [input.to], subject, html }
 *   非 2xx → 抛 `resend {status}: {detail}`（detail 来自响应体，读取失败仍保留状态码）
 *   发送层不吞错、不重试：网络/HTTP 错误一律上抛，语义归调用方。
 */
import { startMetricTimer } from "@/lib/metrics";

export const DEFAULT_RESEND_ENDPOINT = "https://api.resend.com/emails";
export const DEFAULT_EMAIL_FROM = "IndieStack <onboarding@indiestack.dev>";

export async function sendResendEmail(input: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY missing");
  const endpoint = process.env.RESEND_API_URL ?? DEFAULT_RESEND_ENDPOINT;
  const timer = startMetricTimer("email.send.completed", { provider: "resend" });
  try {
    const response = await fetch(endpoint, {
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
      const detail = await response.text().catch(() => "");
      timer.end({ outcome: "failure", status: response.status });
      throw new Error(`resend ${response.status}: ${detail}`);
    }
    timer.end({ outcome: "success", status: response.status });
  } catch (error) {
    timer.end({ outcome: "failure" });
    throw error;
  }
}
