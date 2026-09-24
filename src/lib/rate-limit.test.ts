/**
 * Rate Limiter 单元测试
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { RATE_LIMIT } from "@/lib/constants";
import { checkActionRateLimit, createRateLimit, rateLimit } from "./rate-limit";

/** 让 checkActionRateLimit() 里的动态 import 命中一个可编排的 headers() */
const headersMock = vi.hoisted(() => ({ headers: vi.fn() }));
vi.mock("next/headers", () => headersMock);

describe("createRateLimit()", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("should allow requests within limit", async () => {
    const limiter = createRateLimit({ maxRequests: 5, windowMs: 60_000 });

    for (let i = 0; i < 5; i++) {
      const result = await limiter.check(new Request("http://localhost:3000"));
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(5 - i - 1);
    }

    limiter.clear();
  });

  it("should block requests exceeding limit", async () => {
    const limiter = createRateLimit({ maxRequests: 3, windowMs: 60_000 });

    await limiter.check(new Request("http://localhost:3000"));
    await limiter.check(new Request("http://localhost:3000"));
    await limiter.check(new Request("http://localhost:3000"));

    const result = await limiter.check(new Request("http://localhost:3000"));
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);

    limiter.clear();
  });

  it("should reset after window expires", async () => {
    const limiter = createRateLimit({ maxRequests: 2, windowMs: 60_000 });

    await limiter.check(new Request("http://localhost:3000"));
    await limiter.check(new Request("http://localhost:3000"));

    // Exceeded
    const blocked = await limiter.check(new Request("http://localhost:3000"));
    expect(blocked.allowed).toBe(false);

    // Advance time past window
    vi.advanceTimersByTime(60_001);

    // Should be allowed again
    const allowed = await limiter.check(new Request("http://localhost:3000"));
    expect(allowed.allowed).toBe(true);
    expect(allowed.remaining).toBe(1);

    limiter.clear();
  });

  it("should track different IPs separately", async () => {
    const limiter = createRateLimit({ maxRequests: 2, windowMs: 60_000 });

    const req1 = new Request("http://localhost:3000", {
      headers: { "x-forwarded-for": "1.2.3.4" },
    });
    const req2 = new Request("http://localhost:3000", {
      headers: { "x-forwarded-for": "5.6.7.8" },
    });

    // First IP uses all requests
    await limiter.check(req1);
    await limiter.check(req1);
    const blocked = await limiter.check(req1);
    expect(blocked.allowed).toBe(false);

    // Second IP should still be allowed
    const allowed = await limiter.check(req2);
    expect(allowed.allowed).toBe(true);

    limiter.clear();
  });

  it("should use x-real-ip as fallback", async () => {
    const limiter = createRateLimit({ maxRequests: 1, windowMs: 60_000 });

    const req = new Request("http://localhost:3000", {
      headers: { "x-real-ip": "10.0.0.1" },
    });

    const result = await limiter.check(req);
    expect(result.allowed).toBe(true);

    const blocked = await limiter.check(req);
    expect(blocked.allowed).toBe(false);

    limiter.clear();
  });

  it("should handle clear() correctly", async () => {
    const limiter = createRateLimit({ maxRequests: 1, windowMs: 60_000 });

    await limiter.check(new Request("http://localhost:3000"));
    expect(limiter.size()).toBe(1);

    limiter.clear();
    expect(limiter.size()).toBe(0);

    const result = await limiter.check(new Request("http://localhost:3000"));
    expect(result.allowed).toBe(true);
  });
});

describe("窗口重置与并发", () => {
  it("窗口过期后计数重置", async () => {
    vi.useFakeTimers();
    const rl = createRateLimit({ maxRequests: 2, windowMs: 1000 });
    const req = new Request("http://x/", { headers: { "x-real-ip": "1.1.1.9" } });

    expect((await rl.check(req)).allowed).toBe(true);
    expect((await rl.check(req)).allowed).toBe(true);
    expect((await rl.check(req)).allowed).toBe(false);

    vi.advanceTimersByTime(1100);
    expect((await rl.check(req)).allowed).toBe(true);
    vi.useRealTimers();
  });

  it("不同 IP 互不影响", async () => {
    const rl = createRateLimit({ maxRequests: 1, windowMs: 60_000 });
    const a = new Request("http://x/", { headers: { "x-real-ip": "2.2.2.2" } });
    const b = new Request("http://x/", { headers: { "x-real-ip": "3.3.3.3" } });
    expect((await rl.check(a)).allowed).toBe(true);
    expect((await rl.check(a)).allowed).toBe(false);
    expect((await rl.check(b)).allowed).toBe(true);
  });
});

describe("Server Action 的客户端身份（checkActionRateLimit）", () => {
  const DEFAULT_MAX = RATE_LIMIT.maxRequests;

  beforeEach(() => {
    rateLimit.clear();
  });

  afterEach(() => {
    rateLimit.clear();
    vi.mocked(headersMock.headers).mockReset();
  });

  async function setClientIp(ip: string | null): Promise<void> {
    const entries: [string, string][] = ip === null ? [] : [["x-real-ip", ip]];
    vi.mocked(headersMock.headers).mockResolvedValue(new Headers(entries) as never);
  }

  it("一个 IP 打满配额不会影响另一个 IP", async () => {
    await setClientIp("203.0.113.11");
    let firstBlockedAt = -1;
    for (let i = 1; i <= DEFAULT_MAX + 1; i += 1) {
      const r = await checkActionRateLimit();
      if (!r.allowed) {
        firstBlockedAt = i;
        break;
      }
    }
    expect(firstBlockedAt, "打满默认配额后应当出现限流").toBe(DEFAULT_MAX + 1);

    await setClientIp("198.51.100.22");
    const other = await checkActionRateLimit();
    expect(other.allowed, "另一个客户端不该共享同一个桶").toBe(true);
  });

  it("拿不到请求头时退化为匿名桶而不是抛错", async () => {
    vi.mocked(headersMock.headers).mockRejectedValue(new Error("outside of a request context"));
    const r = await checkActionRateLimit();
    expect(r.allowed).toBe(true);
  });
});

describe("限流调用点必须带真实客户端身份", () => {
  /**
   * 判据：把 Request 现造一个交给限流器，就等于把所有人塞进 "anonymous" 同一个桶。
   * 这条扫描同时跑在合成样本与本仓库源码上——只有本仓库那一次为 0 是不够的，
   * 必须先证明它抓得到那个形状。
   */
  function findHeaderlessLimiterCalls(files: { path: string; content: string }[]): string[] {
    const hits: string[] = [];
    for (const file of files) {
      const lines = file.content.split("\n");
      lines.forEach((line, i) => {
        const trimmed = line.trim();
        // 注释里可以描述这个形状（否则连「别这么写」都没法写），代码里不行
        if (trimmed.startsWith("*") || trimmed.startsWith("/*") || trimmed.startsWith("//")) return;
        if (/\.check\(\s*new\s+Request\(/.test(line) && !/headers/.test(line)) {
          hits.push(`${file.path}:${i + 1}`);
        }
      });
    }
    return hits;
  }

  it("阳性对照：这种写法必须被抓到，写在注释里的不算", () => {
    const bad = [{
      path: "sample.ts",
      content: '  const limits = await rateLimit.check(new Request("http://local/redeem"));\n',
    }];
    expect(findHeaderlessLimiterCalls(bad)).toEqual(["sample.ts:1"]);
    const good = [{
      path: "sample.ts",
      content: "  const limits = await rateLimit.check(request);\n",
    }, {
      path: "sample2.ts",
      content: '  const limits = await rateLimit.check(new Request(url, { headers }));\n',
    }, {
      path: "sample3.ts",
      content: ' * 以前是 `rateLimit.check(new Request("http://local/x"))`，那是缺陷\n',
    }];
    expect(findHeaderlessLimiterCalls(good)).toEqual([]);
  });

  it("本仓库 src/ 里已经没有这种调用点", () => {
    const files = fs
      .readdirSync("src", { withFileTypes: true, recursive: true })
      .filter((e) => e.isFile() && /\.(ts|tsx)$/.test(e.name) && !/\.(test|spec)\.(ts|tsx)$/.test(e.name))
      .map((e) => {
        const abs = path.join(e.parentPath, e.name);
        return {
          path: path.relative(process.cwd(), abs).split(path.sep).join("/"),
          content: fs.readFileSync(abs, "utf8"),
        };
      });
    expect(files.length, "扫描必须有分母").toBeGreaterThan(100);
    expect(findHeaderlessLimiterCalls(files)).toEqual([]);
  });
});
