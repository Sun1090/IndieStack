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
import type { ActionResult } from "@/lib/types/action-result";
import { fail, ok } from "@/lib/types/action-result";

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
    console.error("[listApiKeys] 获取密钥列表失败:", error);
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
    console.error("[createApiKey] 创建密钥失败:", error);
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
    await deactivateApiKey(user.id, keyId);
  } catch (error) {
    console.error("[revokeApiKey] 吊销密钥失败:", error);
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
  const { data: existing } = (await supabase
    .from("api_keys")
    .select("name, scopes")
    .eq("id", keyId)
    .eq("user_id", user.id)
    .maybeSingle()) as unknown as {
    data: { name: string; scopes: string[] } | null;
  };

  if (!existing) return fail("databaseError");

  // 签发新密钥
  const inserted = await insertApiKey({
    user_id: user.id,
    name: existing.name,
    key_prefix: `${rawKey.slice(0, 10)}...`,
    key_hash: hashApiKey(rawKey),
    scopes: existing.scopes ?? ["project:read"],
  });

  // 吊销旧密钥
  await deactivateApiKey(user.id, keyId);

  revalidatePath(ROUTES.apiKeys);
  return ok({ key: rawKey, record: toRecord(inserted) });
}
