/**
 * 会话用户真值表测试（roadmap C09 后半）
 *
 * 8 个仪表盘页面原先写的是同一个形状：只解构 `user`、不取 `error`、然后 `user!.id`。
 * 那条 `!` 在类型上宣称「这里不可能是 null」，而 `auth.getUser()` 把失败装在 `error` 里
 * 返回——于是抖动与「真的没登录」在下游同形，页面只能抛一个 `TypeError` 表达它。
 * 这里钉住的是**三条出口各归各的**：读到了、确认没登录、确认是读取故障。
 *
 * 分类本身在 `session-error` 里有自己的测试；这里要防的是**接线**——
 * 分类判据一旦没接上（把 error 丢了、或不分故障与匿名），这三条用例会立刻红。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
} from "@supabase/supabase-js";

const { createClientMock, redirectMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  redirectMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

import { ROUTES } from "@/lib/constants";
import { SessionReadUnavailableError, requireSessionUser } from "./session-user";

const USER = { id: "u1", email: "a@b.c" };

function clientReturning(result: { data?: { user: unknown }; error?: unknown }) {
  return { auth: { getUser: async () => result } } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  // next/navigation 的 redirect 在真实运行时是抛 NEXT_REDIRECT；桩里要保持同一形状，
  // 否则「第二条出口」与「第一条出口抛错」在测试里分不开。
  redirectMock.mockImplementation(() => {
    throw new Error("NEXT_REDIRECT");
  });
});

describe("requireSessionUser()", () => {
  it("读到用户时原样交出去（调用方不必再判空，也不必写 !）", async () => {
    await expect(requireSessionUser(clientReturning({ data: { user: USER } }))).resolves.toBe(
      USER,
    );
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("读不到会话（fetch 失败）答 SERVICE_UNAVAILABLE，不重定向——重登走的正是同一条读取", async () => {
    const error = new AuthRetryableFetchError("Failed to fetch", 0);
    const promise = requireSessionUser(clientReturning({ data: { user: null }, error }));
    await expect(promise).rejects.toBeInstanceOf(SessionReadUnavailableError);
    await expect(promise).rejects.toThrow("Failed to fetch");
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("Auth 服务 5xx 同样算「没读到」而不是「没登录」", async () => {
    const promise = requireSessionUser(
      clientReturning({ data: { user: null }, error: new AuthApiError("bad gateway", 502, undefined) }),
    );
    await expect(promise).rejects.toBeInstanceOf(SessionReadUnavailableError);
  });

  it("匿名访客（AuthSessionMissingError）答「请登录」，不是 503", async () => {
    // 这一格最容易写反：`error` 非空里最常见的一种根本不是故障，
    // 把它当抖动等于把「请先登录」换成一个重试也不会好的 503。
    const promise = requireSessionUser(
      clientReturning({ data: { user: null }, error: new AuthSessionMissingError() }),
    );
    await expect(promise).rejects.toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith(ROUTES.login);
  });

  it("4xx 仍按「会话不存在或已失效」处理（维持既有行为，不扩大 503 的面）", async () => {
    const promise = requireSessionUser(
      clientReturning({ data: { user: null }, error: new AuthApiError("bad", 401, undefined) }),
    );
    await expect(promise).rejects.toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith(ROUTES.login);
  });

  it("error 为空但 user 为 null（读到了、确实没有）也答「请登录」", async () => {
    const promise = requireSessionUser(clientReturning({ data: { user: null } }));
    await expect(promise).rejects.toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith(ROUTES.login);
  });

  it("没有会话时绝不抛 SessionReadUnavailableError", async () => {
    // 反向证据：否则「一律抛错」也能骗过上面那几条——错误边界会把「请登录」显示成故障。
    for (const error of [new AuthSessionMissingError(), new AuthApiError("bad", 401, undefined)]) {
      await expect(
        requireSessionUser(clientReturning({ data: { user: null }, error })),
      ).rejects.not.toBeInstanceOf(SessionReadUnavailableError);
    }
  });

  it("SessionReadUnavailableError 自带机器可读的 code", () => {
    // 错误边界、日志、监控按 code 分；只有 message 的话「重试」按钮和告警无从区分。
    expect(new SessionReadUnavailableError("x").code).toBe("SESSION_READ_UNAVAILABLE");
  });
});
