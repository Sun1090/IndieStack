/**
 * E2E 专用：mock storage 上传失败注入（仅 Mock 模式启用）
 * 让 uploadAvatar 在浏览器端稳定走出「失败 → 重试成功」闭环：
 *   failNext = N 时，后续 N 次 storage.put() 返回错误，随后恢复成功。
 *
 * POST /api/e2e/mock-upload
 *   Authorization: Bearer <E2E_BEARER_TOKEN>
 *   body: { failNext: number }  → 设置剩余失败次数（0 表示清零）
 *   → { ok: true, failNext: number }
 *
 * GET /api/e2e/mock-upload → { ok: true, failNext: number }
 */

import { NextRequest } from "next/server";
import { jsonNoStore } from "@/lib/api-response";
import { isMockEnabled, getMockUploadFailNext, setMockUploadFailNext } from "@/lib/mock";

export const dynamic = "force-dynamic";

function unauthorized() {
  return jsonNoStore({ error: "Unauthorized" }, { status: 401 });
}

export async function POST(request: NextRequest) {
  if (!isMockEnabled) return jsonNoStore({ error: "Not found" }, { status: 404 });

  const expected = `Bearer ${process.env.E2E_BEARER_TOKEN ?? ""}`;
  if (!expected || request.headers.get("authorization") !== expected) return unauthorized();

  let failNext = 0;
  try {
    const body = (await request.json()) as { failNext?: unknown };
    if (body.failNext !== undefined) {
      const parsed = Number(body.failNext);
      if (!Number.isFinite(parsed) || parsed < 0) {
        return jsonNoStore({ error: "failNext must be a non-negative number" }, { status: 400 });
      }
      failNext = parsed;
    }
  } catch {
    return jsonNoStore({ error: "Invalid JSON" }, { status: 400 });
  }

  setMockUploadFailNext(failNext);
  return jsonNoStore({ ok: true, failNext: getMockUploadFailNext() });
}

export async function GET(request: NextRequest) {
  if (!isMockEnabled) return jsonNoStore({ error: "Not found" }, { status: 404 });

  const expected = `Bearer ${process.env.E2E_BEARER_TOKEN ?? ""}`;
  if (!expected || request.headers.get("authorization") !== expected) return unauthorized();

  return jsonNoStore({ ok: true, failNext: getMockUploadFailNext() });
}
