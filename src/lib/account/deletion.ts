/**
 * 账户删除编排
 *
 * 删除账户只有一个正确顺序：**先清理对象、再擦除数据、最后删号**。
 * `admin.auth.admin.deleteUser()` 触发的是外键级联，而级联覆盖不到三类个人数据
 * （见 `@/lib/privacy/data-policy`）：`api_usage` 与 `audit_logs` 是 `on delete set null`，
 * `contact_messages` 没有外键。一旦先删号，`contact_messages` 就再也无法从账户
 * 反查到邮箱，隐私声明里的「删除或匿名化个人数据」会变成做不到的承诺。
 * 受管对象同理（见 `@/lib/uploads/erasure`）：必须在 `owner_id` 还指向这个人时枚举。
 *
 * 因此这里对失败的处理是刻意的不对称：
 *   - 枚举 / 擦除失败 → 抛错、**不删号**（可重试，且不会留下无法补救的状态）；
 *   - provider 删除单个对象失败 → 继续（删号是用户的权利，不该被 OSS 抖动挡住），
 *     失败的对象保持 `active`，因此仍会被孤儿审计发现并可补删；
 *   - 删除后的审计补记失败 → 只记日志、不抛错（号已经删了，回滚不了，不能因此把成功报成失败）。
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { eraseAccountData } from "@/lib/repositories/account-erasure";
import { appendAuditLog } from "@/lib/repositories/audit-logs";
import { removeUnreferencedUserObjects, type ObjectErasureSummary } from "@/lib/uploads/erasure";
import { logActionError } from "@/lib/api-log";
import type { AccountErasureCounts } from "@/lib/privacy/data-policy";

export interface AccountDeletionResult {
  /** 数据库侧各数据面受影响的行数，供调用方记录与断言。 */
  erasure: AccountErasureCounts;
  /** 受管对象（头像 / 封面）的清理结果。 */
  objects: ObjectErasureSummary;
}

/**
 * 擦除该账户的个人数据并删除账户本身。
 *
 * 调用方负责确认请求来自该账户本人（会话校验 + 确认短语），本函数不做授权判断。
 */
export async function deleteAccountWithData(userId: string): Promise<AccountDeletionResult> {
  const objects = await removeUnreferencedUserObjects(userId);
  const erasure = await eraseAccountData(userId);

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) throw new Error(error.message);

  try {
    // 删除事件本身要留痕，但不能重新建立与已擦除身份的连接：
    // user_id / entity_id 一律为 null，只记计数（对象键含用户 id，不进审计行）。
    await appendAuditLog({
      userId: null,
      action: "account.deleted",
      entityType: "user",
      entityId: null,
      metadata: {
        apiUsage: erasure.apiUsage,
        contactMessages: erasure.contactMessages,
        auditLogsAnonymized: erasure.auditLogsAnonymized,
        objectsRemoved: objects.removed,
        objectsRetained: objects.retained,
        objectsFailed: objects.failed.length,
      },
    });
  } catch (auditError) {
    await logActionError("[deleteAccountWithData] 账户删除审计补记失败", auditError);
  }

  return { erasure, objects };
}
