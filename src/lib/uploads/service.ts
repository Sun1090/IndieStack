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
import { imageChecksum } from "@/lib/uploads/checksum";
import {
  markUploadObjectDeleted,
  recordUploadObject,
  type UploadObjectRecord,
} from "@/lib/repositories/upload-objects";
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

/** 受管 bucket：H05 的 storage 门禁保证应用只引用已登记、已建行迁移的 bucket。 */
const MANAGED_BUCKET = "avatars";

/** 元数据标记失败只记日志：对象已经删掉，这里失败不该让调用方再回滚一次。 */
async function markDeletedQuietly(objectKey: string, operation: string, resourceId: string) {
  try {
    await markUploadObjectDeleted(MANAGED_BUCKET, objectKey);
  } catch (error) {
    logger.error(
      "upload metadata delete mark failed",
      { operation, resourceId, key: objectKey },
      error instanceof Error ? error : new Error(String(error)),
    );
  }
}

/** 对象确认从 provider 删除后才标记元数据，避免把仍然存在的对象误报成已清理。 */
async function cleanupAfterFailure(key: string, operation: string, resourceId: string) {
  const removed = await cleanupStorageObject(key, { operation, resourceId });
  if (removed) await markDeletedQuietly(key, operation, resourceId);
  return removed;
}

/**
 * 落上传元数据（H02）。返回 false 表示这次上传没有可追溯的记录，
 * 调用方必须删除对象并让请求失败——否则 bucket 里会留下没有元数据的孤儿对象。
 */
async function recordUploadQuietly(
  record: UploadObjectRecord,
  operation: string,
  resourceId: string,
): Promise<boolean> {
  try {
    await recordUploadObject(record);
    return true;
  } catch (error) {
    logger.error(
      "upload metadata write failed",
      { operation, resourceId, key: record.objectKey },
      error instanceof Error ? error : new Error(String(error)),
    );
    return false;
  }
}

/** put → 元数据 → 失败即回滚的公共前置阶段（H02）。 */
async function stageUploadObject(params: {
  key: string;
  body: Buffer;
  contentType: string;
  ownerId: string;
  operation: string;
  resourceId: string;
  signal?: AbortSignal;
}): Promise<{ error: string } | { url: string }> {
  const { key, body, contentType, ownerId, operation, resourceId, signal } = params;
  const url = await getStorageDriver().put(key, body, contentType);
  if (isAborted(signal)) {
    await cleanupAfterFailure(key, `${operation}-cancel`, resourceId);
    return { error: "uploadCancelled" };
  }

  const recorded = await recordUploadQuietly(
    {
      bucket: MANAGED_BUCKET,
      objectKey: key,
      ownerId,
      byteSize: body.byteLength,
      contentType,
      checksum: imageChecksum(body),
    },
    operation,
    resourceId,
  );
  if (!recorded) {
    await cleanupAfterFailure(key, `${operation}-metadata-rollback`, resourceId);
    return { error: "uploadFailed" };
  }
  return { url };
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
  const key = buildObjectKey("avatars", user.id, image.type);
  try {
    const staged = await stageUploadObject({
      key,
      body,
      contentType: image.type,
      ownerId: user.id,
      operation: "avatar-upload",
      resourceId: user.id,
      signal: options.signal,
    });
    if ("error" in staged) return fail(staged.error);

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
      .update({ avatar_url: staged.url, updated_at: new Date().toISOString() })
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
      const removed = await cleanupManagedStorageUrl(
        previousProfile?.avatar_url,
        "avatars",
        user.id,
        {
          operation: "avatar-replace",
          resourceId: user.id,
        },
      );
      if (removed) await markDeletedQuietly(oldKey, "avatar-replace", user.id);
    }
    return ok({ url: staged.url });
  } catch (error) {
    logger.error(
      "avatar upload failed",
      { operation: "avatar-upload", resourceId: user.id, key },
      error instanceof Error ? error : new Error(String(error)),
    );
    await cleanupAfterFailure(key, "avatar-upload-rollback", user.id);
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
  const key = buildObjectKey("covers", projectId, image.type);
  try {
    const staged = await stageUploadObject({
      key,
      body,
      contentType: image.type,
      ownerId: user.id,
      operation: "project-cover-upload",
      resourceId: projectId,
      signal: options.signal,
    });
    if ("error" in staged) return fail(staged.error);

    const { error } = await supabase
      .from("projects")
      .update({ logo_url: staged.url, updated_at: new Date().toISOString() })
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
      const removed = await cleanupManagedStorageUrl(project.logo_url, "covers", projectId, {
        operation: "project-cover-replace",
        resourceId: projectId,
      });
      if (removed) await markDeletedQuietly(oldKey, "project-cover-replace", projectId);
    }
    return ok({ url: staged.url });
  } catch (error) {
    logger.error(
      "project cover upload failed",
      { operation: "project-cover-upload", resourceId: projectId, key },
      error instanceof Error ? error : new Error(String(error)),
    );
    await cleanupAfterFailure(key, "project-cover-upload-rollback", projectId);
    return fail("uploadFailed");
  }
}
