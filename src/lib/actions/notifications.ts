/**
 * 通知服务端操作
 */
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types/action-result";
import { fail, ok } from "@/lib/types/action-result";

/**
 * 将当前用户的所有未读通知标记为已读。
 * 使用 ActionResult 判别联合（ADR 渐进迁移试点）。
 */
export async function markAllNotificationsRead(): Promise<ActionResult<{ updated: number }>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return fail("notAuthenticated");

  const { data, error } = (await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("user_id", user.id)
    .eq("is_read", false)
    .select("id")) as unknown as { data: { id: string }[] | null; error: { message: string } | null };

  if (error) {
    console.error("[markAllNotificationsRead] 标记已读失败:", error.message);
    return fail("databaseError");
  }

  revalidatePath("/dashboard/notifications");
  return ok({ updated: data?.length ?? 0 });
}
