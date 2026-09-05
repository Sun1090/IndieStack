/**
 * E2E 联系消息回读端点（仅 Mock 模式启用）
 * F02：contact 表单 → admin/messages 列表断言用。
 *
 * GET /api/e2e/contact-messages
 *   Authorization: Bearer <E2E_BEARER_TOKEN>
 *   → { total, messages: ContactMessageRow[] }   按 created_at desc
 *
 * DELETE /api/e2e/contact-messages
 *   Authorization: Bearer <E2E_BEARER_TOKEN>
 *   → { deleted: true }
 */

import { NextRequest } from "next/server";
import { jsonNoStore } from "@/lib/api-response";
import { isMockEnabled } from "@/lib/mock";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

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

export async function GET(request: NextRequest) {
  const unauth = authOrThrow(request);
  if (unauth) return unauth;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("contact_messages")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return jsonNoStore({ error: error.message }, { status: 500 });
  return jsonNoStore({ total: (data ?? []).length, messages: data ?? [] });
}

export async function DELETE(request: NextRequest) {
  const unauth = authOrThrow(request);
  if (unauth) return unauth;
  // Mock 模式下走 admin client（delete() 不带 filter，mock applyDelete 视为全表清空）
  const admin = createAdminClient();
  await admin.from("contact_messages").delete();
  return jsonNoStore({ deleted: true });
}

export async function POST(request: NextRequest) {
  const unauth = authOrThrow(request);
  if (unauth) return unauth;
  // F02 E2E：模拟 contact 表单提交（绕开 Next.js server action 在 dev 模式下
  // 可能被 Turbopack 拆分到不同 worker 导致 mock 内存跨进程不可见的问题）。
  // 生产路径仍走 submitContactMessage server action；此端点仅在 mock + Bearer 校验下生效。
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonNoStore({ error: "invalidJson" }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!name || !email || !subject || !message) {
    return jsonNoStore({ error: "invalidInput" }, { status: 400 });
  }
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("contact_messages")
    .insert({ name, email, subject, message })
    .select()
    .single();
  if (error) return jsonNoStore({ error: error.message }, { status: 500 });
  return jsonNoStore({ ok: true, message: data });
}
