/**
 * Supabase 认证回调 API 路由
 * 处理 OAuth 和魔法链接登录回调
 */

import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ROUTES } from "@/lib/constants";
import { getSafeRedirect } from "@/lib/safe-redirect";
import { logApiError } from "@/lib/api-log";

/**
 * Auth callback route for Supabase OAuth and email link flows.
 * Exchanges auth code for a session and redirects the user.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = getSafeRedirect(searchParams.get("next"), ROUTES.dashboard);

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      // 不向 URL 泄漏 Supabase 原始错误信息；客户端 /auth/callback 会展示本地化错误
      await logApiError("[Auth Callback] 交换会话失败", error);
      return NextResponse.redirect(`${origin}/auth/login`);
    }
  }

  return NextResponse.redirect(`${origin}${next}`);
}
