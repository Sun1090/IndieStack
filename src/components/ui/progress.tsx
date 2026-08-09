/**
 * Progress 组件 — shadcn/ui 风格的进度条
 * 基于 @radix-ui/react-progress 实现
 * 用于显示任务完成度、上传/下载进度等场景
 *
 * 使用示例：
 *   <Progress value={65} />
 *   <Progress value={100} className="bg-green-500" />
 */
"use client";

import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";
import { cn } from "@/lib/utils";

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> & {
    /** 进度值 0-100，不传则显示无限动画 */
    value?: number;
    /** 指示器自定义样式类名 */
    indicatorClassName?: string;
  }
>(({ className, value, indicatorClassName, ...props }, ref) => (
  <ProgressPrimitive.Root
    ref={ref}
    className={cn(
      "relative h-4 w-full overflow-hidden rounded-full bg-secondary",
      className
    )}
    {...props}
  >
    <ProgressPrimitive.Indicator
      className={cn(
        "h-full w-full flex-1 bg-primary transition-all",
        value === undefined && "animate-progress-indeterminate",
        indicatorClassName
      )}
      style={{ transform: `translateX(-${100 - (value ?? 0)}%)` }}
    />
  </ProgressPrimitive.Root>
));
Progress.displayName = ProgressPrimitive.Root.displayName;

export { Progress };
