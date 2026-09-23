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
import { logActionError } from "@/lib/api-log";

export async function deletePasskey(id: string): Promise<ActionResult> {
  let deleted: boolean;
  try {
    deleted = await deleteMyCredential(id);
  } catch (error) {
    await logActionError("[deletePasskey] 删除失败", error);
    return fail("databaseError");
  }
  // 0 行受影响不是「删好了」。RLS 对不匹配的行静默过滤（不报错），所以这条可能是
  // 一个已经不存在的凭据，也可能是别人的——两种情况下都什么都没发生，而设置页上这是
  // 一条「凭据已移除」的确认：报成功等于让用户带着一个他以为已经吊销的凭据继续用。
  if (!deleted) return fail("passkeyNotFound");
  revalidatePath(ROUTES.dashboardSettings);
  return ok();
}
