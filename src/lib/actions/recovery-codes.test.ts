/**
 * 恢复码服务端操作单测（C01 测试职责）
 * mock server/admin client 与 rate-limit，验证生成/查询/兑换流程
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

const { createClientMock, createAdminClientMock, revalidatePathMock, rateLimitCheckMock } =
  vi.hoisted(() => ({
    createClientMock: vi.fn(),
    createAdminClientMock: vi.fn(),
    revalidatePathMock: vi.fn(),
    rateLimitCheckMock: vi.fn(),
  }));

vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: { check: rateLimitCheckMock } }));
vi.mock("@/lib/repositories/mfa-recovery-codes", () => ({
  listUnusedRecoveryCodes: vi.fn(),
  hasUnusedRecoveryCodes: vi.fn(),
  replaceRecoveryCodes: vi.fn(),
  consumeRecoveryCode: vi.fn(),
}));
vi.mock("@/lib/repositories/audit-logs", () => ({ appendAuditLog: vi.fn() }));

import {
  generateRecoveryCodes,
  hasRecoveryCodes,
  redeemRecoveryCode,
  hashRecoveryCode,
} from "./recovery-codes";
import { RECOVERY_CODE_COUNT } from "@/lib/validations/mfa";
import * as recoveryRepo from "@/lib/repositories/mfa-recovery-codes";

const USER = { id: "u1", email: "a@b.com" };
const repo = vi.mocked(recoveryRepo);

function mockServerClient(user: object | null = USER) {
  createClientMock.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
  });
}

/**
 * 管理端口的 Auth API 不把失败抛出来，只把它放在返回值的 `error` 上（C09）。
 * `failure` 用来注入这两种失败：`list` = 列因子这一步失败，`delete` = 删因子这一步失败。
 */
function mockAdminMfa(
  factors: Array<{ id: string; factor_type: string }> = [],
  failure: { list?: boolean; delete?: boolean } = {},
) {
  const deleteFactor = vi.fn().mockResolvedValue({
    data: {},
    error: failure.delete ? { message: "delete factor failed" } : null,
  });
  const listFactors = vi.fn().mockResolvedValue({
    data: failure.list ? null : { factors },
    error: failure.list ? { message: "list factors failed" } : null,
  });
  createAdminClientMock.mockReturnValue({
    auth: { admin: { mfa: { listFactors, deleteFactor } } },
  });
  return { deleteFactor, listFactors };
}

beforeEach(() => {
  vi.clearAllMocks();
  rateLimitCheckMock.mockResolvedValue({ allowed: true, remaining: 9, resetIn: 1000 });
});

describe("hashRecoveryCode()", () => {
  it("sha256 十六进制且去分隔符归一", async () => {
    await expect(hashRecoveryCode("ABCD-2345")).resolves.toBe(
      createHash("sha256").update("ABCD2345").digest("hex"),
    );
    await expect(hashRecoveryCode("ABCD-2345")).resolves.toBe(
      await hashRecoveryCode("ABCD2345"),
    );
  });
});

describe("generateRecoveryCodes()", () => {
  it("未登录返回 notAuthenticated", async () => {
    mockServerClient(null);
    await expect(generateRecoveryCodes()).resolves.toEqual({
      ok: false,
      error: "notAuthenticated",
    });
  });

  it("生成 10 个码并替换旧码", async () => {
    mockServerClient();
    repo.replaceRecoveryCodes.mockResolvedValue(10);
    const result = await generateRecoveryCodes();
    expect(result.ok).toBe(true);
    const codes = result.ok ? (result.data?.codes ?? []) : [];
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
    expect(repo.replaceRecoveryCodes).toHaveBeenCalledWith("u1", expect.any(Array));
  });

  it("仓库异常返回 databaseError", async () => {
    mockServerClient();
    repo.replaceRecoveryCodes.mockRejectedValue(new Error("boom"));
    await expect(generateRecoveryCodes()).resolves.toEqual({
      ok: false,
      error: "databaseError",
    });
  });
});

describe("hasRecoveryCodes()", () => {
  it("未登录返回 notAuthenticated", async () => {
    mockServerClient(null);
    await expect(hasRecoveryCodes()).resolves.toEqual({ ok: false, error: "notAuthenticated" });
  });

  it("透传仓库结果", async () => {
    mockServerClient();
    repo.hasUnusedRecoveryCodes.mockResolvedValue(true);
    await expect(hasRecoveryCodes()).resolves.toEqual({ ok: true, data: { has: true } });
  });
});

describe("redeemRecoveryCode()", () => {
  // "ABCD2345" 的哈希预置为唯一候选
  const PLAINTEXT = "ABCD-2345";

  it("限频返回 rateLimited", async () => {
    rateLimitCheckMock.mockResolvedValue({ allowed: false, remaining: 0, resetIn: 1000 });
    await expect(redeemRecoveryCode(PLAINTEXT)).resolves.toEqual({
      ok: false,
      error: "rateLimited",
    });
  });

  it("格式非法返回 mfaInvalidCode", async () => {
    await expect(redeemRecoveryCode("bad")).resolves.toEqual({
      ok: false,
      error: "mfaInvalidCode",
    });
  });

  it("未登录返回 notAuthenticated", async () => {
    mockServerClient(null);
    await expect(redeemRecoveryCode(PLAINTEXT)).resolves.toEqual({
      ok: false,
      error: "notAuthenticated",
    });
  });

  it("无匹配返回 mfaInvalidCode", async () => {
    mockServerClient();
    repo.listUnusedRecoveryCodes.mockResolvedValue([]);
    await expect(redeemRecoveryCode(PLAINTEXT)).resolves.toEqual({
      ok: false,
      error: "mfaInvalidCode",
    });
  });

  it("兑换成功消费并解绑 TOTP", async () => {
    mockServerClient();
    repo.listUnusedRecoveryCodes.mockResolvedValue([
      { id: "c1", code_hash: await hashRecoveryCode(PLAINTEXT), used_at: null },
    ]);
    repo.consumeRecoveryCode.mockResolvedValue(true);
    const { deleteFactor } = mockAdminMfa([
      { id: "f1", factor_type: "totp" },
      { id: "f2", factor_type: "phone" },
    ]);
    await expect(redeemRecoveryCode(PLAINTEXT)).resolves.toEqual({ ok: true });
    expect(repo.consumeRecoveryCode).toHaveBeenCalledWith("c1", "u1");
    expect(deleteFactor).toHaveBeenCalledTimes(1);
    expect(deleteFactor).toHaveBeenCalledWith({ id: "f1", userId: "u1" });
  });

  it("抢占失败返回 mfaInvalidCode", async () => {
    mockServerClient();
    repo.listUnusedRecoveryCodes.mockResolvedValue([
      { id: "c1", code_hash: await hashRecoveryCode(PLAINTEXT), used_at: null },
    ]);
    repo.consumeRecoveryCode.mockResolvedValue(false);
    mockAdminMfa();
    await expect(redeemRecoveryCode(PLAINTEXT)).resolves.toEqual({
      ok: false,
      error: "mfaInvalidCode",
    });
  });

  it("列因子失败时回答解绑失败，并且不扣恢复码", async () => {
    mockServerClient();
    repo.listUnusedRecoveryCodes.mockResolvedValue([
      { id: "c1", code_hash: await hashRecoveryCode(PLAINTEXT), used_at: null },
    ]);
    repo.consumeRecoveryCode.mockResolvedValue(true);
    mockAdminMfa([], { list: true });
    await expect(redeemRecoveryCode(PLAINTEXT)).resolves.toEqual({
      ok: false,
      error: "recoveryUnenrollFailed",
    });
    expect(repo.consumeRecoveryCode).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("删因子失败时回答解绑失败，而不是报成功", async () => {
    mockServerClient();
    repo.listUnusedRecoveryCodes.mockResolvedValue([
      { id: "c1", code_hash: await hashRecoveryCode(PLAINTEXT), used_at: null },
    ]);
    repo.consumeRecoveryCode.mockResolvedValue(true);
    const { deleteFactor } = mockAdminMfa([{ id: "f1", factor_type: "totp" }], {
      delete: true,
    });
    await expect(redeemRecoveryCode(PLAINTEXT)).resolves.toEqual({
      ok: false,
      error: "recoveryUnenrollFailed",
    });
    expect(deleteFactor).toHaveBeenCalledTimes(1);
    expect(repo.consumeRecoveryCode).not.toHaveBeenCalled();
  });

  it("本来就没有 TOTP 因子是合法状态，照常扣码", async () => {
    mockServerClient();
    repo.listUnusedRecoveryCodes.mockResolvedValue([
      { id: "c1", code_hash: await hashRecoveryCode(PLAINTEXT), used_at: null },
    ]);
    repo.consumeRecoveryCode.mockResolvedValue(true);
    const { deleteFactor } = mockAdminMfa([{ id: "f2", factor_type: "phone" }]);
    await expect(redeemRecoveryCode(PLAINTEXT)).resolves.toEqual({ ok: true });
    expect(deleteFactor).not.toHaveBeenCalled();
    expect(repo.consumeRecoveryCode).toHaveBeenCalledWith("c1", "u1");
  });
});
