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
    const { data: first } = await client.from("api_keys").select("*").limit(1);

    const keyId = asRows(first)[0].id as string;
    await client
      .from("api_keys")
      .update({ is_active: false })
      .eq("id", keyId)
      .eq("user_id", MOCK_USER_ID);

    const { data: after } = await client.from("api_keys").select("*").eq("id", keyId);

    expect(asRows(after)[0].is_active).toBe(false);
  });

  it("吊销只影响目标密钥，不影响其他密钥", async () => {
    const client = createMockSupabaseClient();
    const { data: before } = await client.from("api_keys").select("*").eq("user_id", MOCK_USER_ID);

    const rows = asRows(before);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const targetId = rows[0].id as string;
    // 其他密钥保持各自的原始状态（mock 预置数据中可能存在本来已吊销的密钥）
    const others = rows.slice(1).map((r) => ({ id: r.id, is_active: r.is_active }));

    await client
      .from("api_keys")
      .update({ is_active: false })
      .eq("id", targetId)
      .eq("user_id", MOCK_USER_ID);

    const { data: after } = await client.from("api_keys").select("*").eq("user_id", MOCK_USER_ID);

    const afterRows = asRows(after);
    expect(afterRows.find((r) => r.id === targetId)?.is_active).toBe(false);
    for (const other of others) {
      expect(afterRows.find((r) => r.id === other.id)?.is_active).toBe(other.is_active);
    }
  });
});

describe("Mock Teams", () => {
  beforeEach(() => {
    resetMockCache();
  });

  it("in 过滤可返回用户所属团队列表", async () => {
    const client = createMockSupabaseClient();
    const { data, error } = await client.from("teams").select("*").in("id", ["mock-team-001"]);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    const rows = asRows(data);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("mock-team-001");
  });

  it("in 过滤不匹配时返回空列表", async () => {
    const client = createMockSupabaseClient();
    const { data } = await client
      .from("teams")
      .select("*")
      .in("id", ["00000000-0000-0000-0000-000000000000"]);

    expect(asRows(data)).toHaveLength(0);
  });
});

describe("Mock Admin Auth", () => {
  beforeEach(() => {
    resetMockCache();
  });

  it("admin.listUsers 返回含当前用户的用户列表", async () => {
    const client = createMockSupabaseClient();
    const { data, error } = await client.auth.admin.listUsers();

    expect(error).toBeNull();
    expect(Array.isArray(data.users)).toBe(true);
    expect(data.users.length).toBeGreaterThan(0);
    expect(data.users[0]).toMatchObject({
      id: MOCK_USER_ID,
      email: "dev@indiestack.local",
    });
  });
});

describe("Mock 写操作与真实 PostgREST 行为对齐", () => {
  beforeEach(() => {
    resetMockCache();
  });

  it("update 带 eq 只更新匹配行并持久化", async () => {
    const client = createMockSupabaseClient();
    await client
      .from("profiles")
      .update({ full_name: "测试更新后的名字", updated_at: "2026-01-01T00:00:00.000Z" })
      .eq("id", MOCK_USER_ID);

    const { data } = await client
      .from("profiles")
      .select("full_name")
      .eq("id", MOCK_USER_ID)
      .single();

    expect(data).not.toBeNull();
    expect((data as Record<string, unknown>).full_name).toBe("测试更新后的名字");
  });

  it("update 不匹配任何行时不改动数据", async () => {
    const client = createMockSupabaseClient();
    await client
      .from("profiles")
      .update({ full_name: "不应生效" })
      .eq("id", "00000000-0000-0000-0000-000000000000");

    const { data } = await client
      .from("profiles")
      .select("full_name")
      .eq("id", MOCK_USER_ID)
      .single();

    expect((data as Record<string, unknown>).full_name).not.toBe("不应生效");
  });

  it("delete 从列表中移除匹配行", async () => {
    const client = createMockSupabaseClient();
    const { data: before } = await client.from("team_members").select("*");
    const beforeRows = asRows(before);
    const targetId = beforeRows[0].id as string;
    const beforeCount = beforeRows.length;

    await client.from("team_members").delete().eq("id", targetId);

    const { data: after } = await client.from("team_members").select("*");
    const afterRows = asRows(after);
    expect(afterRows).toHaveLength(beforeCount - 1);
    expect(afterRows.some((r) => r.id === targetId)).toBe(false);
  });

  it("head: true 只返回 count 不返回数据行", async () => {
    const client = createMockSupabaseClient();
    const { data, count, error } = await client
      .from("profiles")
      .select("*", { count: "exact", head: true });

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    expect((data as unknown[]).length).toBe(0);
    expect(count).toBeGreaterThan(0);
  });

  it("update+select 返回完整更新后的行", async () => {
    const client = createMockSupabaseClient();
    const { data } = await client
      .from("profiles")
      .update({ full_name: "API 更新" })
      .eq("id", MOCK_USER_ID)
      .select()
      .single();

    expect(data).not.toBeNull();
    const row = data as Record<string, unknown>;
    expect(row.full_name).toBe("API 更新");
    expect(row.id).toBe(MOCK_USER_ID);
  });

  it("profiles 支持按 email 通用 eq 过滤（邀请成员按邮箱查用户）", async () => {
    const client = createMockSupabaseClient();

    // 已知邮箱（mock 当前用户）→ 命中
    const { data: found } = await client
      .from("profiles")
      .select("id")
      .eq("email", "dev@indiestack.local")
      .maybeSingle();
    expect(found).not.toBeNull();
    expect((found as Record<string, unknown>).id).toBe(MOCK_USER_ID);

    // 未知邮箱 → 无结果（maybeSingle 返回 null，对应"用户未注册"）
    const { data: missing } = await client
      .from("profiles")
      .select("id")
      .eq("email", "nobody@example.com")
      .maybeSingle();
    expect(missing).toBeNull();
  });
});
