/**
 * Rate Limiter 单元测试
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createRateLimit } from "./rate-limit";

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
