/**
 * cron 路由共享鉴权（Vercel Cron / 外部调度 / 手动运维调用）
 *
 * 接受两种携带方式：
 *   - `Authorization: Bearer <CRON_SECRET>`（Vercel Cron 自动附加）
 *   - `x-cron-secret: <CRON_SECRET>`（手动或兼容调用，如 /api/cron/digest）
 *
 * 未配置 `CRON_SECRET` 时一律拒绝，避免部署漏配导致路由裸奔。
 *
 * E03：拒绝原因必须可区分（未配置 / 未携带 / 携带错误），否则「cron 静默不执行」
 * 与「cron 正常执行但队列为空」在日志里长得一模一样——邮件链路断掉很久都没人发现。
 */
export type HeadersLike = { get(name: string): string | null };

/** 手动手工调用使用的头名（与 C03 digest 路由保持兼容） */
export const CRON_SECRET_HEADER = "x-cron-secret";

/** 鉴权拒绝原因：作为 `cron.auth.rejected` 指标维度，不含任何凭据内容。 */
export type CronAuthFailure = "secret_unconfigured" | "missing_credentials" | "invalid_credentials";

/** 鉴权结论：`authorized` 或具体拒绝原因。 */
export type CronAuthResult = "authorized" | CronAuthFailure;

/**
 * 判定一次 cron 调用的鉴权结论。
 *
 * 优先级：先看部署是否配置了 secret（`secret_unconfigured` 是运维事故，不是调用方问题），
 * 再看调用方是否携带凭据、凭据是否正确。返回值只描述类别，绝不回显凭据。
 */
export function checkCronAuth(
  headers: HeadersLike,
  expectedSecret: string | undefined,
): CronAuthResult {
  if (!expectedSecret) return "secret_unconfigured";
  const bearer = headers.get("authorization");
  if (bearer && bearer.startsWith("Bearer ") && bearer.slice(7) === expectedSecret) {
    return "authorized";
  }
  const manual = headers.get(CRON_SECRET_HEADER);
  if (manual === expectedSecret) return "authorized";
  return bearer === null && manual === null ? "missing_credentials" : "invalid_credentials";
}

export function isCronAuthorized(headers: HeadersLike, expectedSecret: string | undefined): boolean {
  return checkCronAuth(headers, expectedSecret) === "authorized";
}
