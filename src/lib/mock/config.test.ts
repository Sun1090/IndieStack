/**
 * Mock 模式真值表测试（C13）
 * 覆盖：生产构型下两条来源都不成立、非生产下显式开关与自动兜底各自生效、
 *       模块级常量确实读的是导入时的 process.env、常量的写法保持构建期可折叠。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

/**
 * 折叠提示的形状（不是风格问题，是 24.9 kB）。
 *
 * Next 只把 `process.env.X` 这类**成员表达式**替换成字面量；一旦初始化写成
 * `evaluateMockMode(process.env)`（把整个 env 对象传进去），打包器就折不出常量，
 * `if (isMockEnabled)` 两侧的真实客户端与整套 mock 数据都会留在产物里。
 * 实测（同机、每次 `rm -rf .next` 干净构建，2926.8 vs 2951.7 kB），
 * 而这 24.9 kB 只占基线的 0.9%——`check:bundle` 的 5% 预算根本拦不住它，所以在这里钉住形状。
 */
describe("isMockEnabled 必须是构建期可折叠的表达式", () => {
  const source = readFileSync(join(process.cwd(), "src/lib/mock/config.ts"), "utf8");

  it("初始化里直接写 process.env.NODE_ENV 的比较，而不是只把 process.env 交给函数", () => {
    const decl = /export const isMockEnabled =([\s\S]*?);\n/.exec(source);
    expect(decl, "找不到 export const isMockEnabled 的声明").not.toBeNull();
    expect(decl![1]).toMatch(/process\.env\.NODE_ENV\s*===\s*"production"/);
    expect(decl![1]).toMatch(/\?\s*false\s*:/);
  });
});
