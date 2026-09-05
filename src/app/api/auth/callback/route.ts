/**
 * Supabase 认证回调 API 路由
 * 处理 OAuth 和魔法链接登录回调
 */

import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ROUTES } from "@/lib/constants";
import { getSafeRedirect } from "@/lib/safe-redirect";
import { appendAuditLog } from "@/lib/repositories/audit-logs";
import { recordCurrentSession } from "@/lib/actions/sessions";
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
    const {
      data: { user },
    } = await supabase.auth.getUser();
    try {
      await appendAuditLog({
        userId: user?.id ?? null,
        action: "auth.oauth_login",
        entityType: "auth",
        entityId: user?.id ?? null,
        metadata: { method: "oauth" },
      });
    } catch (auditError) {
      await logApiError("[Auth Callback] 审计写入失败", auditError);
    }
    // D02 设备登记：登录回调即登记当前设备会话（失败不阻断跳转）
    try {
      await recordCurrentSession();
    } catch (sessionError) {
      await logApiError("[Auth Callback] 设备会话登记失败", sessionError);
    }
  }

  return NextResponse.redirect(`${origin}${next}`);
}
