/**
 * PageLoader — 页面级加载状态组件
 * 提供页面过渡、内容加载、骨架屏等多种加载状态
 *
 * @example
 * // 全屏加载
 * <PageLoader />
 *
 * // 内联内容加载
 * <PageLoader variant="inline" text="正在加载数据..." />
 *
 * // 骨架屏
 * <PageLoader variant="skeleton" count={3} />
 */

"use client"

import { cn } from "@/lib/utils"
import { Loader2 } from "lucide-react"

type PageLoaderVariant = "fullscreen" | "inline" | "skeleton" | "spinner"

interface PageLoaderProps {
  /** 加载变体 */
  variant?: PageLoaderVariant
  /** 加载提示文字 */
  text?: string
  /** 骨架屏行数（仅 skeleton 变体） */
  count?: number
  /** 自定义类名 */
  className?: string
  /** 子元素（仅 inline 变体） */
  children?: React.ReactNode
}

/**
 * 骨架屏占位行
 */
function SkeletonRow({ index }: { index: number }) {
  const widths = ["w-full", "w-3/4", "w-5/6", "w-2/3", "w-4/5"]
  const width = widths[index % widths.length]

  return (
    <div className="flex items-center gap-4 py-3">
      {index % 3 === 0 && (
        <div className="h-10 w-10 rounded-full bg-muted animate-pulse" />
      )}
      <div className="flex-1 space-y-2">
        <div className={cn("h-4 rounded bg-muted animate-pulse", width)} />
        <div className="h-3 w-1/2 rounded bg-muted animate-pulse" />
      </div>
      {index % 2 === 0 && (
        <div className="h-8 w-20 rounded bg-muted animate-pulse" />
      )}
    </div>
  )
}

export function PageLoader({
  variant = "fullscreen",
  text,
  count = 3,
  className,
  children,
}: PageLoaderProps) {
  // 全屏加载
  if (variant === "fullscreen") {
    return (
      <div
        className={cn(
          "flex min-h-[60vh] flex-col items-center justify-center gap-4",
          className
        )}
      >
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        {text && (
          <p className="text-sm text-muted-foreground">{text}</p>
        )}
      </div>
    )
  }

  // 内联加载
  if (variant === "inline") {
    return (
      <div className={cn("flex items-center gap-3 py-4", className)}>
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">
          {text ?? "加载中..."}
        </span>
        {children}
      </div>
    )
  }

  // 骨架屏
  if (variant === "skeleton") {
    return (
      <div className={cn("divide-y rounded-lg border p-4", className)}>
        {Array.from({ length: count }).map((_, i) => (
          <SkeletonRow key={i} index={i} />
        ))}
      </div>
    )
  }

  // 纯旋转图标
  return (
    <div className={cn("flex items-center justify-center py-8", className)}>
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  )
}
