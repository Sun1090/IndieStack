/**
 * 个人资料服务端操作
 * 更新用户资料设置（Server Actions）
 */
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { profileSettingsSchema } from "@/lib/validations/profile";
import { ROUTES } from "@/lib/constants";
import type { ActionResult } from "@/lib/types/action-result";
import { fail, ok } from "@/lib/types/action-result";

/**
 * Update profile settings (full bio, timezone, language).
 */
export async function updateProfileSettings(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return fail("notAuthenticated");
  }

  // 白名单 + 类型/长度校验：拒绝任意字段值直接写入 profiles
  const parsed = profileSettingsSchema.safeParse({
    fullName: formData.get("fullName")?.toString(),
    bio: formData.get("bio")?.toString(),
    timezone: formData.get("timezone")?.toString(),
    language: formData.get("language")?.toString(),
  });
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "invalidInput");
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
    return fail("databaseError");
  }

  revalidatePath(ROUTES.dashboardProfile);
  return ok();
}
