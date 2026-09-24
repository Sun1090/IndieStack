/**
 * Rate Limiter 单元测试
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { isIP } from "node:net";
import { clientIpFromHeaders, createRateLimit, isIpLike } from "./rate-limit";

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

  it("畸形的 x-real-ip 同样不算身份（直连部署时这个头也是客户端写的）", () => {
    // 形状闸门此前只管 `x-forwarded-for` 那一支：`x-real-ip: evil:` 会原样变成桶键，
    // 而 `x-real-ip: ""` 走的是 `?? `（只挡 null/undefined），空串也会当成一个身份。
    expect(clientIpFromHeaders(new Headers({ "x-real-ip": "evil:" }))).toBe("anonymous");
    expect(clientIpFromHeaders(new Headers({ "x-real-ip": "" }))).toBe("anonymous");
    expect(clientIpFromHeaders(new Headers({ "x-real-ip": "   " }))).toBe("anonymous");
    // 这一支不合格时退回下一支，而不是直接放弃：代理写坏了 x-real-ip 不代表 XFF 也不可信。
    expect(
      clientIpFromHeaders(new Headers({ "x-real-ip": "evil:", "x-forwarded-for": "198.51.100.7" })),
    ).toBe("198.51.100.7");
  });
});
