/**
 * WebAuthn 凭据数据访问层（v0.5.0 D01，迁移 019）
 * 注册与认证均由服务端路由经用户上下文（RLS）或 admin 客户端读写。
 */
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export interface WebauthnCredential {
  id: string;
  credential_id: string;
  device_name: string | null;
  counter: number;
  transports: string[] | null;
  created_at: string;
  last_used_at: string | null;
}

/** 用户上下文：列出当前用户凭据（设置页展示） */
export async function listMyCredentials(): Promise<WebauthnCredential[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("webauthn_credentials")
    .select("id,credential_id,device_name,counter,transports,created_at,last_used_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as WebauthnCredential[];
}

/** 服务端验证流程：按 credential_id 取凭据（含公钥与计数器） */
export async function findCredentialById(
  credentialId: string,
): Promise<(WebauthnCredential & { user_id: string; public_key: string }) | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("webauthn_credentials")
    .select("id,user_id,credential_id,public_key,counter,device_name,transports,created_at,last_used_at")
    .eq("credential_id", credentialId)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as (WebauthnCredential & { user_id: string; public_key: string }) | null) ?? null;
}

/** 服务端验证流程：注册成功后写入新凭据（admin，路由内已有用户上下文校验） */
export async function createCredential(input: {
  userId: string;
  credentialId: string;
  publicKey: string;
  counter: number;
  deviceName?: string | null;
  transports?: string[] | null;
}): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("webauthn_credentials").insert({
    user_id: input.userId,
    credential_id: input.credentialId,
    public_key: input.publicKey,
    counter: input.counter,
    device_name: input.deviceName ?? null,
    transports: input.transports ?? null,
  });
  if (error) throw new Error(error.message);
}

/** 认证成功后更新签名计数器与最后使用时间（克隆检测依据） */
export async function updateCredentialCounter(credentialId: string, counter: number): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("webauthn_credentials")
    .update({ counter, last_used_at: new Date().toISOString() })
    .eq("credential_id", credentialId);
  if (error) throw new Error(error.message);
}

/**
 * 用户上下文：删除自己的凭据（设置页）。
 *
 * 返回「真的删掉了没有」而不是 void：RLS 的 `users_delete_own_passkeys` 对**不匹配**的行
 * 是静默过滤（0 行受影响、`error` 为 null），不是报错。只判 `error` 的话，
 * 删一条不存在的凭据和删一条别人的凭据都会长成「成功」。`.select("id")` 拿回受影响行，
 * 才能把这两种情况分开。（与 `deactivateApiKey` / `updateStatusByToken` 同一口径。）
 */
export async function deleteMyCredential(id: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("webauthn_credentials")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}
