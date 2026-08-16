/**
 * 中间件：Supabase 会话管理 + 权限路由保护
 * - 使用 Cookie 管理 Supabase 会话
 * - 保护需要登录的路由，重定向未登录用户到登录页
 * - 已登录用户访问登录/注册页时重定向到仪表盘
 * - 基于角色的权限路由保护
 *
 * 国际化说明：
 *   语言偏好由 next-intl 在 src/i18n/request.ts 中通过 Cookie 读取，
 *   中间件不再负责语言检测，职责保持单一。
 */
import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { ROUTES } from "@/lib/constants";
import { shouldUseMock } from "@/lib/mock";

/** 需要登录保护的路由列表 */
const protectedRoutes = ["/dashboard", "/dashboard/(.*)"];

/** 认证相关路由（已登录用户不应访问） */
const authRoutes = ["/auth/login", "/auth/register"];

export async function middleware(request: NextRequest) {
  const { supabaseResponse, user } = await updateSession(request);
  const pathname = request.nextUrl.pathname;

  // Mock 模式：跳过所有权限检查
  if (shouldUseMock()) {
    return supabaseResponse;
  }

  // 检查当前路由是否需要保护
  const isProtected = protectedRoutes.some((route) => {
    const pattern = new RegExp(`^${route.replace(/\(\.\*\)/g, ".*")}$`);
    return pattern.test(pathname);
  });

  // 检查当前路由是否为认证页面
  const isAuthRoute = authRoutes.some((route) => {
    const pattern = new RegExp(`^${route.replace(/\(\.\*\)/g, ".*")}$`);
    return pattern.test(pathname);
  });

  // 重定向未认证用户到登录页
  if (isProtected && !user) {
    const loginUrl = new URL(ROUTES.login, request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // 已登录用户访问登录/注册页时重定向到仪表盘
  if (isAuthRoute && user) {
    return NextResponse.redirect(new URL(ROUTES.dashboard, request.url));
  }

  // 注意：细粒度的角色检查由页面组件中的 auth/guards 处理
  // 路由级别的安全检查由各页面的 requireRole/requirePermission 确保

  return supabaseResponse;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
