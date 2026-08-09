/**
 * 个人资料服务端操作
 * 包含更新用户资料、上传头像等 Server Actions
 */
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { profileUpdateSchema, type ProfileUpdateInput } from "@/lib/validations/profile";
import { ROUTES } from "@/lib/constants";
import type { Database } from "@/lib/supabase/database.types";
import type { PostgrestError } from "@supabase/supabase-js";

/**
 * Get the current user's profile with cached data.
 */
export async function getProfile() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return profile;
}

/**
 * Update the current user's profile.
 */
export async function updateProfile(input: ProfileUpdateInput) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  const validated = profileUpdateSchema.safeParse(input);
  if (!validated.success) {
    return { error: validated.error.errors[0]?.message ?? "Invalid input" };
  }

  const { error } = await supabase
    .from("profiles")
    // @ts-ignore - Supabase update type inference limitation
    .update({
      full_name: validated.data.fullName ?? undefined,
      avatar_url: validated.data.avatarUrl ?? undefined,
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(ROUTES.dashboardProfile);
  revalidatePath(ROUTES.dashboard);
  return { success: true };
}

/**
 * Update profile settings (full bio, timezone, language).
 */
export async function updateProfileSettings(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  const fullName = formData.get("fullName") as string;
  const bio = formData.get("bio") as string;
  const timezone = formData.get("timezone") as string;
  const language = formData.get("language") as string;

  const { error } = await supabase
    .from("profiles")
    // @ts-ignore - Supabase update type inference limitation
    .update({
      full_name: fullName,
      bio,
      timezone,
      language,
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(ROUTES.dashboardProfile);
  return { success: true };
}

/**
 * Check if a user has a profile; if not, create one (admin bypass).
 */
export async function ensureProfile() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return null;

  const profile = await getProfile();
  if (profile) return profile;

  // Create profile via admin client
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .insert({
      id: user.id,
      email: user.email,
      full_name: user.user_metadata?.full_name ?? null,
      avatar_url: user.user_metadata?.avatar_url ?? null,
    })
    .select()
    .single();

  if (error) {
    console.error("Failed to create profile:", error);
    return null;
  }

  return data;
}
