/**
 * 登录失败分级锁定（C08）
 * 按归一化邮箱 15 分钟滑窗计数，≥5 次失败则锁定并提示冷却。
 * 说明：本层为 UX 级防护 + 审计；硬限频由 Supabase Auth 服务端执行。
 */
"use server";

/** 滑窗与阈值 */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

interface Bucket {
  count: number;
  resetAt: number;
}

/** 进程级失败计数桶（key: login:<email>） */
const buckets = new Map<string, Bucket>();

function keyOf(email: string): string {
  return `login:${email.trim().toLowerCase()}`;
}

/** 查询是否允许尝试；返回剩余冷却秒数 */
export async function checkLoginAllowed(
  email: string,
): Promise<{ ok: true; data: { allowed: boolean; retryAfterSec: number } }> {
  const now = Date.now();
  const bucket = buckets.get(keyOf(email));
  if (!bucket || now >= bucket.resetAt) {
    return { ok: true, data: { allowed: true, retryAfterSec: 0 } };
  }
  if (bucket.count < MAX_FAILURES) {
    return { ok: true, data: { allowed: true, retryAfterSec: 0 } };
  }
  return {
    ok: true,
    data: { allowed: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) },
  };
}

/** 记录一次登录结果：成功清桶，失败计数 */
export async function recordLoginResult(
  email: string,
  success: boolean,
): Promise<{ ok: true }> {
  const key = keyOf(email);
  if (success) {
    buckets.delete(key);
    return { ok: true };
  }
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  return { ok: true };
}

/** 测试/运维：清空计数桶 */
export async function clearLoginBuckets(): Promise<{ ok: true }> {
  buckets.clear();
  return { ok: true };
}
