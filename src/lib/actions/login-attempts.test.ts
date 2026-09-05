/**
 * 登录失败分级锁定单测（C08 测试职责）
 * 无外部依赖（进程级计数桶），用独立邮箱隔离用例
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "x-real-ip": "203.0.113.9" })),
}));
import { checkLoginAllowed, recordLoginResult, clearLoginBuckets } from "./login-attempts";

describe("login attempts lockout", () => {
  it("初始允许", async () => {
    await expect(checkLoginAllowed("fresh@example.com")).resolves.toEqual({
      ok: true,
      data: { allowed: true, retryAfterSec: 0 },
    });
  });

  it("5 次失败后锁定并给出冷却秒数", async () => {
    const email = "locked@example.com";
    for (let i = 0; i < 5; i++) await recordLoginResult(email, false);
    const result = await checkLoginAllowed(email);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.allowed).toBe(false);
      expect(result.data.retryAfterSec).toBeGreaterThan(0);
    }
  });

  it("成功登录清桶", async () => {
    const email = "cleared@example.com";
    for (let i = 0; i < 5; i++) await recordLoginResult(email, false);
    await recordLoginResult(email, true);
    await expect(checkLoginAllowed(email)).resolves.toEqual({
      ok: true,
      data: { allowed: true, retryAfterSec: 0 },
    });
  });

  it("邮箱归一化（大小写/空白同一桶）", async () => {
    for (let i = 0; i < 5; i++) await recordLoginResult("  Mix@Example.com ", false);
    const result = await checkLoginAllowed("mix@example.com");
    if (result.ok) expect(result.data.allowed).toBe(false);
  });

  it("clearLoginBuckets 清空", async () => {
    await recordLoginResult("wipe@example.com", false);
    await clearLoginBuckets();
    await expect(checkLoginAllowed("wipe@example.com")).resolves.toEqual({
      ok: true,
      data: { allowed: true, retryAfterSec: 0 },
    });
  });
});

describe("IP 维度锁定（D03）", () => {
  it("同 IP 20 次失败后即使换邮箱也锁定", async () => {
    await clearLoginBuckets();
    for (let i = 0; i < 20; i++) await recordLoginResult(`user${i}@example.com`, false);
    const result = await checkLoginAllowed("other@example.com");
    if (result.ok) {
      expect(result.data.allowed).toBe(false);
      expect(result.data.retryAfterSec).toBeGreaterThan(0);
    }
  });

  it("任一成功登录清空该 IP 桶", async () => {
    await clearLoginBuckets();
    for (let i = 0; i < 20; i++) await recordLoginResult(`user${i}@example.com`, false);
    await recordLoginResult("somebody@example.com", true);
    const result = await checkLoginAllowed("fresh@example.com");
    if (result.ok) expect(result.data.allowed).toBe(true);
    await clearLoginBuckets();
  });
});
