/**
 * 原生 `<select>` 控件（G03）
 *
 * 项目里多处下拉曾经各自复制一长串 Tailwind 类名，且漂移出过「有的带 disabled: 变体、
 * 有的不带」的不一致。统一收口到这里，样式与 `ui/input` 对齐，配合 `FormField` /
 * `FormFieldControl` 使用即可自动获得 id 与 aria 接线。
 */

import * as React from "react";
import { cn } from "@/lib/utils";

/** 与 Input 保持一致的表单控件外观。 */
export const NATIVE_SELECT_CLASSES =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

export interface NativeSelectProps extends React.ComponentPropsWithoutRef<"select"> {}

export const NativeSelect = React.forwardRef<HTMLSelectElement, NativeSelectProps>(
  ({ className, ...props }, ref) => (
    <select ref={ref} className={cn(NATIVE_SELECT_CLASSES, className)} {...props} />
  ),
);
NativeSelect.displayName = "NativeSelect";
