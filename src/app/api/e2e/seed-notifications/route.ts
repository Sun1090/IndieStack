/**
 * E2E 测试通知种子端点（仅 Mock 模式启用）
 * 给 mock 用户种 N 条未发 type=system 通知，供 mail-flow.spec 触发 digest worker。
 * 生产与开发非 mock 场景直接 404，绝不作为业务通道暴露。
 *
 * POST /api/e2e/seed-notifications
 *   Authorization: Bearer <E2E_BEARER_TOKEN>
 *   body: { count?: number; type?: string }   // 默认 count=2, type="system"
 *   → { inserted: number, ids: string[] }
 *
 * DELETE /api/e2e/seed-notifications
 *   Authorization: Bearer <E2E_BEARER_TOKEN>
 *   → 清空 mock notifications（按当前 mock user）
 *
 * 注意：MOCK_USER_ID 复制自 src/lib/mock/data.ts（dev-only faker 模块，
 * 不可在生产路径 import，避免把 faker 拽进 bundle）。如 mock 用户 id 变更，
 * 这里需同步。
 */

import { NextRequest } from "next/server";
import { jsonNoStore } from "@/lib/api-response";
import { isMockEnabled } from "@/lib/mock";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

/** 与 src/lib/mock/data.ts 的 MOCK_USER_ID 保持一致 */
const MOCK_USER_ID = "mock-user-001";

function authOrThrow(request: NextRequest): Response | null {
  if (!isMockEnabled) {
    return jsonNoStore({ error: "Not found" }, { status: 404 });
  }
  const expected = `Bearer ${process.env.E2E_BEARER_TOKEN ?? ""}`;
  const got = request.headers.get("authorization") ?? "";
  if (!expected || got !== expected) {
    return jsonNoStore({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function POST(request: NextRequest) {
  const unauth = authOrThrow(request);
  if (unauth) return unauth;

  let body: { count?: number; type?: string } = {};
  try {
    body = (await request.json()) as { count?: number; type?: string };
  } catch {
    body = {};
  }
  const count = Math.max(1, Math.min(20, Math.floor(body.count ?? 2)));
  const type = (body.type ?? "system") as
    | "system"
    | "team_invite"
    | "role_changed"
    | "payment_succeeded"
    | "billing_update"
    | "deployment"
    | "security_alert";

  const admin = createAdminClient();
  const rows = Array.from({ length: count }).map((_, i) => ({
    user_id: MOCK_USER_ID,
    type,
    title: `E2E 种子通知 #${i + 1}`,
    body: `由 seed-notifications 端点注入，供 mail-flow.spec 触发 digest。`,
    link: null,
    metadata: JSON.parse(JSON.stringify({})) as Database["public"]["Tables"]["notifications"]["Insert"]["metadata"],
    email_sent: false,
    is_read: false,
  }));
  const { data, error } = await admin
    .from("notifications")
    .insert(rows)
    .select("id");
  if (error) {
    return jsonNoStore({ error: error.message }, { status: 500 });
  }
  const ids = (data ?? []).map((r) => String((r as { id: string }).id));
  return jsonNoStore({ inserted: ids.length, ids });
}

export async function DELETE(request: NextRequest) {
  const unauth = authOrThrow(request);
  if (unauth) return unauth;

  const admin = createAdminClient();
  const { error } = await admin
    .from("notifications")
    .delete()
    .eq("user_id", MOCK_USER_ID);
  if (error) {
    return jsonNoStore({ error: error.message }, { status: 500 });
  }
  return jsonNoStore({ deleted: true });
}
