/**
 * ConfirmDialog 组件测试
 * 覆盖：trigger 打开、确认回调、取消回调、加载态禁用
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmDialog } from "./confirm-dialog";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("ConfirmDialog", () => {
  it("点击 trigger 打开并显示标题/描述", async () => {
    const user = userEvent.setup();
    render(
      <ConfirmDialog title="删除项目" description="此操作不可撤销" onConfirm={vi.fn()}>
        <button>打开</button>
      </ConfirmDialog>,
    );

    await user.click(screen.getByRole("button", { name: "打开" }));
    expect(await screen.findByText("删除项目")).toBeInTheDocument();
    expect(screen.getByText("此操作不可撤销")).toBeInTheDocument();
  });

  it("确认按钮触发 onConfirm 并关闭", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <ConfirmDialog title="T" confirmText="确认执行" onConfirm={onConfirm}>
        <button>open</button>
      </ConfirmDialog>,
    );

    await user.click(screen.getByRole("button", { name: "open" }));
    await user.click(await screen.findByRole("button", { name: "确认执行" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "确认执行" })).not.toBeInTheDocument();
    });
  });

  it("取消触发 onCancel 并关闭", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDialog title="T" cancelText="取消操作" onConfirm={onConfirm} onCancel={onCancel}>
        <button>open</button>
      </ConfirmDialog>,
    );

    await user.click(screen.getByRole("button", { name: "open" }));
    await user.click(await screen.findByRole("button", { name: "取消操作" }));

    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("异步确认期间按钮禁用（加载态）", async () => {
    let resolveFn!: () => void;
    const onConfirm = vi.fn(
      () => new Promise<void>((resolve) => (resolveFn = resolve)),
    );
    const user = userEvent.setup();
    render(
      <ConfirmDialog title="T" confirmText="go" onConfirm={onConfirm}>
        <button>open</button>
      </ConfirmDialog>,
    );

    await user.click(screen.getByRole("button", { name: "open" }));
    const confirmBtn = await screen.findByRole("button", { name: "go" });
    await user.click(confirmBtn);
    // pending 期间禁用
    await waitFor(() => expect(screen.getByRole("button", { name: /go/ })).toBeDisabled());

    resolveFn();
    // 完成后对话框关闭
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /go/ })).not.toBeInTheDocument();
    });
  });
});
