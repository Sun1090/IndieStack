/**
 * 邮件待发队列可观测口径单测（v0.12.0 A05 前半）
 * 纯函数：只验「队列有多少条、最老一条卡多久、几轮空发送」，不含出队语义。
 */
import { describe, it, expect } from "vitest";
import {
  deriveQueueDiagnostics,
  describePendingAge,
  PENDING_STALE_MS,
  type EmailWorkerRunRow,
} from "./queue-diagnostics";

const NOW = Date.parse("2026-09-22T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

function run(pulled: number, sent: number, failed: number): EmailWorkerRunRow {
  return { pulled, sent, failed };
}

function diagnose(overrides: Partial<Parameters<typeof deriveQueueDiagnostics>[0]> = {}) {
  return deriveQueueDiagnostics({
    pending: 0,
    oldestCreatedAt: null,
    recentRuns: [],
    nowMs: NOW,
    ...overrides,
  });
}

describe("deriveQueueDiagnostics()", () => {
  it("空队列没有年龄：pending=0 时即使传了时间戳也不上报", () => {
    const result = diagnose({
      pending: 0,
      oldestCreatedAt: new Date(NOW - 30 * 24 * HOUR).toISOString(),
    });
    expect(result).toEqual({
      pending: 0,
      oldestAgeMs: null,
      emptySendRounds: 0,
      stale: false,
    });
  });

  it("有积压才计算年龄", () => {
    expect(
      diagnose({
        pending: 3,
        oldestCreatedAt: new Date(NOW - 5 * HOUR).toISOString(),
      }).oldestAgeMs,
    ).toBe(5 * HOUR);
  });

  it("时钟回拨导致的未来时间戳按 0 处理，不报负数年龄", () => {
    expect(
      diagnose({ pending: 1, oldestCreatedAt: new Date(NOW + HOUR).toISOString() }).oldestAgeMs,
    ).toBe(0);
  });

  it("刚好跨到阈值即算卡住，差一毫秒不算", () => {
    expect(
      diagnose({ pending: 1, oldestCreatedAt: new Date(NOW - PENDING_STALE_MS).toISOString() })
        .stale,
    ).toBe(true);
    expect(
      diagnose({
        pending: 1,
        oldestCreatedAt: new Date(NOW - PENDING_STALE_MS + 1).toISOString(),
      }).stale,
    ).toBe(false);
  });

  it("没有积压时再久也不 stale：stale 说的是队列头部卡着东西", () => {
    expect(
      diagnose({ pending: 0, oldestCreatedAt: new Date(NOW - 30 * 24 * HOUR).toISOString() }).stale,
    ).toBe(false);
  });

  it("空发送轮次只数「拉到东西、一封没发、也没报错」", () => {
    const result = diagnose({
      pending: 1,
      oldestCreatedAt: new Date(NOW - HOUR).toISOString(),
      recentRuns: [
        run(5, 0, 0), // 空发送
        run(5, 4, 0), // 正常
        run(5, 0, 2), // 投递失败：由 A04 的可见性表达，不算空发送
        run(0, 0, 0), // 什么都没拉到
        run(1, 0, 0), // 空发送
      ],
    });
    expect(result.emptySendRounds).toBe(2);
  });

  it("轮次顺序不参与计算", () => {
    const runs = [run(1, 1, 0), run(2, 0, 0), run(3, 0, 1)];
    expect(diagnose({ recentRuns: runs }).emptySendRounds).toBe(
      diagnose({ recentRuns: [...runs].reverse() }).emptySendRounds,
    );
  });
});

describe("describePendingAge()", () => {
  it("没有年龄时不编造一个零", () => {
    expect(describePendingAge(null)).toBeNull();
  });

  it("不足一小时落在分钟档，负数不落进分钟档以下", () => {
    expect(describePendingAge(0)).toEqual({ value: 0, unit: "minutes" });
    expect(describePendingAge(59_000)).toEqual({ value: 0, unit: "minutes" });
    expect(describePendingAge(5 * 60_000 + 59_000)).toEqual({ value: 5, unit: "minutes" });
    expect(describePendingAge(-HOUR)).toEqual({ value: 0, unit: "minutes" });
  });

  it("满一小时换档，不足一小时不算一小时", () => {
    expect(describePendingAge(60 * 60_000 - 1)).toEqual({ value: 59, unit: "minutes" });
    expect(describePendingAge(HOUR)).toEqual({ value: 1, unit: "hours" });
  });

  it("天档与 stale 阈值同刻度：47h 仍是小时，48h 起才是天", () => {
    expect(describePendingAge(47 * HOUR + 59 * 60_000)).toEqual({ value: 47, unit: "hours" });
    expect(describePendingAge(PENDING_STALE_MS)).toEqual({ value: 2, unit: "days" });
    expect(describePendingAge(71 * HOUR)).toEqual({ value: 2, unit: "days" });
    expect(describePendingAge(72 * HOUR)).toEqual({ value: 3, unit: "days" });
  });
});
