/**
 * 队列读数组装单测（A05）
 * 锁两件事：每段查询的结果必须原样进规则；时钟由本模块注入而不是留在规则里读系统时间。
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

const { countMock, oldestMock, runsMock, skippedMock, readBeforeSendMock } = vi.hoisted(() => ({
  countMock: vi.fn(),
  oldestMock: vi.fn(),
  runsMock: vi.fn(),
  skippedMock: vi.fn(),
  readBeforeSendMock: vi.fn(),
}));
vi.mock("@/lib/repositories/notifications", () => ({
  countUnsentEmailNotifications: countMock,
  oldestUnsentEmailCreatedAt: oldestMock,
  countEmailSkippedByReason: skippedMock,
  countReadBeforeSendEmailNotifications: readBeforeSendMock,
}));
vi.mock("@/lib/repositories/worker-runs", () => ({
  listRecentEmailWorkerRuns: runsMock,
}));

import { readEmailQueueDiagnostics } from "./queue-observability";

const NOW = "2026-09-22T12:00:00.000Z";
const HOUR = 60 * 60 * 1000;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  skippedMock.mockResolvedValue({});
  readBeforeSendMock.mockResolvedValue(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("readEmailQueueDiagnostics()", () => {
  it("把五段查询原样交给规则，年龄按注入的时钟算", async () => {
    countMock.mockResolvedValue(4);
    oldestMock.mockResolvedValue(new Date(Date.parse(NOW) - 50 * HOUR).toISOString());
    runsMock.mockResolvedValue([
      { pulled: 2, sent: 0, failed: 0 },
      { pulled: 1, sent: 1, failed: 0 },
    ]);
    skippedMock.mockResolvedValue({ no_email: 3, preferences_off: 1 });
    readBeforeSendMock.mockResolvedValue(9);

    await expect(readEmailQueueDiagnostics()).resolves.toEqual({
      pending: 4,
      oldestAgeMs: 50 * HOUR,
      emptySendRounds: 1,
      stale: true,
      skippedByReason: { no_email: 3, preferences_off: 1 },
      skippedTotal: 4,
      readBeforeSend: 9,
    });
    expect(runsMock).toHaveBeenCalled();
    // 两笔「已经离开队列」的账各查一次；漏掉任何一笔，面板就会把「越堵」说成「越小」
    expect(skippedMock).toHaveBeenCalledTimes(1);
    expect(readBeforeSendMock).toHaveBeenCalledTimes(1);
  });

  it("队列为空时不编造年龄，但仍报得出两笔出队的账", async () => {
    countMock.mockResolvedValue(0);
    oldestMock.mockResolvedValue(null);
    runsMock.mockResolvedValue([]);
    skippedMock.mockResolvedValue({ no_email: 100 });
    readBeforeSendMock.mockResolvedValue(2);

    await expect(readEmailQueueDiagnostics()).resolves.toEqual({
      pending: 0,
      oldestAgeMs: null,
      emptySendRounds: 0,
      stale: false,
      skippedByReason: { no_email: 100, preferences_off: 0 },
      skippedTotal: 100,
      readBeforeSend: 2,
    });
  });
});
