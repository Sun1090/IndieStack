/**
 * Profiles 数据访问层（Repository）
 * 集中收口 profiles 表的查询与更新，统一错误处理与类型。
 *
 * 迁移策略（ADR：渐进式）——新代码必须经由本模块访问 profiles；
 * 存量消费方在触碰时迁移。admin 客户端方法显式标注，仅限服务端受信场景。
 */
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type ProfileUpdate = Database["public"]["Tables"]["profiles"]["Update"];

type DbResult<T> = { data: T; error: string | null };

/** 按用户 ID 查询 profile（走登录态客户端，受 RLS 约束） */
export async function getProfileById(id: string): Promise<DbResult<Profile | null>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", id)
    .single();
  return { data: (data as Profile) ?? null, error: error?.message ?? null };
}

/** 按邮箱精确查询用户 ID（service_role，绕过 RLS——仅供邀请等受信流程使用） */
export async function findUserIdByEmail(email: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("id")
    .eq("email", email.toLowerCase())
    .maybeSingle();
  return data?.id ?? null;
}

/** 更新 profile（自动附带 updated_at；走登录态客户端，RLS 防越权写） */
export async function updateProfile(
  id: string,
  patch: ProfileUpdate,
): Promise<DbResult<Profile | null>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  return { data: (data as Profile) ?? null, error: error?.message ?? null };
}
