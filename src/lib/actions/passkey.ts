/**
 * Passkey 管理 Server Actions（v0.5.0 D01）
 * 删除走用户上下文（RLS delete-own）；注册/验证经 API 路由（challenge cookie）。
 */
"use server";

import { revalidatePath } from "next/cache";
import { deleteMyCredential } from "@/lib/repositories/webauthn";
import { ROUTES } from "@/lib/constants";
import type { ActionResult } from "@/lib/types/action-result";
import { ok, fail } from "@/lib/types/action-result";

export async function deletePasskey(id: string): Promise<ActionResult> {
  try {
    await deleteMyCredential(id);
  } catch (error) {
    console.error("[deletePasskey] 删除失败:", error);
    return fail("databaseError");
  }
  revalidatePath(ROUTES.dashboardSettings);
  return ok();
}
