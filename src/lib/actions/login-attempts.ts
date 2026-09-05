/**
 * 登录失败分级锁定（v0.5.0 D03 收口进 rate-limit 模块）
 * 双维度滑窗：归一化邮箱（5 次/15 分钟）+ 客户端 IP（20 次/15 分钟），
 * 任一维度锁定即拒绝登录尝试并提示冷却。
 * 存储复用 rate-limit 的键控滑窗；硬限频仍由 Supabase Auth 服务端执行，
 * 本层为 UX 级防护 + 审计。
 */
"use server";

import { headers } from "next/headers";
import { createKeyedWindowStore, clientIpFromHeaders } from "@/lib/rate-limit";

/** 滑窗与阈值（IP 维度阈值放宽：同一出口 IP 可能有多名用户） */
const WINDOW_MS = 15 * 60 * 1000;
const EMAIL_MAX_FAILURES = 5;
const IP_MAX_FAILURES = 20;

const emailStore = createKeyedWindowStore({ max: EMAIL_MAX_FAILURES, windowMs: WINDOW_MS });
const ipStore = createKeyedWindowStore({ max: IP_MAX_FAILURES, windowMs: WINDOW_MS });

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
  const emailPeek = emailStore.peek(keyOf(email));
  const ipPeek = ipStore.peek(await currentIpKey());
  if (emailPeek.allowed && ipPeek.allowed) {
    return { ok: true, data: { allowed: true, retryAfterSec: 0 } };
  }
  const resetIn = Math.max(emailPeek.resetIn, ipPeek.resetIn);
  return { ok: true, data: { allowed: false, retryAfterSec: Math.ceil(resetIn / 1000) } };
}

/** 记录一次登录结果：成功清两维度桶，失败两维度同时计数 */
export async function recordLoginResult(
  email: string,
  success: boolean,
): Promise<{ ok: true }> {
  const emailKey = keyOf(email);
  const ipKey = await currentIpKey();
  if (success) {
    emailStore.reset(emailKey);
    ipStore.reset(ipKey);
    return { ok: true };
  }
  emailStore.hit(emailKey);
  ipStore.hit(ipKey);
  return { ok: true };
}

/** 测试/运维：清空计数桶 */
export async function clearLoginBuckets(): Promise<{ ok: true }> {
  emailStore.clear();
  ipStore.clear();
  return { ok: true };
}
