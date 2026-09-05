/**
 * E2E 邮件 worker 运行记录回读（仅 Mock 模式启用）
 * mail-flow.spec 用来断言 digest cron 的 sent/groups/failed/pulled 回执。
 *
 * GET /api/e2e/email-worker-runs
 *   Authorization: Bearer <E2E_BEARER_TOKEN>
 *   → { total, runs: EmailWorkerRunRow[] }   按 started_at desc
 */

import { NextRequest } from "next/server";
import { jsonNoStore } from "@/lib/api-response";
import { isMockEnabled } from "@/lib/mock";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isMockEnabled) {
    return jsonNoStore({ error: "Not found" }, { status: 404 });
  }
  const expected = `Bearer ${process.env.E2E_BEARER_TOKEN ?? ""}`;
  const got = request.headers.get("authorization") ?? "";
  if (!expected || got !== expected) {
    return jsonNoStore({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("email_worker_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(50);
  if (error) {
    return jsonNoStore({ error: error.message }, { status: 500 });
  }
  return jsonNoStore({ total: (data ?? []).length, runs: data ?? [] });
}
