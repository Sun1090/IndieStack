/**
 * LoginForm 组件测试（C07 测试职责）
 * 覆盖：邮箱未确认失败时展示重发入口、重发成功 toast
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoginForm } from "./login-form";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const pushMock = vi.hoisted(() => vi.fn());
const refreshMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
  useSearchParams: () => ({ get: () => null }),
}));

const signInMock = vi.hoisted(() => vi.fn());
const resendMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signInWithPassword: signInMock, resend: resendMock } }),
}));

const toastMock = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({
  toast: toastMock,
}));

vi.mock("@/lib/actions/audit", () => ({
  logAuthEvent: vi.fn(async () => ({ ok: true })),
}));

const checkLoginAllowedMock = vi.hoisted(() => vi.fn());
const recordLoginResultMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/login-attempts", () => ({
  checkLoginAllowed: checkLoginAllowedMock,
  recordLoginResult: recordLoginResultMock,
}));

beforeEach(() => {
  vi.clearAllMocks();
  checkLoginAllowedMock.mockResolvedValue({ ok: true, data: { allowed: true, retryAfterSec: 0 } });
});

async function fillAndSubmit(email: string, password: string) {
  const user = userEvent.setup();
  render(<LoginForm />);
  await user.type(screen.getByLabelText("password"), password);
  await user.type(screen.getByPlaceholderText("email"), email);
  await user.click(screen.getByRole("button", { name: "login.submit" }));
}

describe("LoginForm 重发确认邮件", () => {
  it("邮箱未确认失败时展示重发按钮", async () => {
    signInMock.mockResolvedValue({
      data: { user: null },
      error: { code: "email_not_confirmed", message: "Email not confirmed" },
    });
    await fillAndSubmit("a@b.com", "password123");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "login.resend" })).toBeInTheDocument();
    });
  });

  it("点击重发调用 resend 并 toast 成功", async () => {
    signInMock.mockResolvedValue({
      data: { user: null },
      error: { code: "email_not_confirmed", message: "Email not confirmed" },
    });
    resendMock.mockResolvedValue({ error: null });
    await fillAndSubmit("a@b.com", "password123");
    const btn = await screen.findByRole("button", { name: "login.resend" });
    await userEvent.setup().click(btn);
    await waitFor(() => {
      expect(resendMock).toHaveBeenCalledWith(
        expect.objectContaining({ type: "signup", email: "a@b.com" }),
      );
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: "login.resendTitle" }),
      );
    });
  });

  it("锁定状态直接拦截不触碰 Supabase", async () => {
    checkLoginAllowedMock.mockResolvedValue({
      ok: true,
      data: { allowed: false, retryAfterSec: 300 },
    });
    await fillAndSubmit("a@b.com", "password123");
    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ description: "login.locked" }),
      );
    });
    expect(signInMock).not.toHaveBeenCalled();
  });

  it("登录失败记录失败结果", async () => {
    signInMock.mockResolvedValue({
      data: { user: null },
      error: { code: "invalid_credentials", message: "bad" },
    });
    await fillAndSubmit("a@b.com", "wrong");
    await waitFor(() => {
      expect(recordLoginResultMock).toHaveBeenCalledWith("a@b.com", false);
    });
  });

  it("其他登录错误不展示重发按钮", async () => {
    signInMock.mockResolvedValue({
      data: { user: null },
      error: { code: "invalid_credentials", message: "bad" },
    });
    await fillAndSubmit("a@b.com", "wrong");
    await waitFor(() => {
      expect(toastMock).toHaveBeenCalled();
    });
    expect(screen.queryByRole("button", { name: "login.resend" })).toBeNull();
  });
});
