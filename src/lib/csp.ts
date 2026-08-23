/**
 * CSP（内容安全策略）生成器
 * 在 Middleware 中按请求生成 nonce，脚本仅允许带该 nonce 的内联标签执行
 *
 * 说明：
 * - Next.js 会自动读取响应 CSP 头中的 nonce 并应用到其注入的 <script>
 * - 'strict-dynamic' 允许 nonce 脚本动态加载的脚本
 * - 开发模式需 'unsafe-eval'（React HMR / Turbopack）
 * - 样式保留 'unsafe-inline'（Tailwind/shadcn 运行时注入，无法 nonce 化）
 */

/** 请求头中携带 nonce 的键名（Server Components 可读取） */
export const NONCE_HEADER = "x-nonce";

export function generateNonce(): string {
  return btoa(crypto.randomUUID());
}

export function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV === "development";
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    // 静态预渲染页面的脚本在构建时生成、无 nonce，浏览器会回退允许自身加载的脚本；
    // 老浏览器不支持 strict-dynamic，需要 unsafe-inline 回退
    "'unsafe-inline'",
    ...(isDev ? ["'unsafe-eval'"] : []),
  ].join(" ");

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data: https://*.supabase.co",
    "font-src 'self' data:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.sentry.io https://*.ingest.sentry.io",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}
