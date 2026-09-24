/**
 * Supabase 认证回调 API 路由
 * 处理 OAuth 和魔法链接登录回调
 */

import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ROUTES } from "@/lib/constants";
import { getSafeRedirect } from "@/lib/safe-redirect";
import { appendAuditLog } from "@/lib/repositories/audit-logs";
import { isRetryableSessionReadFailure } from "@/lib/auth/session-error";
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
    const { data, error: sessionError } = await supabase.auth.getUser();
    const readFailed = isRetryableSessionReadFailure(sessionError);
    if (readFailed) {
      await logApiError("[Auth Callback] 会话交换成功但用户读取失败", sessionError);
    }
    try {
      await appendAuditLog({
        userId: data.user?.id ?? null,
        action: "auth.oauth_login",
        entityType: "auth",
        entityId: data.user?.id ?? null,
        // 走到这里交换是**成功**的，所以这一行的 `user_id` 为空只可能是「没读到」而不是
        // 「本来就没有会话」。两者在 `user_id` 列上同形，对读审计的人是两件相反的事：
        // 一次成功的登录被记成没有主人。标出来，不加列、不动迁移（与 actions/audit.ts 同一约定）。
        // 判据同样只看「能叫出名字的读取故障」——匿名访客的 getUser() 也带一个 error。
        metadata: readFailed ? { method: "oauth", sessionReadFailed: true } : { method: "oauth" },
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
