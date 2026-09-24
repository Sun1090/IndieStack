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
import { notifyUser } from "@/lib/email-notify";
import { syncTeamMemberCount } from "@/lib/repositories/teams";

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
    const { data: membership, error: membershipError } = await supabase
      .from("team_members")
      .select("user_id")
      .eq("team_id", teamId)
      .eq("user_id", auth.data.id)
      .maybeSingle();

    // 这一处与下面几处都没有类型断言，所以 C08-b 的门禁看不见；但它的失败方向是同一件事：
    // 读失败会沿着 `!membership` 长成 403「Forbidden」，把一个权限没变过的人挡在团队外，
    // 而他该做的只是重试。`error` 必须先于「有没有这一行」被判断。
    if (membershipError) {
      await logApiError("[Invitations API] 团队成员身份读取失败", membershipError);
      return jsonNoStore({ error: "Could not verify your team membership. Please retry." }, { status: 503 });
    }

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

    // 获取当前用户的团队。`.limit(1).single()` 会把「这个用户没有团队」也当成 error 抛出来，
    // 与真正的读取故障同形，所以这里用 maybeSingle：缺行是合法状态，error 才是「我们没读到」。
    const { data: membership, error: membershipError } = await supabase
      .from("team_members")
      .select("team_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    // 三处读取（团队归属 / 我在该团队的角色 / 对方是否已是成员）都是**授权与幂等判定**的输入，
    // 读失败时必须说「没读到」而不是顺着 `!data` 那条分支答成「你没有团队」或「你不是管理员」：
    // 后者会让用户以为权限被改了，而真正该做的只是重试一次。
    if (membershipError) {
      await logApiError("[Invitations API] 发起人团队归属读取失败", membershipError);
      return jsonNoStore({ error: "Could not read your team membership. Please retry." }, { status: 503 });
    }

    if (!membership) {
      return jsonNoStore({ error: "No team found" }, { status: 404 });
    }

    const teamId = validated.data.team_id ?? membership.team_id;

    // 校验当前用户对该团队拥有 owner/admin 权限
    const { data: teamRole, error: teamRoleError } = await supabase
      .from("team_members")
      .select("role")
      .eq("team_id", teamId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (teamRoleError) {
      await logApiError("[Invitations API] 发起人在该团队的角色读取失败", teamRoleError);
      return jsonNoStore({ error: "Could not verify your team role. Please retry." }, { status: 503 });
    }

    if (!teamRole || !["owner", "admin"].includes(teamRole.role)) {
      return jsonNoStore({ error: "Only team admins can invite members" }, { status: 403 });
    }

    // 按邮箱在 profiles 表精确查询目标用户（替代 admin.auth.admin.listUsers() 全量拉取，
    // 避免用户量大时拉取全部 auth.users；profiles.email 由注册触发器写入，与 auth.users 一致）
    const admin = createAdminClient();
    const { data: invitedProfile, error: profileError } = await admin
      .from("profiles")
      .select("id")
      .eq("email", validated.data.email.toLowerCase())
      .maybeSingle();

    // 这一处没有类型断言，所以 C08-b 的门禁看不见它，但它的失败方向与上面几处一模一样：
    // 读失败会长成「这个人还没注册」，于是用户被劝着让对方去注册，而真正发生的是一次数据库抖动。
    if (profileError) {
      await logApiError("[Invitations API] 被邀请人读取失败", profileError);
      return jsonNoStore({ error: "Could not look up that user. Please retry." }, { status: 503 });
    }

    if (!invitedProfile) {
      return jsonNoStore(
        { error: "User not found. They need to register first." },
        { status: 404 },
      );
    }

    // 检查是否已是成员。读失败时不能当作「还不是成员」往下走：`team_members` 上有
    // `unique(team_id, user_id)`（迁移 001），所以后果不是重复插入而是撞约束、
    // 报一个与真实原因无关的 500 —— 但仍然要说实话：我们没能确认。
    const { data: existing, error: existingError } = await supabase
      .from("team_members")
      .select("id")
      .eq("team_id", teamId)
      .eq("user_id", invitedProfile.id)
      .maybeSingle();

    if (existingError) {
      await logApiError("[Invitations API] 现有成员关系读取失败", existingError);
      return jsonNoStore({ error: "Could not check existing membership. Please retry." }, { status: 503 });
    }

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

    // 更新成员计数（派生缓存：读不到真实行数就保持旧值，见 repositories/teams.ts）
    const synced = await syncTeamMemberCount(teamId);
    if (synced !== "synced") {
      await logApiError(
        `[Invitations API] 成员已加入，但 teams.member_count 未更新（${synced}）：面板上的人数会偏旧`,
        new Error("member_count_sync_failed"),
      );
    }

    // 通知被邀请人（失败不阻断邀请主流程）
    try {
      await notifyUser({
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
    const { data: member, error: memberError } = await supabase
      .from("team_members")
      .select("team_id, role")
      .eq("id", memberId)
      .maybeSingle();

    // 「查不到这个人」要 404，「没查到」要 503：前者是终态，后者重试就好。
    // 顺着 `!member` 走下去会把一次故障报成「这个成员不存在」。
    if (memberError) {
      await logApiError("[Invitations API] 目标成员读取失败", memberError);
      return jsonNoStore({ error: "Could not read that team member. Please retry." }, { status: 503 });
    }

    if (!member) {
      return jsonNoStore({ error: "Member not found" }, { status: 404 });
    }

    const { data: membership, error: membershipError } = await supabase
      .from("team_members")
      .select("role")
      .eq("team_id", member.team_id)
      .eq("user_id", auth.data.id)
      .maybeSingle();

    if (membershipError) {
      await logApiError("[Invitations API] 操作人在该团队的角色读取失败", membershipError);
      return jsonNoStore({ error: "Could not verify your team role. Please retry." }, { status: 503 });
    }

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

    const synced = await syncTeamMemberCount(member.team_id);
    if (synced !== "synced") {
      await logApiError(
        `[Invitations API] 成员已移除，但 teams.member_count 未更新（${synced}）：面板上的人数会偏新`,
        new Error("member_count_sync_failed"),
      );
    }

    return jsonNoStore({ success: true });
  } catch (error) {
    await logApiError("[Invitations API] 撤销邀请失败", error);
    return jsonNoStore({ error: "Internal server error" }, { status: 500 });
  }
}
