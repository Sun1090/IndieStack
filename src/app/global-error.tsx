/**
 * 全局错误边界（根布局级）
 * 根布局（layout.tsx）抛错时，根 error.tsx 无法捕获，必须由本组件兜底。
 * 注意：此边界会替换整个 <html>，因此不能依赖根布局中的 Provider，
 * 文案使用硬编码中文（项目默认语言）；展示层仍复用共享 ErrorState（G04）。
 */
"use client";

import { ErrorState } from "@/components/shared/error-state";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{ margin: 0 }}
        className="bg-background flex min-h-screen items-center justify-center font-sans antialiased"
      >
        <ErrorState
          code="500"
          size="page"
          title="出错了"
          description={
            <>
              <p>应用加载时发生意外错误，请重试或刷新页面。</p>
              {error.digest ? <p className="mt-2 text-xs">错误 ID：{error.digest}</p> : null}
            </>
          }
          action={
            <div className="flex gap-4">
              <button
                type="button"
                onClick={() => reset()}
                className="bg-primary text-primary-foreground inline-flex h-10 items-center justify-center rounded-md px-4 py-2 text-sm font-medium"
              >
                重试
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="border-input bg-background inline-flex h-10 items-center justify-center rounded-md border px-4 py-2 text-sm font-medium"
              >
                刷新页面
              </button>
            </div>
          }
        />
      </body>
    </html>
  );
}
