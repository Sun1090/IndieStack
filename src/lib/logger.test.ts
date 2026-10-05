/**
 * 结构化日志工具单元测试
 * isDev / isVerbose 在模块加载时求值，因此通过 vi.resetModules + 动态导入控制环境
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sanitizeLogText } from "./logger";

const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException }));

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
  beforeEach(() => {
    captureException.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("非 verbose 时不输出 console，并将 error 上报 Sentry", async () => {
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
    const error = new Error("x");
    logger.info("安静模式");
    logger.error("仅上报", { id: 1 }, error);

    for (const spy of Object.values(spies)) {
      expect(spy).not.toHaveBeenCalled();
    }
    await vi.waitFor(() => expect(captureException).toHaveBeenCalledOnce());
    expect(captureException).toHaveBeenCalledWith(error, {
      extra: { id: 1, logLevel: "error" },
    });
  });
});

/**
 * 日志注入收口（CodeQL `js/log-injection`，告警 #11–#14）。
 * 这些用例是可失败的：去掉 `formatLog` 里的 `sanitizeLogText`，或去掉 Sentry 标题那一道，
 * 对应用例会红。
 */
describe("日志注入收口 sanitizeLogText()", () => {
  const spies: Record<string, ReturnType<typeof vi.spyOn>> = {};

  beforeEach(() => {
    captureException.mockClear();
    for (const level of ["debug", "info", "warn", "error"] as const) {
      spies[level] = vi.spyOn(console, level).mockImplementation(() => {});
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("换行 / 回车 / 制表符转成可见的转义，内容一个字都不丢", () => {
    expect(sanitizeLogText("a\nb")).toBe("a\\nb");
    expect(sanitizeLogText("a\r\nb")).toBe("a\\r\\nb");
    expect(sanitizeLogText("a\tb")).toBe("a\\tb");
  });

  it("其余控制字符按码位转义：ANSI、NUL、DEL、C1", () => {
    const at = (code: number) => String.fromCharCode(code);
    expect(sanitizeLogText(at(0x1b) + "[31mred" + at(0x1b) + "[39m")).toBe(
      "\\u001b[31mred\\u001b[39m",
    );
    expect(sanitizeLogText("a" + at(0) + "b")).toBe("a\\u0000b");
    expect(sanitizeLogText("a" + at(0x7f) + "b")).toBe("a\\u007fb");
    expect(sanitizeLogText("a" + at(0x9f) + "b")).toBe("a\\u009fb");
  });

  it("普通文本原样通过；转一次之后再转一次不变（幂等）", () => {
    const plain = "invoice in_1, 用户 u1 — 235ms /dashboard?tab=teams";
    expect(sanitizeLogText(plain)).toBe(plain);
    const once = sanitizeLogText("a\nb");
    expect(sanitizeLogText(once)).toBe(once);
  });

  it("请求体里的换行造不出第二条日志行", async () => {
    const { logger } = await loadLogger({ NEXT_PUBLIC_VERBOSE_LOGGING: "true" });
    logger.info("付款成功: invoice in_1\n[ERROR] 2026-09-24 00:00:00 全量重置已确认", {
      note: "a\r\nb",
    });

    const text = String(spies.info.mock.calls[0][0]);
    expect(text.includes("\n")).toBe(false);
    expect(text.includes("\r")).toBe(false);
    expect(text).toContain("in_1\\n[ERROR]");
    expect(text).toContain('"note":"a\\r\\nb"');
  });

  it("error.stack 里的多行与 ANSI 同样收口成一行", async () => {
    const { logger } = await loadLogger({ NEXT_PUBLIC_VERBOSE_LOGGING: "true" });
    const err = new Error("boom");
    err.stack = "Error: boom\n    at real\n" + String.fromCharCode(0x1b) + "[31m  at forged";
    logger.error("处理失败", { id: 7 }, err);

    const text = String(spies.error.mock.calls[0][0]);
    expect(text.includes("\n")).toBe(false);
    expect(text).toContain("at real\\n");
    expect(text).toContain("\\u001b[31m  at forged");
  });

  it("没有 error 实例时，Sentry 的标题也带着同一道收口", async () => {
    const { logger } = await loadLogger({
      NODE_ENV: "production",
      NEXT_PUBLIC_VERBOSE_LOGGING: undefined,
    });
    logger.error("登录失败\n[INFO] 管理员已批准");

    await vi.waitFor(() => expect(captureException).toHaveBeenCalledOnce());
    const reported = captureException.mock.calls[0][0] as Error;
    expect(reported.message.includes("\n")).toBe(false);
    expect(reported.message).toBe("登录失败\\n[INFO] 管理员已批准");
  });

  it("有 error 实例时原样交给 Sentry，不改调用方抛出的那个对象", async () => {
    const { logger } = await loadLogger({
      NODE_ENV: "production",
      NEXT_PUBLIC_VERBOSE_LOGGING: undefined,
    });
    const original = new Error("真实错误\n带换行的堆栈来源");
    logger.error("上下文", { id: 1 }, original);

    await vi.waitFor(() => expect(captureException).toHaveBeenCalledOnce());
    expect(captureException.mock.calls[0][0]).toBe(original);
    expect(original.message).toBe("真实错误\n带换行的堆栈来源");
  });
});

/**
 * 监控失效时必须留下证据（2026-10-05）。
 *
 * **背景**：生产实测发现该部署没有配 Sentry DSN，于是
 * 「邮件积压 > 500 会告警」这句话在**这个部署上是假的**——代码路径确实调用了
 * `captureException`，但没有 DSN 时它是空转，而原来的 `.catch(() => {})` 又把失败吞掉。
 * 结果是：**监控静默失效时，唯一能发现它的信号也被它自己吞了**，
 * 「告警不会响」与「没有告警」变得不可区分。
 *
 * 这组用例钉住修好之后的语义，分三件事：
 *  1. 上报失败**不让日志调用抛**（监控坏了不能把业务请求也搞失败）；
 *  2. 但**必须留证据**：一行 stderr + 一条 `sentry.report.failed` 指标；
 *  3. 上报成功时**不多写**（否则每次 error 都多两行噪声，没人愿意看日志）。
 */
describe("Sentry 上报失败时不静默", () => {
  // spy 必须放在 beforeEach 里而不是 describe 体：第一版写在 describe 体，
  // 结果第一个用例的 afterEach（vi.restoreAllMocks）把 spy 复原了，
  // 后三个用例记到的是一个已经失效的 mock——表现为「等了 1 秒也没等到」。
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    captureException.mockReset();
  });

  // 让 captureException 抛，而不是让模块加载失败：后者会被文件顶部那个 hoisted mock 盖掉，
  // 而且它模拟的是另一条路径。captureException 抛错才是「上报失败」的真实形态。
  async function loadWithBrokenSentry() {
    captureException.mockImplementation(() => {
      throw new Error("Sentry 未配置");
    });
    return loadLogger({ NODE_ENV: "production" });
  }

  it("上报失败时 logger.error 仍然正常返回（监控坏了不能弄坏业务）", async () => {
    const { logger } = await loadWithBrokenSentry();
    expect(() => logger.error("数据库炸了")).not.toThrow();
  });

  it("上报失败会留一行 stderr，指明是监控不可用而不是业务错误", async () => {
    const { logger } = await loadWithBrokenSentry();
    logger.error("数据库炸了");
    // 动态 import 的失败是异步的，且要经过不止一个微任务——固定 sleep 会 flaky，
    // 所以轮询等它落地（第一版用 setTimeout(0) 就是这里红的）。
    await vi.waitFor(() =>
      expect(
        errorSpy.mock.calls.map((call: unknown[]) => String(call[0])).join("\n"),
      ).toContain("Sentry 上报失败"),
    );
    const lines = errorSpy.mock.calls.map((call: unknown[]) => String(call[0]));
    // 这行必须能让人分辨「监控坏了」与「业务出错」，否则值班会查错方向
    expect(lines.some((line: string) => line.includes("监控当前不可用"))).toBe(true);
  });

  it("上报失败会产出 sentry.report.failed 指标（这是唯一不依赖 Sentry 的告警通道）", async () => {
    const { logger } = await loadWithBrokenSentry();
    logger.error("数据库炸了");
    await vi.waitFor(() =>
      expect(logSpy.mock.calls.map((call: unknown[]) => String(call[0])).join("\n")).toContain(
        "sentry.report.failed",
      ),
    );
  });

  it("上报成功时不产生多余噪声（否则每次 error 都多两行，没人愿意看日志）", async () => {
    captureException.mockReturnValue(undefined);
    const { logger } = await loadLogger({ NODE_ENV: "production" });
    logger.error("数据库炸了");
    await vi.waitFor(() => expect(captureException).toHaveBeenCalledTimes(1));
    // 给可能迟到的失败分支一个机会：成功路径下它不该在随后才补写一行噪声
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n")).not.toContain(
      "sentry.report.failed",
    );
  });
});
