/**
 * Rate Limiter 单元测试
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { isIP } from "node:net";
import { RATE_LIMIT } from "@/lib/constants";
import {
  checkActionRateLimit,
  clientIpFromHeaders,
  createRateLimit,
  isIpLike,
  rateLimit,
} from "./rate-limit";

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

/**
 * `isIpLike()` 是限流桶键与 `user_sessions.ip_address`（`inet` 列）唯一的形状闸门，
 * 而它此前是 `/^[\d.]+$/ || includes(":")`——上面 75 例语料里有 40 例判错，
 * 其中 64 例被判成「像 IP」。判据不自己发明：与 `node:net` 的 `isIP()` 逐例差分。
 */
describe("isIpLike()", () => {
  const CORPUS = [
    "0.0.0.0", "1.2.3.4", "255.255.255.255", "192.168.0.1", "10.0.0.1", "8.8.8.8",
    "256.1.1.1", "300.1.1.1", "1.2.3", "1.2.3.4.5", "1.2.3.4.", ".1.2.3.4", "1..2.3.4", "",
    "01.2.3.4", "1.02.3.4", "1.2.3.04", "12.", ".", "..", "999.999.999.999", " 1.2.3.4",
    "1.2.3.4 ", "1.2.3.4/24", "0x7f.0.0.1", "2130706433", "0.0.0.0.0",
    "::", "::1", "2001:db8::1", "2001:0db8:85a3:0000:0000:8a2e:0370:7334", "fe80::1",
    "1:2:3:4:5:6:7:8", "::ffff:1.2.3.4", "64:ff9b::192.0.2.33", "2001:db8::", "::2:3:4:5:6:7:8",
    "1:2:3:4:5:6:7", "1:2:3:4:5:6:7:8:9", "1:2:3:4:5:6:7:8::", "1::2::3", "gggg::1", "12345::",
    "1:2:3:4::5:6:7::8",
    ":1:2:3:4:5:6:7:8", "1:2:3:4:5:6:7:8:", "1:2:3:4:5:6:1.2.3.4", "1:2:3:4:5:6:7:1.2.3.4",
    "fe80::1%eth0", "2001:DB8::1", "::ffff:256.1.1.1", "abcd:ef01:2345:6789:abcd:ef01:2345:6789",
    "::a:b", "a::", "0:0:0:0:0:0:0:1",
    ":", ":::", "foo:", "a:b:c", "evil:", "http://x:", "x:y:z:1", "1:", ":1", "abc:def",
    "unknown", "anonymous", "null", "-", "*", "1.2.3.4, 5.6.7.8", "0", "0.0", "1:2:3:4:5:6:7:8:9:10",
  ];

  it("与 node:net 的 isIP() 逐例一致，唯一分歧是点名放行的 IPv6 zone id", () => {
    const disagreements = CORPUS.filter((value) => (isIP(value) !== 0) !== isIpLike(value));
    // zone id（`fe80::1%eth0`）判否是刻意的：代理不会写进转发头，而它进 `inet` 列的形态存疑。
    expect(disagreements).toEqual(["fe80::1%eth0"]);
    // 分母：语料必须真的覆盖两侧，否则「一致」是一句空断言。
    expect(CORPUS.filter((value) => isIP(value) !== 0).length).toBeGreaterThanOrEqual(15);
    expect(CORPUS.filter((value) => isIP(value) === 0).length).toBeGreaterThanOrEqual(15);
  });

  it("旧判据放过的畸形形状一律判否", () => {
    for (const value of [
      ":", "foo:", "evil:", "a:b:c", "http://x:", "abc:def", ":::",
      "999.999.999.999", "300.1.1.1", "1.2.3.4.5", ".", "..", "12.",
      "1:2:3:4:5:6:7", "1::2::3", ":1:2:3:4:5:6:7:8", "1:2:3:4:5:6:7:8::", "12345::",
    ]) {
      expect(isIpLike(value), value).toBe(false);
    }
  });

  it("合法形状照旧判真（含 `::` 压缩与内嵌 IPv4 尾巴）", () => {
    for (const value of ["1.2.3.4", "255.255.255.255", "::", "::1", "2001:db8::1", "::ffff:1.2.3.4", "1:2:3:4:5:6:1.2.3.4"]) {
      expect(isIpLike(value), value).toBe(true);
    }
  });
});

describe("clientIpFromHeaders()", () => {
  it("x-real-ip 优先于 x-forwarded-for", () => {
    const header = new Headers({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.9" });
    expect(clientIpFromHeaders(header)).toBe("203.0.113.7");
  });

  it("畸形的 x-forwarded-for 退化成 anonymous，不会变成一个桶键", () => {
    // 这一条就是本次修形的动机：旧判据下 `"evil:"` 会被当成一个来源地址。
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "evil:" }))).toBe("anonymous");
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "999.999.999.999" }))).toBe("anonymous");
  });

  it("合法 IPv6 形态的 x-forwarded-for 会采信", () => {
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "2001:db8::1" }))).toBe("2001:db8::1");
  });

  it("多段时取最左一段——那是客户端自己写的那一段（已知残留，收紧要先改信任模型）", () => {
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }))).toBe("1.2.3.4");
  });

  it("两个都缺省时是 anonymous", () => {
    expect(clientIpFromHeaders(new Headers())).toBe("anonymous");
  });
});
