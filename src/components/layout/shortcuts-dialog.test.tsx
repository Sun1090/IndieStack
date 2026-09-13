/**
 * ShortcutsDialog 组件测试（G07）
 * 覆盖：? 唤起、Esc 关闭、焦点归还触发按钮、输入场景不误触发。
 * 背景："?" 是文本输入里的常见字符，早期实现只挡了 input/textarea/select，
 * 在 contenteditable 与 role=textbox（命令面板）里输入会误弹对话框。
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ShortcutsDialog } from "./shortcuts-dialog";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("ShortcutsDialog", () => {
  it("默认关闭，按 ? 打开", async () => {
    const user = userEvent.setup();
    render(<ShortcutsDialog />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.keyboard("?");
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("点击触发按钮也能打开", async () => {
    const user = userEvent.setup();
    render(<ShortcutsDialog />);

    await user.click(screen.getByRole("button"));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("Esc 关闭并把焦点还给触发按钮", async () => {
    const user = userEvent.setup();
    render(<ShortcutsDialog />);
    const trigger = screen.getByRole("button");

    await user.click(trigger);
    await screen.findByRole("dialog");

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("在 input / textarea 里输入 ? 不触发", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <ShortcutsDialog />
        <input aria-label="text" />
        <textarea aria-label="area" />
      </div>,
    );

    await user.click(screen.getByLabelText("text"));
    await user.keyboard("?");
    await user.click(screen.getByLabelText("area"));
    await user.keyboard("?");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("在 contenteditable 里输入 ? 不触发", () => {
    // jsdom 不实现 contenteditable 的聚焦行为，直接派发带 target 的键盘事件
    render(
      <div>
        <ShortcutsDialog />
        <div aria-label="rich" contentEditable suppressContentEditableWarning />
      </div>,
    );

    const rich = screen.getByLabelText("rich");
    rich.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("在 role=textbox 容器（命令面板输入区）里输入 ? 不触发", () => {
    render(
      <div>
        <ShortcutsDialog />
        <div role="textbox" aria-label="palette">
          <span data-testid="palette-inner">x</span>
        </div>
      </div>,
    );

    const inner = screen.getByTestId("palette-inner");
    inner.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("带修饰键的 ? （如 ⌘?）不触发", async () => {
    const user = userEvent.setup();
    render(<ShortcutsDialog />);

    await user.keyboard("{Meta>}?{/Meta}");
    await user.keyboard("{Control>}?{/Control}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
