/**
 * API 密钥服务端操作单元测试
 * mock supabase server client 与 next/cache，验证鉴权、校验、密钥生成与吊销逻辑
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ROUTES } from "@/lib/constants";

const { createClientMock, revalidatePathMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import { listApiKeys, createApiKey, regenerateApiKey, revokeApiKey } from "./api-keys";

const USER = { id: "u1", email: "a@b.com" };

function mockClient(
  opts: {
    user?: object | null;
    listError?: boolean;
    insertError?: boolean;
    updateError?: boolean;
    /** 重新生成时读到的原密钥行；`null` 表示确实没有这一条。 */
    existingRow?: { name: string; scopes: string[] } | null;
    existingReadError?: boolean;
    /** `update` 改掉的行数由这里决定：空数组就是「0 行受影响」。 */
    updateRows?: { id: string }[];
  } = {},
) {
  const {
    user = USER,
    listError = false,
    insertError = false,
    updateError = false,
    existingRow = { name: "Key", scopes: ["project:read"] },
    existingReadError = false,
    updateRows = [{ id: "k1" }],
  } = opts;
  /** 记录写到哪一步、写了什么，用来证明「读失败时一个密钥都没签发」。 */
  const calls: string[] = [];
  const inserts: Record<string, unknown>[] = [];
  return {
    calls,
    inserts,
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
    from: vi.fn((table: string) => {
      if (table === "api_keys") {
        return {
          select: vi.fn((..._args: unknown[]) => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(() =>
                  Promise.resolve(
                    existingReadError
                      ? { data: null, error: { message: "connection reset" } }
                      : { data: existingRow, error: null },
                  ),
                ),
              })),
              order: vi.fn(() =>
                Promise.resolve(
                  listError
                    ? { data: null, error: { message: "db" } }
                    : {
                        data: [
                          {
                            id: "k1",
                            name: "Key",
                            key_prefix: "isk_abc...",
                            scopes: ["project:read"],
                            is_active: true,
                            last_used_at: null,
                            created_at: "2026-01-01T00:00:00Z",
                          },
                        ],
                        error: null,
                      },
                ),
              ),
            })),
          })),
          insert: vi.fn((payload: Record<string, unknown>) => {
            inserts.push(payload);
            calls.push("insert");
            return {
              select: vi.fn(() => ({
                single: vi.fn(() =>
                  Promise.resolve(
                    insertError
                      ? { data: null, error: { message: "db" } }
                      : {
                          data: {
                            id: "k2",
                            name: "New",
                            key_prefix: "isk_0123456789...",
                            scopes: payload.scopes,
                            is_active: true,
                            last_used_at: null,
                            created_at: "2026-01-01T00:00:00Z",
                          },
                          error: null,
                        },
                  ),
                ),
              })),
            };
          }),
          update: vi.fn(() => {
            calls.push("update");
            return {
              eq: vi.fn(() => ({
                // 仓库层现在会 `.select("id")` 回来数行数，桩必须支持这一环
                eq: vi.fn(() => ({
                  select: vi.fn(() =>
                    Promise.resolve(
                      updateError
                        ? { data: null, error: { message: "db" } }
                        : { data: updateRows, error: null },
                    ),
                  ),
                })),
              })),
            };
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listApiKeys()", () => {
  it("未登录返回 notAuthenticated", async () => {
    createClientMock.mockResolvedValue(mockClient({ user: null }));
    await expect(listApiKeys()).resolves.toEqual({ ok: false, error: "notAuthenticated" });
  });

  it("数据库错误返回 databaseError", async () => {
    createClientMock.mockResolvedValue(mockClient({ listError: true }));
    const result = await listApiKeys();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("databaseError");
  });

  it("成功返回映射后的密钥记录", async () => {
    createClientMock.mockResolvedValue(mockClient());
    const result = await listApiKeys();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    const data = result.data ?? [];
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
      id: "k1",
      name: "Key",
      key_prefix: "isk_abc...",
      scopes: ["project:read"],
      is_active: true,
      last_used_at: null,
    });
  });
});

describe("createApiKey()", () => {
  it("未登录返回 notAuthenticated", async () => {
    createClientMock.mockResolvedValue(mockClient({ user: null }));
    await expect(createApiKey({ name: "x", scope: "read" })).resolves.toEqual({
      ok: false,
      error: "notAuthenticated",
    });
  });

  it("空名称返回校验错误", async () => {
    createClientMock.mockResolvedValue(mockClient());
    const result = await createApiKey({ name: "   ", scope: "read" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("keyNameRequired");
  });

  it("非法 scope 返回校验错误", async () => {
    createClientMock.mockResolvedValue(mockClient());
    const result = await createApiKey({ name: "key", scope: "admin" as never });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeTruthy();
  });

  it("read scope 生成只读密钥并触发 revalidatePath", async () => {
    createClientMock.mockResolvedValue(mockClient());
    const result = await createApiKey({ name: "My Key", scope: "read" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data!.key).toMatch(/^isk_/);
      expect(result.data!.key).not.toContain(result.data!.record.key_prefix);
      expect(result.data!.record.scopes).toEqual(["project:read"]);
      expect(result.data!.record.key_prefix.endsWith("...")).toBe(true);
    }
    expect(revalidatePathMock).toHaveBeenCalledWith(ROUTES.apiKeys);
  });

  it("all scope 生成全量权限密钥", async () => {
    createClientMock.mockResolvedValue(mockClient());
    const result = await createApiKey({ name: "Full", scope: "all" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data!.record.scopes).toContain("user:write");
      expect(result.data!.record.scopes).toContain("billing:read");
    }
  });

  it("数据库错误返回 databaseError", async () => {
    createClientMock.mockResolvedValue(mockClient({ insertError: true }));
    const result = await createApiKey({ name: "Key", scope: "read" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("databaseError");
  });
});

describe("revokeApiKey()", () => {
  it("未登录返回 notAuthenticated", async () => {
    createClientMock.mockResolvedValue(mockClient({ user: null }));
    await expect(revokeApiKey("k1")).resolves.toEqual({ ok: false, error: "notAuthenticated" });
  });

  it("成功吊销并触发 revalidatePath", async () => {
    createClientMock.mockResolvedValue(mockClient());
    await expect(revokeApiKey("k1")).resolves.toEqual({ ok: true });
    expect(revalidatePathMock).toHaveBeenCalledWith(ROUTES.apiKeys);
  });

  it("数据库错误返回 databaseError", async () => {
    createClientMock.mockResolvedValue(mockClient({ updateError: true }));
    await expect(revokeApiKey("k1")).resolves.toEqual({ ok: false, error: "databaseError" });
  });

  it("0 行受影响时是 apiKeyNotFound，不能报「已吊销」", async () => {
    createClientMock.mockResolvedValue(mockClient({ updateRows: [] }));
    revalidatePathMock.mockClear();
    await expect(revokeApiKey("k-999")).resolves.toEqual({ ok: false, error: "apiKeyNotFound" });
    // 没改掉任何一行就不该让页面重拉一遍列表——那会把「成功」的形状演全套
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

describe("regenerateApiKey()", () => {
  it("读不到原密钥元数据时是 databaseError，且一个密钥都不签发", async () => {
    const client = mockClient({ existingReadError: true });
    createClientMock.mockResolvedValue(client);
    await expect(regenerateApiKey("k1")).resolves.toEqual({ ok: false, error: "databaseError" });
    // 名字与 scopes 是从这一行读来的；没读到就签发会签出一个错的密钥而不是失败
    expect(client.calls).not.toContain("insert");
    expect(client.calls).not.toContain("update");
  });

  it("密钥确实不存在时是 apiKeyNotFound，不再是含糊的 databaseError", async () => {
    const client = mockClient({ existingRow: null });
    createClientMock.mockResolvedValue(client);
    await expect(regenerateApiKey("k-999")).resolves.toEqual({
      ok: false,
      error: "apiKeyNotFound",
    });
    expect(client.calls).not.toContain("insert");
  });

  it("旧密钥已吊销而新密钥签发失败时，说的是「旧的没了、请新建」", async () => {
    const client = mockClient({ insertError: true });
    createClientMock.mockResolvedValue(client);
    await expect(regenerateApiKey("k1")).resolves.toEqual({
      ok: false,
      error: "apiKeyRevokedButNotCreated",
    });
    // 关键在于顺序：先吊销才会出现「吊销成功 + 签发失败」；反过来留下的是没人知道的活密钥
    expect(client.calls).toEqual(["update", "insert"]);
  });

  it("读到元数据时沿用名字与 scopes 签发新密钥，并吊销旧的", async () => {
    const client = mockClient({ existingRow: { name: "CI", scopes: ["project:read", "project:write"] } });
    createClientMock.mockResolvedValue(client);
    const result = await regenerateApiKey("k1");
    expect(result.ok).toBe(true);
    // 先吊销、再签发：顺序反了就会造出一个谁都不知道明文的 active 密钥
    expect(client.calls).toEqual(["update", "insert"]);
    if (!result.ok) throw new Error("unreachable");
    // 新密钥沿用原密钥的名字与 scopes：断言的是**写进去的载荷**，
    // 而不是 mock 返回行的形状（它固定回一条 name: "New"，断言那里等于什么都没断）。
    expect(client.inserts[0]).toMatchObject({ name: "CI", scopes: ["project:read", "project:write"] });
    expect(result.data?.key).toMatch(/^isk_/);
  });
});
