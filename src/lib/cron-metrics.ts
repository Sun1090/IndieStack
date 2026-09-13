/**
 * cron worker 指标入口（E03）。
 *
 * 指标名与 worker 标识集中在这里：路由负责调用，`pnpm check:cron-contract`
 * 负责校验「路由真的调用了、文档真的登记了」。鉴权拒绝也计数，原因取自
 * `checkCronAuth` 的类别枚举，因此不会把凭据写进日志。
 */
import { recordMetric } from "./metrics";
import type { CronAuthFailure } from "./cron-auth";
import { CRON_REJECTED_METRIC, type CronWorkerId } from "./observability/cron-contract";

export { CRON_REJECTED_METRIC };

/**
 * 记录一次被拒绝的 cron 调用。
 *
 * 典型来源：Vercel 环境变量漏配/轮换 `CRON_SECRET`——此时平台每轮照常调用、路由每轮
 * 返回 401，但业务指标一条都不产出。没有这条计数，告警规则里的「排查 cron 鉴权」
 * 就只是一句空话。
 */
export function recordCronRejected(worker: CronWorkerId, reason: CronAuthFailure): void {
  recordMetric(CRON_REJECTED_METRIC, 1, { attributes: { worker, reason } });
}
