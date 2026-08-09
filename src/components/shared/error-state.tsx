/**
 * ErrorState 错误状态组件
 * ======================
 *
 * 统一错误展示组件，支持错误图标、自定义消息和重试操作。
 *
 * 使用方式：
 *   <ErrorState
 *     title="加载失败"
 *     description="无法获取数据，请稍后重试"
 *     onRetry={() => fetchData()}
 *   />
 */

"use client";

import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ErrorStateProps {
  /** 错误标题（默认：出错了） */
  title?: string;
  /** 错误详细描述 */
  description?: string;
  /** 重试回调 */
  onRetry?: () => void;
  /** 重试按钮文本（默认：重试） */
  retryText?: string;
  /** 额外的 CSS 类名 */
  className?: string;
  /** 是否全屏居中 */
  fullPage?: boolean;
}

export function ErrorState({
  title = "出错了",
  description,
  onRetry,
  retryText = "重试",
  className,
  fullPage = false,
}: ErrorStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4 py-16 text-center",
        fullPage && "min-h-[50vh]",
        className
      )}
    >
      <AlertCircle className="h-12 w-12 text-destructive" />
      <div>
        <h3 className="text-lg font-semibold">{title}</h3>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground max-w-md">
            {description}
          </p>
        )}
      </div>
      {onRetry && (
        <Button variant="outline" onClick={onRetry} className="mt-2">
          <RefreshCw className="mr-2 h-4 w-4" />
          {retryText}
        </Button>
      )}
    </div>
  );
}
