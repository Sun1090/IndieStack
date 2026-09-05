/**
 * 营销订阅确认/退订公开路由测试（v0.5.0 A05）
 * 覆盖：缺 token 400、命中 302 跳转、未命中 404、数据库错误 500
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET as confirmGET } from "./route";
import { GET as unsubscribeGET } from "../unsubscribe/route";

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
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
});

function req(path: string) {
  return new NextRequest(`https://app.example.com${path}`);
}

describe("GET /api/marketing/confirm", () => {
  it("缺 token 返回 400", async () => {
    const res = await confirmGET(req("/api/marketing/confirm"));
    expect(res.status).toBe(400);
  });

  it("token 命中：置 subscribed 并 302 跳转", async () => {
    confirmMock.mockResolvedValue(true);
    const res = await confirmGET(req("/api/marketing/confirm?token=t1"));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://app.example.com/?marketing=confirmed");
    expect(confirmMock).toHaveBeenCalledWith("t1");
  });

  it("token 未命中返回 404", async () => {
    confirmMock.mockResolvedValue(false);
    const res = await confirmGET(req("/api/marketing/confirm?token=bad"));
    expect(res.status).toBe(404);
  });

  it("数据库错误返回 500 不泄露细节", async () => {
    confirmMock.mockRejectedValue(new Error("boom detail"));
    const res = await confirmGET(req("/api/marketing/confirm?token=t1"));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toMatch(/boom/);
  });
});

describe("GET /api/marketing/unsubscribe", () => {
  it("token 命中：置 unsubscribed 并 302 跳转", async () => {
    unsubscribeMock.mockResolvedValue(true);
    const res = await unsubscribeGET(req("/api/marketing/unsubscribe?token=t1"));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://app.example.com/?marketing=unsubscribed");
    expect(unsubscribeMock).toHaveBeenCalledWith("t1");
  });

  it("token 未命中返回 404", async () => {
    unsubscribeMock.mockResolvedValue(false);
    const res = await unsubscribeGET(req("/api/marketing/unsubscribe?token=bad"));
    expect(res.status).toBe(404);
  });
});
