/**
 * API 密钥服务端操作
 * 在服务端生成密钥并只保存加盐哈希，完整密钥只返回一次
 */
"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ROUTES } from "@/lib/constants";
import { listApiKeysByUser, insertApiKey, deactivateApiKey } from "@/lib/repositories/api-keys";
import type { ApiKeyRow } from "@/lib/repositories/api-keys";
import type { ActionResult } from "@/lib/types/action-result";
import { fail, ok } from "@/lib/types/action-result";
import { logActionError } from "@/lib/api-log";

const createApiKeySchema = z.object({
  name: z.string().trim().min(1, "keyNameRequired").max(60),
  scope: z.enum(["read", "all"]).default("read"),
});

export type ApiKeyRecord = {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  is_active: boolean;
  last_used_at: string | null;
  created_at: string;
};

function hashApiKey(rawKey: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = createHash("sha256").update(`${salt}:${rawKey}`).digest("hex");
  return `sha256:${salt}:${hash}`;
}

function toRecord(row: Record<string, unknown>): ApiKeyRecord {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    key_prefix: String(row.key_prefix ?? ""),
    scopes: Array.isArray(row.scopes) ? (row.scopes as string[]) : [],
    is_active: Boolean(row.is_active),
    last_used_at: row.last_used_at ? String(row.last_used_at) : null,
    created_at: String(row.created_at ?? ""),
  };
}

export async function listApiKeys(): Promise<ActionResult<ApiKeyRecord[]>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return fail("notAuthenticated");

  try {
    return ok((await listApiKeysByUser(user.id)).map((row) => toRecord(row)));
  } catch (error) {
    await logActionError("[listApiKeys] 获取密钥列表失败", error);
    return fail("databaseError");
  }
}

export async function createApiKey(
  input: { name: string; scope: "read" | "all" },
): Promise<ActionResult<{ key: string; record: ApiKeyRecord }>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return fail("notAuthenticated");

  const validated = createApiKeySchema.safeParse(input);
  if (!validated.success) {
    return fail(validated.error.issues[0]?.message ?? "invalidInput");
  }

  const rawKey = `isk_${randomBytes(24).toString("base64url")}`;
  const scopes =
    validated.data.scope === "all"
      ? ["user:read", "user:write", "project:read", "project:write", "billing:read"]
      : ["project:read"];

  let record: ApiKeyRecord;
  try {
    const row = await insertApiKey({
      user_id: user.id,
      name: validated.data.name,
      key_prefix: `${rawKey.slice(0, 10)}...`,
      key_hash: hashApiKey(rawKey),
      scopes,
    });
    record = toRecord(row);
  } catch (error) {
    await logActionError("[createApiKey] 创建密钥失败", error);
    return fail("databaseError");
  }

  revalidatePath(ROUTES.apiKeys);

  return ok({ key: rawKey, record });
}

export async function revokeApiKey(keyId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return fail("notAuthenticated");

  try {
    // 0 行受影响不是成功：`update` 只在报错时给 `error`，吊销一个不存在（或本就属于别人、
    // 被 RLS 挡掉）的密钥过去会照样回 `ok()`，UI 于是报「已吊销」。
    const revoked = await deactivateApiKey(user.id, keyId);
    if (!revoked) return fail("apiKeyNotFound");
  } catch (error) {
    await logActionError("[revokeApiKey] 吊销密钥失败", error);
    return fail("databaseError");
  }

  revalidatePath(ROUTES.apiKeys);
  return ok();
}

/**
 * 重新生成密钥：旧密钥立即失效（is_active=false），签发新密钥。
 */
export async function regenerateApiKey(
  keyId: string,
): Promise<ActionResult<{ key: string; record: ApiKeyRecord }>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return fail("notAuthenticated");

  const rawKey = `isk_${randomBytes(24).toString("base64url")}`;

  // 读取原密钥元数据
  const { data: existing, error: existingError } = await supabase
    .from("api_keys")
    .select("name, scopes")
    .eq("id", keyId)
    .eq("user_id", user.id)
    .maybeSingle();

  // 这次读取决定「拿什么名字与 scopes 去签新密钥」，所以它读失败时**绝不能签发**。
  // 原先两件事共用一个 `databaseError`：既把故障说成数据问题，也把「这个密钥不存在」
  // 说成服务器坏了——而后者是终态，重试不会变，用户该看到的是「找不到那个密钥」。
  if (existingError) {
    await logActionError("[regenerateApiKey] 原密钥元数据读取失败", existingError);
    return fail("databaseError");
  }
  if (!existing) return fail("apiKeyNotFound");

  // 顺序是**先吊销旧的、再签发新的**，不是反过来。原顺序会造出一个谁都不知道明文的可用凭据：
  // 明文只在成功响应里给一次，一旦后面的吊销步骤抛错，新密钥已经 active 却永远不会被使用，
  // 列表里只留一条前缀能对上的谜。现在的顺序最坏情况是「旧的回不去、新的没出来」——
  // 那是一次可见的失败，用户看得见旧密钥已失效，并且手里就有「创建密钥」这条出路。
  try {
    const revoked = await deactivateApiKey(user.id, keyId);
    if (!revoked) return fail("apiKeyNotFound");
  } catch (error) {
    await logActionError("[regenerateApiKey] 旧密钥吊销失败", error);
    return fail("databaseError");
  }

  let inserted: ApiKeyRow;
  try {
    inserted = await insertApiKey({
      user_id: user.id,
      name: existing.name,
      key_prefix: `${rawKey.slice(0, 10)}...`,
      key_hash: hashApiKey(rawKey),
      scopes: existing.scopes ?? ["project:read"],
    });
  } catch (error) {
    // 这条不能用泛化的 `databaseError`：它说的不是「什么都没变」，而是「旧密钥已经没了」。
    await logActionError("[regenerateApiKey] 旧密钥已吊销，但新密钥签发失败", error);
    return fail("apiKeyRevokedButNotCreated");
  }

  revalidatePath(ROUTES.apiKeys);
  return ok({ key: rawKey, record: toRecord(inserted) });
}
