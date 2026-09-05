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

/** 图片文件统一校验：必填/类型白名单/大小上限；返回 i18n 错误键或 null */
function validateImageFile(file: FormDataEntryValue | null): string | null {
  if (!(file instanceof File) || file.size === 0) return "fileRequired";
  if (!(file.type in ALLOWED_IMAGE_TYPES)) return "fileTypeUnsupported";
  if (file.size > AVATAR_MAX_BYTES) return "fileTooLarge";
  return null;
}

/** 上传当前用户头像：写入存储并更新 profiles.avatar_url */
export async function uploadAvatar(formData: FormData): Promise<ActionResult<{ url: string }>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("notAuthenticated");

  const file = formData.get("avatar");
  const validationError = validateImageFile(file);
  if (validationError) return fail(validationError);
  const image = file as File;

  try {
    const key = buildObjectKey("avatars", user.id, image.type);
    const body = Buffer.from(await image.arrayBuffer());
    const url = await getStorageDriver().put(key, body, image.type);

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

/** 上传项目封面（写入 projects.logo_url）：仅项目所属团队的 owner/admin */
export async function uploadProjectCover(
  projectId: string,
  formData: FormData,
): Promise<ActionResult<{ url: string }>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("notAuthenticated");

  const { data: project } = (await supabase
    .from("projects")
    .select("team_id")
    .eq("id", projectId)
    .maybeSingle()) as unknown as { data: { team_id: string } | null };
  if (!project) return fail("projectNotFound");

  const { data: membership } = (await supabase
    .from("team_members")
    .select("role")
    .eq("team_id", project.team_id)
    .eq("user_id", user.id)
    .maybeSingle()) as unknown as { data: { role: string } | null };
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return fail("onlyAdminsCreateProject");
  }

  const file = formData.get("cover");
  const validationError = validateImageFile(file);
  if (validationError) return fail(validationError);
  const image = file as File;

  try {
    const key = buildObjectKey("covers", projectId, image.type);
    const body = Buffer.from(await image.arrayBuffer());
    const url = await getStorageDriver().put(key, body, image.type);

    const { error } = await supabase
      .from("projects")
      .update({ logo_url: url, updated_at: new Date().toISOString() })
      .eq("id", projectId);
    if (error) {
      console.error("[uploadProjectCover] 封面地址写回失败:", error);
      return fail("uploadFailed");
    }

    revalidatePath(`${ROUTES.dashboardProjects}/${projectId}`);
    return ok({ url });
  } catch (error) {
    console.error("[uploadProjectCover] 上传失败:", error);
    return fail("uploadFailed");
  }
}
