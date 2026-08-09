/**
 * 团队邀请 API 路由
 * 管理团队成员的邀请发送、撤销和状态查询
 *
 * GET    /api/invitations?team_id=xxx   — 获取团队成员列表
 * POST   /api/invitations                — 发送邀请
 * DELETE /api/invitations?id=xxx         — 撤销邀请/移除成员
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/rate-limit";
import { safelyRequirePermission } from "@/lib/auth/guards";
import { inviteMemberSchema } from "@/lib/validations/team";
import { PERMISSIONS } from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";

/**
 * GET /api/invitations
 * 获取指定团队的成员列表（含邀请信息）
 */
export async function GET(request: NextRequest) {
  const limits = await rateLimit.check(request);
  if (!limits.allowed) {
    return NextResponse.json(
      { error: "Too Many Requests", retryAfter: Math.ceil(limits.resetIn / 1000) },
      { status: 429 }
    );
  }

  const auth = await safelyRequirePermission(PERMISSIONS.team.read);
  if (!auth.success) {
    return NextResponse.json({ error: auth.error.message }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const teamId = searchParams.get("team_id");
  if (!teamId) {
    return NextResponse.json({ error: "team_id is required" }, { status: 400 });
  }

  try {
    const supabase = await createClient();
    const { data: members, error } = await supabase
      .from("team_members")
      .select(`
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
      `)
      .eq("team_id", teamId)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ invitations: members ?? [] });
  } catch (error) {
    console.error("[Invitations API] 获取成员列表失败:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/invitations
 * 邀请新成员加入团队
 */
export async function POST(request: NextRequest) {
  const limits = await rateLimit.check(request);
  if (!limits.allowed) {
    return NextResponse.json(
      { error: "Too Many Requests", retryAfter: Math.ceil(limits.resetIn / 1000) },
      { status: 429 }
    );
  }

  const auth = await safelyRequirePermission(PERMISSIONS.team.invite);
  if (!auth.success) {
    return NextResponse.json({ error: auth.error.message }, { status: 403 });
  }

  try {
    const body = await request.json();
    const validated = inviteMemberSchema.safeParse(body);
    if (!validated.success) {
      return NextResponse.json(
        { error: validated.error.errors[0]?.message ?? "Invalid input" },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // 获取当前用户的团队
    const { data: membership } = await supabase
      .from("team_members")
      .select("team_id")
      .eq("user_id", user.id)
      .limit(1)
      .single() as unknown as { data: { team_id: string } | null };

    if (!membership) {
      return NextResponse.json({ error: "No team found" }, { status: 404 });
    }

    const teamId = validated.data.team_id ?? membership.team_id;

    // 校验当前用户对该团队拥有 owner/admin 权限
    const { data: teamRole } = await supabase
      .from("team_members")
      .select("role")
      .eq("team_id", teamId)
      .eq("user_id", user.id)
      .maybeSingle() as unknown as { data: { role: string } | null };

    if (!teamRole || !["owner", "admin"].includes(teamRole.role)) {
      return NextResponse.json({ error: "Only team admins can invite members" }, { status: 403 });
    }

    // 通过 Admin API 查找目标用户
    const admin = createAdminClient();
    const { data: usersList } = await admin.auth.admin.listUsers();
    const invitedUser = usersList.users.find((u) => u.email === validated.data.email);

    if (!invitedUser) {
      return NextResponse.json({ error: "User not found. They need to register first." }, { status: 404 });
    }

    // 检查是否已是成员
    const { data: existing } = await supabase
      .from("team_members")
      .select("id")
      .eq("team_id", teamId)
      .eq("user_id", invitedUser.id)
      .maybeSingle() as unknown as { data: { id: string } | null };

    if (existing) {
      return NextResponse.json({ error: "User is already a team member" }, { status: 409 });
    }

    // 添加成员
    const { data: newMember, error: insertError } = await admin
      .from("team_members")
      .insert({
        team_id: teamId,
        user_id: invitedUser.id,
        role: validated.data.role,
        invited_by: user.id,
      })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    // 更新成员计数
    await admin
      .from("teams")
      .update({ member_count: (await supabase.from("team_members").select("*", { count: "exact", head: true }).eq("team_id", teamId)).count ?? 0 })
      .eq("id", teamId);

    return NextResponse.json({ invitation: newMember }, { status: 201 });
  } catch (error) {
    console.error("[Invitations API] 发送邀请失败:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/invitations
 * 撤销邀请（移除团队成员）
 */
export async function DELETE(request: NextRequest) {
  const auth = await safelyRequirePermission(PERMISSIONS.team.remove);
  if (!auth.success) {
    return NextResponse.json({ error: auth.error.message }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const memberId = searchParams.get("id");
    if (!memberId) {
      return NextResponse.json({ error: "Member ID is required" }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: member } = await supabase
      .from("team_members")
      .select("team_id, role")
      .eq("id", memberId)
      .maybeSingle() as unknown as { data: { team_id: string; role: string } | null };

    if (!member) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    const { data: membership } = await supabase
      .from("team_members")
      .select("role")
      .eq("team_id", member.team_id)
      .eq("user_id", auth.data.id)
      .maybeSingle() as unknown as { data: { role: string } | null };

    if (!membership || !["owner", "admin"].includes(membership.role)) {
      return NextResponse.json({ error: "Only team admins can remove members" }, { status: 403 });
    }

    if (member.role === "owner") {
      return NextResponse.json({ error: "The team owner cannot be removed" }, { status: 403 });
    }

    const admin = createAdminClient();
    const { error } = await admin
      .from("team_members")
      .delete()
      .eq("id", memberId)
      .eq("team_id", member.team_id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const { count } = await admin
      .from("team_members")
      .select("*", { count: "exact", head: true })
      .eq("team_id", member.team_id);

    await admin
      .from("teams")
      .update({ member_count: count ?? 0 })
      .eq("id", member.team_id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Invitations API] 撤销邀请失败:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
