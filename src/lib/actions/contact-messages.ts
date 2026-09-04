/**
 * 联系消息查询（admin 专用）
 * 数据访问经 repositories/contact-messages（service_role，RLS 拒绝普通读取）
 */
"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/types/action-result";
import { fail, ok } from "@/lib/types/action-result";
import {
  listRecentContactMessages,
  listContactMessagesPage as fetchContactMessagesPage,
  setMessageStatus,
  type ContactMessageFilter,
  type MessageStatus,
} from "@/lib/repositories/contact-messages";
import { safelyRequireRole } from "@/lib/auth/guards";
import { ROUTES } from "@/lib/constants";

export type ContactMessageRecord = {
  id: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  status: string;
  created_at: string;
};

export { type MessageStatus };

function toRecord(row: Record<string, unknown>): ContactMessageRecord {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    email: String(row.email ?? ""),
    subject: String(row.subject ?? ""),
    message: String(row.message ?? ""),
    status: String(row.status ?? "new"),
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

export interface ContactMessagePage {
  rows: ContactMessageRecord[];
  total: number;
}

/**
 * 分页查询联系消息（仅 admin/super_admin，支持状态筛选与模糊搜）。
 */
export async function listContactMessagesPage(
  filter: ContactMessageFilter = {},
): Promise<ActionResult<ContactMessagePage>> {
  const auth = await safelyRequireRole("admin");
  if (!auth.success) {
    return fail(auth.error.code === "UNAUTHORIZED" ? "notAuthenticated" : "forbidden");
  }

  try {
    const { rows, total } = await fetchContactMessagesPage(filter);
    return ok({ rows: rows.map((row) => toRecord(row)), total });
  } catch (error) {
    console.error("[listContactMessagesPage] 查询失败:", error);
    return fail(
      error instanceof Error && error.message.startsWith("invalid_")
        ? "invalidInput"
        : "databaseError",
    );
  }
}

/**
 * 更新消息处理状态（仅 admin/super_admin，单向流转）。
 */
export async function updateMessageStatus(
  id: string,
  status: MessageStatus,
): Promise<ActionResult> {
  const auth = await safelyRequireRole("admin");
  if (!auth.success) {
    return fail(auth.error.code === "UNAUTHORIZED" ? "notAuthenticated" : "forbidden");
  }

  try {
    await setMessageStatus(id, status);
    revalidatePath(ROUTES.adminMessages);
    return ok();
  } catch (error) {
    console.error("[updateMessageStatus] 更新失败:", error);
    return fail(
      error instanceof Error && error.message.startsWith("invalid_transition")
        ? "invalidTransition"
        : "databaseError",
    );
  }
}
