/**
 * /api/cron/retention 路由测试
 * 覆盖：鉴权拒绝归因、成功计数、部分失败仍 200、全失败 500、未处理异常指标。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { metricEvents } from "@/lib/testing/metric-events";
import { NextRequest } from "next/server";
import { POST } from "./route";

const { runRetentionSweepsMock, listOrphanObjectsMock, logApiErrorMock } = vi.hoisted(() => ({
  runRetentionSweepsMock: vi.fn(),
  listOrphanObjectsMock: vi.fn(async () => [] as unknown[]),
  logApiErrorMock: vi.fn(async () => {}),
}));

vi.mock("@/lib/repositories/retention", () => ({
  runRetentionSweeps: runRetentionSweepsMock,
}));
vi.mock("@/lib/repositories/upload-objects", () => ({
  listOrphanObjects: listOrphanObjectsMock,
}));
vi.mock("@/lib/api-log", () => ({ logApiError: logApiErrorMock }));

function req(secret = "***") {
  return new NextRequest("http://localhost/api/cron/retention", {
    headers: { "x-cron-secret": secret },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks 不会清掉 mockRejectedValue 之类的手工实现，这里显式恢复默认，
  // 否则「巡检失败」那条会污染后面所有用例的孤儿计数。
  listOrphanObjectsMock.mockImplementation(async () => []);
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
    await expect(response.json()).resolves.toEqual({
      ran: 6,
      failed: 0,
      orphans: 0,
      unownedOrphans: 0,
    });
    expect(metricEvents(log)).toEqual([
      expect.objectContaining({ name: "storage.orphan.objects", value: 0 }),
      expect.objectContaining({ name: "storage.orphan.unowned", value: 0 }),
      expect.objectContaining({
        name: "cron.retention.completed",
        attributes: { ran: 6, failed: 0, orphans: 0 },
      }),
    ]);
  });

  it("每轮顺带只读巡检孤儿：账户已删的对象单独计数", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    runRetentionSweepsMock.mockResolvedValue({ ran: 6, failures: [] });
    listOrphanObjectsMock.mockResolvedValue([
      {
        bucket: "avatars",
        objectKey: "u1/a.png",
        ownerId: null,
        byteSize: 2048,
        createdAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
      },
      {
        bucket: "avatars",
        objectKey: "u2/b.png",
        ownerId: "u2",
        byteSize: 1024,
        createdAt: new Date().toISOString(),
      },
    ]);

    const response = await POST(req());

    await expect(response.json()).resolves.toMatchObject({ orphans: 2, unownedOrphans: 1 });
    expect(metricEvents(log)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "storage.orphan.objects", value: 2 }),
        expect.objectContaining({ name: "storage.orphan.unowned", value: 1 }),
      ]),
    );
  });

  it("巡检失败时不把「读不懂」报成「零孤儿」，也不影响保留期结论", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    runRetentionSweepsMock.mockResolvedValue({ ran: 6, failures: [] });
    listOrphanObjectsMock.mockRejectedValue(new Error("rpc gone"));

    const response = await POST(req());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ran: 6, failed: 0, orphans: null });
    expect(metricEvents(log).map((event) => event.name)).not.toContain("storage.orphan.objects");
    expect(metricEvents(log)).toEqual([
      expect.objectContaining({
        name: "cron.retention.completed",
        attributes: { ran: 6, failed: 0 },
      }),
    ]);
    expect(logApiErrorMock).toHaveBeenCalled();
  });

  it("单个函数失败只影响它自己：整轮仍 200，但逐个上报清理失败指标", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    runRetentionSweepsMock.mockResolvedValue({
      ran: 5,
      failures: [{ cleanupFunction: "cleanup_old_api_usage", message: "permission denied" }],
    });

    const response = await POST(req());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ran: 5, failed: 1 });
    expect(metricEvents(log)).toEqual([
      expect.objectContaining({
        name: "cron.retention.cleanup_failed",
        value: 1,
        attributes: { cleanup_function: "cleanup_old_api_usage" },
      }),
      expect.objectContaining({ name: "storage.orphan.objects" }),
      expect.objectContaining({ name: "storage.orphan.unowned" }),
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
      expect.objectContaining({ name: "storage.orphan.objects" }),
      expect.objectContaining({ name: "storage.orphan.unowned" }),
      expect.objectContaining({
        name: "cron.retention.completed",
        attributes: { ran: 0, failed: 2, orphans: 0 },
      }),
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
