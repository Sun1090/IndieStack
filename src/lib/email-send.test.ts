/**
 * email-send（Resend provider）契约测试（v0.6.0 F08）
 * 锁定发送通道的 wire contract，供 B06 Web Push provider 抽象落地时复用同一断言模式：
 *   - 端点：默认 DEFAULT_RESEND_ENDPOINT，RESEND_API_URL 可覆盖
 *   - 鉴权头：Authorization: Bearer {RESEND_API_KEY}；Content-Type: application/json
 *   - body：{ from, to: [input.to], subject, html }（from 默认/覆盖；to 恒为数组）
 *   - 缺 key 抛错且不发请求；2xx 静默 resolve；非 2xx 抛 `resend {status}: {detail}`
 *   - 发送层不吞错、不重试：网络错误原样上抛且 fetch 仅一次（重试/死信归调用方）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendResendEmail, DEFAULT_RESEND_ENDPOINT, DEFAULT_EMAIL_FROM } from "./email-send";

type FetchResponseMock = { ok: boolean; status: number; text: () => Promise<string> };
const fetchMockResolved: FetchResponseMock = {
  ok: true,
  status: 200,
  text: async () => "",
};
let fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) =>
  Promise.resolve(fetchMockResolved),
);

const INPUT = { to: "a@b.c", subject: "安全告警", html: "<p>hi</p>" };

function sentCall(): { endpoint: string; init: RequestInit } {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [endpoint, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return { endpoint, init };
}

function sentHeaders(init: RequestInit): Record<string, string> {
  return (init.headers ?? {}) as Record<string, string>;
}

function sentBody(init: RequestInit): {
  from: string;
  to: string[];
  subject: string;
  html: string;
} {
  return JSON.parse(String(init.body)) as {
    from: string;
    to: string[];
    subject: string;
    html: string;
  };
}

beforeEach(() => {
  fetchMockResolved.ok = true;
  fetchMockResolved.status = 200;
  fetchMockResolved.text = async () => "";
  fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) =>
    Promise.resolve(fetchMockResolved),
  );
  vi.stubGlobal("fetch", fetchMock);
  process.env.RESEND_API_KEY = "rk_test_key";
  delete process.env.RESEND_API_URL;
  delete process.env.RESEND_FROM;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_URL;
  delete process.env.RESEND_FROM;
});

describe("sendResendEmail(): Resend provider contract", () => {
  it("默认端点：POST 到 DEFAULT_RESEND_ENDPOINT", async () => {
    await expect(sendResendEmail(INPUT)).resolves.toBeUndefined();
    const { endpoint, init } = sentCall();
    expect(endpoint).toBe(DEFAULT_RESEND_ENDPOINT);
    expect(init.method).toBe("POST");
  });

  it("RESEND_API_URL 覆盖端点（E2E 捕获端点同机制）", async () => {
    process.env.RESEND_API_URL = "http://localhost:3100/api/e2e/email-inbox";
    await expect(sendResendEmail(INPUT)).resolves.toBeUndefined();
    expect(sentCall().endpoint).toBe("http://localhost:3100/api/e2e/email-inbox");
  });

  it("鉴权与内容头：Bearer {key} + application/json", async () => {
    await expect(sendResendEmail(INPUT)).resolves.toBeUndefined();
    const headers = sentHeaders(sentCall().init);
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["Authorization"]).toBe("Bearer rk_test_key");
  });

  it("body 契约：from 默认、to 为数组、subject/html 原样透传", async () => {
    await expect(sendResendEmail(INPUT)).resolves.toBeUndefined();
    const body = sentBody(sentCall().init);
    expect(body.from).toBe(DEFAULT_EMAIL_FROM);
    expect(body.to).toEqual([INPUT.to]);
    expect(body.subject).toBe(INPUT.subject);
    expect(body.html).toBe(INPUT.html);
  });

  it("RESEND_FROM 覆盖发件人", async () => {
    process.env.RESEND_FROM = "Ops <ops@indiestack.dev>";
    await expect(sendResendEmail(INPUT)).resolves.toBeUndefined();
    expect(sentBody(sentCall().init).from).toBe("Ops <ops@indiestack.dev>");
  });

  it("RESEND_API_KEY 缺失：抛 RESEND_API_KEY missing 且不发起请求", async () => {
    delete process.env.RESEND_API_KEY;
    await expect(sendResendEmail(INPUT)).rejects.toThrow("RESEND_API_KEY missing");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("2xx：静默 resolve，不读取也不依赖响应体", async () => {
    fetchMockResolved.ok = true;
    await expect(sendResendEmail(INPUT)).resolves.toBeUndefined();
  });

  it("非 2xx：抛 `resend {status}: {detail}`，detail 来自响应体", async () => {
    fetchMockResolved.ok = false;
    fetchMockResolved.status = 503;
    fetchMockResolved.text = async () => '{"message":"rate limited"}';
    await expect(sendResendEmail(INPUT)).rejects.toThrow('resend 503: {"message":"rate limited"}');
  });

  it("非 2xx 且响应体读取失败：仍以状态码抛出（detail 置空）", async () => {
    fetchMockResolved.ok = false;
    fetchMockResolved.status = 503;
    fetchMockResolved.text = async () => {
      throw new Error("body read error");
    };
    await expect(sendResendEmail(INPUT)).rejects.toThrow("resend 503: ");
  });

  it("网络错误：原样上抛且不重试（fetch 仅一次），重试语义归调用方", async () => {
    const networkError = new Error("ECONNREFUSED");
    fetchMock = vi.fn(() => Promise.reject(networkError));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendResendEmail(INPUT)).rejects.toThrow("ECONNREFUSED");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
