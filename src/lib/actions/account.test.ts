/**
 * 账户删除 action 单测（H08）
 * 覆盖：限频、未登录、确认短语（含大小写/空白与被篡改的客户端）、
 *       成功后的登出与重校验、失败时不登出。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { deleteAccountWithDataMock, createClientMock, rateLimitCheckMock, revalidatePathMock, logActionErrorMock } =
  vi.hoisted(() => ({
    deleteAccountWithDataMock: vi.fn(),
    createClientMock: vi.fn(),
    rateLimitCheckMock: vi.fn(),
    revalidatePathMock: vi.fn(),
    logActionErrorMock: vi.fn(),
  }));

vi.mock("@/lib/account/deletion", () => ({ deleteAccountWithData: deleteAccountWithDataMock }));
vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: { check: rateLimitCheckMock } }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/api-log", () => ({ logActionError: logActionErrorMock }));

import { deleteAccountAction } from "./account";
import { ROUTES } from "@/lib/constants";

const USER = { id: "u1", email: "a@b.c" };

function client(user: unknown = USER) {
  const signOut = vi.fn(async () => ({ error: null }));
  createClientMock.mockResolvedValue({
    auth: {
      getUser: async () => ({ data: { user } }),
      signOut,
    },
    signOut,
  });
  return signOut;
}

beforeEach(() => {
  vi.clearAllMocks();
  rateLimitCheckMock.mockResolvedValue({ allowed: true, remaining: 4, resetIn: 60_000 });
  client();
  deleteAccountWithDataMock.mockResolvedValue({
    erasure: { apiUsage: 0, contactMessages: 0, auditLogsAnonymized: 0 },
  });
});

describe("deleteAccountAction", () => {
  it("限频命中时直接拒绝，不查库也不删号", async () => {
    rateLimitCheckMock.mockResolvedValue({ allowed: false, remaining: 0, resetIn: 60_000 });

    await expect(deleteAccountAction({ confirm: "delete" })).resolves.toEqual({
      ok: false,
      error: "rateLimited",
    });
    expect(deleteAccountWithDataMock).not.toHaveBeenCalled();
  });

  it("未登录返回 notAuthenticated", async () => {
    client(null);

    await expect(deleteAccountAction({ confirm: "delete" })).resolves.toEqual({
      ok: false,
      error: "notAuthenticated",
    });
    expect(deleteAccountWithDataMock).not.toHaveBeenCalled();
  });

  it("确认短语不符时拒绝：删号不可逆，不能靠客户端自觉", async () => {
    const cases: unknown[] = ["", "  ", "delete me", "DEL", { toString: () => "delete" }, undefined];

    for (const confirm of cases) {
      const result = await deleteAccountAction({ confirm });
      expect(result, String(confirm)).toEqual({ ok: false, error: "confirmPhraseMismatch" });
    }
    expect(deleteAccountWithDataMock).not.toHaveBeenCalled();
  });

  it("接受两种语言的短语，并忽略首尾空白与大小写", async () => {
    await expect(deleteAccountAction({ confirm: " Delete " })).resolves.toEqual({ ok: true });
    await expect(deleteAccountAction({ confirm: "删除" })).resolves.toEqual({ ok: true });
  });

  it("只删除当前会话用户自己的账户", async () => {
    await deleteAccountAction({ confirm: "delete" });

    expect(deleteAccountWithDataMock).toHaveBeenCalledTimes(1);
    expect(deleteAccountWithDataMock).toHaveBeenCalledWith(USER.id);
  });

  it("删除成功后清掉本设备会话并让设置页重新校验", async () => {
    const signOut = client();

    await expect(deleteAccountAction({ confirm: "delete" })).resolves.toEqual({ ok: true });

    expect(signOut).toHaveBeenCalledWith({ scope: "global" });
    expect(revalidatePathMock).toHaveBeenCalledWith(ROUTES.dashboardSettings);
  });

  it("擦除或删号失败时返回错误、保持登录态，让用户能重试", async () => {
    const signOut = client();
    deleteAccountWithDataMock.mockRejectedValue(new Error("erase unavailable"));

    await expect(deleteAccountAction({ confirm: "delete" })).resolves.toEqual({
      ok: false,
      error: "accountDeleteFailed",
    });
    expect(signOut).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
    expect(logActionErrorMock).toHaveBeenCalled();
  });
});
