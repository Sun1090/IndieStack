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

export async function listApiKeys() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { data: [], error: "notAuthenticated" };
  }

  const { data, error } = await supabase
    .from("api_keys")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[listApiKeys] 获取密钥列表失败:", error);
    return { data: [], error: "databaseError" };
  }

  return { data: (data ?? []).map((row: Record<string, unknown>) => toRecord(row)), error: null };
}

export async function createApiKey(input: { name: string; scope: "read" | "all" }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { error: "notAuthenticated" };
  }

  const validated = createApiKeySchema.safeParse(input);
  if (!validated.success) {
    return { error: validated.error.errors[0]?.message ?? "invalidInput" };
  }

  const rawKey = `isk_${randomBytes(24).toString("base64url")}`;
  const scopes =
    validated.data.scope === "all"
      ? ["user:read", "user:write", "project:read", "project:write", "billing:read"]
      : ["project:read"];

  const { data, error } = await supabase
    .from("api_keys")
    .insert({
      user_id: user.id,
      name: validated.data.name,
      key_prefix: `${rawKey.slice(0, 10)}...`,
      key_hash: hashApiKey(rawKey),
      scopes,
    })
    .select()
    .single();

  if (error) {
    console.error("[createApiKey] 创建密钥失败:", error);
    return { error: "databaseError" };
  }

  revalidatePath(ROUTES.apiKeys);

  const record = data
    ? toRecord(data as unknown as Record<string, unknown>)
    : {
        id: "",
        name: validated.data.name,
        key_prefix: `${rawKey.slice(0, 10)}...`,
        scopes,
        is_active: true,
        last_used_at: null,
        created_at: new Date().toISOString(),
      };

  return { success: true, key: rawKey, record };
}

export async function revokeApiKey(keyId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { error: "notAuthenticated" };
  }

  const { error } = await supabase
    .from("api_keys")
    .update({ is_active: false })
    .eq("id", keyId)
    .eq("user_id", user.id);

  if (error) {
    console.error("[revokeApiKey] 吊销密钥失败:", error);
    return { error: "databaseError" };
  }

  revalidatePath(ROUTES.apiKeys);
  return { success: true };
}
