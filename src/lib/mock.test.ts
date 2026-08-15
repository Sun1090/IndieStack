/**
 * Mock 数据层测试
 * 验证 Mock Supabase 客户端对 API 密钥表的读写行为
 * （列表、创建追加、吊销更新）
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createMockSupabaseClient, resetMockCache } from "./mock";
import { MOCK_USER_ID } from "./mock/data";

type MockRow = Record<string, unknown>;

function asRows(data: unknown): MockRow[] {
  return (data as MockRow[] | null) ?? [];
}

describe("Mock API Keys", () => {
  beforeEach(() => {
    resetMockCache();
  });

  it("列出预置的 mock API 密钥", async () => {
    const client = createMockSupabaseClient();
    const { data, error } = await client
      .from("api_keys")
      .select("*")
      .eq("user_id", MOCK_USER_ID)
      .order("created_at", { ascending: false });

    expect(error).toBeNull();
    const rows = asRows(data);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      user_id: MOCK_USER_ID,
      key_prefix: expect.any(String),
      scopes: expect.any(Array),
      is_active: expect.any(Boolean),
    });
  });

  it("创建密钥后追加到列表", async () => {
    const client = createMockSupabaseClient();
    const { data: created } = await client
      .from("api_keys")
      .insert({
        user_id: MOCK_USER_ID,
        name: "测试密钥",
        key_prefix: "isk_test...",
        key_hash: "sha256:salt:hash",
        scopes: ["project:read"],
        is_active: true,
      })
      .select()
      .single();

    expect(created).not.toBeNull();

    const { data: list } = await client.from("api_keys").select("*");
    const rows = asRows(list);
    expect(rows).toHaveLength(4);
    expect(rows.some((k) => k.name === "测试密钥")).toBe(true);
  });

  it("吊销密钥更新 is_active 并保留在列表中", async () => {
    const client = createMockSupabaseClient();
    const { data: first } = await client
      .from("api_keys")
      .select("*")
      .limit(1);

    const keyId = asRows(first)[0].id as string;
    await client
      .from("api_keys")
      .update({ is_active: false })
      .eq("id", keyId)
      .eq("user_id", MOCK_USER_ID);

    const { data: after } = await client
      .from("api_keys")
      .select("*")
      .eq("id", keyId);

    expect(asRows(after)[0].is_active).toBe(false);
  });
});
