/**
 * 团队管理服务端操作
 * 包含创建团队、邀请成员、移除成员等 Server Actions
 */
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { findUserIdByEmail } from "@/lib/repositories/profiles";
import { syncTeamMemberCount } from "@/lib/repositories/teams";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createTeamSchema,
  inviteMemberSchema,
  type CreateTeamInput,
  type InviteMemberInput,
} from "@/lib/validations/team";
import { ROUTES } from "@/lib/constants";
import type { Database } from "@/lib/supabase/database.types";
import type { ActionResult } from "@/lib/types/action-result";
import { fail, ok } from "@/lib/types/action-result";
import { logActionError } from "@/lib/api-log";

/**
 * 当前用户的团队解析结果。三种情况必须分开说：`no-team` 是「这个人确实没有团队」，
 * `error` 是「我们没读到」。
 *
 * 原先这里返回 `team | null`，两处断言里明写着 `error: null`——于是数据库抖动一次，
 * 三个团队动作就齐刷刷答成「你没有团队」（`noTeam`），而那是个终态：用户会去创建第二个团队，
 * 而不是刷新重试。断言里那个 `error: null` 不是「保留了错误通道」，是断言它不可能出现。
 */
export type TeamLookup =
  | { status: "ok"; team: Database["public"]["Tables"]["teams"]["Row"] }
  | { status: "no-team" }
  | { status: "error"; message: string };

/** Get the current user's team. */
export async function getCurrentTeam(): Promise<TeamLookup> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { status: "no-team" };

  // Get the team the user belongs to (first one)
  // `.maybeSingle()` 而不是 `.single()`：后者在「确实没有这一行」这个正常结果上就会给 error，
  // 而这里现在真的要看 `error`——不换成 maybeSingle 的话，没团队会被说成读失败。
  const { data: membership, error: membershipError } = await supabase
    .from("team_members")
    .select("team_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (membershipError) return { status: "error", message: membershipError.message };
  if (!membership) return { status: "no-team" };

  const { data: team, error: teamError } = await supabase
    .from("teams")
    .select("*")
    .eq("id", membership.team_id)
    .maybeSingle();

  if (teamError) return { status: "error", message: teamError.message };
  // 有成员行却没有团队行是数据不一致（外键不该允许），不是读失败：照旧按「没有团队」回答。
  return team ? { status: "ok", team } : { status: "no-team" };
}

/**
 * 三个团队动作共用的解析：把 `TeamLookup` 折成「拿到团队」或「一个已经写好日志的失败」。
 * 分派规则只有一句——读失败是 `databaseError`（该重试），没有团队是 `noTeam`（该去创建）。
 */
async function requireTeam(scope: string): Promise<
  { team: Database["public"]["Tables"]["teams"]["Row"] } | { failure: ActionResult }
> {
  const lookup = await getCurrentTeam();
  if (lookup.status === "ok") return { team: lookup.team };
  if (lookup.status === "no-team") return { failure: fail("noTeam") };
  await logActionError(`[${scope}] 团队归属读取失败`, new Error(lookup.message));
  return { failure: fail("databaseError") };
}

/**
 * Create a new team.
 */
export async function createTeam(input: CreateTeamInput): Promise<
    ActionResult<{ team: Database["public"]["Tables"]["teams"]["Row"] }>
  > {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return fail("notAuthenticated");
  }

  const validated = createTeamSchema.safeParse(input);
  if (!validated.success) {
    return fail(validated.error.issues[0]?.message ?? "invalidInput");
  }

  const admin = createAdminClient();

  // Create team
  const { data: team, error: teamError } = await admin
    .from("teams")
    .insert({
      name: validated.data.name,
      slug: validated.data.slug,
      owner_id: user.id,
    })
    .select()
    .single();

  if (teamError) {
    if (teamError.code === "23505") {
      return fail("teamSlugExists");
    }
    await logActionError("[createTeam] 创建团队失败", teamError);
    return fail("databaseError");
  }

  // Add creator as owner
  const { error: memberError } = await admin.from("team_members").insert({
    team_id: team.id,
    user_id: user.id,
    role: "owner",
  });

  if (memberError) {
    // 回滚刚创建的团队，避免留下没有所有者的孤儿团队
    await admin.from("teams").delete().eq("id", team.id);
    await logActionError("[createTeam] 添加所有者失败，已回滚", memberError);
    return fail("databaseError");
  }

  revalidatePath(ROUTES.dashboardTeam);
  return ok({ team });
}

/**
 * Invite a member to the team.
 */
export async function inviteMember(input: InviteMemberInput): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return fail("notAuthenticated");
  }

  const validated = inviteMemberSchema.safeParse(input);
  if (!validated.success) {
    return fail(validated.error.issues[0]?.message ?? "invalidInput");
  }

  const resolved = await requireTeam("inviteMember");
  if ("failure" in resolved) return resolved.failure;
  const team = resolved.team;

  // Check if user is admin/owner
  // 「查不到成员行」与「查不了」必须分开：抹掉 error 会让一次故障答成「你没有权限」，
  // 那是凭空造出来的一条权限拒绝。
  const { data: membership, error: membershipError } = await supabase
    .from("team_members")
    .select("role")
    .eq("team_id", team.id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (membershipError) {
    await logActionError("[inviteMember] 权限查询失败", membershipError);
    return fail("databaseError");
  }

  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return fail("onlyAdminsInvite");
  }

  // 按邮箱在 profiles 表精确查询目标用户（经 Repository，service_role 绕过 RLS；
  // profiles.email 由注册触发器写入，与 auth.users 一致）
  let invitedProfileId: string | null;
  try {
    invitedProfileId = await findUserIdByEmail(validated.data.email);
  } catch (error) {
    await logActionError("[inviteMember] 邮箱查询失败", error);
    return fail("databaseError");
  }

  if (!invitedProfileId) {
    return fail("userNotFound");
  }

  // Check if already a member
  // 用 maybeSingle：`.single()` 在「没有这一行」这个正常结果上就会返回 error，
  // 旧代码因此把它 `as unknown as { error: null }` 抹掉——错误通道和「不是成员」混在一起，
  // 真出故障时就一路走到 INSERT，让唯一约束去替权限逻辑说话。
  const { data: existing, error: existingError } = await supabase
    .from("team_members")
    .select("id")
    .eq("team_id", team.id)
    .eq("user_id", invitedProfileId)
    .maybeSingle();

  if (existingError) {
    await logActionError("[inviteMember] 成员查重失败", existingError);
    return fail("databaseError");
  }

  if (existing) {
    return fail("alreadyMember");
  }

  const admin = createAdminClient();

  const { error: inviteError } = await admin.from("team_members").insert({
    team_id: team.id,
    user_id: invitedProfileId,
    role: validated.data.role,
    invited_by: user.id,
  });

  if (inviteError) {
    await logActionError("[inviteMember] 添加成员失败", inviteError);
    return fail("databaseError");
  }

  // 重算派生缓存；读不到数字就保持旧值，不写一个猜出来的数（见 repositories/teams.ts）
  const synced = await syncTeamMemberCount(team.id);
  if (synced !== "synced") {
    await logActionError(
      `[inviteMember] 成员已加入，但 teams.member_count 未更新（${synced}）：面板上的人数会偏旧`,
      new Error("member_count_sync_failed"),
    );
  }

  revalidatePath(ROUTES.dashboardTeam);
  return ok();
}

/**
 * Remove a member from the team.
 */
export async function removeMember(memberId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return fail("notAuthenticated");
  }

  const resolved = await requireTeam("removeMember");
  if ("failure" in resolved) return resolved.failure;
  const team = resolved.team;

  const { data: currentMembership, error: currentMembershipError } = await supabase
    .from("team_members")
    .select("role")
    .eq("team_id", team.id)
    .eq("user_id", user.id)
    .maybeSingle();

  // 「读不到我的角色」不是「我没有权限」：这条故障如果落到下面的权限判断，
  // 管理员会在一次抖动里收到 onlyAdminsRemove，而重试才是正确答案。
  if (currentMembershipError) {
    await logActionError("[removeMember] 权限查询失败", currentMembershipError);
    return fail("databaseError");
  }

  if (!currentMembership || !["owner", "admin"].includes(currentMembership.role)) {
    return fail("onlyAdminsRemove");
  }

  const admin = createAdminClient();
  const { data: targetMember, error: targetMemberError } = await admin
    .from("team_members")
    .select("role")
    .eq("id", memberId)
    .eq("team_id", team.id)
    .maybeSingle();

  // 同样地，service_role 那一路读失败也不能答成「成员不存在」——那是终态，
  // 用户会以为这个人早就被移走了。
  if (targetMemberError) {
    await logActionError("[removeMember] 目标成员读取失败", targetMemberError);
    return fail("databaseError");
  }

  if (!targetMember) {
    return fail("memberNotFound");
  }

  if (targetMember.role === "owner") {
    return fail("ownerCannotRemove");
  }

  const { error } = await admin
    .from("team_members")
    .delete()
    .eq("id", memberId)
    .eq("team_id", team.id);

  if (error) {
    await logActionError("[removeMember] 移除成员失败", error);
    return fail("databaseError");
  }

  // 重算派生缓存；读不到数字就保持旧值（成员已经移走了，写 0 会把整队人抹掉）
  const synced = await syncTeamMemberCount(team.id);
  if (synced !== "synced") {
    await logActionError(
      `[removeMember] 成员已移除，但 teams.member_count 未更新（${synced}）：面板上的人数会偏新`,
      new Error("member_count_sync_failed"),
    );
  }

  revalidatePath(ROUTES.dashboardTeam);
  return ok();
}

/**
 * 更新成员角色（仅 owner/admin；不能修改 owner 角色）。
 */
export async function updateMemberRole(
  memberId: string,
  newRole: "admin" | "member",
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return fail("notAuthenticated");

  const resolved = await requireTeam("updateMemberRole");
  if ("failure" in resolved) return resolved.failure;
  const team = resolved.team;

  const { data: currentMembership, error: currentMembershipError } = await supabase
    .from("team_members")
    .select("role")
    .eq("team_id", team.id)
    .eq("user_id", user.id)
    .maybeSingle();

  // 与 removeMember 同一条线：读失败答成 `onlyAdminsInvite` 是凭空造出一条权限拒绝。
  if (currentMembershipError) {
    await logActionError("[updateMemberRole] 权限查询失败", currentMembershipError);
    return fail("databaseError");
  }

  if (!currentMembership || !["owner", "admin"].includes(currentMembership.role)) {
    return fail("onlyAdminsInvite");
  }

  // 目标成员必须是本团队的普通成员/admin（不允许动 owner）
  const { data: target, error: targetError } = await supabase
    .from("team_members")
    .select("role")
    .eq("id", memberId)
    .eq("team_id", team.id)
    .maybeSingle();

  // 「没读到」不是「没有这个人」：memberNotFound 是终态，重试不会变。
  if (targetError) {
    await logActionError("[updateMemberRole] 目标成员读取失败", targetError);
    return fail("databaseError");
  }

  if (!target) return fail("memberNotFound");
  if (target.role === "owner") return fail("ownerCannotRemove");

  const { error } = await supabase
    .from("team_members")
    .update({ role: newRole })
    .eq("id", memberId)
    .eq("team_id", team.id);

  if (error) {
    await logActionError("[updateMemberRole] 失败", error);
    return fail("databaseError");
  }

  revalidatePath(ROUTES.dashboardTeam);
  return ok();
}
