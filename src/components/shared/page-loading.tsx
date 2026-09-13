/**
 * 路由级加载状态（G04 单一事实来源）
 * ================================
 *
 * G04 之前仓库里同时存在 `page-loader.tsx`、`loading-state.tsx` 两个无人引用的加载组件，
 * 12 个 `loading.tsx` 里有 3 个绕过共享原语手写 Skeleton（且没有 `aria-busy`），
 * 加载文案还有硬编码中文。现在所有加载态都收敛到这里：
 *
 *   - `PageLoading`：路由级骨架屏，`src/app/**\/loading.tsx` 只能渲染它；
 *   - `LoadingIndicator`：局部的旋转指示器（表格单元格、认证回调等骨架屏不合适的场景）。
 *
 * 两者都带 `role="status"` 与 `aria-busy="true"`，加载文案走 next-intl，屏幕阅读器可播报。
 * 该组件不声明 `"use client"`：next-intl 的 `useTranslations` 在 Server Component 中同样可用，
 * 因此 `loading.tsx` 保持服务端渲染（不额外把骨架屏变成客户端组件）。
 */

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type PageLoadingVariant = "cards" | "dashboard" | "stats" | "list" | "spinner";

interface PageLoadingProps {
  /**
   * 骨架形状：
   * - `cards`（默认）：标题 + 4 张统计卡 + 一块内容区
   * - `dashboard`：标题 + 统计卡 + 两张明细卡（仪表盘首页）
   * - `stats`：标题 + 4 张统计卡（admin 概览）
   * - `list`：标题 + 若干占位行（列表页）
   * - `spinner`：居中旋转指示器（认证回调等无形状可预测的场景）
   */
  variant?: PageLoadingVariant;
  /** `list` 变体的占位行数，默认 5。 */
  rows?: number;
  /** 覆盖默认加载文案（已翻译）；缺省使用 `common.loading`。 */
  label?: string;
  className?: string;
}

/** 骨架屏共用的标题占位（一行大标题 + 一行描述）。 */
function LoadingHeader() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-72" />
    </div>
  );
}

/** 四张统计卡占位。 */
function LoadingStatCards({ valueClass }: { valueClass: string }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i}>
          <CardHeader className="pb-2">
            <Skeleton className="h-4 w-24" />
          </CardHeader>
          <CardContent>
            <Skeleton className={cn("w-16", valueClass)} />
            <Skeleton className="mt-2 h-3 w-32" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/** 局部旋转指示器：表格单元格、认证回调等骨架屏不合适的场景。 */
export function LoadingIndicator({ label, className }: { label: string; className?: string }) {
  return (
    <div
      role="status"
      className={cn("text-muted-foreground flex items-center justify-center gap-2", className)}
    >
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function PageLoading({ variant = "cards", rows = 5, label, className }: PageLoadingProps) {
  const t = useTranslations("common");
  const statusText = label ?? t("loading");

  if (variant === "spinner") {
    return (
      <div
        aria-busy="true"
        className={cn("flex min-h-[50vh] items-center justify-center", className)}
      >
        <LoadingIndicator label={statusText} />
      </div>
    );
  }

  let body: React.ReactNode;
  if (variant === "dashboard") {
    body = (
      <div className="space-y-8">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96" />
        </div>
        <LoadingStatCards valueClass="h-8" />
        <div className="grid gap-6 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-3 w-48" />
              </CardHeader>
              <CardContent className="space-y-4">
                {Array.from({ length: 4 }).map((_, j) => (
                  <div key={j} className="flex items-center gap-3">
                    <Skeleton className="h-2 w-2 rounded-full" />
                    <div className="flex-1 space-y-1">
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-3 w-2/3" />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  } else if (variant === "stats") {
    body = (
      <div className="space-y-6">
        <div className="space-y-1">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-56" />
        </div>
        <LoadingStatCards valueClass="h-7" />
      </div>
    );
  } else if (variant === "list") {
    body = (
      <div className="space-y-6">
        <LoadingHeader />
        <div className="space-y-3">
          {Array.from({ length: rows }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      </div>
    );
  } else {
    body = (
      <div className="space-y-8">
        <LoadingHeader />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  return (
    <div aria-busy="true" className={cn("space-y-8", className)}>
      {/* 骨架屏本身对屏幕阅读器无意义，用一条 role="status" 文本说明正在加载 */}
      <span role="status" className="sr-only">
        {statusText}
      </span>
      {body}
    </div>
  );
}
