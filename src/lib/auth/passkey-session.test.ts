/**
 * Passkey → Supabase 会话桥接契约测试（ADR-012）
 * 确保只消费同用户的一次性 magiclink，并统一收敛为不泄漏细节的失败。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createAdminClientMock,
  createClientMock,
  getUserByIdMock,
  generateLinkMock,
  verifyOtpMock,
  signOutMock,
} = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  createClientMock: vi.fn(),
  getUserByIdMock: vi.fn(),
  generateLinkMock: vi.fn(),
  verifyOtpMock: vi.fn(),
  signOutMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));
vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));

import { establishPasskeySession, PasskeySessionError } from "./passkey-session";

const USER_ID = "11111111-1111-1111-1111-111111111111";
const EMAIL = "passkey@example.com";
const TOKEN_HASH = "one-time-token-hash";

function verifiedFactor() {
  return {
    id: "factor-1",
    friendly_name: "Authenticator",
    factor_type: "totp",
    status: "verified",
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  createAdminClientMock.mockReturnValue({
    auth: {
      admin: {
        getUserById: getUserByIdMock,
        generateLink: generateLinkMock,
      },
    },
  });
  createClientMock.mockResolvedValue({
    auth: { verifyOtp: verifyOtpMock, signOut: signOutMock },
  });
  getUserByIdMock.mockResolvedValue({
    data: { user: { id: USER_ID, email: EMAIL } },
    error: null,
  });
  generateLinkMock.mockResolvedValue({
    data: {
      properties: {
        action_link: "https://supabase.invalid/do-not-log",
        hashed_token: TOKEN_HASH,
        verification_type: "magiclink",
      },
      user: { id: USER_ID },
    },
    error: null,
  });
  verifyOtpMock.mockResolvedValue({
    data: { session: { access_token: "access" }, user: { id: USER_ID, factors: [] } },
    error: null,
  });
  signOutMock.mockResolvedValue({ error: null });
});

describe("establishPasskeySession()", () => {
  it("为同一用户消费一次性 magiclink 并下发无 MFA 会话", async () => {
    await expect(establishPasskeySession(USER_ID)).resolves.toEqual({
      mfaRequired: false,
      factorId: null,
    });
    expect(generateLinkMock).toHaveBeenCalledWith({ type: "magiclink", email: EMAIL });
    expect(verifyOtpMock).toHaveBeenCalledWith({
      token_hash: TOKEN_HASH,
      type: "magiclink",
    });
    expect(signOutMock).not.toHaveBeenCalled();
  });

  it("返回已验证 MFA factor，供调用方升级到 aal2", async () => {
    verifyOtpMock.mockResolvedValue({
      data: {
        session: { access_token: "access" },
        user: { id: USER_ID, factors: [verifiedFactor()] },
      },
      error: null,
    });

    await expect(establishPasskeySession(USER_ID)).resolves.toEqual({
      mfaRequired: true,
      factorId: "factor-1",
    });
  });

  it("忽略未验证 factor", async () => {
    verifyOtpMock.mockResolvedValue({
      data: {
        session: { access_token: "access" },
        user: {
          id: USER_ID,
          factors: [{ ...verifiedFactor(), status: "unverified" }],
        },
      },
      error: null,
    });

    await expect(establishPasskeySession(USER_ID)).resolves.toEqual({
      mfaRequired: false,
      factorId: null,
    });
  });

  it("拒绝生成给其他用户的 token", async () => {
    generateLinkMock.mockResolvedValue({
      data: {
        properties: { hashed_token: TOKEN_HASH, verification_type: "magiclink" },
        user: { id: "22222222-2222-2222-2222-222222222222" },
      },
      error: null,
    });

    await expect(establishPasskeySession(USER_ID)).rejects.toBeInstanceOf(PasskeySessionError);
    expect(verifyOtpMock).not.toHaveBeenCalled();
  });

  it("拒绝非 magiclink 验证类型", async () => {
    generateLinkMock.mockResolvedValue({
      data: {
        properties: { hashed_token: TOKEN_HASH, verification_type: "recovery" },
        user: { id: USER_ID },
      },
      error: null,
    });

    await expect(establishPasskeySession(USER_ID)).rejects.toBeInstanceOf(PasskeySessionError);
    expect(verifyOtpMock).not.toHaveBeenCalled();
  });

  it("OTP 返回其他用户时立即退出本地会话", async () => {
    verifyOtpMock.mockResolvedValue({
      data: {
        session: { access_token: "access" },
        user: { id: "22222222-2222-2222-2222-222222222222", factors: [] },
      },
      error: null,
    });

    await expect(establishPasskeySession(USER_ID)).rejects.toBeInstanceOf(PasskeySessionError);
    expect(signOutMock).toHaveBeenCalledWith({ scope: "local" });
  });

  it("底层错误只暴露通用会话桥接错误", async () => {
    getUserByIdMock.mockRejectedValue(new Error(`token=${TOKEN_HASH}`));

    await expect(establishPasskeySession(USER_ID)).rejects.toMatchObject({
      name: "PasskeySessionError",
      message: "Passkey session bridge failed",
    });
  });
});
