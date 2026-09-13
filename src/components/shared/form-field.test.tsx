/**
 * FormField 共享字段原语测试
 * 覆盖：label/控件关联、描述与错误的 aria 接线、错误播报、内联布局、默认布局与越界保护
 */
import type { HTMLAttributes, ReactElement } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Input } from "@/components/ui/input";
import {
  FormField,
  FormFieldControl,
  FormFieldDescription,
  FormFieldLabel,
  useFormField,
} from "./form-field";

describe("FormField", () => {
  it("把 label 与控件通过 htmlFor/id 关联", () => {
    render(
      <FormField htmlFor="email" label="邮箱">
        <FormFieldControl>
          <Input name="email" />
        </FormFieldControl>
      </FormField>,
    );

    const input = screen.getByLabelText("邮箱");
    expect(input).toHaveAttribute("id", "email");
    expect(input).toHaveAttribute("name", "email");
  });

  it("没有描述与错误时不写 aria 属性", () => {
    render(
      <FormField htmlFor="email" label="邮箱">
        <FormFieldControl>
          <Input />
        </FormFieldControl>
      </FormField>,
    );

    const input = screen.getByLabelText("邮箱");
    expect(input).not.toHaveAttribute("aria-describedby");
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("有描述时把描述 id 并入 aria-describedby 且描述元素存在", () => {
    render(
      <FormField htmlFor="bio" label="简介" description="最多 200 字">
        <FormFieldControl>
          <Input />
        </FormFieldControl>
      </FormField>,
    );

    const input = screen.getByLabelText("简介");
    expect(input).toHaveAttribute("aria-describedby", "bio-description");
    expect(document.getElementById("bio-description")).toHaveTextContent("最多 200 字");
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("有错误时同时接线 aria-describedby 与 aria-invalid，并用 alert 播报", () => {
    render(
      <FormField htmlFor="email" label="邮箱" error="该邮箱已被邀请">
        <FormFieldControl>
          <Input />
        </FormFieldControl>
      </FormField>,
    );

    const input = screen.getByLabelText("邮箱");
    expect(input).toHaveAttribute("aria-describedby", "email-error");
    expect(input).toHaveAttribute("aria-invalid", "true");

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("该邮箱已被邀请");
    expect(alert).toHaveAttribute("id", "email-error");
  });

  it("描述与错误同时存在时按顺序并入 aria-describedby", () => {
    render(
      <FormField htmlFor="email" label="邮箱" description="公司邮箱" error="已被占用">
        <FormFieldControl>
          <Input />
        </FormFieldControl>
      </FormField>,
    );

    expect(screen.getByLabelText("邮箱")).toHaveAttribute(
      "aria-describedby",
      "email-description email-error",
    );
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("error 为 null 时不渲染错误节点、不标记 invalid", () => {
    const { container } = render(
      <FormField htmlFor="email" label="邮箱" error={null}>
        <FormFieldControl>
          <Input />
        </FormFieldControl>
      </FormField>,
    );

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(document.getElementById("email-error")).toBeNull();
    expect(container.querySelector("[data-invalid]")).toBeNull();
  });

  it("默认使用 space-y-2，显式 className 覆盖默认布局", () => {
    const { container: defaultContainer } = render(
      <FormField htmlFor="a" label="A">
        <FormFieldControl>
          <Input />
        </FormFieldControl>
      </FormField>,
    );
    expect(defaultContainer.firstElementChild).toHaveClass("space-y-2");

    const { container } = render(
      <FormField htmlFor="b" label="B" className="grid gap-2">
        <FormFieldControl>
          <Input />
        </FormFieldControl>
      </FormField>,
    );
    expect(container.firstElementChild).toHaveClass("grid", "gap-2");
    expect(container.firstElementChild).not.toHaveClass("space-y-2");
  });

  it("descriptionPosition=before 把描述放在控件之前", () => {
    render(
      <FormField
        htmlFor="avatar"
        label="头像"
        description="PNG/JPEG/WebP"
        descriptionPosition="before"
      >
        <FormFieldControl>
          <Input type="file" />
        </FormFieldControl>
      </FormField>,
    );

    const description = document.getElementById("avatar-description")!;
    const input = screen.getByLabelText("头像");
    expect(
      description.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(input).toHaveAttribute("aria-describedby", "avatar-description");
  });

  it("inline 变体把标签与描述放同一块、控件在另一块", () => {
    const { container } = render(
      <FormField
        htmlFor="marketing"
        label="营销邮件"
        description="每周一封"
        variant="inline"
        className="flex items-center justify-between rounded-lg border p-4"
      >
        <FormFieldControl>
          <input type="checkbox" />
        </FormFieldControl>
      </FormField>,
    );

    const wrapper = container.firstElementChild!;
    expect(wrapper).toHaveClass("flex");
    const label = screen.getByText("营销邮件");
    const checkbox = screen.getByLabelText("营销邮件");
    expect(label.compareDocumentPosition(checkbox) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(checkbox).toHaveAttribute("aria-describedby", "marketing-description");
  });

  it("注入的 id 覆盖子控件自带 id，保证 label 不会指错", () => {
    render(
      <FormField htmlFor="injected" label="字段">
        <FormFieldControl>
          <Input id="explicit" />
        </FormFieldControl>
      </FormField>,
    );

    expect(screen.getByLabelText("字段")).toHaveAttribute("id", "injected");
  });

  it("保留子控件自带的 aria-describedby 并追加字段描述", () => {
    render(
      <>
        <p id="extra-hint">额外提示</p>
        <FormField htmlFor="bio" label="简介" description="最多 200 字">
          <FormFieldControl>
            <Input aria-describedby="extra-hint" />
          </FormFieldControl>
        </FormField>
      </>,
    );

    expect(screen.getByLabelText("简介")).toHaveAttribute(
      "aria-describedby",
      "bio-description extra-hint",
    );
  });

  it("FormFieldControl 收到非元素 children 时报错", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      render(
        <FormField htmlFor="weird" label="字段">
          <FormFieldControl>{"不是元素" as unknown as ReactElement<HTMLAttributes<HTMLElement>>}</FormFieldControl>
        </FormField>,
      ),
    ).toThrow(/需要且仅需要一个受控控件元素/);
    spy.mockRestore();
  });

  it("可自行摆放 FormFieldLabel 与 FormFieldDescription", () => {
    render(
      <FormField htmlFor="theme-dark">
        <FormFieldControl>
          <input type="radio" />
        </FormFieldControl>
        <FormFieldLabel>深色</FormFieldLabel>
        <FormFieldDescription>始终使用深色主题</FormFieldDescription>
      </FormField>,
    );

    expect(screen.getByLabelText("深色")).toHaveAttribute("id", "theme-dark");
    expect(document.getElementById("theme-dark-description")).toHaveTextContent("始终使用深色主题");
  });

  it("在 FormField 之外调用 useFormField 直接报错", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    function Probe() {
      useFormField();
      return null;
    }

    expect(() => render(<Probe />)).toThrow(/必须在 <FormField> 内使用/);
    spy.mockRestore();
  });
});
