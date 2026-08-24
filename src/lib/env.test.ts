import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("env 校验", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
  });
  afterEach(() => vi.unstubAllEnvs());

  async function load() {
    return import("./env");
  }

  it("核心变量齐全时 ok", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://x.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "k");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "s");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
    const { getEnvReport } = await load();
    expect(getEnvReport().ok).toBe(true);
  });

  it("service_role 与 URL 不成对时报问题", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "k");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "s");
    const { getEnvReport } = await load();
    const report = getEnvReport();
    expect(report.ok).toBe(false);
    expect(report.problems.some((p) => p.includes("同时提供"))).toBe(true);
  });

  it("生产缺 APP_URL 提示 https 地址", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://x.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "k");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "s");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
    delete (process.env as Record<string, string | undefined>).NEXT_PUBLIC_APP_URL;
    const { getEnvReport } = await load();
    expect(getEnvReport().problems.some((p) => p.includes("NEXT_PUBLIC_APP_URL"))).toBe(true);
  });
});
