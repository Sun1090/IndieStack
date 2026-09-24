/**
 * 认证回调页的 effect 契约测试
 * 覆盖：一次性 code 不被双花（`reactStrictMode: true` 会双跑 effect）、但换一枚 code 仍会去换、
 * 成功态不被第二次的失败覆盖、失败分支排的回登录页定时器在卸载后失效。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { StrictMode } from "react";
import { render, screen, act } from "@testing-library/react";
import AuthCallbackPage from "./page";

const exchangeMock = vi.hoisted(() => vi.fn());
const getSessionMock = vi.hoisted(() => vi.fn());
const routerMock = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
// router / searchParams 在真实的 next/navigation 里跨渲染是同一批对象（都取自 context）。
// 若在这里每次返回新对象，`router` / `searchParams` 两个 dep 每渲染都变，
// effect 会被 mock 自己逼着重跑，量出来的就不是被测代码的行为了。
// 需要换 URL 时把 holder 换成**另一个**对象，模拟一次真实的导航。
const paramsHolder = vi.hoisted(() => ({ current: new URLSearchParams("code=one-time-code") }));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { exchangeCodeForSession: exchangeMock, getSession: getSessionMock },
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
  useSearchParams: () => paramsHolder.current,
}));

vi.mock("next-intl", () => {
  const cache = new Map<string, (key: string) => string>();
  return {
    useTranslations: (ns: string) => {
      if (!cache.has(ns)) cache.set(ns, (key: string) => key);
      return cache.get(ns)!;
    },
  };
});

/** 让 effect 里那条 async 链跑到底（纯微任务，不碰定时器）。 */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function statusText() {
  return screen.getByRole("status").textContent ?? "";
}

/** 真实 PKCE 语义：一枚 code 只能用一次，第二次必然被服务端拒。 */
function oneTimeCodeExchange() {
  const consumed = new Set<string>();
  exchangeMock.mockImplementation((code: string) => {
    if (consumed.has(code)) {
      return Promise.resolve({
        data: { user: null, session: null },
        error: { code: "invalid_grant", message: "code already used" },
      });
    }
    consumed.add(code);
    return Promise.resolve({ data: { user: { id: "u1" }, session: {} }, error: null });
  });
}

describe("AuthCallbackPage", () => {
  beforeEach(() => {
    exchangeMock.mockReset();
    getSessionMock.mockReset();
    routerMock.push.mockReset();
    routerMock.refresh.mockReset();
    window.location.hash = "";
    // holder 是模块级的（见上方注释），逐用例复位，避免上一条用例换过的 URL 串到下一条。
    paramsHolder.current = new URLSearchParams("code=one-time-code");
  });

  it("StrictMode 双跑之下，同一枚 code 只交换一次", async () => {
    oneTimeCodeExchange();
    render(
      <StrictMode>
        <AuthCallbackPage />
      </StrictMode>,
    );
    await settle();
    expect(exchangeMock).toHaveBeenCalledTimes(1);
  });

  it("成功的那次交换之后，状态不被第二次的失败覆盖", async () => {
    oneTimeCodeExchange();
    render(
      <StrictMode>
        <AuthCallbackPage />
      </StrictMode>,
    );
    await settle();
    expect(statusText()).toBe("callback.success");
    expect(routerMock.push).toHaveBeenCalledWith("/dashboard");
    expect(routerMock.refresh).toHaveBeenCalledTimes(1);
  });

  it("交换失败时仍然提示失败，并在 2 秒后送回登录页", async () => {
    vi.useFakeTimers();
    try {
      exchangeMock.mockResolvedValue({
        data: { user: null, session: null },
        error: { code: "invalid_grant", message: "boom" },
      });
      render(<AuthCallbackPage />);
      await act(async () => {
        vi.advanceTimersByTime(0);
      });
      expect(statusText()).toBe("callback.failed authOtpExpired");
      expect(routerMock.push).not.toHaveBeenCalled();
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
      expect(routerMock.push).toHaveBeenCalledTimes(1);
      expect(routerMock.push).toHaveBeenCalledWith("/auth/login");
    } finally {
      vi.useRealTimers();
    }
  });

  it("用户已经离开这一页之后，那个 2 秒定时器不再把他拽回登录页", async () => {
    vi.useFakeTimers();
    try {
      exchangeMock.mockResolvedValue({
        data: { user: null, session: null },
        error: { code: "invalid_grant", message: "boom" },
      });
      const view = render(<AuthCallbackPage />);
      await act(async () => {
        vi.advanceTimersByTime(0);
      });
      view.unmount();
      routerMock.push.mockClear();
      await act(async () => {
        vi.advanceTimersByTime(2100);
      });
      expect(routerMock.push).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("URL 里没有 code、hash 里也没有时，只探会话而不换 code", async () => {
    paramsHolder.current = new URLSearchParams("");
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: "u1" } } }, error: null });
    render(<AuthCallbackPage />);
    await settle();
    expect(exchangeMock).not.toHaveBeenCalled();
    expect(getSessionMock).toHaveBeenCalledTimes(1);
    expect(statusText()).toBe("callback.success");
  });

  it("换了一枚不同的 code 时还会再交换一次（去重按凭据，不按挂载次数）", async () => {
    oneTimeCodeExchange();
    const view = render(
      <StrictMode>
        <AuthCallbackPage />
      </StrictMode>,
    );
    await settle();
    expect(exchangeMock).toHaveBeenCalledTimes(1);

    paramsHolder.current = new URLSearchParams("code=second-code");
    view.rerender(
      <StrictMode>
        <AuthCallbackPage />
      </StrictMode>,
    );
    await settle();
    expect(exchangeMock).toHaveBeenCalledTimes(2);
    expect(exchangeMock.mock.calls[1][0]).toBe("second-code");
  });
});
