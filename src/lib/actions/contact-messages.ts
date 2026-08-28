/**
 * 联系消息查询（admin 专用）
 * 数据访问经 repositories/contact-messages（service_role，RLS 拒绝普通读取）
 */
"use server";

import type { ActionResult } from "@/lib/types/action-result";
import { fail, ok } from "@/lib/types/action-result";
import { listRecentContactMessages } from "@/lib/repositories/contact-messages";
import { safelyRequireRole } from "@/lib/auth/guards";

export type ContactMessageRecord = {
  id: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  created_at: string;
};

function toRecord(row: Record<string, unknown>): ContactMessageRecord {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    email: String(row.email ?? ""),
    subject: String(row.subject ?? ""),
    message: String(row.message ?? ""),
    created_at: String(row.created_at ?? ""),
  };
}

/**
 * 列出近期联系消息（仅 admin/super_admin）。
 * 页面层守卫之外，Action 本身亦校验角色，防绕过入口越权读取。
 */
export async function listContactMessages(
  limit = 50,
): Promise<ActionResult<ContactMessageRecord[]>> {
  const auth = await safelyRequireRole("admin");
  if (!auth.success) {
    return fail(auth.error.code === "UNAUTHORIZED" ? "notAuthenticated" : "forbidden");
  }

  try {
    return ok((await listRecentContactMessages(limit)).map((row) => toRecord(row)));
  } catch (error) {
    console.error("[listContactMessages] 查询失败:", error);
    return fail("databaseError");
  }
}
