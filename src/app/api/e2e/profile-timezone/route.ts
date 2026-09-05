/**
 * E2E 专用：动态调整 mock profile.timezone（仅 Mock 模式启用）
 * 让 isDigestHour 在任意 CI/本地时区下都能命中本地 08:00 门控，
 * mail-flow.spec 启动后调一次本端点写入 Etc/GMT±N。
 *
 * PATCH /api/e2e/profile-timezone
 *   Authorization: Bearer <E2E_BEARER_TOKEN>
 *   body: { timezone: string }
 *   → { ok: true, timezone: string }
 */

import { NextRequest } from "next/server";
import { jsonNoStore } from "@/lib/api-response";
import { isMockEnabled } from "@/lib/mock";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** 与 src/lib/mock/data.ts 的 MOCK_USER_ID 保持一致 */
const MOCK_USER_ID = "mock-user-001";

export async function PATCH(request: NextRequest) {
  if (!isMockEnabled) {
    return jsonNoStore({ error: "Not found" }, { status: 404 });
  }
  const expected = `Bearer ${process.env.E2E_BEARER_TOKEN ?? ""}`;
  const got = request.headers.get("authorization") ?? "";
  if (!expected || got !== expected) {
    return jsonNoStore({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { timezone?: string } = {};
  try {
    body = (await request.json()) as { timezone?: string };
  } catch {
    return jsonNoStore({ error: "Invalid JSON" }, { status: 400 });
  }
  const timezone = (body.timezone ?? "").trim();
  if (!timezone) {
    return jsonNoStore({ error: "timezone required" }, { status: 400 });
  }
  // 用 Intl 验一下时区合法性，避免静默落库
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
  } catch {
    return jsonNoStore({ error: "Invalid timezone" }, { status: 400 });
  }

  const admin = createAdminClient();
  // mock 层 update 会覆盖字段（包括 timezone）；先读取当前值避免误清空
  const { error } = await admin
    .from("profiles")
    
    .update({ timezone, updated_at: new Date().toISOString() })
    .eq("id", MOCK_USER_ID);
  if (error) {
    return jsonNoStore({ error: error.message }, { status: 500 });
  }
  return jsonNoStore({ ok: true, timezone });
}
