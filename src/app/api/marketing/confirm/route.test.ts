/**
 * 营销订阅确认/退订公开路由测试（v0.5.0 A05）
 * 覆盖：缺 token 400、命中 302 跳转、未命中 404、数据库错误 500
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST as confirmPOST, GET as confirmGET } from "./route";
import { POST as unsubscribePOST, GET as unsubscribeGET } from "../unsubscribe/route";
import { clearMarketingTokenBucket } from "@/lib/marketing/request";

const { confirmMock, unsubscribeMock } = vi.hoisted(() => ({
  confirmMock: vi.fn(),
  unsubscribeMock: vi.fn(),
}));

vi.mock("@/lib/repositories/marketing", () => ({
  confirmSubscription: confirmMock,
  unsubscribeByToken: unsubscribeMock,
}));

beforeEach(() => {
  vi.clearAllMocks();
  // 两只端点共用一只按 IP 的滑窗桶（C10）：不复位的话，先跑的用例会把后跑的打成 429，
  // 整套用例就变成一条顺序依赖的 flake。
  clearMarketingTokenBucket();
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
});

function req(path: string) {
  return new NextRequest(`https://app.example.com${path}`);
}

describe("POST /api/marketing/confirm", () => {
  it("缺 token 返回 400", async () => {
    const res = await confirmPOST(req("/api/marketing/confirm"));
    expect(res.status).toBe(400);
  });

  it("token 命中：置 subscribed 并 302 跳转", async () => {
    confirmMock.mockResolvedValue(true);
    const res = await confirmPOST(req("/api/marketing/confirm?token=t1"));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://app.example.com/?marketing=confirmed");
    expect(confirmMock).toHaveBeenCalledWith("t1");
  });

  it("token 未命中返回 404", async () => {
    confirmMock.mockResolvedValue(false);
    const res = await confirmPOST(req("/api/marketing/confirm?token=bad"));
    expect(res.status).toBe(404);
  });

  it("数据库错误返回 500 不泄露细节", async () => {
    confirmMock.mockRejectedValue(new Error("boom detail"));
    const res = await confirmPOST(req("/api/marketing/confirm?token=t1"));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toMatch(/boom/);
  });
});

describe("POST /api/marketing/unsubscribe", () => {
  it("token 命中：置 unsubscribed 并 302 跳转", async () => {
    unsubscribeMock.mockResolvedValue(true);
    const res = await unsubscribePOST(req("/api/marketing/unsubscribe?token=t1"));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://app.example.com/?marketing=unsubscribed");
    expect(unsubscribeMock).toHaveBeenCalledWith("t1");
  });

  it("token 未命中返回 404", async () => {
    unsubscribeMock.mockResolvedValue(false);
    const res = await unsubscribePOST(req("/api/marketing/unsubscribe?token=bad"));
    expect(res.status).toBe(404);
  });
});


describe("marketing routes do not mutate on GET", () => {
  it("confirm GET renders a non-mutating form", async () => {
    expect((await confirmGET(req("/api/marketing/confirm?token=" + "a".repeat(48)))).status).toBe(200);
  });
  it("unsubscribe GET renders a non-mutating form", async () => {
    expect((await unsubscribeGET(req("/api/marketing/unsubscribe?token=" + "a".repeat(48)))).status).toBe(200);
  });

  it("确认页会安全转义 token，且表单 action 固定", async () => {
    const payload = '\"><img src=x onerror=alert(1)>';
    const response = await confirmGET(
      req(`/api/marketing/confirm?token=${encodeURIComponent(payload)}`),
    );
    const html = await response.text();

    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).toContain('action="/api/marketing/confirm"');
  });

  it("退订页会安全转义 token，且表单 action 固定", async () => {
    const payload = '\"><img src=x onerror=alert(1)>';
    const response = await unsubscribeGET(
      req(`/api/marketing/unsubscribe?token=${encodeURIComponent(payload)}`),
    );
    const html = await response.text();

    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).toContain('action="/api/marketing/unsubscribe"');
  });
});

describe("公开 token 端点的限频（C10）", () => {
  /** 阈值与 passkey 匿名入口同档：10 次 / 分钟 / IP。 */
  const LIMIT = 10;

  it("同一来源打到第 11 次返回 429，并且不再碰数据库", async () => {
    confirmMock.mockResolvedValue(true);
    const statuses: number[] = [];
    for (let i = 0; i < LIMIT + 1; i += 1) {
      const res = await confirmPOST(req("/api/marketing/confirm?token=t1"));
      statuses.push(res.status);
    }
    expect(statuses.slice(0, LIMIT)).toEqual(new Array(LIMIT).fill(302));
    expect(statuses[LIMIT]).toBe(429);
    // 被限频挡住的那些请求不能落到仓储层，否则限频只是改了个说法
    expect(confirmMock).toHaveBeenCalledTimes(LIMIT);
  });

  it("确认与退订共用一只桶：它们是同一个滥用面，分开计数等于阈值翻倍", async () => {
    unsubscribeMock.mockResolvedValue(true);
    confirmMock.mockResolvedValue(true);
    for (let i = 0; i < LIMIT; i += 1) {
      const res = await unsubscribePOST(req("/api/marketing/unsubscribe?token=t1"));
      expect(res.status).toBe(302);
    }
    const res = await confirmPOST(req("/api/marketing/confirm?token=t1"));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it("GET 只是渲染表单、不写库，所以不吃配额", async () => {
    const token = "a".repeat(48);
    for (let i = 0; i < LIMIT + 5; i += 1) {
      expect((await confirmGET(req(`/api/marketing/confirm?token=${token}`))).status).toBe(200);
    }
    confirmMock.mockResolvedValue(true);
    const res = await confirmPOST(req(`/api/marketing/confirm?token=${token}`));
    expect(res.status).toBe(302);
  });
});
