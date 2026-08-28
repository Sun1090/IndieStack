/**
 * 联系表单服务端操作单元测试
 * mock supabase server client、next/cache 与 rate-limit，验证限频、校验与落库逻辑
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { createClientMock, revalidatePathMock, rateLimitCheckMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  rateLimitCheckMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: { check: rateLimitCheckMock } }));

import { submitContactMessage } from "./contact";

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

const VALID = { name: "张三", email: "a@b.com", subject: "咨询", message: "你好" };

function mockClient(opts: { insertError?: boolean } = {}) {
  const { insertError = false } = opts;
  return {
    from: vi.fn((table: string) => {
      if (table === "contact_messages") {
        return { insert: vi.fn().mockResolvedValue(insertError ? { error: { message: "db" } } : { error: null }) };
      }
      throw new Error(`unexpected table: ${table}`);
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  rateLimitCheckMock.mockResolvedValue({ allowed: true, remaining: 99, resetIn: 1000 });
});

describe("submitContactMessage()", () => {
  it("触发限频返回 rateLimited", async () => {
    rateLimitCheckMock.mockResolvedValue({ allowed: false, remaining: 0, resetIn: 1000 });
    await expect(submitContactMessage(form(VALID))).resolves.toEqual({
      ok: false,
      error: "rateLimited",
    });
  });

  it("姓名为空返回 nameRequired", async () => {
    await expect(submitContactMessage(form({ ...VALID, name: "  " }))).resolves.toEqual({
      ok: false,
      error: "nameRequired",
    });
  });

  it("邮箱非法返回 emailInvalid", async () => {
    await expect(submitContactMessage(form({ ...VALID, email: "not-an-email" }))).resolves.toEqual({
      ok: false,
      error: "emailInvalid",
    });
  });

  it("主题为空返回 subjectRequired", async () => {
    await expect(submitContactMessage(form({ ...VALID, subject: "" }))).resolves.toEqual({
      ok: false,
      error: "subjectRequired",
    });
  });

  it("内容为空返回 messageRequired", async () => {
    await expect(submitContactMessage(form({ ...VALID, message: "" }))).resolves.toEqual({
      ok: false,
      error: "messageRequired",
    });
  });

  it("写入失败返回 databaseError", async () => {
    createClientMock.mockResolvedValue(mockClient({ insertError: true }));
    await expect(submitContactMessage(form(VALID))).resolves.toEqual({
      ok: false,
      error: "databaseError",
    });
  });

  it("成功写入并触发 revalidatePath", async () => {
    createClientMock.mockResolvedValue(mockClient());
    await expect(submitContactMessage(form(VALID))).resolves.toEqual({ ok: true });
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/admin");
  });
});