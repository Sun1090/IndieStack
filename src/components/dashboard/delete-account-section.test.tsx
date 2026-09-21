/**
 * DeleteAccountSection 组件测试（H08）
 * 覆盖：两步确认交互、空输入不可提交、成功后跳转首页并刷新、失败时留在页面并给出可访问错误。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DeleteAccountSection } from "./delete-account-section";
import { ROUTES } from "@/lib/constants";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const pushMock = vi.hoisted(() => vi.fn());
const refreshMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

const deleteAccountMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/account", () => ({
  deleteAccountAction: deleteAccountMock,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

async function openDangerForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "deleteAccount" }));
  return screen.findByRole("textbox", { name: "confirmPhrase" });
}

describe("DeleteAccountSection", () => {
  it("默认只露出入口，点击后才要求输入确认短语", async () => {
    const user = userEvent.setup();
    render(<DeleteAccountSection />);

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    const input = await openDangerForm(user);
    expect(input).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "cancel" })).toBeInTheDocument();
  });

  it("取消后回到入口状态，不会留下半个表单", async () => {
    const user = userEvent.setup();
    render(<DeleteAccountSection />);

    await openDangerForm(user);
    await user.click(screen.getByRole("button", { name: "cancel" }));

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(deleteAccountMock).not.toHaveBeenCalled();
  });

  it("没输入任何内容时不可提交（防误触，服务端仍独立校验）", async () => {
    const user = userEvent.setup();
    render(<DeleteAccountSection />);

    await openDangerForm(user);
    expect(screen.getByRole("button", { name: "deleteConfirm" })).toBeDisabled();
  });

  it("输入确认短语后提交，成功即离开 dashboard", async () => {
    deleteAccountMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<DeleteAccountSection />);

    const input = await openDangerForm(user);
    await user.type(input, "delete");
    await user.click(screen.getByRole("button", { name: "deleteConfirm" }));

    await waitFor(() => expect(deleteAccountMock).toHaveBeenCalledWith({ confirm: "delete" }));
    expect(pushMock).toHaveBeenCalledWith(ROUTES.home);
    expect(refreshMock).toHaveBeenCalled();
  });

  it("服务端拒绝时给出可访问的错误提示，不跳转", async () => {
    deleteAccountMock.mockResolvedValue({ ok: false, error: "confirmPhraseMismatch" });
    const user = userEvent.setup();
    render(<DeleteAccountSection />);

    const input = await openDangerForm(user);
    await user.type(input, "delete me");
    await user.click(screen.getByRole("button", { name: "deleteConfirm" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("confirmPhraseMismatch");
    expect(pushMock).not.toHaveBeenCalled();
  });
});
