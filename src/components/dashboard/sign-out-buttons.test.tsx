/**
 * 登出按钮的失败路径（C09）
 * 覆盖：signOut 失败时不得进入「已登出」态、不得把用户送去登录页，而是留在原地给出可读的错误。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const signOutMock = vi.hoisted(() => vi.fn());
const pushMock = vi.hoisted(() => vi.fn());
const refreshMock = vi.hoisted(() => vi.fn());

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signOut: signOutMock } }),
}));

import { ROUTES } from "@/lib/constants";
import { LogoutAllButton } from "./logout-all-button";
import { SignOutOthersButton } from "./sign-out-others-button";

beforeEach(() => {
  vi.clearAllMocks();
});

async function clickConfirm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "logoutAll" }));
  await user.click(await screen.findByRole("button", { name: "confirm" }));
}

describe("LogoutAllButton", () => {
  it("登出成功才跳登录页", async () => {
    signOutMock.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(<LogoutAllButton />);
    await clickConfirm(user);

    await waitFor(() => expect(signOutMock).toHaveBeenCalledWith({ scope: "global" }));
    expect(pushMock).toHaveBeenCalledWith(ROUTES.login);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("signOut 返回 error 时留在原地说「没登出」，而不是把人送去登录页报假成功", async () => {
    signOutMock.mockResolvedValue({ error: { message: "network" } });
    const user = userEvent.setup();
    render(<LogoutAllButton />);
    await clickConfirm(user);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("logoutAllFailed"));
    expect(pushMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});

describe("SignOutOthersButton", () => {
  it("登出其他设备成功才进入「已登出」态", async () => {
    signOutMock.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(<SignOutOthersButton />);
    await user.click(screen.getByRole("button", { name: "signOutOthers" }));
    await user.click(await screen.findByRole("button", { name: "confirm" }));

    await waitFor(() => expect(screen.getByText("signOutOthersDone")).toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("signOut 返回 error 时不报「其他设备已登出」，并留在可重试的界面", async () => {
    signOutMock.mockResolvedValue({ error: { message: "network" } });
    const user = userEvent.setup();
    render(<SignOutOthersButton />);
    await user.click(screen.getByRole("button", { name: "signOutOthers" }));
    await user.click(await screen.findByRole("button", { name: "confirm" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("signOutOthersFailed"));
    expect(screen.queryByText("signOutOthersDone")).not.toBeInTheDocument();
    // 还能重试：确认按钮仍在
    expect(screen.getByRole("button", { name: "confirm" })).toBeEnabled();
  });
});
