/**
 * 登录失败分级锁定（v0.5.0 D03 收口进 rate-limit 模块）
 * 双维度滑窗：归一化邮箱（5 次/15 分钟）+ 客户端 IP（20 次/15 分钟），
 * 任一维度锁定即拒绝登录尝试并提示冷却。
 * 存储复用 rate-limit 的键控滑窗；硬限频仍由 Supabase Auth 服务端执行，
 * 本层为 UX 级防护 + 审计。
 *
 * **这个文件里的每一个 export 都是一条可被任意访客 POST 的 action**——它们都是匿名的
 * （登录页本来就没有会话）。因此这里只能放「登录流程本身需要暴露」的入口：
 *   - `checkLoginAllowed`：只读，回答「现在还能不能试」；
 *   - `recordLoginResult`：写，记录一次尝试的结果。
 * 清空计数桶不住在这里（见 `src/lib/auth/login-buckets.ts`）：那是一个不需要网络表面的操作。
 */
"use server";

import { headers } from "next/headers";
import { clientIpFromHeaders } from "@/lib/rate-limit";
import { loginEmailStore, loginIpStore } from "@/lib/auth/login-buckets";

function keyOf(email: string): string {
  return `login:${email.trim().toLowerCase()}`;
}

async function currentIpKey(): Promise<string> {
  try {
    return `ip:${clientIpFromHeaders(await headers())}`;
  } catch {
    // headers 不可用（如极端测试环境）时退化为独立桶，不影响邮箱维度
    return "ip:unknown";
  }
}

/** 查询是否允许尝试；返回剩余冷却秒数（取两维度的较大值） */
export async function checkLoginAllowed(
  email: string,
): Promise<{ ok: true; data: { allowed: boolean; retryAfterSec: number } }> {
  const emailPeek = loginEmailStore.peek(keyOf(email));
  const ipPeek = loginIpStore.peek(await currentIpKey());
  if (emailPeek.allowed && ipPeek.allowed) {
    return { ok: true, data: { allowed: true, retryAfterSec: 0 } };
  }
  const resetIn = Math.max(emailPeek.resetIn, ipPeek.resetIn);
  return { ok: true, data: { allowed: false, retryAfterSec: Math.ceil(resetIn / 1000) } };
}

/**
 * 记录一次登录结果：成功清两维度桶，失败两维度同时计数。
 *
 * **为什么失败上报要受出口 IP 的额度约束**：这个 action 是匿名的，且它的入参就是
 * 「邮箱 + 布尔值」——也就是说**任何人都能替任意邮箱宣布一次登录失败**。
 * 后果不是「绕过限频」（绕过 `checkLoginAllowed` 直接打 Supabase 的 `/token` 本来也行），
 * 而是「第三方可对指定账号制造登录拒绝」：五个 POST 锁死一个邮箱 15 分钟。
 *
 * 修法不是给失败上报加身份（登录页没有身份可用），而是**给它一个成本**：
 * 当这个出口 IP 自己的失败额度已经用尽时，不再受理新的失败上报。
 * 于是同一条 IP 每个窗口最多能推到的「被锁邮箱数」被 IP 额度（20）除以邮箱阈值（5）
 * 卡在 4 个，而不是无上限。
 *
 * **残留风险（写清楚，不假装解决）**：分布式攻击者用多台出口可以继续锁账号；
 * 真正的修法是让认证发生在服务端（由服务端自己产生「失败」这个事实），
 * 而不是由客户端上报——那是一次认证链路重构，不在这一手范围内。
 */
export async function recordLoginResult(
  email: string,
  success: boolean,
): Promise<{ ok: true }> {
  const emailKey = keyOf(email);
  const ipKey = await currentIpKey();
  if (success) {
    loginEmailStore.reset(emailKey);
    loginIpStore.reset(ipKey);
    return { ok: true };
  }

  // 先看这条出口 IP 还有没有额度：没有就不再把「失败」记到别人头上。
  // 返回 ok 而不是错误码——调用方（登录表单）对它只是 `void`，
  // 而且不该让一个匿名调用者从错误码里读出「自己的桶还剩几次」。
  if (!loginIpStore.peek(ipKey).allowed) {
    return { ok: true };
  }

  loginEmailStore.hit(emailKey);
  loginIpStore.hit(ipKey);
  return { ok: true };
}
