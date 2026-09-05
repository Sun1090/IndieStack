/**
 * E2E mock 状态重置端点（仅 Mock 模式启用）。
 * 只清理当前 mock runtime 的内存状态，不触碰真实数据库。
 */
import { NextRequest } from "next/server";
import { jsonNoStore } from "@/lib/api-response";
import { isMockEnabled, resetMockCache } from "@/lib/mock";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isMockEnabled) return jsonNoStore({ error: "Not found" }, { status: 404 });

  const expected = `Bearer ${process.env.E2E_BEARER_TOKEN ?? ""}`;
  if (!expected || request.headers.get("authorization") !== expected) {
    return jsonNoStore({ error: "Unauthorized" }, { status: 401 });
  }

  resetMockCache();
  return jsonNoStore({ ok: true, reset: true });
}
