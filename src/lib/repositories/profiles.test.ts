/**
 * profiles repository 单测（B07）
 * mock server + admin client，验证查询/邮箱查 ID/更新与错误映射
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { chainMock, dbClientMock } from "./test-helpers";

const { createClientMock, createAdminClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  createAdminClientMock: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));

import { getProfileById, findUserIdByEmail, updateProfile } from "./profiles";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getProfileById()", () => {
  it("成功返回 profile", async () => {
    const row = { id: "u1", email: "a@b.com" };
    createClientMock.mockResolvedValue(dbClientMock(() => chainMock({ data: row })));
    await expect(getProfileById("u1")).resolves.toEqual({ data: row, error: null });
  });

  it("错误映射为 message 字符串", async () => {
    createClientMock.mockResolvedValue(
      dbClientMock(() => chainMock({ error: { message: "db" } })),
    );
    await expect(getProfileById("u1")).resolves.toEqual({ data: null, error: "db" });
  });
});

describe("findUserIdByEmail()", () => {
  it("命中返回用户 ID", async () => {
    createAdminClientMock.mockReturnValue(dbClientMock(() => chainMock({ data: { id: "u1" } })));
    await expect(findUserIdByEmail("A@B.com")).resolves.toBe("u1");
  });

  it("未命中返回 null", async () => {
    createAdminClientMock.mockReturnValue(dbClientMock(() => chainMock({})));
    await expect(findUserIdByEmail("x@y.com")).resolves.toBeNull();
  });
});

describe("updateProfile()", () => {
  it("成功返回更新后的 profile", async () => {
    const row = { id: "u1", full_name: "New" };
    createClientMock.mockResolvedValue(dbClientMock(() => chainMock({ data: row })));
    const result = await updateProfile("u1", { full_name: "New" });
    expect(result).toEqual({ data: row, error: null });
  });

  it("错误映射为 message 字符串", async () => {
    createClientMock.mockResolvedValue(
      dbClientMock(() => chainMock({ error: { message: "db" } })),
    );
    await expect(updateProfile("u1", {})).resolves.toEqual({ data: null, error: "db" });
  });
});
