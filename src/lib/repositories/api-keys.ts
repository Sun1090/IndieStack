/**
 * ApiKeys 数据访问层
 */
import { createClient } from "@/lib/supabase/server";

export type ApiKeyRow = Record<string, unknown>;

/** 用户的所有 API 密钥（登录态） */
export async function listApiKeysByUser(userId: string): Promise<ApiKeyRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("api_keys")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ApiKeyRow[];
}

/** 插入新密钥，返回完整行 */
export async function insertApiKey(row: Record<string, unknown>): Promise<ApiKeyRow> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("api_keys")
    .insert(row)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return (data ?? {}) as ApiKeyRow;
}

/**
 * 吊销（软删除）；RLS 保证只能操作自己的密钥。
 *
 * 返回「有没有真的改掉一行」。`update` 只给 `error`，0 行受影响时它是 `null`，
 * 所以不 `select` 回来的话「吊销了一个不存在的密钥」与「吊销成功」在调用方看来一模一样。
 */
export async function deactivateApiKey(userId: string, keyId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("api_keys")
    .update({ is_active: false })
    .eq("id", keyId)
    .eq("user_id", userId)
    .select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}
