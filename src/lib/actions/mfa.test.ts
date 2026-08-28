/**
 * 双因素认证（TOTP）服务端操作单元测试
 * mock supabase server client 与 next/cache，验证因子列表/注册/验证/解除流程
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { createClientMock, revalidatePathMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import { listTotpFactors, enrollTotp, verifyTotpEnrollment, unenrollTotp } from "./mfa";

const USER = { id: "u1", email: "a@b.com" };

interface MfaMock {
  listFactors?: ReturnType<typeof vi.fn>;
  enroll?: ReturnType<typeof vi.fn>;
  challengeAndVerify?: ReturnType<typeof vi.fn>;
  unenroll?: ReturnType<typeof vi.fn>;
}

function mockClient(opts: { user?: object | null; mfa?: MfaMock } = {}) {
  const { user = USER, mfa = {} } = opts;
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user } }),
      mfa: {
        listFactors: mfa.listFactors ?? vi.fn().mockResolvedValue({ data: { totp: [] }, error: null }),
        enroll: mfa.enroll ?? vi.fn().mockResolvedValue({ data: null, error: null }),
        challengeAndVerify:
          mfa.challengeAndVerify ??
          vi.fn().mockResolvedValue({ data: {}, error: null }),
        unenroll: mfa.unenroll ?? vi.fn().mockResolvedValue({ data: {}, error: null }),
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listTotpFactors()", () => {
  it("未登录返回 notAuthenticated", async () => {
    createClientMock.mockResolvedValue(mockClient({ user: null }));
    await expect(listTotpFactors()).resolves.toEqual({ ok: false, error: "notAuthenticated" });
  });

  it("查询失败返回 databaseError", async () => {
    createClientMock.mockResolvedValue(
      mockClient({ mfa: { listFactors: vi.fn().mockResolvedValue({ data: null, error: { message: "db" } }) } }),
    );
    await expect(listTotpFactors()).resolves.toEqual({ ok: false, error: "databaseError" });
  });

  it("成功映射 TOTP 因子列表", async () => {
    createClientMock.mockResolvedValue(
      mockClient({
        mfa: {
          listFactors: vi.fn().mockResolvedValue({
            data: {
              totp: [
                { id: "f1", status: "verified", created_at: "2026-01-01" },
                { id: "f2", status: "unverified", created_at: null },
              ],
            },
            error: null,
          }),
        },
      }),
    );
    await expect(listTotpFactors()).resolves.toEqual({
      ok: true,
      data: [
        { id: "f1", status: "verified", createdAt: "2026-01-01" },
        { id: "f2", status: "unverified", createdAt: null },
      ],
    });
  });
});

describe("enrollTotp()", () => {
  it("未登录返回 notAuthenticated", async () => {
    createClientMock.mockResolvedValue(mockClient({ user: null }));
    await expect(enrollTotp()).resolves.toEqual({ ok: false, error: "notAuthenticated" });
  });

  it("注册失败返回 mfaEnrollFailed", async () => {
    createClientMock.mockResolvedValue(
      mockClient({ mfa: { enroll: vi.fn().mockResolvedValue({ data: null, error: { message: "bad" } }) } }),
    );
    await expect(enrollTotp()).resolves.toEqual({ ok: false, error: "mfaEnrollFailed" });
  });

  it("注册成功返回二维码与密钥", async () => {
    createClientMock.mockResolvedValue(
      mockClient({
        mfa: {
          enroll: vi.fn().mockResolvedValue({
            data: { id: "f1", totp: { qr_code: "data:image/svg+xml;base64,xxx", secret: "SECRET" } },
            error: null,
          }),
        },
      }),
    );
    await expect(enrollTotp()).resolves.toEqual({
      ok: true,
      data: { factorId: "f1", qrCode: "data:image/svg+xml;base64,xxx", secret: "SECRET" },
    });
  });
});

describe("verifyTotpEnrollment()", () => {
  it("未登录返回 notAuthenticated", async () => {
    createClientMock.mockResolvedValue(mockClient({ user: null }));
    await expect(verifyTotpEnrollment("f1", "123456")).resolves.toEqual({
      ok: false,
      error: "notAuthenticated",
    });
  });

  it("验证码格式非法返回 mfaInvalidCode", async () => {
    createClientMock.mockResolvedValue(mockClient());
    await expect(verifyTotpEnrollment("f1", "abc")).resolves.toEqual({
      ok: false,
      error: "mfaInvalidCode",
    });
  });

  it("验证失败（Invalid 提示）返回 mfaInvalidCode", async () => {
    createClientMock.mockResolvedValue(
      mockClient({
        mfa: {
          challengeAndVerify: vi
            .fn()
            .mockResolvedValue({ data: null, error: { message: "Invalid code" } }),
        },
      }),
    );
    await expect(verifyTotpEnrollment("f1", "123456")).resolves.toEqual({
      ok: false,
      error: "mfaInvalidCode",
    });
  });

  it("验证失败（其他错误）返回 databaseError", async () => {
    createClientMock.mockResolvedValue(
      mockClient({
        mfa: {
          challengeAndVerify: vi
            .fn()
            .mockResolvedValue({ data: null, error: { message: "network" } }),
        },
      }),
    );
    await expect(verifyTotpEnrollment("f1", "123456")).resolves.toEqual({
      ok: false,
      error: "databaseError",
    });
  });

  it("验证成功并触发 revalidatePath", async () => {
    createClientMock.mockResolvedValue(mockClient());
    await expect(verifyTotpEnrollment("f1", "123456")).resolves.toEqual({ ok: true });
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/settings");
  });
});

describe("unenrollTotp()", () => {
  it("未登录返回 notAuthenticated", async () => {
    createClientMock.mockResolvedValue(mockClient({ user: null }));
    await expect(unenrollTotp("f1", "123456")).resolves.toEqual({
      ok: false,
      error: "notAuthenticated",
    });
  });

  it("验证码格式非法返回 mfaInvalidCode", async () => {
    createClientMock.mockResolvedValue(mockClient());
    await expect(unenrollTotp("f1", "short")).resolves.toEqual({
      ok: false,
      error: "mfaInvalidCode",
    });
  });

  it("challenge 失败返回 mfaInvalidCode", async () => {
    createClientMock.mockResolvedValue(
      mockClient({
        mfa: {
          challengeAndVerify: vi
            .fn()
            .mockResolvedValue({ data: null, error: { message: "Invalid" } }),
        },
      }),
    );
    await expect(unenrollTotp("f1", "123456")).resolves.toEqual({
      ok: false,
      error: "mfaInvalidCode",
    });
  });

  it("解除失败返回 databaseError", async () => {
    createClientMock.mockResolvedValue(
      mockClient({
        mfa: { unenroll: vi.fn().mockResolvedValue({ data: null, error: { message: "db" } }) },
      }),
    );
    await expect(unenrollTotp("f1", "123456")).resolves.toEqual({
      ok: false,
      error: "databaseError",
    });
  });

  it("解除成功并触发 revalidatePath", async () => {
    createClientMock.mockResolvedValue(mockClient());
    await expect(unenrollTotp("f1", "123456")).resolves.toEqual({ ok: true });
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/settings");
  });
});