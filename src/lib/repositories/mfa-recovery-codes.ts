/**
 * MfaRecoveryCodes 数据访问层（service_role）
 * mfa_recovery_codes 表无 anon/authenticated 策略，仅 admin 客户端可读写。
 */
import { createAdminClient } from "@/lib/supabase/admin";

export interface RecoveryCodeRow {
  id: string;
  code_hash: string;
  used_at: string | null;
}

/** 用户未使用的恢复码哈希 */
export async function listUnusedRecoveryCodes(userId: string): Promise<RecoveryCodeRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("mfa_recovery_codes")
    .select("id, code_hash, used_at")
    .eq("user_id", userId)
    .is("used_at", null);
  if (error) throw new Error(error.message);
  return (data ?? []) as RecoveryCodeRow[];
}

/** 是否有可用恢复码（UI 提示用） */
export async function hasUnusedRecoveryCodes(userId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from("mfa_recovery_codes")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("used_at", null);
  if (error) throw new Error(error.message);
  return (count ?? 0) > 0;
}

/** 替换整组恢复码（重新生成时先清旧码），返回写入行数 */
export async function replaceRecoveryCodes(
  userId: string,
  hashes: string[],
): Promise<number> {
  const admin = createAdminClient();
  const { error: delError } = await admin
    .from("mfa_recovery_codes")
    .delete()
    .eq("user_id", userId);
  if (delError) throw new Error(delError.message);
  if (hashes.length === 0) return 0;
  const { data, error } = await admin
    .from("mfa_recovery_codes")
    .insert(hashes.map((code_hash) => ({ user_id: userId, code_hash })))
    .select("id");
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

/** 消费一张恢复码（标记已用）；返回是否成功抢占（防并发复用） */
export async function consumeRecoveryCode(id: string, userId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("mfa_recovery_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .is("used_at", null)
    .select("id");
  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
}
