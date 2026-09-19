/**
 * Supabase 恢复循环指标契约测试（v0.6.0 E07）
 * 锁定：指标名与动作取值、每个终态 value=1 的计数语义、projectStatus 归一化。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { metricEvents } from "@/lib/testing/metric-events";
import {
  OPS_SUPABASE_RESTORE_METRIC,
  OPS_SUPABASE_RESTORE_ACTIONS,
  recordSupabaseRestoreCycle,
} from "./ops-metrics";

afterEach(() => vi.restoreAllMocks());

describe("指标契约常量", () => {
  it("指标名与动作取值是稳定契约", () => {
    expect(OPS_SUPABASE_RESTORE_METRIC).toBe("ops.supabase.restore");
    expect([...OPS_SUPABASE_RESTORE_ACTIONS]).toEqual([
      "noop",
      "restore",
      "wait",
      "escalate",
      "skipped",
    ]);
  });
});

describe("recordSupabaseRestoreCycle()", () => {
  it("每个动作都上报一条 value=1 的 count 样本", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    for (const action of OPS_SUPABASE_RESTORE_ACTIONS) {
      expect(recordSupabaseRestoreCycle({ action, projectStatus: "ACTIVE_HEALTHY" })).toBe(true);
    }

    const events = metricEvents(log);
    expect(events).toHaveLength(OPS_SUPABASE_RESTORE_ACTIONS.length);
    for (const [index, action] of OPS_SUPABASE_RESTORE_ACTIONS.entries()) {
      expect(events[index]).toEqual(
        expect.objectContaining({
          name: "ops.supabase.restore",
          value: 1,
          unit: "count",
          attributes: { action, projectStatus: "ACTIVE_HEALTHY" },
        }),
      );
    }
  });

  it("escalate 与 skipped 也产出 value=1，不会被值 0 静默吞掉", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    recordSupabaseRestoreCycle({ action: "escalate", projectStatus: "REMOVED" });
    recordSupabaseRestoreCycle({ action: "skipped" });

    expect(metricEvents(log)).toEqual([
      expect.objectContaining({ value: 1, attributes: { action: "escalate", projectStatus: "REMOVED" } }),
      expect.objectContaining({ value: 1, attributes: { action: "skipped", projectStatus: "unknown" } }),
    ]);
  });

  it("projectStatus 去空白，缺失或空白归一化为 unknown", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    recordSupabaseRestoreCycle({ action: "noop", projectStatus: "  RESTORING  " });
    recordSupabaseRestoreCycle({ action: "noop", projectStatus: "   " });
    recordSupabaseRestoreCycle({ action: "noop" });

    expect(metricEvents(log).map((event) => event.attributes?.projectStatus)).toEqual([
      "RESTORING",
      "unknown",
      "unknown",
    ]);
  });
});
