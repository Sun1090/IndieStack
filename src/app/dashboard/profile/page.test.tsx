/**
 * 个人页的读取失败契约（C08-b）
 *
 * 只测守卫那一段：读失败必须在渲染之前抛出。继续渲染不是「显示空态」那么无害——
 * 编辑页会把 `""` / `UTC` / `en` 当现值预填，用户点一次保存就把真资料覆盖掉。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { createClientMock } = vi.hoisted(() => ({ createClientMock: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => {
    const t = (key: string) => key;
    t.has = () => false;
    return t;
  },
  getLocale: async () => "zh-CN",
}));

import ProfilePage from "./page";

function mockRead(result: { data: unknown; error: { message: string } | null }) {
  const query: Record<string, unknown> = { eq: () => query };
  query.select = () => query;
  query.maybeSingle = () => Promise.resolve(result);
  createClientMock.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "u1", created_at: null } } }) },
    from: () => query,
  });
}

describe("ProfilePage 的资料读取", () => {
  it("读失败时抛错，而不是把角色显示成 member", async () => {
    mockRead({ data: null, error: { message: "connection terminated" } });
    await expect(ProfilePage()).rejects.toThrow("connection terminated");
  });

  it("读到资料时正常渲染", async () => {
    mockRead({ data: { role: "admin", full_name: "N" }, error: null });
    await expect(ProfilePage()).resolves.toBeTruthy();
  });
});
