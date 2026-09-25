/**
 * Mock 模式真值表测试（C13）
 * 覆盖：生产构型下两条来源都不成立、非生产下显式开关与自动兜底各自生效、
 *       模块级常量确实读的是导入时的 process.env。
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { evaluateMockMode, isMockEnabled, shouldUseMock } from "./config";

const URL = "https://project.example.supabase.co";

describe("evaluateMockMode", () => {
  it("生产构型：显式 true 也不开 mock", () => {
    expect(evaluateMockMode({ NODE_ENV: "production", NEXT_PUBLIC_MOCK_ENABLED: "true", NEXT_PUBLIC_SUPABASE_URL: URL }))
      .toBe(false);
  });

  it("生产构型：显式 true 且 Supabase 未配置，仍然不开（宁可 500，不许假登录）", () => {
    expect(evaluateMockMode({ NODE_ENV: "production", NEXT_PUBLIC_MOCK_ENABLED: "true" })).toBe(false);
  });

  it("生产构型：没配 Supabase 也不会被自动兜底成 mock", () => {
    expect(evaluateMockMode({ NODE_ENV: "production" })).toBe(false);
  });

  it("非生产：显式 true 打开 mock（哪怕凭据齐全）", () => {
    expect(evaluateMockMode({ NODE_ENV: "test", NEXT_PUBLIC_MOCK_ENABLED: "true", NEXT_PUBLIC_SUPABASE_URL: URL }))
      .toBe(true);
  });

  it("非生产：没配 Supabase 时自动兜底打开", () => {
    expect(evaluateMockMode({ NODE_ENV: "development" })).toBe(true);
  });

  it("非生产：凭据齐全且没开开关 ⇒ 走真实客户端", () => {
    expect(evaluateMockMode({ NODE_ENV: "development", NEXT_PUBLIC_SUPABASE_URL: URL })).toBe(false);
  });

  it("开关只认字符串 true，其它值按未设置处理", () => {
    for (const value of ["1", "TRUE", "yes", " false", "false", ""]) {
      expect(evaluateMockMode({ NODE_ENV: "development", NEXT_PUBLIC_MOCK_ENABLED: value, NEXT_PUBLIC_SUPABASE_URL: URL }), value)
        .toBe(false);
    }
  });
});

describe("模块级常量", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("isMockEnabled / shouldUseMock 读的是导入时的 process.env", async () => {
    // 生产 + 显式 true 是这次要关的那一格：常量为 true 就等于中间件把假用户放行，
    // 所以这一格必须由**导入时**的判定保证，而不是由调用方各自补闸门。
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_MOCK_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", URL);
    vi.resetModules();
    const fresh = await import("./config");
    expect(fresh.isMockEnabled).toBe(false);
    expect(fresh.shouldUseMock()).toBe(false);
  });

  it("当前测试环境（非生产）里两条导出仍然一致", () => {
    expect(shouldUseMock()).toBe(isMockEnabled);
  });
});
