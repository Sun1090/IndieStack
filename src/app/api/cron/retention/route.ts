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
 * 返回脱敏计数 `{ ran, failed, orphans, unownedOrphans }`——不含表名、对象键或任何用户标识。
 * 除了删除过期行，每轮还顺带跑一次**只读**的存储孤儿巡检：033 与 `erasure.ts` 的注释都写着
 * 失败删除「可被 `find_orphan_upload_objects()` 发现并补删」，但在那之前只有一个人手动的
 * `pnpm audit:storage-orphans`，没人跑就等于没这条链路。现在每天产出
 * `storage.orphan.objects` / `storage.orphan.unowned` 两个计数。
 * 单个函数失败只记指标与错误日志，不影响其余函数；一个都没跑成时整轮按 500 返回，
 * 让平台调度记录里留下失败痕迹，而不是「200 但什么都没删」。巡检失败不影响保留期的结论：
 * 它只读，且失败已经单独进日志。
 */
import { NextRequest } from "next/server";
import { jsonNoStore } from "@/lib/api-response";
import { logApiError } from "@/lib/api-log";
import { checkCronAuth } from "@/lib/cron-auth";
import { recordCronRejected } from "@/lib/cron-metrics";
import { recordMetric } from "@/lib/metrics";
import { listOrphanObjects } from "@/lib/repositories/upload-objects";
import { runRetentionSweeps } from "@/lib/repositories/retention";
import { summarizeOrphans } from "@/lib/uploads/orphan-audit";

export const dynamic = "force-dynamic";

interface OrphanAuditCounts {
  orphans: number | null;
  unownedOrphans: number | null;
}

/** 只读巡检；失败绝不能被报成「零孤儿」——那正是最需要告警的状态。 */
async function auditOrphans(): Promise<OrphanAuditCounts> {
  try {
    const summary = summarizeOrphans(await listOrphanObjects(), Date.now());
    recordMetric("storage.orphan.objects", summary.count, { unit: "count" });
    recordMetric("storage.orphan.unowned", summary.unowned, { unit: "count" });
    return { orphans: summary.count, unownedOrphans: summary.unowned };
  } catch (error) {
    await logApiError("[Cron Retention] 存储孤儿巡检失败", error);
    return { orphans: null, unownedOrphans: null };
  }
}

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
    const orphans = await auditOrphans();
    recordMetric("cron.retention.completed", Date.now() - startedAt, {
      unit: "ms",
      // 巡检失败时不带 orphans 维度：缺失本身就是「这轮没拿到孤儿数」的信号，
      // 写成 0 或 -1 都会把它读成「数据库干净」。
      attributes: {
        ran: result.ran,
        failed: result.failures.length,
        ...(orphans.orphans === null ? {} : { orphans: orphans.orphans }),
      },
    });

    if (result.ran === 0 && result.failures.length > 0) {
      await logApiError(
        `[Cron Retention] 全部 ${result.failures.length} 个清理函数都失败`,
        new Error(result.failures[0]?.message ?? "unknown"),
      );
      return jsonNoStore(
        {
          error: "Retention cleanup failed",
          ran: 0,
          failed: result.failures.length,
          ...orphans,
        },
        { status: 500 },
      );
    }

    return jsonNoStore({
      ran: result.ran,
      failed: result.failures.length,
      ...orphans,
    });
  } catch (error) {
    recordMetric("cron.retention.failed", 1, {
      unit: "count",
      attributes: { error_type: error instanceof Error ? error.name : "unknown" },
    });
    await logApiError("[Cron Retention] 执行失败", error);
    return jsonNoStore({ error: "Internal server error" }, { status: 500 });
  }
}
