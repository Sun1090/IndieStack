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

/**
 * Update notification settings for the current user.
 */
export async function updateNotificationSettings(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "notAuthenticated" };
  }

  const settings = {
    emailNotifications: formData.get("emailNotifications") === "on",
    marketingEmails: formData.get("marketingEmails") === "on",
    productUpdates: formData.get("productUpdates") === "on",
    securityAlerts: formData.get("securityAlerts") === "on",
  };

  const validated = notificationSettingsSchema.safeParse(settings);
  if (!validated.success) {
    return { error: "invalidSettings" };
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
    console.error("[updateSettings] 保存设置失败:", error);
    return { error: "databaseError" };
  }

  revalidatePath(ROUTES.dashboardSettings);
  return { success: true };
}

/**
 * Update the user's password.
 */
export async function updatePassword(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "notAuthenticated" };
  }

  const currentPassword = formData.get("currentPassword") as string;
  const newPassword = formData.get("newPassword") as string;

  if (!currentPassword || !newPassword) {
    return { error: "passwordsRequired" };
  }

  if (newPassword.length < 8) {
    return { error: "passwordMin8" };
  }

  // Verify current password by trying to sign in.
  // 无邮箱（如纯 OAuth 账户）时无法验证当前密码，直接拒绝修改，避免绕过密码校验。
  if (!user.email) {
    return { error: "passwordChangeUnavailable" };
  }
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });

  if (signInError) {
    return { error: "currentPasswordIncorrect" };
  }

  // Update password
  const { error } = await supabase.auth.updateUser({
    password: newPassword,
  });

  if (error) {
    console.error("[updateSettings] 保存设置失败:", error);
    return { error: "databaseError" };
  }

  revalidatePath(ROUTES.dashboardSettings);
  return { success: true };
}
