/**
 * 通知服务端操作
 */
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types/action-result";
import { fail, ok } from "@/lib/types/action-result";
import * as notificationsRepo from "@/lib/repositories/notifications";
import { getTraceId } from "@/lib/trace";

/**
 * 将当前用户的所有未读通知标记为已读。
 * 使用 ActionResult 判别联合（ADR 渐进迁移试点）。
 */
export async function markAllNotificationsRead(): Promise<
  ActionResult<{ updated: number }>
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return fail("notAuthenticated");

  try {
    const updated = await notificationsRepo.markAllNotificationsRead(user.id);
    revalidatePath("/dashboard/notifications");
    return ok({ updated });
  } catch (error) {
    const traceId = await getTraceId();
    console.error(`[markAllNotificationsRead] 标记已读失败 trace=${traceId ?? "-"}:`, error);
    return fail("databaseError");
  }
}
