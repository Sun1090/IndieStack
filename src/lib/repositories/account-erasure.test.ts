/**
 * 账户数据擦除仓库单测（H08）
 * 覆盖：RPC 名与参数取自契约常量、数据库错误上抛、返回值形状校验（fail-closed）。
 */
import { describe, expect, it, vi } from "vitest";

const { createAdminClientMock } = vi.hoisted(() => ({ createAdminClientMock: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));

import { eraseAccountData } from "./account-erasure";
import { ACCOUNT_ERASURE_ARG, ACCOUNT_ERASURE_RPC } from "@/lib/privacy/data-policy";

function rpc(result: { data?: unknown; error?: { message: string } | null }) {
  const rpcMock = vi.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null });
  createAdminClientMock.mockReturnValue({ rpc: rpcMock });
  return rpcMock;
}

describe("eraseAccountData", () => {
  it("按契约常量调用 RPC，并返回各数据面的行数", async () => {
    const rpcMock = rpc({
      data: { apiUsage: 2, contactMessages: 1, auditLogsAnonymized: 7 },
    });

    await expect(eraseAccountData("u1")).resolves.toEqual({
      apiUsage: 2,
      contactMessages: 1,
      auditLogsAnonymized: 7,
    });
    expect(rpcMock).toHaveBeenCalledWith(ACCOUNT_ERASURE_RPC, { [ACCOUNT_ERASURE_ARG]: "u1" });
  });

  it("数据库报错时抛给调用方，让删号流程中止", async () => {
    rpc({ error: { message: "permission denied for function erase_user_data" } });
    await expect(eraseAccountData("u1")).rejects.toThrow("permission denied");
  });

  it("RPC 返回空（例如桩实现）时抛错，绝不把「没擦」当成「擦完了」", async () => {
    rpc({ data: null });
    await expect(eraseAccountData("u1")).rejects.toThrow("unexpected shape");
  });

  it("缺少计数键时抛错", async () => {
    rpc({ data: { apiUsage: 1, contactMessages: 0 } });
    await expect(eraseAccountData("u1")).rejects.toThrow("auditLogsAnonymized");
  });
});
