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

import { listApiKeys, createApiKey, revokeApiKey } from "./api-keys";

const USER = { id: "u1", email: "a@b.com" };

function mockClient(
  opts: {
    user?: object | null;
    listError?: boolean;
    insertError?: boolean;
    updateError?: boolean;
  } = {},
) {
  const { user = USER, listError = false, insertError = false, updateError = false } = opts;
  let insertPayload: Record<string, unknown> | null = null;
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
    from: vi.fn((table: string) => {
      if (table === "api_keys") {
        return {
          select: vi.fn((..._args: unknown[]) => ({
            eq: vi.fn(() => ({
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
            insertPayload = payload;
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
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() =>
                Promise.resolve(updateError ? { error: { message: "db" } } : { error: null }),
              ),
            })),
          })),
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
});
