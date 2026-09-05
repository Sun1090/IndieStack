/**
 * 文件上传 Server Actions（v0.5.0 B01/B02）
 * 服务端中转上传（≤2MB 图片），经 storage 抽象层写入；
 * 校验失败返回 actions 命名空间的 i18n 错误键。
 */
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getStorageDriver, buildObjectKey, ALLOWED_IMAGE_TYPES, AVATAR_MAX_BYTES } from "@/lib/storage";
import { ROUTES } from "@/lib/constants";
import type { ActionResult } from "@/lib/types/action-result";
import { ok, fail } from "@/lib/types/action-result";

/** 上传当前用户头像：写入存储并更新 profiles.avatar_url */
export async function uploadAvatar(formData: FormData): Promise<ActionResult<{ url: string }>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("notAuthenticated");

  const file = formData.get("avatar");
  if (!(file instanceof File) || file.size === 0) return fail("fileRequired");
  if (!(file.type in ALLOWED_IMAGE_TYPES)) return fail("fileTypeUnsupported");
  if (file.size > AVATAR_MAX_BYTES) return fail("fileTooLarge");

  try {
    const key = buildObjectKey("avatars", user.id, file.type);
    const body = Buffer.from(await file.arrayBuffer());
    const url = await getStorageDriver().put(key, body, file.type);

    const { error } = await supabase
      .from("profiles")
      .update({ avatar_url: url, updated_at: new Date().toISOString() })
      .eq("id", user.id);
    if (error) {
      console.error("[uploadAvatar] 头像地址写回失败:", error);
      return fail("uploadFailed");
    }

    revalidatePath(ROUTES.dashboardProfile);
    revalidatePath(ROUTES.dashboardProfileEdit);
    return ok({ url });
  } catch (error) {
    console.error("[uploadAvatar] 上传失败:", error);
    return fail("uploadFailed");
  }
}
