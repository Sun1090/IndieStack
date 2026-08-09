/**
 * 团队管理服务端操作
 * 包含创建团队、邀请成员、移除成员等 Server Actions
 */
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createTeamSchema, inviteMemberSchema, type CreateTeamInput, type InviteMemberInput } from "@/lib/validations/team";
import { ROUTES } from "@/lib/constants";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Get the current user's team.
 */
export async function getCurrentTeam() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return null;

  // Get the team the user belongs to (first one)
  const { data: membership } = await supabase
    .from("team_members")
    .select("team_id")
    .eq("user_id", user.id)
    .limit(1)
    .single() as unknown as { data: { team_id: string } | null; error: null };

  if (!membership) return null;

  const { data: team } = await supabase
    .from("teams")
    .select("*")
    .eq("id", membership.team_id)
    .single() as unknown as { data: Database["public"]["Tables"]["teams"]["Row"] | null; error: null };

  return team;
}

/**
 * Get all members of a team.
 */
export async function getTeamMembers(teamId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return [];

  const { data: members } = await supabase
    .from("team_members")
    .select(`
      id,
      role,
      created_at,
      user_id,
      profiles:user_id (
        id,
        email,
        full_name,
        avatar_url
      )
    `)
    .eq("team_id", teamId);

  return members ?? [];
}

/**
 * Create a new team.
 */
export async function createTeam(input: CreateTeamInput) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  const validated = createTeamSchema.safeParse(input);
  if (!validated.success) {
    return { error: validated.error.errors[0]?.message ?? "Invalid input" };
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
      return { error: "A team with this slug already exists" };
    }
    return { error: teamError.message };
  }

  // Add creator as owner
  const { error: memberError } = await admin
    .from("team_members")
    .insert({
      team_id: team.id,
      user_id: user.id,
      role: "owner",
    });

  if (memberError) {
    return { error: memberError.message };
  }

  revalidatePath(ROUTES.dashboardTeam);
  return { success: true, team };
}

/**
 * Invite a member to the team.
 */
export async function inviteMember(input: InviteMemberInput) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  const validated = inviteMemberSchema.safeParse(input);
  if (!validated.success) {
    return { error: validated.error.errors[0]?.message ?? "Invalid input" };
  }

  const team = await getCurrentTeam();
  if (!team) {
    return { error: "No team found" };
  }

  // Check if user is admin/owner
  const { data: membership } = await supabase
    .from("team_members")
    .select("role")
    .eq("team_id", team.id)
    .eq("user_id", user.id)
    .single() as unknown as { data: { role: string } | null; error: null };

  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return { error: "Only team admins can invite members" };
  }

  // Find user by email
  const admin = createAdminClient();
  const { data: users } = await admin.auth.admin.listUsers();
  const invitedUser = users.users.find((u) => u.email === validated.data.email);

  if (!invitedUser) {
    return { error: "User not found. They need to register first." };
  }

  // Check if already a member
  const { data: existing } = await supabase
    .from("team_members")
    .select("id")
    .eq("team_id", team.id)
    .eq("user_id", invitedUser.id)
    .single() as unknown as { data: { id: string } | null; error: null };

  if (existing) {
    return { error: "User is already a team member" };
  }

  const { error: inviteError } = await admin
    .from("team_members")
    .insert({
      team_id: team.id,
      user_id: invitedUser.id,
      role: validated.data.role,
      invited_by: user.id,
    });

  if (inviteError) {
    return { error: inviteError.message };
  }

  // Update member count
  await admin
    .from("teams")
    .update({ member_count: team.member_count + 1 })
    .eq("id", team.id);

  revalidatePath(ROUTES.dashboardTeam);
  return { success: true };
}

/**
 * Remove a member from the team.
 */
export async function removeMember(memberId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  const team = await getCurrentTeam();
  if (!team) {
    return { error: "No team found" };
  }

  const { error } = await supabase
    .from("team_members")
    .delete()
    .eq("id", memberId)
    .eq("team_id", team.id);

  if (error) {
    return { error: error.message };
  }

  // Update member count
  const admin = createAdminClient();
  await admin
    .from("teams")
    .update({ member_count: Math.max(0, team.member_count - 1) })
    .eq("id", team.id);

  revalidatePath(ROUTES.dashboardTeam);
  return { success: true };
}

/**
 * Leave the current team.
 */
export async function leaveTeam(teamId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  const { error } = await supabase
    .from("team_members")
    .delete()
    .eq("team_id", teamId)
    .eq("user_id", user.id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(ROUTES.dashboard);
  return { success: true };
}
