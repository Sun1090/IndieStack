/**
 * 审计日志布局的权限读取测试（C08）
 *
 * 这一层比父级更严（只放 super_admin），所以「读不到角色」和「不是 super_admin」必须是两件事：
 * 前者抛给错误边界，后者才是 redirect。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ROUTES } from "@/lib/constants";

const { createClientMock, redirectMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  redirectMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

import AuditLogsLayout from "./layout";

function mockProfileRead(result: {
  data: { role: string } | null;
  error: { message: string } | null;
}) {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: () => Promise.resolve(result),
  };
  createClientMock.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from: () => query,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // 与 admin/layout.test.tsx 同理：redirect 必须抛，否则「抛穿 vs 继续执行」分不出来。
  redirectMock.mockImplementation(() => {
    throw new Error("NEXT_REDIRECT");
  });
});

describe("AuditLogsLayout 的角色读取", () => {
  it("角色读取失败时抛错，而不是 redirect 回 /dashboard/admin", async () => {
    mockProfileRead({ data: null, error: { message: "connection terminated" } });

    await expect(AuditLogsLayout({ children: null })).rejects.toThrow("connection terminated");
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("profiles 缺行时按「不是 super_admin」redirect", async () => {
    mockProfileRead({ data: null, error: null });

    await expect(AuditLogsLayout({ children: null })).rejects.toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith(ROUTES.admin);
  });

  it("admin 也不是 super_admin，仍然 redirect", async () => {
    mockProfileRead({ data: { role: "admin" }, error: null });

    await expect(AuditLogsLayout({ children: null })).rejects.toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith(ROUTES.admin);
  });

  it("super_admin 放行且不 redirect", async () => {
    mockProfileRead({ data: { role: "super_admin" }, error: null });

    await expect(AuditLogsLayout({ children: null })).resolves.not.toThrow();
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
