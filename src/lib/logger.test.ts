/**
 * 结构化日志工具单元测试
 * isDev / isVerbose 在模块加载时求值，因此通过 vi.resetModules + 动态导入控制环境
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/** 在指定环境变量下重新加载 logger 模块 */
async function loadLogger(env: Record<string, string | undefined>) {
  const saved = new Map<string, string | undefined>();
  for (const [k, v] of Object.entries(env)) {
    saved.set(k, process.env[k]);
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.resetModules();
  const mod = await import("./logger");
  // 还原环境，避免污染其他用例
  for (const [k, v] of saved) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return mod;
}

describe("logger（详细模式）", () => {
  const spies: Record<string, ReturnType<typeof vi.spyOn>> = {};

  beforeEach(() => {
    for (const level of ["debug", "info", "warn", "error"] as const) {
      spies[level] = vi.spyOn(console, level).mockImplementation(() => {});
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("debug/info/warn/error 输出带级别前缀与数据", async () => {
    const { logger } = await loadLogger({ NEXT_PUBLIC_VERBOSE_LOGGING: "true" });
    logger.debug("调试", { a: 1 });
    logger.info("用户登录成功", { userId: "u1" });
    logger.warn("资源紧张", { pct: 90 });
    logger.error("数据库失败", { db: "pg" }, new Error("boom"));

    expect(spies.debug).toHaveBeenCalledTimes(1);
    expect(String(spies.debug.mock.calls[0][0])).toMatch(/\[DEBUG\] 调试/);
    expect(String(spies.debug.mock.calls[0][0])).toContain('"a"');
    expect(String(spies.info.mock.calls[0][0])).toMatch(/\[INFO\] 用户登录成功/);
    expect(String(spies.warn.mock.calls[0][0])).toMatch(/\[WARN\] 资源紧张/);
    expect(String(spies.error.mock.calls[0][0])).toMatch(/\[ERROR\] 数据库失败/);
    expect(String(spies.error.mock.calls[0][0])).toContain("boom");
  });

  it("timer 记录耗时并输出 info", async () => {
    const { logger } = await loadLogger({ NEXT_PUBLIC_VERBOSE_LOGGING: "true" });
    const timer = logger.timer("查询");
    timer.end({ table: "users" });

    expect(spies.info).toHaveBeenCalledTimes(1);
    const msg = String(spies.info.mock.calls[0][0]);
    expect(msg).toMatch(/查询: \d+ms/);
    expect(msg).toContain("durationMs");
  });
});

describe("logger（生产模式）", () => {
  it("非 verbose 时不输出 console（error 仅走 Sentry，未初始化时为静默 no-op）", async () => {
    const spies = {
      debug: vi.spyOn(console, "debug").mockImplementation(() => {}),
      info: vi.spyOn(console, "info").mockImplementation(() => {}),
      warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
      error: vi.spyOn(console, "error").mockImplementation(() => {}),
    };

    const { logger } = await loadLogger({
      NODE_ENV: "production",
      NEXT_PUBLIC_VERBOSE_LOGGING: undefined,
    });
    logger.info("安静模式");
    logger.error("仅上报", { id: 1 }, new Error("x"));

    for (const spy of Object.values(spies)) {
      expect(spy).not.toHaveBeenCalled();
    }
    vi.restoreAllMocks();
  });
});
