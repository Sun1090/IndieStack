/**
 * 全局错误边界（根布局级）
 * 根布局（layout.tsx）抛错时，根 error.tsx 无法捕获，必须由本组件兜底。
 * 注意：此边界会替换整个 <html>，因此拿不到根布局里的 next-intl Provider，
 * 文案只能硬编码；又因为此刻无法解析用户语言（`app-locale` cookie 要经由
 * `src/i18n/request.ts` 才能读，而那条链路正是失败的根布局），中英文并列展示，
 * 并给中文片段标注 `lang="zh-CN"`——单语写法会让另一批用户在 500 页面读到
 * 自己看不懂的文字，而 `<html lang>` 与实际内容互相矛盾。展示层仍复用共享 ErrorState（G04）。
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
          title="Something went wrong · 出错了"
          description={
            <>
              <p>An unexpected error occurred while loading the app. Retry or reload the page.</p>
              <p lang="zh-CN">应用加载时发生意外错误，请重试或刷新页面。</p>
              {error.digest ? <p className="mt-2 text-xs">Error ID / 错误 ID：{error.digest}</p> : null}
            </>
          }
          action={
            <div className="flex gap-4">
              <button
                type="button"
                onClick={() => reset()}
                className="bg-primary text-primary-foreground inline-flex h-10 items-center justify-center rounded-md px-4 py-2 text-sm font-medium"
              >
                Retry · <span lang="zh-CN">重试</span>
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="border-input bg-background inline-flex h-10 items-center justify-center rounded-md border px-4 py-2 text-sm font-medium"
              >
                Reload page · <span lang="zh-CN">刷新页面</span>
              </button>
            </div>
          }
        />
      </body>
    </html>
  );
}
