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

import ProfileEditPage from "./page";

function mockRead(result: { data: unknown; error: { message: string } | null }) {
  const query: Record<string, unknown> = { eq: () => query };
  query.select = () => query;
  query.maybeSingle = () => Promise.resolve(result);
  createClientMock.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from: () => query,
  });
}

describe("ProfileEditPage 的资料读取", () => {
  it("读失败时抛错，而不是预填一份看起来合法的空白资料", async () => {
    mockRead({ data: null, error: { message: "connection terminated" } });
    await expect(ProfileEditPage()).rejects.toThrow("connection terminated");
  });

  it("缺行是正常结果，表单按空值预填", async () => {
    mockRead({ data: null, error: null });
    await expect(ProfileEditPage()).resolves.toBeTruthy();
  });
});
