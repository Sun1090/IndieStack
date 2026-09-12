/**
 * 浏览器头像上传端点（v0.6.0 G08）
 * 支持 XMLHttpRequest 进度与 abort；领域规则与 uploadAvatar Server Action 共用 service。
 */
import { revalidatePath } from "next/cache";
import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { uploadAvatarFile } from "@/lib/uploads/service";
import { guardUploadRequest, uploadResultResponse } from "@/lib/uploads/request";
import { ROUTES } from "@/lib/constants";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const guarded = await guardUploadRequest(request);
  if (!guarded.ok) return guarded.response;

  const supabase = await createClient();
  const result = await uploadAvatarFile(supabase, guarded.formData.get("avatar"), {
    signal: request.signal,
  });
  if (!result.ok) return uploadResultResponse(result);

  revalidatePath(ROUTES.dashboardProfile);
  revalidatePath(ROUTES.dashboardProfileEdit);
  return uploadResultResponse(result);
}
