/**
 * 全局错误边界（根布局级）
 * 根布局（layout.tsx）抛错时，根 error.tsx 无法捕获，必须由本组件兜底。
 * 注意：此边界会替换整个 <html>，因此不能依赖根布局中的 Provider，
 * 文案使用硬编码中文（项目默认语言），并提供重试与刷新入口。
 */
"use client";

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
        className="flex min-h-screen items-center justify-center bg-background font-sans antialiased"
      >
        <div className="container flex max-w-md flex-col items-center gap-4 text-center">
          <h1 className="text-6xl font-bold">500</h1>
          <h2 className="text-2xl font-semibold">出错了</h2>
          <p className="text-muted-foreground">
            应用加载时发生意外错误，请重试或刷新页面。
            {error.digest ? (
              <span className="mt-2 block text-xs text-muted-foreground">
                错误 ID：{error.digest}
              </span>
            ) : null}
          </p>
          <div className="flex gap-4">
            <button
              type="button"
              onClick={() => reset()}
              className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              重试
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex h-10 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium"
            >
              刷新页面
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
