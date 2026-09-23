/**
 * Passkey 管理 Server Action 单测（v0.5.0 D01）
 *
 * 这里钉的是「删没删掉」这个信号本身。此前 `deletePasskey` 在整个仓库里没有任何用例：
 * 把函数体换成无条件 `return ok()`（连仓储都不调）之后，全量测试仍然 2291 条全过——
 * 而这是设置页上一条凭据消失的确认。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { deleteMyCredentialMock, revalidatePathMock, logActionErrorMock } = vi.hoisted(() => ({
  deleteMyCredentialMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  logActionErrorMock: vi.fn(async () => {}),
}));

vi.mock("@/lib/repositories/webauthn", () => ({
  deleteMyCredential: deleteMyCredentialMock,
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/api-log", () => ({ logActionError: logActionErrorMock }));

import { deletePasskey } from "./passkey";
import { ROUTES } from "@/lib/constants";

beforeEach(() => {
  vi.clearAllMocks();
  deleteMyCredentialMock.mockResolvedValue(true);
});

describe("deletePasskey()", () => {
  it("删掉一行才算成功，并让设置页重新取列表", async () => {
    await expect(deletePasskey("w1")).resolves.toEqual({ ok: true });
    expect(deleteMyCredentialMock).toHaveBeenCalledWith("w1");
    expect(revalidatePathMock).toHaveBeenCalledWith(ROUTES.dashboardSettings);
  });

  it("一行都没删掉时回 passkeyNotFound，不报成功也不重取列表", async () => {
    // RLS 的 `users_delete_own_passkeys` 对不匹配的行是静默过滤（0 行、error 为 null）：
    // 别人的凭据与已经不存在的凭据都走这里，两者都没有任何东西被移除。
    deleteMyCredentialMock.mockResolvedValue(false);

    await expect(deletePasskey("not-mine")).resolves.toEqual({ ok: false, error: "passkeyNotFound" });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("仓储抛错回 databaseError，且不假装刷新过", async () => {
    deleteMyCredentialMock.mockRejectedValue(new Error("db down"));

    await expect(deletePasskey("w1")).resolves.toEqual({ ok: false, error: "databaseError" });
    expect(logActionErrorMock).toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
