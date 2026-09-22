/**
 * 管理后台布局的权限读取测试（C08）
 *
 * 只测守卫那一段：两条路径都在渲染之前结束（抛错 / redirect），所以不需要渲染组件。
 * 要紧的是把它们区分开——一次读失败曾经和「不是管理员」走同一条 redirect，
 * 于是数据库抖一下，管理员看到的是一条凭空的权限拒绝。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ROUTES } from "@/lib/constants";

const { createClientMock, redirectMock, getTranslationsMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  redirectMock: vi.fn(),
  getTranslationsMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("next-intl/server", () => ({
  getTranslations: getTranslationsMock,
}));

import AdminLayout from "./layout";

/** `maybeSingle` 的三种答案：有行、没行、读失败。 */
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
  // 真的 `redirect()` 是抛 NEXT_REDIRECT：不照抄这个行为，「redirect 之后不该继续执行」
  // 就永远测不到——第一版让它返回，于是读失败那条路径一路走到了后面的代码。
  redirectMock.mockImplementation(() => {
    throw new Error("NEXT_REDIRECT");
  });
  getTranslationsMock.mockResolvedValue((key: string) => key);
});

describe("AdminLayout 的角色读取", () => {
  it("未登录仍然 redirect 到登录页", async () => {
    createClientMock.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null } }) },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({}) }) }) }),
    });
    await expect(AdminLayout({ children: null })).rejects.toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith(ROUTES.login);
  });

  it("角色读取失败时抛错，而不是把人 redirect 回仪表盘", async () => {
    mockProfileRead({ data: null, error: { message: "connection terminated" } });

    await expect(AdminLayout({ children: null })).rejects.toThrow("connection terminated");
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("profiles 缺行是「还没有记录」，按 member 处理并 redirect", async () => {
    mockProfileRead({ data: null, error: null });

    await expect(AdminLayout({ children: null })).rejects.toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith(ROUTES.dashboard);
  });

  it("角色达标时不 redirect 也不抛错", async () => {
    mockProfileRead({ data: { role: "admin" }, error: null });

    await expect(AdminLayout({ children: null })).resolves.toBeTruthy();
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
