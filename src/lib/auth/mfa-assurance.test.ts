/**
 * MFA 服务端闸门（`requireMfaAssurance`）的测试。
 *
 * 这个文件存在的理由：**2FA 此前完全是 UI 约定**。登录表单看到已验证因子就
 * `router.push("/auth/mfa")`，而服务端从未读过 `aal`——于是 aal1 会话能直接读仪表盘，
 * 「跳过挑战页」不需要任何技巧，关掉 JS 就行。所以这里的每一条用例都在钉
 * 「判定发生在服务端，且默认方向是拦」。
 *
 * 与 `session-user.test.ts` 同一套桩：`redirect` 在真实运行时抛 `NEXT_REDIRECT`，
 * 桩里保持同一形状，否则「拦了」与「读失败抛错」在断言里分不开。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { redirectMock } = vi.hoisted(() => ({ redirectMock: vi.fn() }));

vi.mock("next/navigation", () => ({ redirect: redirectMock }));

import { ROUTES } from "@/lib/constants";
import { AuthGuardError } from "./guards";
import { requireMfaAssurance, requiresMfaStepUp } from "./mfa-assurance";

function client(reading: {
  level?: { currentLevel: string | null; nextLevel: string | null };
  error?: unknown;
  factors?: { id: string; status: string }[];
}) {
  return {
    auth: {
      mfa: {
        getAuthenticatorAssuranceLevel: async () =>
          reading.error
            ? { data: null, error: reading.error }
            : { data: reading.level ?? { currentLevel: "aal1", nextLevel: "aal1" }, error: null },
        listFactors: vi.fn(async () => ({
          data: { all: reading.factors ?? [], totp: reading.factors ?? [] },
          error: null,
        })),
      },
    },
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  redirectMock.mockImplementation(() => {
    throw new Error("NEXT_REDIRECT");
  });
});

describe("requiresMfaStepUp()（纯判定）", () => {
  it("开了 2FA 但还没做第二步 ⇒ 拦", () => {
    expect(requiresMfaStepUp({ currentLevel: "aal1", nextLevel: "aal2" })).toBe(true);
  });

  it("已经 aal2 ⇒ 放行", () => {
    expect(requiresMfaStepUp({ currentLevel: "aal2", nextLevel: "aal2" })).toBe(false);
  });

  it("**没开 2FA 的账号一条都不受影响**（nextLevel 仍是 aal1）", () => {
    // 这是不能写成「所有人必须 aal2」的原因：那样整个模板的登录都会被改掉。
    expect(requiresMfaStepUp({ currentLevel: "aal1", nextLevel: "aal1" })).toBe(false);
  });

  it("读数为空 / 残缺时**不在这一层拦**（拦不拦由调用方的读失败分支决定）", () => {
    expect(requiresMfaStepUp(null)).toBe(false);
    expect(requiresMfaStepUp(undefined)).toBe(false);
    expect(requiresMfaStepUp({ currentLevel: null, nextLevel: null })).toBe(false);
  });
});

describe("requireMfaAssurance()", () => {
  it("需要第二步时重定向到挑战页，并带上因子 id 与回跳地址", async () => {
    // 不带 factor 的话挑战页只会显示「缺少参数，请重新登录」——
    // 那是给手工敲 URL 的兜底，不该成为服务端送人过去时的落点。
    await expect(
      requireMfaAssurance(
        client({
          level: { currentLevel: "aal1", nextLevel: "aal2" },
          factors: [{ id: "factor-1", status: "verified" }],
        }),
        "/dashboard/billing",
      ),
    ).rejects.toThrow("NEXT_REDIRECT");

    const target = String(redirectMock.mock.calls[0][0]);
    expect(target.startsWith(`${ROUTES.mfa}?`)).toBe(true);
    const params = new URL(target, "http://x").searchParams;
    expect(params.get("factor")).toBe("factor-1");
    expect(params.get("redirect")).toBe("/dashboard/billing");
  });

  it("读不到因子时不编一个 id 出来：只带 redirect，让挑战页走自己的兜底", async () => {
    await expect(
      requireMfaAssurance(client({ level: { currentLevel: "aal1", nextLevel: "aal2" } })),
    ).rejects.toThrow("NEXT_REDIRECT");
    const params = new URL(String(redirectMock.mock.calls[0][0]), "http://x").searchParams;
    expect(params.get("factor")).toBeNull();
    expect(params.get("redirect")).toBe(ROUTES.dashboard);
  });

  it("不需要第二步时**一次 listFactors 都不打**（不在热路径上多花一次往返）", async () => {
    const stub = client({ level: { currentLevel: "aal1", nextLevel: "aal1" } });
    await expect(requireMfaAssurance(stub)).resolves.toBeUndefined();
    expect(redirectMock).not.toHaveBeenCalled();
    const mfa = (stub as unknown as { auth: { mfa: { listFactors: ReturnType<typeof vi.fn> } } })
      .auth.mfa;
    expect(mfa.listFactors).not.toHaveBeenCalled();
  });

  it("**读数失败时拦（503），不是放行**", async () => {
    // 放行是这套控制最贵的失效方式：Auth 一抖，2FA 静默失效且没有任何读数。
    // 与 requireAuth 对「会话读不出来」的处理一致——抛 SERVICE_UNAVAILABLE，
    // 由 error.tsx 给出可重试的页面（不登出，所以重试一次就恢复）。
    const failure = requireMfaAssurance(client({ error: { message: "boom" } }));
    await expect(failure).rejects.toBeInstanceOf(AuthGuardError);
    await expect(failure).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
