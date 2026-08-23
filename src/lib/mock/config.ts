/**
 * Mock 模式配置（零依赖轻量模块）
 * 仅供 Edge Middleware 等对 bundle 体积敏感的场景引入，
 * 避免把 faker 等 mock 数据依赖打进 Edge 运行时。
 */

/** 是否启用 Mock 模式 */
export const isMockEnabled =
  process.env.NEXT_PUBLIC_MOCK_ENABLED === "true" ||
  // 仅在非生产环境：Supabase 未配置时自动启用 Mock（避免生产环境误配时静默绕过认证）
  (process.env.NODE_ENV !== "production" && !process.env.NEXT_PUBLIC_SUPABASE_URL);

/** 当 Supabase 未配置时，自动启用 Mock 模式 */
export function shouldUseMock(): boolean {
  return isMockEnabled;
}
