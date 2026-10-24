import { describe, expect, it } from "vitest";
import {
  assertLocalOnlyTarget,
  exitCodeForStorageErasure,
  judgeStorageErasure,
  type TargetGuard,
} from "./storage-erasure-drill";

const PASS: TargetGuard = { ok: true, reason: "本机栈 127.0.0.1", host: "127.0.0.1" };
const readings = (partial: Partial<Record<string, boolean>> = {}) => ({
  putOk: true,
  visibleOk: true,
  removeOk: true,
  goneAfterRemove: true,
  ...partial,
});

describe("assertLocalOnlyTarget（承重的是这道闸）", () => {
  it("本机 http 放行", () => {
    expect(assertLocalOnlyTarget("http://127.0.0.1:54321").ok).toBe(true);
    expect(assertLocalOnlyTarget("http://localhost:54321").ok).toBe(true);
  });

  it("生产的 supabase.co ⇒ 拒绝——.env.local 的默认值就是它", () => {
    const guard = assertLocalOnlyTarget("https://ntqggnztzvoavjbiillb.supabase.co");
    expect(guard.ok).toBe(false);
  });

  it("两条规则各自钉住，且不依赖谁先命中（协议 / 宿主是两回事）", () => {
    // 协议：http 但宿主是生产域名 ⇒ 必须被**宿主**规则拒。
    // 写成一条 `toContain("宿主不是本机")` 去断言生产 URL，就把「哪条先命中」
    // 这个实现细节钉成了用例——顺序一改就红，而红的是我的断言，不是世界。
    const hostOnly = assertLocalOnlyTarget("http://ntqggnztzvoavjbiillb.supabase.co");
    expect(hostOnly.ok).toBe(false);
    expect(hostOnly.reason).toContain("宿主不是本机");
    // 协议：本机宿主但 https ⇒ 必须被**协议**规则拒。
    const protocolOnly = assertLocalOnlyTarget("https://127.0.0.1:54321");
    expect(protocolOnly.ok).toBe(false);
    expect(protocolOnly.reason).toContain("只允许 http:");
  });

  it("空值与解析不出来的值 ⇒ 拒绝（不是放行）", () => {
    expect(assertLocalOnlyTarget(undefined).ok).toBe(false);
    expect(assertLocalOnlyTarget("   ").ok).toBe(false);
    const broken = assertLocalOnlyTarget("not a url");
    expect(broken.ok).toBe(false);
    expect(broken.reason).toContain("解析不出来");
  });

  it("「看着像本地」的相似串不能混过去（如 127.0.0.1.evil）", () => {
    expect(assertLocalOnlyTarget("http://127.0.0.1.evil.test").ok).toBe(false);
    expect(assertLocalOnlyTarget("http://localhost.evil.test").ok).toBe(false);
  });

  it("file: 之类的非 http 协议也被同一条规则挡住", () => {
    expect(assertLocalOnlyTarget("file:///tmp/x").ok).toBe(false);
  });
});

describe("judgeStorageErasure", () => {
  it("四步全过 ⇒ PASSED", () => {
    const report = judgeStorageErasure({ guard: PASS, provider: "supabase", supportsRemove: true, readings: readings() });
    expect(report.step).toBe("PASSED");
    expect(exitCodeForStorageErasure(report.step)).toBe(0);
  });

  it("闸拦下 ⇒ SKIPPED_GUARD 且声明未发写请求，退出码算「未验证」", () => {
    const guard = assertLocalOnlyTarget("https://x.supabase.co");
    const report = judgeStorageErasure({ guard, provider: "supabase", supportsRemove: true, readings: null });
    expect(report.step).toBe("SKIPPED_GUARD");
    expect(report.evidence).toContain("未发出任何写请求");
    expect(exitCodeForStorageErasure(report.step)).toBe(2);
  });

  it("驱动不声明 remove 能力 ⇒ SKIPPED_CAPABILITY（不谎称验过）", () => {
    const report = judgeStorageErasure({ guard: PASS, provider: "oss", supportsRemove: false, readings: null });
    expect(report.step).toBe("SKIPPED_CAPABILITY");
    expect(exitCodeForStorageErasure(report.step)).toBe(2);
  });

  it("上传失败 ⇒ FAILED_PUT", () => {
    expect(judgeStorageErasure({ guard: PASS, provider: "supabase", supportsRemove: true, readings: readings({ putOk: false }) }).step).toBe(
      "FAILED_PUT",
    );
    expect(judgeStorageErasure({ guard: PASS, provider: "supabase", supportsRemove: true, readings: null }).step).toBe("FAILED_PUT");
  });

  it("建好但读不到 ⇒ FAILED_VISIBLE（删除判据无从建立）", () => {
    expect(judgeStorageErasure({ guard: PASS, provider: "supabase", supportsRemove: true, readings: readings({ visibleOk: false }) }).step).toBe(
      "FAILED_VISIBLE",
    );
  });

  it("remove 调用失败 ⇒ FAILED_REMOVE", () => {
    expect(judgeStorageErasure({ guard: PASS, provider: "supabase", supportsRemove: true, readings: readings({ removeOk: false }) }).step).toBe(
      "FAILED_REMOVE",
    );
  });

  it("**remove 报成功但对象还在 ⇒ 单独成档**，这是最危险的一种", () => {
    const report = judgeStorageErasure({
      guard: PASS,
      provider: "supabase",
      supportsRemove: true,
      readings: readings({ goneAfterRemove: false }),
    });
    expect(report.step).toBe("FAILED_STILL_PRESENT");
    expect(report.evidence).toContain("静默");
    expect(exitCodeForStorageErasure(report.step)).toBe(1);
  });

  it("顺序：put 失败优先于 remove 失败报出（不掩盖第一步）", () => {
    const report = judgeStorageErasure({
      guard: PASS,
      provider: "supabase",
      supportsRemove: true,
      readings: readings({ putOk: false, removeOk: false }),
    });
    expect(report.step).toBe("FAILED_PUT");
  });
});
