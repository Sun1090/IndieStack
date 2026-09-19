/**
 * Supabase 自动恢复（应用侧兜底 cron）
 *
 * GET /api/ops/supabase-restore
 * Header: authorization: Bearer <CRON_SECRET>（Vercel Cron 自动附加）
 *         或 x-cron-secret: <CRON_SECRET>（手动/兼容调用）
 *
 * 为什么需要这一层：GitHub Actions 的 `schedule` 会在仓库连续 60 天无提交后被停用，
 * 而 Vercel Cron 不会。本路由复用与 `scripts/supabase-auto-restore.js` 相同的判定：
 * 只有 Management API 明确返回 `status=INACTIVE` 才执行 restore，其余状态只报告不动手。
 *
 * 返回 `{ ok, action, projectStatus?, reason?, checkedAt }`；action ∈
 * noop | restore | wait | escalate | skipped。不返回也不记录令牌值。
 */

import { NextRequest } from "next/server";
import { jsonNoStore } from "@/lib/api-response";
import { logApiError } from "@/lib/api-log";
import { logger } from "@/lib/logger";
import { recordSupabaseRestoreCycle } from "@/lib/observability/ops-metrics";
import { isCronAuthorized, resolveProjectRef, runRestoreCycle } from "@/lib/ops/supabase-restore";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers, process.env.CRON_SECRET)) {
    return jsonNoStore({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const result = await runRestoreCycle(
    {
      ref: resolveProjectRef(process.env.SUPABASE_PROJECT_REF, process.env.NEXT_PUBLIC_SUPABASE_URL),
      token: process.env.SUPABASE_ACCESS_TOKEN,
      isProduction: process.env.VERCEL_ENV === "production",
    },
    {
      // 每个终态（含 skipped / escalate）都产出 value=1 的计数样本，
      // 让告警能分别对 restore / escalate / skipped 计数，而不是被值 0 静默吞掉。
      onMetric: (action, projectStatus) =>
        recordSupabaseRestoreCycle({ action, projectStatus }),
      onError: logApiError,
      onInfo: (message, data) => logger.info(message, data),
      onWarn: (message, data) => logger.warn(message, data),
    },
  );

  return jsonNoStore(result.body, { status: result.httpStatus });
}
