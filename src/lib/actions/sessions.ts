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
import { logActionError } from "@/lib/api-log";

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
    await logActionError("[recordCurrentSession] 会话登记失败", error);
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

  const { data: row, error: readError } = await supabase
    .from("user_sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("user_id", user.id)
    .maybeSingle();
  // 「这台设备没有记录」与「我们没查到它的记录」是两件事。共用 `sessionNotFound` 不只是一次
  // 措辞问题：那条文案说的是「它可能已经被吊销了」，于是一次数据库抖动会让用户以为某个设备
  // 已经登出，而那个会话可能还好端端地活着——他既不会重试，也不会去查第二遍。
  if (readError) {
    await logActionError("[revokeSession] 会话记录读取失败", readError);
    return fail("databaseError");
  }
  if (!row) return fail("sessionNotFound");

  // 说明：当前 @supabase/auth-js 的 admin API 仅有 signOut(jwt, scope)，而按**会话**吊销需要
  // 目标会话自己的 JWT（服务端拿不到）；GoTrue 也没有「按 session id 吊销」的公开端点。
  // 因此这里的「单设备吊销」**只是把这台设备从列表里删掉**，不是让它的令牌失效：
  // 那台设备手里的 refresh token 仍然有效，可以继续换新的 access token。
  // 真正能让人下线的是 `signOutOthers`（`auth.signOut({ scope: "others" })`，在 GoTrue 侧作废
  // 其它会话的 refresh token）。
  //
  // 这一点必须与 UI 文案一致：文案此前写着「吊销后该设备将被登出」，而那句话是做不到的
  // ——一个做不到的安全承诺比没有更糟，用户会以为被盗设备已经下线而不去用真正的开关。
  // 现在文案与这条注释说同一件事（`dashboard.settings.sections.security.devicesDesc`）。
  const { error } = await supabase.from("user_sessions").delete().eq("id", sessionId);
  if (error) {
    await logActionError("[revokeSession] 会话记录删除失败", error);
    return fail("databaseError");
  }

  revalidatePath(ROUTES.dashboardSettings);
  return ok();
}
