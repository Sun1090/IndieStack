/**
 * 个人资料服务端操作单元测试
 * mock supabase server client 与 next/cache，验证资料更新的白名单校验
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ROUTES } from "@/lib/constants";

const { createClientMock, revalidatePathMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import { updateProfileSettings } from "./profile";

const USER = { id: "u1", email: "a@b.com" };

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

function mockClient(opts: { user?: object | null; updateError?: boolean } = {}) {
  const { user = USER, updateError = false } = opts;
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
    from: vi.fn((table: string) => {
      if (table === "profiles") {
        return {
          update: vi.fn(() => ({
            eq: vi.fn(() =>
              Promise.resolve(updateError ? { error: { message: "db" } } : { error: null }),
            ),
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

describe("updateProfileSettings()", () => {
  it("未登录返回 notAuthenticated", async () => {
    createClientMock.mockResolvedValue(mockClient({ user: null }));
    await expect(updateProfileSettings(form({}))).resolves.toEqual({ error: "notAuthenticated" });
  });

  it("空全名返回 fullNameRequired", async () => {
    createClientMock.mockResolvedValue(mockClient());
    await expect(updateProfileSettings(form({ fullName: "  " }))).resolves.toEqual({
      error: "fullNameRequired",
    });
  });

  it("合法资料更新成功并触发 revalidatePath", async () => {
    createClientMock.mockResolvedValue(mockClient());
    const result = await updateProfileSettings(
      form({ fullName: "张三", bio: "hi", timezone: "Asia/Shanghai", language: "zh-CN" }),
    );
    expect(result).toEqual({ success: true });
    expect(revalidatePathMock).toHaveBeenCalledWith(ROUTES.dashboardProfile);
  });

  it("数据库错误返回 databaseError", async () => {
    createClientMock.mockResolvedValue(mockClient({ updateError: true }));
    await expect(updateProfileSettings(form({ fullName: "张三" }))).resolves.toEqual({
      error: "databaseError",
    });
  });
});
