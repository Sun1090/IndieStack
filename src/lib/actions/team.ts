/**
 * 团队管理服务端操作
 * 包含创建团队、邀请成员、移除成员等 Server Actions
 */
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { findUserIdByEmail } from "@/lib/repositories/profiles";
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

/**
 * Get the current user's team.
 */
export async function getCurrentTeam() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  // Get the team the user belongs to (first one)
  const { data: membership } = (await supabase
    .from("team_members")
    .select("team_id")
    .eq("user_id", user.id)
    .limit(1)
    .single()) as unknown as { data: { team_id: string } | null; error: null };

  if (!membership) return null;

  const { data: team } = (await supabase
    .from("teams")
    .select("*")
    .eq("id", membership.team_id)
    .single()) as unknown as {
    data: Database["public"]["Tables"]["teams"]["Row"] | null;
    error: null;
  };

  return team;
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
    console.error("[createTeam] 创建团队失败:", teamError);
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
    console.error("[createTeam] 添加所有者失败，已回滚:", memberError);
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

  const team = await getCurrentTeam();
  if (!team) {
    return fail("noTeam");
  }

  // Check if user is admin/owner
  const { data: membership } = (await supabase
    .from("team_members")
    .select("role")
    .eq("team_id", team.id)
    .eq("user_id", user.id)
    .maybeSingle()) as unknown as { data: { role: string } | null; error: null };

  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return fail("onlyAdminsInvite");
  }

  // 按邮箱在 profiles 表精确查询目标用户（经 Repository，service_role 绕过 RLS；
  // profiles.email 由注册触发器写入，与 auth.users 一致）
  const invitedProfileId = await findUserIdByEmail(validated.data.email);

  if (!invitedProfileId) {
    return fail("userNotFound");
  }

  // Check if already a member
  const { data: existing } = (await supabase
    .from("team_members")
    .select("id")
    .eq("team_id", team.id)
    .eq("user_id", invitedProfileId)
    .single()) as unknown as { data: { id: string } | null; error: null };

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
    console.error("[inviteMember] 添加成员失败:", inviteError);
    return fail("databaseError");
  }

  // Recalculate member count instead of trusting a cached value
  const { count } = await admin
    .from("team_members")
    .select("*", { count: "exact", head: true })
    .eq("team_id", team.id);

  await admin
    .from("teams")
    .update({ member_count: count ?? 1 })
    .eq("id", team.id);

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

  const team = await getCurrentTeam();
  if (!team) {
    return fail("noTeam");
  }

  const { data: currentMembership } = (await supabase
    .from("team_members")
    .select("role")
    .eq("team_id", team.id)
    .eq("user_id", user.id)
    .maybeSingle()) as unknown as { data: { role: string } | null; error: null };

  if (!currentMembership || !["owner", "admin"].includes(currentMembership.role)) {
    return fail("onlyAdminsRemove");
  }

  const admin = createAdminClient();
  const { data: targetMember } = (await admin
    .from("team_members")
    .select("role")
    .eq("id", memberId)
    .eq("team_id", team.id)
    .maybeSingle()) as unknown as { data: { role: string } | null; error: null };

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
    console.error("[removeMember] 移除成员失败:", error);
    return fail("databaseError");
  }

  // Recalculate member count after deletion
  const { count } = await admin
    .from("team_members")
    .select("*", { count: "exact", head: true })
    .eq("team_id", team.id);

  await admin
    .from("teams")
    .update({ member_count: count ?? 0 })
    .eq("id", team.id);

  revalidatePath(ROUTES.dashboardTeam);
  return ok();
}
