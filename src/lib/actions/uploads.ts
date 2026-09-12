/**
 * 文件上传 Server Actions（v0.5.0 B01/B02；v0.6.0 G08 共享 service）
 *
 * Server Actions 保留给渐进增强/非浏览器调用方；需要真实进度和取消的浏览器表单
 * 使用 `/api/uploads/*`，两者共用 `src/lib/uploads/service.ts` 的安全与业务规则。
 */
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { uploadAvatarFile, uploadProjectCoverFile } from "@/lib/uploads/service";
import { ROUTES } from "@/lib/constants";
import type { ActionResult } from "@/lib/types/action-result";

/** 上传当前用户头像：写入存储并更新 profiles.avatar_url */
export async function uploadAvatar(formData: FormData): Promise<ActionResult<{ url: string }>> {
  const supabase = await createClient();
  const result = await uploadAvatarFile(supabase, formData.get("avatar"));
  if (!result.ok) return result;

  revalidatePath(ROUTES.dashboardProfile);
  revalidatePath(ROUTES.dashboardProfileEdit);
  return result;
}

/** 上传项目封面（写入 projects.logo_url）：仅项目所属团队的 owner/admin */
export async function uploadProjectCover(
  projectId: string,
  formData: FormData,
): Promise<ActionResult<{ url: string }>> {
  const supabase = await createClient();
  const result = await uploadProjectCoverFile(supabase, projectId, formData.get("cover"));
  if (!result.ok) return result;

  revalidatePath(`${ROUTES.dashboardProjects}/${projectId}`);
  return result;
}
