/**
 * /api/cron/retention 路由测试
 * 覆盖：鉴权拒绝归因、成功计数、部分失败仍 200、全失败 500、未处理异常指标。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { metricEvents } from "@/lib/testing/metric-events";
import { NextRequest } from "next/server";
import { POST } from "./route";

const { runRetentionSweepsMock, logApiErrorMock } = vi.hoisted(() => ({
  runRetentionSweepsMock: vi.fn(),
  logApiErrorMock: vi.fn(async () => {}),
}));

vi.mock("@/lib/repositories/retention", () => ({
  runRetentionSweeps: runRetentionSweepsMock,
}));
vi.mock("@/lib/api-log", () => ({ logApiError: logApiErrorMock }));

function req(secret = "***") {
  return new NextRequest("http://localhost/api/cron/retention", {
    headers: { "x-cron-secret": secret },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "***";
});

afterEach(() => vi.restoreAllMocks());

describe("/api/cron/retention", () => {
  it("缺少或错误 secret 返回 401，上报拒绝指标且不回显凭据", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    expect((await POST(new NextRequest("http://localhost/api/cron/retention"))).status).toBe(401);
    expect((await POST(req("wrong"))).status).toBe(401);
    expect(runRetentionSweepsMock).not.toHaveBeenCalled();

    expect(metricEvents(log)).toEqual([
      expect.objectContaining({
        name: "cron.auth.rejected",
        attributes: { worker: "retention", reason: "missing_credentials" },
      }),
      expect.objectContaining({
        name: "cron.auth.rejected",
        attributes: { worker: "retention", reason: "invalid_credentials" },
      }),
    ]);
    expect(JSON.stringify(log.mock.calls)).not.toContain("wrong");
  });

  it("全部清理成功时返回计数并上报轮次指标", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    runRetentionSweepsMock.mockResolvedValue({ ran: 6, failures: [] });

    const response = await POST(req());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ran: 6, failed: 0 });
    expect(metricEvents(log)).toEqual([
      expect.objectContaining({
        name: "cron.retention.completed",
        attributes: { ran: 6, failed: 0 },
      }),
    ]);
  });

  it("单个函数失败只影响它自己：整轮仍 200，但逐个上报清理失败指标", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    runRetentionSweepsMock.mockResolvedValue({
      ran: 5,
      failures: [{ cleanupFunction: "cleanup_old_api_usage", message: "permission denied" }],
    });

    const response = await POST(req());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ran: 5, failed: 1 });
    expect(metricEvents(log)).toEqual([
      expect.objectContaining({
        name: "cron.retention.cleanup_failed",
        value: 1,
        attributes: { cleanup_function: "cleanup_old_api_usage" },
      }),
      expect.objectContaining({ name: "cron.retention.completed" }),
    ]);
    expect(logApiErrorMock).toHaveBeenCalled();
  });

  it("一个都没清理成功时按 500 返回，避免调度记录显示成功", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    runRetentionSweepsMock.mockResolvedValue({
      ran: 0,
      failures: [
        { cleanupFunction: "cleanup_old_notifications", message: "connection timeout" },
        { cleanupFunction: "cleanup_old_webhook_events", message: "connection timeout" },
      ],
    });

    const response = await POST(req());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ ran: 0, failed: 2 });
    expect(metricEvents(log)).toEqual([
      expect.objectContaining({ name: "cron.retention.cleanup_failed" }),
      expect.objectContaining({ name: "cron.retention.cleanup_failed" }),
      expect.objectContaining({ name: "cron.retention.completed", attributes: { ran: 0, failed: 2 } }),
    ]);
  });

  it("未处理异常上报 cron.retention.failed 并返回 500", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    runRetentionSweepsMock.mockRejectedValue(new Error("admin client unavailable"));

    const response = await POST(req());

    expect(response.status).toBe(500);
    expect(metricEvents(log)).toEqual([
      expect.objectContaining({
        name: "cron.retention.failed",
        value: 1,
        attributes: { error_type: "Error" },
      }),
    ]);
    expect(logApiErrorMock).toHaveBeenCalled();
  });
});
