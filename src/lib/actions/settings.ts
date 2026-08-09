/**
 * 设置服务端操作
 * 包含更新密码、通知偏好等 Server Actions
 */
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { notificationSettingsSchema, appearanceSettingsSchema } from "@/lib/validations/settings";
import { ROUTES } from "@/lib/constants";
import type { Database } from "@/lib/supabase/database.types";
import type { PostgrestError } from "@supabase/supabase-js";

/**
 * Update notification settings for the current user.
 */
export async function updateNotificationSettings(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  const settings = {
    emailNotifications: formData.get("emailNotifications") === "on",
    marketingEmails: formData.get("marketingEmails") === "on",
    productUpdates: formData.get("productUpdates") === "on",
    securityAlerts: formData.get("securityAlerts") === "on",
  };

  const validated = notificationSettingsSchema.safeParse(settings);
  if (!validated.success) {
    return { error: "Invalid settings" };
  }

  const { error } = await supabase
    .from("profiles")
    // @ts-ignore - Supabase update type inference limitation
    .update({
      notification_settings: validated.data,
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(ROUTES.dashboardSettings);
  return { success: true };
}

/**
 * Update the user's password.
 */
export async function updatePassword(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  const currentPassword = formData.get("currentPassword") as string;
  const newPassword = formData.get("newPassword") as string;

  if (!currentPassword || !newPassword) {
    return { error: "Both current and new password are required" };
  }

  if (newPassword.length < 8) {
    return { error: "Password must be at least 8 characters" };
  }

  // Verify current password by trying to sign in
  if (user.email) {
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    });

    if (signInError) {
      return { error: "Current password is incorrect" };
    }
  }

  // Update password
  const { error } = await supabase.auth.updateUser({
    password: newPassword,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath(ROUTES.dashboardSettings);
  return { success: true };
}
