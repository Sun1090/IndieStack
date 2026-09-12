/**
 * Passkey 路由与工具单测（v0.5.0 D01，ADR-012）
 * 覆盖：flag 门控、challenge cookie、注册和认证验证、服务端会话桥接与失败收口。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const featureState = vi.hoisted(() => ({ passkey: true, passkeyLogin: true }));
const {
  createClientMock,
  createAdminClientMock,
  listMock,
  createCredMock,
  findMock,
  updateCounterMock,
  getUserByIdMock,
  generateLinkMock,
  verifyOtpMock,
  signOutMock,
  logApiErrorMock,
} = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  createAdminClientMock: vi.fn(),
  listMock: vi.fn(async () => []),
  createCredMock: vi.fn(async () => {}),
  findMock: vi.fn(async (): Promise<Record<string, unknown> | null> => null),
  updateCounterMock: vi.fn(async () => {}),
  getUserByIdMock: vi.fn(),
  generateLinkMock: vi.fn(),
  verifyOtpMock: vi.fn(),
  signOutMock: vi.fn(),
  logApiErrorMock: vi.fn(async () => {}),
}));

vi.mock("@/lib/feature-flags", () => ({ features: featureState }));
vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));
vi.mock("@/lib/api-log", () => ({ logApiError: logApiErrorMock }));
vi.mock("@/lib/repositories/webauthn", () => ({
  listMyCredentials: listMock,
  findCredentialById: findMock,
  createCredential: createCredMock,
  updateCredentialCounter: updateCounterMock,
  deleteMyCredential: vi.fn(),
}));

vi.mock("@simplewebauthn/server", () => ({
  generateRegistrationOptions: vi.fn(async () => ({ challenge: "reg-challenge" })),
  verifyRegistrationResponse: vi.fn(async () => ({
    verified: true,
    registrationInfo: {
      credential: {
        id: "cred1",
        publicKey: new Uint8Array([1, 2]),
        counter: 0,
        transports: ["internal"],
      },
    },
  })),
  generateAuthenticationOptions: vi.fn(async () => ({ challenge: "auth-challenge" })),
  verifyAuthenticationResponse: vi.fn(async () => ({
    verified: true,
    authenticationInfo: { newCounter: 5 },
  })),
}));

import { POST as registerOptions } from "./register-options/route";
import { POST as registerVerify } from "./register-verify/route";
import { POST as authOptions } from "./auth-options/route";
import { POST as authVerify } from "./auth-verify/route";

const USER = { id: "11111111-1111-1111-1111-111111111111", email: "a@b.c" };
const TOKEN_HASH = "server-only-token-hash";

function sessionClient(overrides: Record<string, unknown> = {}) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: USER } }),
      verifyOtp: verifyOtpMock,
      signOut: signOutMock,
      ...overrides,
    },
  };
}

function credential() {
  return {
    id: "w1",
    user_id: USER.id,
    credential_id: "cred1",
    public_key: "AQI",
    counter: 0,
    device_name: null,
    transports: null,
    created_at: "2026-09-12T00:00:00.000Z",
    last_used_at: null,
  };
}

process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";

beforeEach(() => {
  vi.clearAllMocks();
  featureState.passkey = true;
  featureState.passkeyLogin = true;
  createClientMock.mockResolvedValue(sessionClient());
  createAdminClientMock.mockReturnValue({
    auth: {
      admin: {
        getUserById: getUserByIdMock,
        generateLink: generateLinkMock,
      },
    },
  });
  getUserByIdMock.mockResolvedValue({ data: { user: USER }, error: null });
  generateLinkMock.mockResolvedValue({
    data: {
      properties: {
        action_link: "https://supabase.invalid/secret-action-link",
        email_otp: "123456",
        hashed_token: TOKEN_HASH,
        redirect_to: "https://app.example.com",
        verification_type: "magiclink",
      },
      user: USER,
    },
    error: null,
  });
  verifyOtpMock.mockResolvedValue({
    data: {
      session: { access_token: "access", refresh_token: "refresh" },
      user: { id: USER.id, factors: [] },
    },
    error: null,
  });
  signOutMock.mockResolvedValue({ error: null });
  findMock.mockResolvedValue(credential());
});

function jsonReq(
  url: string,
  body?: object,
  cookies?: Record<string, string>,
  ip = "203.0.113.10",
) {
  return new NextRequest(`https://app.example.com${url}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-real-ip": ip,
      ...(cookies
        ? { cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ") }
        : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("POST /api/auth/passkey/register-options", () => {
  it("未登录返回 401", async () => {
    createClientMock.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    });
    const res = await registerOptions(jsonReq("/api/auth/passkey/register-options"));
    expect(res.status).toBe(401);
  });

  it("成功返回选项并下发 challenge cookie", async () => {
    listMock.mockResolvedValue([]);
    const res = await registerOptions(jsonReq("/api/auth/passkey/register-options"));
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("pk_challenge=reg-challenge");
    expect(cookie).toContain("HttpOnly");
  });
});

describe("POST /api/auth/passkey/register-verify", () => {
  it("缺少 challenge cookie 返回 400", async () => {
    const res = await registerVerify(jsonReq("/api/auth/passkey/register-verify", { response: {} }));
    expect(res.status).toBe(400);
  });

  it("验证通过后落库凭据（base64url 公钥）", async () => {
    const res = await registerVerify(
      jsonReq(
        "/api/auth/passkey/register-verify",
        { response: { deviceName: "Mac" } },
        { pk_challenge: "reg-challenge" },
      ),
    );
    expect(res.status).toBe(200);
    expect(createCredMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER.id,
        credentialId: "cred1",
        publicKey: "AQI",
        counter: 0,
        deviceName: "Mac",
      }),
    );
  });

  it("无 body 返回 400", async () => {
    const res = await registerVerify(
      jsonReq("/api/auth/passkey/register-verify", undefined, { pk_challenge: "reg-challenge" }),
    );
    expect(res.status).toBe(400);
    expect(res.headers.get("set-cookie") ?? "").toContain("pk_challenge=;");
  });

  it("凭据落库失败返回 503 并清除 challenge", async () => {
    createCredMock.mockRejectedValueOnce(new Error("database unavailable"));
    const res = await registerVerify(
      jsonReq(
        "/api/auth/passkey/register-verify",
        { response: { deviceName: "Mac" } },
        { pk_challenge: "reg-challenge" },
        "203.0.113.11",
      ),
    );
    expect(res.status).toBe(503);
    expect(res.headers.get("set-cookie") ?? "").toContain("pk_challenge=;");
  });
});

describe("POST /api/auth/passkey/auth-options", () => {
  it("登录开关关闭时返回 404", async () => {
    featureState.passkeyLogin = false;
    const res = await authOptions(jsonReq("/api/auth/passkey/auth-options"));
    expect(res.status).toBe(404);
  });

  it("成功返回认证选项并下发 challenge cookie", async () => {
    const res = await authOptions(jsonReq("/api/auth/passkey/auth-options"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ challenge: "auth-challenge" });
  });
});

describe("POST /api/auth/passkey/auth-verify", () => {
  it("凭据不存在返回 404 并清除 challenge", async () => {
    findMock.mockResolvedValue(null);
    const res = await authVerify(
      jsonReq(
        "/api/auth/passkey/auth-verify",
        { response: { id: "credX" } },
        { pk_challenge: "auth-challenge" },
      ),
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("set-cookie") ?? "").toContain("pk_challenge=;");
  });

  it("验证通过后建立服务端会话且不泄漏 token/userId", async () => {
    const res = await authVerify(
      jsonReq(
        "/api/auth/passkey/auth-verify",
        { response: { id: "cred1" } },
        { pk_challenge: "auth-challenge" },
      ),
    );
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload).toEqual({ verified: true, mfaRequired: false });
    expect(JSON.stringify(payload)).not.toContain(TOKEN_HASH);
    expect(JSON.stringify(payload)).not.toContain(USER.id);
    expect(JSON.stringify(payload)).not.toContain("secret-action-link");
    expect(verifyOtpMock).toHaveBeenCalledWith({ token_hash: TOKEN_HASH, type: "magiclink" });
    expect(updateCounterMock).toHaveBeenCalledWith("cred1", 5);
    expect(res.headers.get("set-cookie") ?? "").toContain("pk_challenge=;");
  });

  it("开启 MFA 的账户返回挑战 factor", async () => {
    verifyOtpMock.mockResolvedValue({
      data: {
        session: { access_token: "access", refresh_token: "refresh" },
        user: {
          id: USER.id,
          factors: [{ id: "factor-1", status: "verified", factor_type: "totp" }],
        },
      },
      error: null,
    });
    const res = await authVerify(
      jsonReq(
        "/api/auth/passkey/auth-verify",
        { response: { id: "cred1" } },
        { pk_challenge: "auth-challenge" },
      ),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      verified: true,
      mfaRequired: true,
      factorId: "factor-1",
    });
  });

  it("会话桥接失败返回 503，且不把原始 GoTrue 错误暴露给客户端", async () => {
    verifyOtpMock.mockResolvedValue({
      data: { session: null, user: null },
      error: { message: "sensitive-token-hash" },
    });
    const res = await authVerify(
      jsonReq(
        "/api/auth/passkey/auth-verify",
        { response: { id: "cred1" } },
        { pk_challenge: "auth-challenge" },
      ),
    );
    expect(res.status).toBe(503);
    const payload = await res.json();
    expect(payload).toEqual({ error: "Authentication unavailable" });
    expect(JSON.stringify(payload)).not.toContain("sensitive-token-hash");
  });

  it("缺少 challenge cookie 返回 400", async () => {
    const res = await authVerify(jsonReq("/api/auth/passkey/auth-verify", { response: { id: "cred1" } }));
    expect(res.status).toBe(400);
  });
});
