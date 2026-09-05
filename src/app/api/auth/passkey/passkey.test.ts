/**
 * Passkey 路由与工具单测（v0.5.0 D01，ADR-012）
 * 覆盖：flag 门控 404、登录门控 401、challenge cookie 读写、注册/认证验证成功与失败路径
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { createClientMock, createAdminClientMock, listMock, createCredMock, findMock, updateCounterMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  createAdminClientMock: vi.fn(),
  listMock: vi.fn(async () => []),
  createCredMock: vi.fn(async () => {}),
  findMock: vi.fn(async (): Promise<Record<string, unknown> | null> => null),
  updateCounterMock: vi.fn(async () => {}),
}));

vi.mock("@/lib/feature-flags", () => ({ features: { passkey: true } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));
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
    registrationInfo: { credential: { id: "cred1", publicKey: new Uint8Array([1, 2]), counter: 0, transports: ["internal"] } },
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

function authedClient() {
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: USER } }) },
  };
}

process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";

beforeEach(() => {
  vi.clearAllMocks();
  createClientMock.mockResolvedValue(authedClient());
});

function jsonReq(url: string, body?: object, cookies?: Record<string, string>) {
  return new NextRequest(`https://app.example.com${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    ...(cookies ? { headers: { cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ") } } : {}),
  });
}

describe("POST /api/auth/passkey/register-options", () => {
  it("未登录返回 401", async () => {
    createClientMock.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) } });
    const res = await registerOptions();
    expect(res.status).toBe(401);
  });

  it("成功返回选项并下发 challenge cookie", async () => {
    listMock.mockResolvedValue([]);
    const res = await registerOptions();
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
      jsonReq("/api/auth/passkey/register-verify", { response: { deviceName: "Mac" } }, { pk_challenge: "reg-challenge" }),
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
  });
});

describe("POST /api/auth/passkey/auth-options", () => {
  it("成功返回认证选项并下发 challenge cookie", async () => {
    const res = await authOptions();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ challenge: "auth-challenge" });
  });
});

describe("POST /api/auth/passkey/auth-verify", () => {
  it("凭据不存在返回 404", async () => {
    findMock.mockResolvedValue(null);
    const res = await authVerify(
      jsonReq("/api/auth/passkey/auth-verify", { response: { id: "credX" } }, { pk_challenge: "auth-challenge" }),
    );
    expect(res.status).toBe(404);
  });

  it("验证通过更新计数器并返回 userId", async () => {
    findMock.mockResolvedValue({ id: "w1", user_id: USER.id, credential_id: "cred1", public_key: "AQI", counter: 0, transports: null });
    const res = await authVerify(
      jsonReq("/api/auth/passkey/auth-verify", { response: { id: "cred1" } }, { pk_challenge: "auth-challenge" }),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ verified: true, userId: USER.id });
    expect(updateCounterMock).toHaveBeenCalledWith("cred1", 5);
  });

  it("缺少 challenge cookie 返回 400", async () => {
    const res = await authVerify(jsonReq("/api/auth/passkey/auth-verify", { response: { id: "cred1" } }));
    expect(res.status).toBe(400);
  });
});
