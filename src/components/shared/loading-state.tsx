/**
 * LoadingState / LoadingPage 加载状态组件
 * ======================
 *
 * LoadingState：内联加载占位，用于页面片段加载
 * LoadingPage：全屏加载页面，用于页面级 loading.tsx
 *
 * 使用方式：
 *   <LoadingState text="正在加载..." />
 *   <LoadingPage />  （用于 loading.tsx）
 */

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface LoadingStateProps {
  /** 加载文本（默认：加载中...） */
  text?: string;
  /** 是否全屏居中（默认 false） */
  fullPage?: boolean;
  /** 额外的 CSS 类名 */
  className?: string;
  /** 图标大小（默认 24） */
  iconSize?: number;
}

/**
 * 内联加载状态（用于页面片段）
 */
export function LoadingState({
  text = "加载中...",
  fullPage = false,
  className,
  iconSize = 24,
}: LoadingStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 py-12",
        fullPage && "fixed inset-0",
        className,
      )}
    >
      <Loader2
        className="animate-spin text-muted-foreground"
        style={{ width: iconSize, height: iconSize }}
      />
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

/**
 * 全屏加载页面（用于 Next.js loading.tsx）
 *
 * 使用方式 - 在 loading.tsx 中：
 *   export { LoadingPage as default } from "@/components/shared/loading-state"
 */
export function LoadingPage({ text = "加载中..." }: { text?: string }) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <LoadingState text={text} />
    </div>
  );
}
