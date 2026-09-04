/**
 * 团队邀请 API 路由
 * 管理团队成员的邀请发送、撤销和状态查询
 *
 * GET    /api/invitations?team_id=xxx   — 获取团队成员列表
 * POST   /api/invitations                — 发送邀请
 * DELETE /api/invitations?id=xxx         — 撤销邀请/移除成员
 */

import { NextRequest } from "next/server";
import { jsonNoStore } from "@/lib/api-response";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/rate-limit";
import { safelyRequirePermission, guardHttpStatus } from "@/lib/auth/guards";
import { logApiError } from "@/lib/api-log";
import { inviteMemberSchema } from "@/lib/validations/team";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { ROUTES } from "@/lib/constants";
import { createNotification } from "@/lib/repositories/notifications";

export const dynamic = "force-dynamic";

/**
 * GET /api/invitations
 * 获取指定团队的成员列表（含邀请信息）
 */
export async function GET(request: NextRequest) {
  const limits = await rateLimit.check(request);
  if (!limits.allowed) {
    return jsonNoStore(
      { error: "Too Many Requests", retryAfter: Math.ceil(limits.resetIn / 1000) },
      { status: 429 },
    );
  }

  const auth = await safelyRequirePermission(PERMISSIONS.team.read);
  if (!auth.success) {
    return jsonNoStore(
      { error: auth.error.message },
      { status: guardHttpStatus(auth.error) },
    );
  }

  const { searchParams } = new URL(request.url);
  const teamId = searchParams.get("team_id");
  if (!teamId) {
    return jsonNoStore({ error: "team_id is required" }, { status: 400 });
  }

  try {
    const supabase = await createClient();
    // 纵深防御：显式校验当前用户属于该团队（RLS 是兜底，这里在应用层再拦一道，
    // 防止未来策略回归导致成员 PII（email 等）越权可读）
    const { data: membership } = await supabase
      .from("team_members")
      .select("user_id")
      .eq("team_id", teamId)
      .eq("user_id", auth.data.id)
      .maybeSingle();
    if (!membership) {
      return jsonNoStore({ error: "Forbidden" }, { status: 403 });
    }

    const { data: members, error } = await supabase
      .from("team_members")
      .select(
        `
        id,
        team_id,
        user_id,
        role,
        invited_by,
        created_at,
        profiles:user_id (
          email,
          full_name,
          avatar_url
        )
      `,
      )
      .eq("team_id", teamId)
      .order("created_at", { ascending: false });

    if (error) {
      await logApiError("[Invitations API] 获取成员列表失败", error);
      return jsonNoStore({ error: "Internal server error" }, { status: 500 });
    }

    return jsonNoStore({ invitations: members ?? [] });
  } catch (error) {
    await logApiError("[Invitations API] 获取成员列表失败", error);
    return jsonNoStore({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/invitations
 * 邀请新成员加入团队
 */
export async function POST(request: NextRequest) {
  const limits = await rateLimit.check(request);
  if (!limits.allowed) {
    return jsonNoStore(
      { error: "Too Many Requests", retryAfter: Math.ceil(limits.resetIn / 1000) },
      { status: 429 },
    );
  }

  const auth = await safelyRequirePermission(PERMISSIONS.team.invite);
  if (!auth.success) {
    return jsonNoStore(
      { error: auth.error.message },
      { status: guardHttpStatus(auth.error) },
    );
  }

  try {
    const body = await request.json();
    const validated = inviteMemberSchema.safeParse(body);
    if (!validated.success) {
      return jsonNoStore(
        { error: validated.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return jsonNoStore({ error: "Not authenticated" }, { status: 401 });
    }

    // 获取当前用户的团队
    const { data: membership } = (await supabase
      .from("team_members")
      .select("team_id")
      .eq("user_id", user.id)
      .limit(1)
      .single()) as unknown as { data: { team_id: string } | null };

    if (!membership) {
      return jsonNoStore({ error: "No team found" }, { status: 404 });
    }

    const teamId = validated.data.team_id ?? membership.team_id;

    // 校验当前用户对该团队拥有 owner/admin 权限
    const { data: teamRole } = (await supabase
      .from("team_members")
      .select("role")
      .eq("team_id", teamId)
      .eq("user_id", user.id)
      .maybeSingle()) as unknown as { data: { role: string } | null };

    if (!teamRole || !["owner", "admin"].includes(teamRole.role)) {
      return jsonNoStore({ error: "Only team admins can invite members" }, { status: 403 });
    }

    // 按邮箱在 profiles 表精确查询目标用户（替代 admin.auth.admin.listUsers() 全量拉取，
    // 避免用户量大时拉取全部 auth.users；profiles.email 由注册触发器写入，与 auth.users 一致）
    const admin = createAdminClient();
    const { data: invitedProfile } = await admin
      .from("profiles")
      .select("id")
      .eq("email", validated.data.email.toLowerCase())
      .maybeSingle();

    if (!invitedProfile) {
      return jsonNoStore(
        { error: "User not found. They need to register first." },
        { status: 404 },
      );
    }

    // 检查是否已是成员
    const { data: existing } = (await supabase
      .from("team_members")
      .select("id")
      .eq("team_id", teamId)
      .eq("user_id", invitedProfile.id)
      .maybeSingle()) as unknown as { data: { id: string } | null };

    if (existing) {
      return jsonNoStore({ error: "User is already a team member" }, { status: 409 });
    }

    // 添加成员
    const { data: newMember, error: insertError } = await admin
      .from("team_members")
      .insert({
        team_id: teamId,
        user_id: invitedProfile.id,
        role: validated.data.role,
        invited_by: user.id,
      })
      .select()
      .single();

    if (insertError) {
      await logApiError("[Invitations API] 添加成员失败", insertError);
      return jsonNoStore({ error: "Internal server error" }, { status: 500 });
    }

    // 更新成员计数
    await admin
      .from("teams")
      .update({
        member_count:
          (
            await supabase
              .from("team_members")
              .select("*", { count: "exact", head: true })
              .eq("team_id", teamId)
          ).count ?? 0,
      })
      .eq("id", teamId);

    // 通知被邀请人（失败不阻断邀请主流程）
    try {
      await createNotification({
        userId: invitedProfile.id,
        type: "team_invite",
        title: "新的团队邀请",
        body: "你被邀请加入团队。",
        link: ROUTES.dashboardTeam,
        metadata: { team_id: teamId, role: validated.data.role },
      });
    } catch (notifyError) {
      await logApiError("[Invitations API] 邀请通知写入失败", notifyError);
    }

    return jsonNoStore({ invitation: newMember }, { status: 201 });
  } catch (error) {
    await logApiError("[Invitations API] 发送邀请失败", error);
    return jsonNoStore({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/invitations
 * 撤销邀请（移除团队成员）
 */
export async function DELETE(request: NextRequest) {
  const limits = await rateLimit.check(request);
  if (!limits.allowed) {
    return jsonNoStore(
      { error: "Too Many Requests", retryAfter: Math.ceil(limits.resetIn / 1000) },
      { status: 429 },
    );
  }
  const auth = await safelyRequirePermission(PERMISSIONS.team.remove);
  if (!auth.success) {
    return jsonNoStore(
      { error: auth.error.message },
      { status: guardHttpStatus(auth.error) },
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const memberId = searchParams.get("id");
    if (!memberId) {
      return jsonNoStore({ error: "Member ID is required" }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: member } = (await supabase
      .from("team_members")
      .select("team_id, role")
      .eq("id", memberId)
      .maybeSingle()) as unknown as { data: { team_id: string; role: string } | null };

    if (!member) {
      return jsonNoStore({ error: "Member not found" }, { status: 404 });
    }

    const { data: membership } = (await supabase
      .from("team_members")
      .select("role")
      .eq("team_id", member.team_id)
      .eq("user_id", auth.data.id)
      .maybeSingle()) as unknown as { data: { role: string } | null };

    if (!membership || !["owner", "admin"].includes(membership.role)) {
      return jsonNoStore({ error: "Only team admins can remove members" }, { status: 403 });
    }

    if (member.role === "owner") {
      return jsonNoStore({ error: "The team owner cannot be removed" }, { status: 403 });
    }

    const admin = createAdminClient();
    const { error } = await admin
      .from("team_members")
      .delete()
      .eq("id", memberId)
      .eq("team_id", member.team_id);

    if (error) {
      await logApiError("[Invitations API] 移除成员失败", error);
      return jsonNoStore({ error: "Internal server error" }, { status: 500 });
    }

    const { count } = await admin
      .from("team_members")
      .select("*", { count: "exact", head: true })
      .eq("team_id", member.team_id);

    await admin
      .from("teams")
      .update({ member_count: count ?? 0 })
      .eq("id", member.team_id);

    return jsonNoStore({ success: true });
  } catch (error) {
    await logApiError("[Invitations API] 撤销邀请失败", error);
    return jsonNoStore({ error: "Internal server error" }, { status: 500 });
  }
}
