/**
 * email-marketing 单测（v0.5.0 A05）
 * 覆盖：确认邮件含确认链接与退订链接、营销邮件强制附加退订页脚
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendMarketingConfirmationEmail, sendMarketingEmail } from "./email-marketing";

const fetchMockResolved: { ok: boolean; text: () => Promise<string> } = { ok: true, text: async () => "" };
let fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) => Promise.resolve(fetchMockResolved));

beforeEach(() => {
  fetchMockResolved.ok = true;
  vi.stubGlobal("fetch", fetchMock);
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
  process.env.RESEND_API_KEY = "***";
});

function sentBody(): string {
  const init = fetchMock.mock.calls[0][1];
  return String(init?.body);
}

describe("sendMarketingConfirmationEmail()", () => {
  it("正文含确认链接与退订链接", async () => {
    await expect(sendMarketingConfirmationEmail("a@b.c", "tok1")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = sentBody();
    expect(body).toContain("https://app.example.com/api/marketing/confirm?token=tok1");
    expect(body).toContain("https://app.example.com/api/marketing/unsubscribe?token=tok1");
  });
});

describe("sendMarketingEmail()", () => {
  it("强制附加该收件人的退订页脚", async () => {
    await expect(
      sendMarketingEmail({ to: "a@b.c", token: "tok9", subject: "月度更新", html: "<p>hi</p>" }),
    ).resolves.toBeUndefined();
    const body = sentBody();
    expect(body).toContain("<p>hi</p>");
    expect(body).toContain("https://app.example.com/api/marketing/unsubscribe?token=tok9");
  });

  it("API key 缺失抛错", async () => {
    delete process.env.RESEND_API_KEY;
    await expect(
      sendMarketingEmail({ to: "a@b.c", token: "tok9", subject: "s", html: "<p></p>" }),
    ).rejects.toThrow("RESEND_API_KEY missing");
  });
});
