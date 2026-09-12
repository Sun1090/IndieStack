/**
 * cron 路由共享鉴权（Vercel Cron / 外部调度 / 手动运维调用）
 *
 * 接受两种携带方式：
 *   - `Authorization: Bearer <CRON_SECRET>`（Vercel Cron 自动附加）
 *   - `x-cron-secret: <CRON_SECRET>`（手动或兼容调用，如 /api/cron/digest）
 *
 * 未配置 `CRON_SECRET` 时一律拒绝，避免部署漏配导致路由裸奔。
 */
export type HeadersLike = { get(name: string): string | null };

/** 手动手工调用使用的头名（与 C03 digest 路由保持兼容） */
export const CRON_SECRET_HEADER = "x-cron-secret";

export function isCronAuthorized(headers: HeadersLike, expectedSecret: string | undefined): boolean {
  if (!expectedSecret) return false;
  const bearer = headers.get("authorization");
  if (bearer && bearer.startsWith("Bearer ") && bearer.slice(7) === expectedSecret) return true;
  return headers.get(CRON_SECRET_HEADER) === expectedSecret;
}
