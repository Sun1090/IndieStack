/**
 * 对象存储抽象（v0.5.0 B01，ADR-010）
 * 双驱动：默认 Supabase Storage（零新依赖、凭据已就绪）；配置 OSS_* 环境变量后
 * 切换阿里云 OSS。上传 action 与业务代码只面向 StorageDriver 接口。
 *
 * 说明：首版为服务端中转上传（小文件 ≤2MB），签名直传列为后续优化。
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { getStorageConfigReport } from "@/lib/env";
import { logger } from "@/lib/logger";
import OSS from "ali-oss";

/** 允许的图片类型 → 存储扩展名（content-type 白名单，拒绝任意扩展名拼接） */
export const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** 头像上限 2MB */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const SIGNED_URL_MIN_SECONDS = 1;
export const SIGNED_URL_MAX_SECONDS = 7 * 24 * 60 * 60;

function validateSignedUrlExpiry(expiresInSeconds: number): void {
  if (
    !Number.isInteger(expiresInSeconds) ||
    expiresInSeconds < SIGNED_URL_MIN_SECONDS ||
    expiresInSeconds > SIGNED_URL_MAX_SECONDS
  ) {
    throw new Error(`invalid signed URL expiry: ${expiresInSeconds}`);
  }
}

export interface StorageCapabilities {
  put: true;
  publicUrl: true;
  signedUrl: boolean;
  remove: boolean;
}

/**
 * Provider contract. 业务代码只依赖此接口；provider 的能力差异通过
 * capabilities 显式暴露，避免调用方猜测当前后端实现。
 */
export interface StorageDriver {
  readonly provider: "supabase" | "oss";
  readonly capabilities: StorageCapabilities;
  /** 写入对象，返回可公开访问的 URL。 */
  put(key: string, body: Buffer, contentType: string): Promise<string>;
  /** 生成临时访问 URL；不支持时以明确错误拒绝。 */
  signedUrl(key: string, expiresInSeconds: number): Promise<string>;
  /** 删除对象；不支持时以明确错误拒绝。 */
  remove(key: string): Promise<void>;
}

/** OSS_* 四项齐备即启用阿里云 OSS 驱动 */
export function isOssConfigured(): boolean {
  return getStorageConfigReport().ossConfigured;
}

function supabaseDriver(): StorageDriver {
  return {
    provider: "supabase",
    capabilities: { put: true, publicUrl: true, signedUrl: true, remove: true },
    async put(key, body, contentType) {
      const admin = createAdminClient();
      // 桶名约定：avatars（公共读）。上线前需在 Supabase Dashboard/迁移中创建。
      const { error } = await admin.storage.from("avatars").upload(key, body, {
        contentType,
        upsert: true,
      });
      if (error) throw new Error(`storage upload: ${error.message}`);
      const { data } = admin.storage.from("avatars").getPublicUrl(key);
      return data.publicUrl;
    },
    async signedUrl(key, expiresInSeconds) {
      validateSignedUrlExpiry(expiresInSeconds);
      const { data, error } = await createAdminClient()
        .storage.from("avatars")
        .createSignedUrl(key, expiresInSeconds);
      if (error) throw new Error(`storage signed URL: ${error.message}`);
      return data.signedUrl;
    },
    async remove(key) {
      const { error } = await createAdminClient().storage.from("avatars").remove([key]);
      if (error) throw new Error(`storage remove: ${error.message}`);
    },
  };
}

function ossDriver(): StorageDriver {
  // 仅在 OSS 配置完整时实例化客户端；不完整配置始终走 Supabase fallback
  const store = new OSS({
    region: process.env.OSS_REGION as string,
    bucket: process.env.OSS_BUCKET as string,
    accessKeyId: process.env.OSS_ACCESS_KEY_ID as string,
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET as string,
  });
  return {
    provider: "oss",
    capabilities: { put: true, publicUrl: true, signedUrl: true, remove: true },
    async put(key, body, contentType) {
      const result = await store.put(key, body, { mime: contentType });
      return (result as { url: string }).url;
    },
    async signedUrl(key, expiresInSeconds) {
      validateSignedUrlExpiry(expiresInSeconds);
      return store.signatureUrl(key, { expires: expiresInSeconds });
    },
    async remove(key) {
      await store.delete(key);
    },
  };
}

/** 按环境选择驱动；OSS 配置不完整时回退 Supabase（诊断信息见 warnOnEnvProblems 类日志） */
export function getStorageDriver(): StorageDriver {
  return getStorageConfigReport().provider === "oss" ? ossDriver() : supabaseDriver();
}

/**
 * 构造对象键：{prefix}/{userId}/{随机串}.{ext}
 * 扩展名取自白名单映射（非用户文件名），杜绝路径穿越与任意后缀。
 */
export function buildObjectKey(prefix: string, userId: string, contentType: string): string {
  // prefix 与租户标识必须是单一路径段，调用方不能注入 `/`、`.` 或空值跨越租户目录。
  const pathSegment = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
  if (!pathSegment.test(prefix)) throw new Error("invalid storage prefix");
  if (!pathSegment.test(userId)) throw new Error("invalid storage tenant");
  const ext = ALLOWED_IMAGE_TYPES[contentType];
  if (!ext) throw new Error(`unsupported content type: ${contentType}`);
  const random = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  return `${prefix}/${userId}/${Date.now()}-${random}.${ext}`;
}

/**
 * 从受管公共 URL 提取对象键，仅接受预期 prefix/tenant 边界。
 * 支持 Supabase `/object/public/<bucket>/<key>` 与 OSS `/<key>` URL；
 * 外部 URL、编码路径穿越或不匹配租户一律返回 null。
 */
export function extractManagedObjectKey(
  rawUrl: string | null | undefined,
  prefix: string,
  tenantId: string,
): string | null {
  if (!rawUrl) return null;
  const pathSegment = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
  if (!pathSegment.test(prefix) || !pathSegment.test(tenantId)) return null;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const decoded = decodeURIComponent(url.pathname);
    if (decoded.includes("..") || decoded.includes("\\")) return null;
    const marker = "/object/public/";
    const markerIndex = decoded.indexOf(marker);
    const key =
      markerIndex >= 0
        ? decoded.slice(markerIndex + marker.length).replace(/^[^/]+\/?/, "")
        : decoded.replace(/^\/+/, "");
    const normalizedKey = key.replace(/^\/+/, "");
    const boundary = `${prefix}/${tenantId}/`;
    return normalizedKey.startsWith(boundary) && normalizedKey.length > boundary.length
      ? normalizedKey
      : null;
  } catch {
    return null;
  }
}

export interface StorageCleanupContext {
  operation: string;
  resourceId: string;
}

/**
 * Best-effort managed-object cleanup used after a successful metadata mutation
 * or when a metadata write fails after the object was uploaded. Cleanup is
 * deliberately non-blocking: the database remains the source of truth and a
 * failed provider call is recorded with structured context for later repair.
 */
export async function cleanupStorageObject(
  key: string,
  context: StorageCleanupContext,
): Promise<boolean> {
  if (!key || key.includes("..") || key.includes("\\") || key.startsWith("/")) {
    logger.warn("storage cleanup skipped: invalid managed key", {
      operation: context.operation,
      resourceId: context.resourceId,
    });
    return false;
  }

  try {
    await getStorageDriver().remove(key);
    logger.info("storage object cleaned", {
      operation: context.operation,
      resourceId: context.resourceId,
      key,
    });
    return true;
  } catch (error) {
    logger.error(
      "storage object cleanup failed",
      { operation: context.operation, resourceId: context.resourceId, key },
      error instanceof Error ? error : new Error(String(error)),
    );
    return false;
  }
}

/** Extracts and cleans a URL only when it belongs to the expected tenant. */
export async function cleanupManagedStorageUrl(
  rawUrl: string | null | undefined,
  prefix: string,
  tenantId: string,
  context: StorageCleanupContext,
): Promise<boolean> {
  const key = extractManagedObjectKey(rawUrl, prefix, tenantId);
  return key ? cleanupStorageObject(key, context) : false;
}
