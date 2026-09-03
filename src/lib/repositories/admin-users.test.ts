/**
 * admin-users repository 单测（B02）
 * mock admin client，验证分页映射、总数、错误抛错与 range 分页参数
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { chainMock, dbClientMock } from "./test-helpers";

const { createAdminClientMock } = vi.hoisted(() => ({ createAdminClientMock: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));

import { listAdminUsersPage } from "./admin-users";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listAdminUsersPage()", () => {
  it("成功映射用户并返回总数", async () => {
    const rows = [
      { id: "u1", email: "a@b.com", full_name: "A", role: "admin", created_at: "2026-01-01" },
    ];
    createAdminClientMock.mockReturnValue(dbClientMock(() => chainMock({ data: rows, count: 1 })));
    await expect(listAdminUsersPage(1, 20)).resolves.toEqual({ users: rows, total: 1 });
  });

  it("空数据返回空列表且总数为 0", async () => {
    createAdminClientMock.mockReturnValue(dbClientMock(() => chainMock({ data: null })));
    await expect(listAdminUsersPage()).resolves.toEqual({ users: [], total: 0 });
  });

  it("数据库错误抛错", async () => {
    createAdminClientMock.mockReturnValue(
      dbClientMock(() => chainMock({ error: { message: "db" } })),
    );
    await expect(listAdminUsersPage()).rejects.toThrow("db");
  });

  it("分页参数正确透传 range", async () => {
    const chain = chainMock({ data: [], count: 0 });
    const from = vi.fn(() => chain);
    createAdminClientMock.mockReturnValue({ from });
    await listAdminUsersPage(3, 10);
    expect(from).toHaveBeenCalledWith("profiles");
    expect(chain.range).toHaveBeenCalledWith(20, 29);
  });
});
