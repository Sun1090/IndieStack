"use client";

/**
 * 共享表单字段原语（G03）
 *
 * 统一「标签 / 控件 / 描述 / 错误」四件套的 DOM 与 ARIA 接线：
 * - `FormFieldControl` 通过 Radix `Slot` 把控件 id（即 `htmlFor` 值）与 `aria-*` 合并到子控件上，
 *   因此调用方不再手写 `id`，也不会出现 label 指不到控件的漂移；
 * - 描述与错误各自持有稳定 id，只要有内容就会并入控件的 `aria-describedby`；
 * - 出现错误时控件标记 `aria-invalid="true"`，错误文本以 `role="alert"` 播报。
 *
 * 布局由 `variant` 与 `className` 控制：默认竖排 `space-y-2`；`inline` 用于「文案在左、开关在右」
 * 的设置项。需要完全自定义排布时，可不传 label/description/error，改用 `FormFieldLabel` 自行摆放。
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";

interface FormFieldContextValue {
  id: string;
  descriptionId: string;
  errorId: string;
  hasDescription: boolean;
  hasError: boolean;
}

const FormFieldContext = React.createContext<FormFieldContextValue | null>(null);

/** 读取当前字段的 id 与 aria 接线信息；必须在 `FormField` 内使用。 */
export function useFormField() {
  const context = React.useContext(FormFieldContext);
  if (!context) {
    throw new Error("useFormField 必须在 <FormField> 内使用");
  }
  return context;
}

export interface FormFieldLabelProps extends React.ComponentPropsWithoutRef<typeof Label> {}

/** 字段标签。id 绑定由 `FormField` 提供，调用方只需给内容。 */
export const FormFieldLabel = React.forwardRef<React.ElementRef<typeof Label>, FormFieldLabelProps>(
  ({ className, ...props }, ref) => {
    const { id } = useFormField();
    return <Label ref={ref} htmlFor={id} className={className} {...props} />;
  },
);
FormFieldLabel.displayName = "FormFieldLabel";

export interface FormFieldControlProps {
  /** 单个受控控件元素；id / aria 接线由本组件合并上去。 */
  children: React.ReactElement<React.HTMLAttributes<HTMLElement>>;
}

type InjectedControlProps = React.HTMLAttributes<HTMLElement> & {
  ref?: React.Ref<HTMLElement>;
};

/**
 * 控件包装层。本身不产生 DOM，只把 id / aria-describedby / aria-invalid 合并到子控件上。
 *
 * 注入值优先于子控件自带的同名 props：id 由 `htmlFor` 唯一决定，label 与控件不可能再指错；
 * 子控件自带的 `aria-describedby` 会追加保留（例如上传控件额外说明不可覆盖）。
 */
export const FormFieldControl = React.forwardRef<HTMLElement, FormFieldControlProps>(
  ({ children }, ref) => {
    const { id, descriptionId, errorId, hasDescription, hasError } = useFormField();

    if (!React.isValidElement(children)) {
      throw new Error("FormFieldControl 需要且仅需要一个受控控件元素作为 children");
    }

    const childProps = children.props;
    const describedBy = [
      hasDescription ? descriptionId : null,
      hasError ? errorId : null,
      childProps["aria-describedby"],
    ]
      .filter(Boolean)
      .join(" ");

    const injected = {
      ...childProps,
      id,
      "aria-describedby": describedBy || undefined,
      "aria-invalid": hasError ? true : childProps["aria-invalid"],
      ref,
    } as InjectedControlProps;

    return React.cloneElement(children, injected);
  },
);
FormFieldControl.displayName = "FormFieldControl";

export interface FormFieldDescriptionProps extends React.ComponentPropsWithoutRef<"p"> {}

/** 字段描述文本，带稳定 id 供控件 `aria-describedby` 引用。 */
export const FormFieldDescription = React.forwardRef<
  HTMLParagraphElement,
  FormFieldDescriptionProps
>(({ className, ...props }, ref) => {
  const { descriptionId } = useFormField();
  return (
    <p
      ref={ref}
      id={descriptionId}
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  );
});
FormFieldDescription.displayName = "FormFieldDescription";

export interface FormFieldErrorProps extends React.ComponentPropsWithoutRef<"p"> {}

/** 字段错误文本，`role="alert"` 让屏幕阅读器在提交失败后立刻播报。 */
export const FormFieldError = React.forwardRef<HTMLParagraphElement, FormFieldErrorProps>(
  ({ className, ...props }, ref) => {
    const { errorId } = useFormField();
    return (
      <p
        ref={ref}
        id={errorId}
        role="alert"
        className={cn("text-destructive text-sm font-medium", className)}
        {...props}
      />
    );
  },
);
FormFieldError.displayName = "FormFieldError";

export interface FormFieldProps {
  /** 控件 id，也是 label 的 `htmlFor`；由 `FormFieldControl` 注入到控件。 */
  htmlFor: string;
  label?: React.ReactNode;
  description?: React.ReactNode;
  error?: string | null;
  /** 描述相对控件的位置；上传类字段习惯把说明放在控件上方。 */
  descriptionPosition?: "before" | "after";
  /** `inline` 用于「标签 + 描述在左、控件在右」的设置项。 */
  variant?: "stack" | "inline";
  className?: string;
  labelClassName?: string;
  descriptionClassName?: string;
  children: React.ReactNode;
}

function buildBody(
  variant: "stack" | "inline",
  descriptionPosition: "before" | "after",
  labelNode: React.ReactNode,
  descriptionNode: React.ReactNode,
  errorNode: React.ReactNode,
  children: React.ReactNode,
) {
  if (variant === "inline") {
    return (
      <>
        {labelNode || descriptionNode ? (
          <div className="space-y-0.5">
            {labelNode}
            {descriptionNode}
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          {children}
          {errorNode}
        </div>
      </>
    );
  }

  return (
    <>
      {labelNode}
      {descriptionPosition === "before" ? descriptionNode : null}
      {children}
      {descriptionPosition === "before" ? null : descriptionNode}
      {errorNode}
    </>
  );
}

export function FormField({
  htmlFor,
  label,
  description,
  error,
  descriptionPosition = "after",
  variant = "stack",
  className,
  labelClassName,
  descriptionClassName,
  children,
}: FormFieldProps) {
  const hasDescription = description != null && description !== false;
  const hasError = Boolean(error);
  const context = React.useMemo<FormFieldContextValue>(
    () => ({
      id: htmlFor,
      descriptionId: `${htmlFor}-description`,
      errorId: `${htmlFor}-error`,
      hasDescription,
      hasError,
    }),
    [htmlFor, hasDescription, hasError],
  );

  const labelNode =
    label != null ? <FormFieldLabel className={labelClassName}>{label}</FormFieldLabel> : null;
  const descriptionNode = hasDescription ? (
    <FormFieldDescription className={descriptionClassName}>{description}</FormFieldDescription>
  ) : null;
  const errorNode = hasError ? <FormFieldError>{error}</FormFieldError> : null;

  return (
    <FormFieldContext.Provider value={context}>
      <div
        className={cn(className === undefined ? "space-y-2" : className)}
        data-invalid={hasError ? "true" : undefined}
      >
        {buildBody(variant, descriptionPosition, labelNode, descriptionNode, errorNode, children)}
      </div>
    </FormFieldContext.Provider>
  );
}
