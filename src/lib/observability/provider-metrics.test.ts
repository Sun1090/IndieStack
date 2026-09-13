/**
 * Provider 降级指标契约测试（v0.6.0 E06）
 * 锁定：指标名与原因取值、缺失变量签名的排序语义、上报维度、去重闸门状态机。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { metricEvents } from "@/lib/testing/metric-events";
import {
  PROVIDER_FALLBACK_METRIC,
  PROVIDER_FALLBACK_REASONS,
  OSS_INCOMPLETE_REASON,
  NOT_CONFIGURED_REASON,
  providerFallbackSignature,
  recordProviderFallback,
  createProviderFallbackGate,
} from "./provider-metrics";

afterEach(() => vi.restoreAllMocks());

describe("指标契约常量", () => {
  it("指标名与原因取值是稳定契约", () => {
    expect(PROVIDER_FALLBACK_METRIC).toBe("provider.fallback");
    expect([...PROVIDER_FALLBACK_REASONS]).toEqual(["oss-incomplete"]);
    expect(OSS_INCOMPLETE_REASON).toBe("oss-incomplete");
  });

  it("未配置原因与 Web Push 侧复用同一取值", () => {
    expect(NOT_CONFIGURED_REASON).toBe("not-configured");
  });
});

describe("providerFallbackSignature()", () => {
  it("排序后拼接，签名与传入顺序无关", () => {
    expect(providerFallbackSignature(["OSS_REGION", "OSS_BUCKET"])).toBe(
      "OSS_BUCKET,OSS_REGION",
    );
    expect(providerFallbackSignature(["OSS_BUCKET", "OSS_REGION"])).toBe(
      providerFallbackSignature(["OSS_REGION", "OSS_BUCKET"]),
    );
  });

  it("不修改传入数组，空集合得到空字符串", () => {
    const missing = ["OSS_REGION", "OSS_BUCKET"];
    providerFallbackSignature(missing);
    expect(missing).toEqual(["OSS_REGION", "OSS_BUCKET"]);
    expect(providerFallbackSignature([])).toBe("");
  });
});

describe("recordProviderFallback()", () => {
  it("上报一条 count 指标，维度为实际驱动 / 原因 / 排序后的缺失变量名", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    expect(
      recordProviderFallback({
        provider: "supabase",
        reason: OSS_INCOMPLETE_REASON,
        missing: ["OSS_REGION", "OSS_BUCKET"],
      }),
    ).toBe(true);

    expect(metricEvents(log)).toEqual([
      expect.objectContaining({
        name: "provider.fallback",
        value: 1,
        unit: "count",
        attributes: {
          provider: "supabase",
          reason: "oss-incomplete",
          missing: "OSS_BUCKET,OSS_REGION",
        },
      }),
    ]);
  });
});

describe("createProviderFallbackGate()", () => {
  it("同一签名只放行一次，签名变化重新放行", () => {
    const gate = createProviderFallbackGate();
    expect(gate.shouldReport("a,b")).toBe(true);
    expect(gate.shouldReport("a,b")).toBe(false);
    expect(gate.shouldReport("a")).toBe(true);
    expect(gate.shouldReport("a")).toBe(false);
  });

  it("null 表示配置恢复，重置后同一签名仍可再次放行", () => {
    const gate = createProviderFallbackGate();
    expect(gate.shouldReport("a")).toBe(true);
    expect(gate.shouldReport(null)).toBe(false);
    expect(gate.shouldReport("a")).toBe(true);
  });

  it("reset() 忘记上次签名", () => {
    const gate = createProviderFallbackGate();
    expect(gate.shouldReport("a")).toBe(true);
    expect(gate.shouldReport("a")).toBe(false);
    gate.reset();
    expect(gate.shouldReport("a")).toBe(true);
  });
});
