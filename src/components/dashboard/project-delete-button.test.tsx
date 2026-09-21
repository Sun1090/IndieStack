/**
 * ProjectDeleteButton 组件测试
 * 覆盖：确认弹窗、删除成功 toast、失败时错误码必须经 actions 命名空间翻译
 *
 * `useTranslations` 这里按命名空间加前缀返回，目的是区分「渲染错误码」与
 * 「渲染该错误码的译文」——若沿用只返回 key 的通用 mock，
 * `result.error` 与 `ta(result.error)` 的产物完全一样，这条回归就测不出来。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProjectDeleteButton } from "./project-delete-button";

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string) => `${namespace}:${key}`,
}));

const deleteProjectMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/projects", () => ({
  deleteProject: deleteProjectMock,
}));

const toastMock = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({
  toast: toastMock,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

async function confirmDeletion() {
  const user = userEvent.setup();
  render(<ProjectDeleteButton projectId="p1" projectName="My app" />);
  await user.click(screen.getByRole("button", { name: "dashboard.projects:deleteDelete: My app" }));
  await user.click(await screen.findByRole("button", { name: "dashboard.projects:deleteDelete" }));
  return user;
}

describe("ProjectDeleteButton", () => {
  it("删除成功后提示已删除且不带 destructive 样式", async () => {
    deleteProjectMock.mockResolvedValue({ ok: true });
    await confirmDeletion();

    await waitFor(() => {
      expect(deleteProjectMock).toHaveBeenCalledWith("p1");
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: "dashboard.projects:deleteDeleted" }),
      );
    });
    expect(toastMock).not.toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
  });

  it("失败时 toast 展示 actions 命名空间的译文，而不是原始错误码", async () => {
    deleteProjectMock.mockResolvedValue({ ok: false, error: "projectNotFound" });
    await confirmDeletion();

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "common:error",
          description: "actions:projectNotFound",
          variant: "destructive",
        }),
      );
    });
    const call = toastMock.mock.calls.at(-1)?.[0] as { description: unknown };
    expect(call.description).not.toBe("projectNotFound");
  });
});
