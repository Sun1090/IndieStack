/**
 * 数据保留期清理 Worker（cron）
 *
 * 由 Vercel Cron 每天 05:00 UTC 调度（见 `vercel.json` 与 `src/lib/observability/cron-contract.ts`
 * 注册表；Hobby 计划每路径每天最多一次）。它逐个执行迁移 `003` / `014` / `027` / `032` 里定义的
 * 保留期清理函数，替代「只能靠 pg_cron、而 pg_cron 从未安装」的 SQL 侧调度。
 *
 * POST /api/cron/retention
 * Header: Authorization: Bearer ***.CRON_SECRET 或 x-cron-secret = ***.CRON_SECRET
 *
 * 返回脱敏计数 `{ ran, failed }`——不含表名、行数或任何用户标识。
 * 单个函数失败只记指标与错误日志，不影响其余函数；一个都没跑成时整轮按 500 返回，
 * 让平台调度记录里留下失败痕迹，而不是「200 但什么都没删」。
 */
import { NextRequest } from "next/server";
import { jsonNoStore } from "@/lib/api-response";
import { logApiError } from "@/lib/api-log";
import { checkCronAuth } from "@/lib/cron-auth";
import { recordCronRejected } from "@/lib/cron-metrics";
import { recordMetric } from "@/lib/metrics";
import { runRetentionSweeps } from "@/lib/repositories/retention";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = checkCronAuth(request.headers, process.env.CRON_SECRET);
  if (auth !== "authorized") {
    recordCronRejected("retention", auth);
    return jsonNoStore({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  try {
    const result = await runRetentionSweeps();
    for (const failure of result.failures) {
      recordMetric("cron.retention.cleanup_failed", 1, {
        unit: "count",
        attributes: { cleanup_function: failure.cleanupFunction },
      });
      await logApiError(
        `[Cron Retention] ${failure.cleanupFunction} 清理失败`,
        new Error(failure.message),
      );
    }
    recordMetric("cron.retention.completed", Date.now() - startedAt, {
      unit: "ms",
      attributes: { ran: result.ran, failed: result.failures.length },
    });

    if (result.ran === 0 && result.failures.length > 0) {
      await logApiError(
        `[Cron Retention] 全部 ${result.failures.length} 个清理函数都失败`,
        new Error(result.failures[0]?.message ?? "unknown"),
      );
      return jsonNoStore(
        { error: "Retention cleanup failed", ran: 0, failed: result.failures.length },
        { status: 500 },
      );
    }

    return jsonNoStore({ ran: result.ran, failed: result.failures.length });
  } catch (error) {
    recordMetric("cron.retention.failed", 1, {
      unit: "count",
      attributes: { error_type: error instanceof Error ? error.name : "unknown" },
    });
    await logApiError("[Cron Retention] 执行失败", error);
    return jsonNoStore({ error: "Internal server error" }, { status: 500 });
  }
}
