/**
 * 上传领域服务（v0.6.0 G08）
 *
 * Server Action 与 Route Handler 共用同一套鉴权、校验、对象写入、元数据回写和
 * 孤儿对象清理逻辑。HTTP 路由只负责请求边界与响应映射，避免安全规则分叉。
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  ALLOWED_IMAGE_TYPES,
  AVATAR_MAX_BYTES,
  buildObjectKey,
  cleanupManagedStorageUrl,
  cleanupStorageObject,
  extractManagedObjectKey,
  getStorageDriver,
} from "@/lib/storage";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/types/action-result";
import { fail, ok } from "@/lib/types/action-result";

export type UploadClient = SupabaseClient<Database>;
export type UploadResult = ActionResult<{ url: string }>;

export interface UploadFileOptions {
  /** Route Handler 的 request.signal；Action 不传。 */
  signal?: AbortSignal;
}

/** 允许上传的类型必须来自白名单自有属性，避免 `toString` 等原型键绕过。 */
export function isAllowedImageType(contentType: string): boolean {
  return Object.prototype.hasOwnProperty.call(ALLOWED_IMAGE_TYPES, contentType);
}

/**
 * 校验文件大小与声明类型。真实文件签名在读取 body 后校验，不能只信浏览器 MIME。
 */
export function validateImageFile(file: FormDataEntryValue | null): string | null {
  if (!(file instanceof File) || file.size === 0) return "fileRequired";
  if (!isAllowedImageType(file.type)) return "fileTypeUnsupported";
  if (file.size > AVATAR_MAX_BYTES) return "fileTooLarge";
  return null;
}

/** PNG / JPEG / WebP 的文件头校验；拒绝伪造 MIME 的任意内容。 */
export function hasSupportedImageSignature(body: Buffer, contentType: string): boolean {
  if (contentType === "image/png") {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return (
      body.length >= signature.length && signature.every((byte, index) => body[index] === byte)
    );
  }
  if (contentType === "image/jpeg") {
    return body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff;
  }
  if (contentType === "image/webp") {
    return (
      body.length >= 12 &&
      body.subarray(0, 4).toString("ascii") === "RIFF" &&
      body.subarray(8, 12).toString("ascii") === "WEBP"
    );
  }
  return false;
}

function isAborted(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

async function readValidatedImage(
  file: FormDataEntryValue | null,
  signal?: AbortSignal,
): Promise<{ ok: true; body: Buffer; image: File } | { ok: false; error: string }> {
  const validationError = validateImageFile(file);
  if (validationError) return { ok: false, error: validationError };

  const image = file as File;
  const body = Buffer.from(await image.arrayBuffer());
  if (isAborted(signal)) return { ok: false, error: "uploadCancelled" };
  if (!hasSupportedImageSignature(body, image.type)) {
    return { ok: false, error: "fileTypeUnsupported" };
  }
  return { ok: true, body, image };
}

async function cleanupAfterFailure(key: string, operation: string, resourceId: string) {
  await cleanupStorageObject(key, { operation, resourceId });
}

/** 上传头像并回写 profiles.avatar_url；成功时返回公共 URL。 */
export async function uploadAvatarFile(
  supabase: UploadClient,
  file: FormDataEntryValue | null,
  options: UploadFileOptions = {},
): Promise<UploadResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("notAuthenticated");

  const validated = await readValidatedImage(file, options.signal);
  if (!validated.ok) return fail(validated.error);

  const { body, image } = validated;
  let key: string | null = null;
  try {
    key = buildObjectKey("avatars", user.id, image.type);
    const url = await getStorageDriver().put(key, body, image.type);
    if (isAborted(options.signal)) {
      await cleanupAfterFailure(key, "avatar-upload-cancel", user.id);
      return fail("uploadCancelled");
    }

    const { data: previousProfile } = (await supabase
      .from("profiles")
      .select("avatar_url")
      .eq("id", user.id)
      .maybeSingle()) as unknown as { data: { avatar_url: string | null } | null };
    if (isAborted(options.signal)) {
      await cleanupAfterFailure(key, "avatar-upload-cancel", user.id);
      return fail("uploadCancelled");
    }

    const { error } = await supabase
      .from("profiles")
      .update({ avatar_url: url, updated_at: new Date().toISOString() })
      .eq("id", user.id);
    if (error) {
      logger.error(
        "avatar upload metadata update failed",
        { operation: "avatar-upload", resourceId: user.id },
        error,
      );
      await cleanupAfterFailure(key, "avatar-upload-rollback", user.id);
      return fail("uploadFailed");
    }

    const oldKey = extractManagedObjectKey(previousProfile?.avatar_url, "avatars", user.id);
    if (oldKey && oldKey !== key) {
      await cleanupManagedStorageUrl(previousProfile?.avatar_url, "avatars", user.id, {
        operation: "avatar-replace",
        resourceId: user.id,
      });
    }
    return ok({ url });
  } catch (error) {
    logger.error(
      "avatar upload failed",
      { operation: "avatar-upload", resourceId: user.id, key },
      error instanceof Error ? error : new Error(String(error)),
    );
    if (key) await cleanupAfterFailure(key, "avatar-upload-rollback", user.id);
    return fail("uploadFailed");
  }
}

/** 上传项目封面并回写 projects.logo_url；仅所属团队 owner/admin 可操作。 */
export async function uploadProjectCoverFile(
  supabase: UploadClient,
  projectId: string,
  file: FormDataEntryValue | null,
  options: UploadFileOptions = {},
): Promise<UploadResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("notAuthenticated");

  const { data: project } = (await supabase
    .from("projects")
    .select("team_id, logo_url")
    .eq("id", projectId)
    .maybeSingle()) as unknown as {
    data: { team_id: string; logo_url: string | null } | null;
  };
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

  const validated = await readValidatedImage(file, options.signal);
  if (!validated.ok) return fail(validated.error);

  const { body, image } = validated;
  let key: string | null = null;
  try {
    key = buildObjectKey("covers", projectId, image.type);
    const url = await getStorageDriver().put(key, body, image.type);
    if (isAborted(options.signal)) {
      await cleanupAfterFailure(key, "project-cover-upload-cancel", projectId);
      return fail("uploadCancelled");
    }

    const { error } = await supabase
      .from("projects")
      .update({ logo_url: url, updated_at: new Date().toISOString() })
      .eq("id", projectId);
    if (error) {
      logger.error(
        "project cover upload metadata update failed",
        { operation: "project-cover-upload", resourceId: projectId },
        error,
      );
      await cleanupAfterFailure(key, "project-cover-upload-rollback", projectId);
      return fail("uploadFailed");
    }

    const oldKey = extractManagedObjectKey(project.logo_url, "covers", projectId);
    if (oldKey && oldKey !== key) {
      await cleanupManagedStorageUrl(project.logo_url, "covers", projectId, {
        operation: "project-cover-replace",
        resourceId: projectId,
      });
    }
    return ok({ url });
  } catch (error) {
    logger.error(
      "project cover upload failed",
      { operation: "project-cover-upload", resourceId: projectId, key },
      error instanceof Error ? error : new Error(String(error)),
    );
    if (key) await cleanupAfterFailure(key, "project-cover-upload-rollback", projectId);
    return fail("uploadFailed");
  }
}
