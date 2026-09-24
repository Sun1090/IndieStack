/**
 * 账户删除（H08）
 *
 * 只允许当前会话的持有者删除自己的账户，且必须输入与界面语言一致的确认短语
 * （`delete` / 「删除」）。删除后本设备的会话 cookie 一并清掉——账户已经不存在，
 * 令牌自然会失效，但让用户下一次请求才收到 401 是一次无谓的报错。
 */
"use server";

import { revalidatePath } from "next/cache";
import { deleteAccountWithData } from "@/lib/account/deletion";
import { ROUTES } from "@/lib/constants";
import { logActionError } from "@/lib/api-log";
import { isAccountDeletionConfirmed } from "@/lib/privacy/data-policy";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types/action-result";
import { fail, ok } from "@/lib/types/action-result";

export async function deleteAccountAction(input: { confirm?: unknown }): Promise<ActionResult> {
  const limits = await rateLimit.check(new Request("http://local/account-delete"));
  if (!limits.allowed) return fail("rateLimited");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("notAuthenticated");

  if (!isAccountDeletionConfirmed(input?.confirm)) return fail("confirmPhraseMismatch");

  try {
    await deleteAccountWithData(user.id);
  } catch (error) {
    await logActionError("[deleteAccountAction] 账户删除失败", error);
    return fail("accountDeleteFailed");
  }

  const { error: signOutError } = await supabase.auth.signOut({ scope: "global" });
  if (signOutError) {
    // 不回头报 `accountDeleteFailed`：账户已经删掉了，那样会让人去删一个不存在的账户。
    // 但「清掉本设备会话」是这个函数在文件头上承诺过的事（见文档注释），没做成必须留痕迹，
    // 而不是让它读起来像做成了。
    await logActionError("[deleteAccountAction] 账户已删除，但清退会话失败", signOutError);
  }
  revalidatePath(ROUTES.dashboardSettings);
  return ok();
}
