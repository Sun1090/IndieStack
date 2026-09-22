/**
 * MFA 登录挑战页测试（C03）
 * 覆盖：factor 参数缺失、输入过滤与提交门控、challenge / verify 失败与成功、
 * 抛异常时的 loading 复位、redirect 消毒、恢复码自救分支。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MfaPage from "./page";
import { ROUTES } from "@/lib/constants";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const pushMock = vi.hoisted(() => vi.fn());
const refreshMock = vi.hoisted(() => vi.fn());

// searchParams 需要按用例切换 factor / redirect，故用可写入的 Map 驱动
const searchParams = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    use(init: Record<string, string>) {
      store.clear();
      for (const [key, value] of Object.entries(init)) store.set(key, value);
    },
    get: (key: string) => store.get(key) ?? null,
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
  useSearchParams: () => ({ get: searchParams.get }),
}));

const challengeMock = vi.hoisted(() => vi.fn());
const verifyMock = vi.hoisted(() => vi.fn());
const refreshSessionMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      mfa: { challenge: challengeMock, verify: verifyMock },
      refreshSession: refreshSessionMock,
    },
  }),
}));

const toastMock = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({
  toast: toastMock,
}));

const logAuthEventMock = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock("@/lib/actions/audit", () => ({
  logAuthEvent: logAuthEventMock,
}));

const redeemRecoveryCodeMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/recovery-codes", () => ({
  redeemRecoveryCode: redeemRecoveryCodeMock,
}));

const FACTOR_ID = "factor-123";
const CHALLENGE_ID = "challenge-456";

beforeEach(() => {
  vi.clearAllMocks();
  searchParams.use({ factor: FACTOR_ID });
  challengeMock.mockResolvedValue({ data: { id: CHALLENGE_ID }, error: null });
  verifyMock.mockResolvedValue({ data: {}, error: null });
  refreshSessionMock.mockResolvedValue({ data: {}, error: null });
  redeemRecoveryCodeMock.mockResolvedValue({ ok: true });
});

async function typeCode(user: ReturnType<typeof userEvent.setup>, value: string) {
  await user.type(screen.getByLabelText("codeLabel"), value);
}

describe("MfaPage 缺少 factor 上下文", () => {
  it("缺 factor 参数时不渲染验证码输入，给出说明与回登录入口", async () => {
    searchParams.use({});
    const user = userEvent.setup();
    render(<MfaPage />);

    // 默认导出包着 Card 外壳，标题/描述与提示同屏
    expect(screen.getByText("title")).toBeInTheDocument();
    expect(screen.getByText("desc")).toBeInTheDocument();
    expect(screen.queryByLabelText("codeLabel")).toBeNull();
    expect(screen.getByText("missingFactor")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "backToLogin" })).toHaveAttribute("href", ROUTES.login);
  });

  it("factor 为空串同样视为缺失", async () => {
    searchParams.use({ factor: "" });
    render(<MfaPage />);
    expect(screen.getByText("missingFactor")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "submit" })).toBeNull();
  });
});

describe("MfaPage 验证码输入与提交门控", () => {
  it("剔除非数字字符且未满 6 位时禁止提交", async () => {
    const user = userEvent.setup();
    render(<MfaPage />);
    const input = screen.getByLabelText("codeLabel");
    const submit = screen.getByRole("button", { name: "submit" });

    expect(submit).toBeDisabled();
    await typeCode(user, "ab12 34");
    expect(input).toHaveValue("1234");
    expect(submit).toBeDisabled();

    await typeCode(user, "5");
    expect(input).toHaveValue("12345");
    expect(submit).toBeDisabled();

    await typeCode(user, "6");
    expect(input).toHaveValue("123456");
    expect(submit).toBeEnabled();
    expect(challengeMock).not.toHaveBeenCalled();
  });
});

describe("MfaPage 验证码校验", () => {
  it("challenge 失败时提示错误且不发起 verify、不跳转", async () => {
    challengeMock.mockResolvedValue({
      data: null,
      error: { code: "mfa_factor_not_found", message: "Factor not found" },
    });
    const user = userEvent.setup();
    render(<MfaPage />);
    await typeCode(user, "123456");
    await user.click(screen.getByRole("button", { name: "submit" }));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith({
        title: "MFA",
        description: "authMfaFailed",
        variant: "destructive",
      });
    });
    expect(challengeMock).toHaveBeenCalledWith({ factorId: FACTOR_ID });
    expect(verifyMock).not.toHaveBeenCalled();
    expect(refreshSessionMock).not.toHaveBeenCalled();
    expect(logAuthEventMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
    // loading 必须复位，否则用户无法重试
    expect(screen.getByRole("button", { name: "submit" })).toBeEnabled();
  });

  it("verify 失败时提示对应错误码且不刷新会话", async () => {
    verifyMock.mockResolvedValue({
      data: null,
      error: { code: "mfa_challenge_expired", message: "Challenge expired" },
    });
    const user = userEvent.setup();
    render(<MfaPage />);
    await typeCode(user, "123456");
    await user.click(screen.getByRole("button", { name: "submit" }));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith({
        title: "MFA",
        description: "authOtpExpired",
        variant: "destructive",
      });
    });
    expect(verifyMock).toHaveBeenCalledWith({
      factorId: FACTOR_ID,
      challengeId: CHALLENGE_ID,
      code: "123456",
    });
    expect(refreshSessionMock).not.toHaveBeenCalled();
    expect(logAuthEventMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "submit" })).toBeEnabled();
  });

  it("verify 成功时刷新会话、记审计并跳转到目标页", async () => {
    searchParams.use({ factor: FACTOR_ID, redirect: "/dashboard/team" });
    const user = userEvent.setup();
    render(<MfaPage />);
    // 带空格输入，验证提交前同样被清洗
    await typeCode(user, "12 3456");
    await user.click(screen.getByRole("button", { name: "submit" }));

    await waitFor(() => {
      expect(refreshSessionMock).toHaveBeenCalled();
      expect(logAuthEventMock).toHaveBeenCalledWith("auth.mfa_verified", {});
      expect(pushMock).toHaveBeenCalledWith("/dashboard/team");
      expect(refreshMock).toHaveBeenCalled();
    });
    expect(verifyMock).toHaveBeenCalledWith({
      factorId: FACTOR_ID,
      challengeId: CHALLENGE_ID,
      code: "123456",
    });
    expect(toastMock).not.toHaveBeenCalled();
  });
});

describe("MfaPage 异常兜底", () => {
  it("mfa.challenge 抛异常时提示通用错误并恢复可重试", async () => {
    challengeMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const user = userEvent.setup();
    render(<MfaPage />);
    await typeCode(user, "123456");
    await user.click(screen.getByRole("button", { name: "submit" }));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith({
        title: "MFA",
        description: "authError",
        variant: "destructive",
      });
    });
    expect(verifyMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
    // 没有 try/finally 时按钮会永远停在 "..."，这条就是那个回归的哨兵
    expect(screen.getByRole("button", { name: "submit" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "submit" })).not.toHaveTextContent("...");
  });

  it("兑换恢复码抛异常时同样提示并可重试", async () => {
    redeemRecoveryCodeMock.mockRejectedValue(new Error("action unavailable"));
    const user = userEvent.setup();
    render(<MfaPage />);
    await user.click(screen.getByRole("button", { name: "useRecovery" }));
    await user.type(screen.getByLabelText("recoveryTitle"), "abcd-efgh");
    await user.click(screen.getByRole("button", { name: "recoverySubmit" }));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith({
        title: "MFA",
        description: "authError",
        variant: "destructive",
      });
    });
    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "recoverySubmit" })).toBeEnabled();
  });
});

describe("MfaPage redirect 消毒", () => {  it("站外 redirect 回落到 dashboard", async () => {
    searchParams.use({ factor: FACTOR_ID, redirect: "https://evil.example/x" });
    const user = userEvent.setup();
    render(<MfaPage />);
    await typeCode(user, "123456");
    await user.click(screen.getByRole("button", { name: "submit" }));

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith(ROUTES.dashboard);
    });
    expect(pushMock).not.toHaveBeenCalledWith(expect.stringContaining("evil.example"));
  });

  it("协议相对 redirect 同样回落到 dashboard", async () => {
    searchParams.use({ factor: FACTOR_ID, redirect: "//evil.example/x" });
    const user = userEvent.setup();
    render(<MfaPage />);
    await typeCode(user, "123456");
    await user.click(screen.getByRole("button", { name: "submit" }));

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith(ROUTES.dashboard);
    });
  });
});

describe("MfaPage 恢复码自救", () => {
  it("切换到恢复码表单后空码禁止提交，可返回验证码表单", async () => {
    const user = userEvent.setup();
    render(<MfaPage />);
    await user.click(screen.getByRole("button", { name: "useRecovery" }));

    expect(screen.getByText("recoveryDesc")).toBeInTheDocument();
    expect(screen.queryByLabelText("codeLabel")).toBeNull();
    const submit = screen.getByRole("button", { name: "recoverySubmit" });
    expect(submit).toBeDisabled();

    // 纯空白经 trim 后仍视为空，不应放行
    await user.type(screen.getByLabelText("recoveryTitle"), "   ");
    expect(submit).toBeDisabled();
    expect(redeemRecoveryCodeMock).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText("recoveryTitle"));
    await user.click(screen.getByRole("button", { name: "backToCode" }));
    expect(screen.getByLabelText("codeLabel")).toBeInTheDocument();
    expect(screen.queryByText("recoveryDesc")).toBeNull();
  });

  it("兑换失败时提示错误码且不跳转", async () => {
    redeemRecoveryCodeMock.mockResolvedValue({ ok: false, error: "mfaInvalidCode" });
    const user = userEvent.setup();
    render(<MfaPage />);
    await user.click(screen.getByRole("button", { name: "useRecovery" }));
    await user.type(screen.getByLabelText("recoveryTitle"), "bad-code");
    await user.click(screen.getByRole("button", { name: "recoverySubmit" }));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith({
        title: "MFA",
        description: "mfaInvalidCode",
        variant: "destructive",
      });
    });
    expect(redeemRecoveryCodeMock).toHaveBeenCalledWith("bad-code");
    expect(pushMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "recoverySubmit" })).toBeEnabled();
  });

  it("兑换成功时提示并引导重新登录", async () => {
    const user = userEvent.setup();
    render(<MfaPage />);
    await user.click(screen.getByRole("button", { name: "useRecovery" }));
    await user.type(screen.getByLabelText("recoveryTitle"), "abcd-efgh");
    await user.click(screen.getByRole("button", { name: "recoverySubmit" }));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith({ title: "MFA", description: "redeemed" });
      expect(pushMock).toHaveBeenCalledWith(ROUTES.login);
      expect(refreshMock).toHaveBeenCalled();
    });
    expect(challengeMock).not.toHaveBeenCalled();
  });
});
