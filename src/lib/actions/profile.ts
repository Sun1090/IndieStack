/**
 * 个人资料服务端操作
 * 包含更新用户资料、上传头像等 Server Actions
 */
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { profileUpdateSchema, profileSettingsSchema, type ProfileUpdateInput } from "@/lib/validations/profile";
import { ROUTES } from "@/lib/constants";
import type { Database } from "@/lib/supabase/database.types";

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
    return { error: "notAuthenticated" };
  }

  const validated = profileUpdateSchema.safeParse(input);
  if (!validated.success) {
    return { error: validated.error.errors[0]?.message ?? "invalidInput" };
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
    console.error("[updateProfile] 更新资料失败:", error);
    return { error: "databaseError" };
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
    return { error: "notAuthenticated" };
  }

  // 白名单 + 类型/长度校验：拒绝任意字段值直接写入 profiles
  const parsed = profileSettingsSchema.safeParse({
    fullName: formData.get("fullName")?.toString(),
    bio: formData.get("bio")?.toString(),
    timezone: formData.get("timezone")?.toString(),
    language: formData.get("language")?.toString(),
  });
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "invalidInput" };
  }

  const { error } = await supabase
    .from("profiles")
    // @ts-ignore - Supabase update type inference limitation
    .update({
      full_name: parsed.data.fullName,
      bio: parsed.data.bio ?? null,
      timezone: parsed.data.timezone ?? null,
      language: parsed.data.language ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id);

  if (error) {
    console.error("[updateProfileSettings] 更新资料设置失败:", error);
    return { error: "databaseError" };
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
