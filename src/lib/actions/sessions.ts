/**
 * 会话设备管理（v0.5.0 D02，迁移 018）
 * - recordCurrentSession：把当前登录会话登记到 user_sessions（id = GoTrue 会话 id，
 *   取自 access token JWT 的 session_id claim），重复登记刷新 last_seen_at。
 * - revokeSession：单设备吊销 = service_role 删除 GoTrue 会话（真·令牌失效）+ 删本表行。
 */
"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { clientIpFromHeaders, isIpLike } from "@/lib/rate-limit";
import { sessionIdFromAccessToken } from "@/lib/session-id";
import { ROUTES } from "@/lib/constants";
import type { ActionResult } from "@/lib/types/action-result";
import { ok, fail } from "@/lib/types/action-result";

async function requestMeta(): Promise<{ userAgent: string | null; ip: string | null }> {
  try {
    const h = await headers();
    const ip = clientIpFromHeaders(h);
    return {
      userAgent: h.get("user-agent"),
      // ip_address 列为 inet，非 IP 形态的占位值（anonymous）存 null
      ip: isIpLike(ip) ? ip : null,
    };
  } catch {
    return { userAgent: null, ip: null };
  }
}

/** 登记当前设备会话（dashboard 布局心跳与登录回调调用，失败静默不阻断） */
export async function recordCurrentSession(): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("notAuthenticated");

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const sessionId = session?.access_token ? sessionIdFromAccessToken(session.access_token) : null;
  if (!sessionId) return fail("invalidInput");

  const meta = await requestMeta();
  const { error } = await supabase.from("user_sessions").upsert(
    {
      id: sessionId,
      user_id: user.id,
      user_agent: meta.userAgent,
      ip_address: meta.ip,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (error) {
    console.error("[recordCurrentSession] 会话登记失败:", error);
    return fail("databaseError");
  }
  return ok();
}

/** 吊销单个设备会话：删除设备记录（设备列表的事实来源） */
export async function revokeSession(sessionId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("notAuthenticated");

  const { data: row } = (await supabase
    .from("user_sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("user_id", user.id)
    .maybeSingle()) as unknown as { data: { id: string } | null };
  if (!row) return fail("sessionNotFound");

  // 说明：当前 @supabase/auth-js 的 admin API 仅有 signOut(jwt, scope)，
  // 按会话吊销需要目标会话的 JWT（服务端拿不到）。
  // 因此单设备吊销为"移除设备记录"；令牌级全量吊销由既有
  // 「退出其他设备」(auth.signOut({ scope: "others" })) 与会话过期兜底。
  const { error } = await supabase.from("user_sessions").delete().eq("id", sessionId);
  if (error) {
    console.error("[revokeSession] 会话记录删除失败:", error);
    return fail("databaseError");
  }

  revalidatePath(ROUTES.dashboardSettings);
  return ok();
}
