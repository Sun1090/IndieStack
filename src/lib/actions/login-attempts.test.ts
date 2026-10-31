/**
 * 登录失败分级锁定单测（C08 测试职责）
 * 无外部依赖（进程级计数桶），用独立邮箱隔离用例
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "x-real-ip": "203.0.113.9" })),
}));
import { checkLoginAllowed, recordLoginResult } from "./login-attempts";
import { clearLoginBuckets, loginEmailStore, loginIpStore } from "@/lib/auth/login-buckets";

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
    clearLoginBuckets();
    await expect(checkLoginAllowed("wipe@example.com")).resolves.toEqual({
      ok: true,
      data: { allowed: true, retryAfterSec: 0 },
    });
  });
});

describe("IP 维度锁定（D03）", () => {
  it("同 IP 20 次失败后即使换邮箱也锁定", async () => {
    clearLoginBuckets();
    for (let i = 0; i < 20; i++) await recordLoginResult(`user${i}@example.com`, false);
    const result = await checkLoginAllowed("other@example.com");
    if (result.ok) {
      expect(result.data.allowed).toBe(false);
      expect(result.data.retryAfterSec).toBeGreaterThan(0);
    }
  });

  it("任一成功登录清空该 IP 桶", async () => {
    clearLoginBuckets();
    for (let i = 0; i < 20; i++) await recordLoginResult(`user${i}@example.com`, false);
    await recordLoginResult("somebody@example.com", true);
    const result = await checkLoginAllowed("fresh@example.com");
    if (result.ok) expect(result.data.allowed).toBe(true);
    clearLoginBuckets();
  });
});

describe("未知调用方的失败上报（匿名 action 的爆炸半径）", () => {
  it("导出面只有两个 entrypoint——多一个就是多一条可 POST 的路径", async () => {
    // 这个文件带 `"use server"`：**每一个 export 都是一条 action**。
    // 上一版把 clearLoginBuckets 也放在这里，于是「清空全站锁定桶」没有鉴权、没有身份判定，
    // 只靠「没有客户端 import 它」挡着。现在清空入口搬进普通模块，这条用例守住它不回来。
    const moduleExports = Object.keys(await import("./login-attempts")).sort();
    expect(moduleExports).toEqual(["checkLoginAllowed", "recordLoginResult"]);
  });

  it("出口 IP 额度用尽后不再受理失败上报：被锁邮箱数被 IP 额度卡住", async () => {
    clearLoginBuckets();
    // 4 个邮箱 × 5 次 = 20，正好用尽这条出口 IP 的额度
    for (let victim = 0; victim < 4; victim++) {
      for (let attempt = 0; attempt < 5; attempt++) {
        await recordLoginResult(`victim${victim}@example.com`, false);
      }
    }
    // 第 5 个邮箱继续被上报 5 次：这一次不该再把它锁上
    for (let attempt = 0; attempt < 5; attempt++) {
      await recordLoginResult("late@example.com", false);
    }
    // 直接看邮箱桶而不是 checkLoginAllowed：后者同时看 IP 桶，而 IP 桶这时已经满了
    // ——那样断言会在「邮箱其实没被锁」的情况下也变绿，等于什么都没证明。
    expect(loginEmailStore.peek("login:late@example.com").allowed).toBe(true);
    expect(loginIpStore.peek("ip:203.0.113.9").allowed).toBe(false);
    clearLoginBuckets();
  });
});
