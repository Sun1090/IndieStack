/**
 * 阿里云 OSS 工具模块
 * 提供文件上传、删除、签名 URL 生成、文件列表查询等操作
 * 通过服务端 API 路由包装，前端不直接暴露 OSS 凭证
 *
 * 使用方式：
 *   import { uploadFile, deleteFile, getSignedUrl } from "@/lib/storage/oss";
 *   const url = await uploadFile(file, "avatars");
 */

const OSS_ENDPOINT = `https://${process.env.ALIYUN_BUCKET}.${process.env.ALIYUN_REGION}.aliyuncs.com`;

/** OSS 文件上传结果 */
export interface OSSUploadResult {
  url: string;
  key: string;
  size: number;
  mimeType: string;
  uploadedAt: string;
}

/** OSS 文件信息 */
export interface OSSFileInfo {
  key: string;
  size: number;
  lastModified: string;
  etag: string;
}

/** OSS 文件列表结果 */
export interface OSSListResult {
  files: OSSFileInfo[];
  hasMore: boolean;
  nextMarker?: string;
}

/**
 * 上传文件到阿里云 OSS（服务端使用）
 * @param file - 文件 Buffer 或 Blob
 * @param key - OSS 存储路径，如 "avatars/user-123.jpg"
 * @param options - 可选配置
 */
export async function uploadFile(
  file: Blob | ArrayBuffer | string,
  key: string,
  options?: {
    contentType?: string;
    public?: boolean;
  }
): Promise<OSSUploadResult> {
  const { contentType = "application/octet-stream", public: isPublic = true } = options ?? {};
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    ...(isPublic ? { "x-oss-object-acl": "public-read" } : {}),
  };

  const response = await fetch(`${OSS_ENDPOINT}/${key}`, {
    method: "PUT",
    headers,
    body: file,
  });

  if (!response.ok) {
    throw new Error(`OSS 上传失败: ${response.status} ${response.statusText}`);
  }

  const cdnDomain = process.env.ALIYUN_CDN_DOMAIN;
  return {
    url: cdnDomain ? `${cdnDomain}/${key}` : `${OSS_ENDPOINT}/${key}`,
    key,
    size: typeof file === 'string' ? new Blob([file]).size : file instanceof Blob ? file.size : (file as ArrayBuffer).byteLength,
    mimeType: contentType,
    uploadedAt: new Date().toISOString(),
  };
}

/** 从 OSS 删除文件 */
export async function deleteFile(key: string): Promise<void> {
  const response = await fetch(`${OSS_ENDPOINT}/${key}`, { method: "DELETE" });
  if (!response.ok && response.status !== 404) {
    throw new Error(`OSS 删除失败: ${response.status}`);
  }
}

/** 生成签名 URL（私有文件临时授权访问） */
export async function getSignedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${baseUrl}/api/upload/sign?key=${encodeURIComponent(key)}&expires=${expiresInSeconds}`;
}

/** 列出 Bucket 中的文件 */
export async function listFiles(
  prefix?: string,
  marker?: string,
  maxKeys = 100
): Promise<OSSListResult> {
  const params = new URLSearchParams();
  if (prefix) params.set("prefix", prefix);
  if (marker) params.set("marker", marker);
  params.set("max-keys", String(maxKeys));

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const response = await fetch(`${baseUrl}/api/upload/list?${params.toString()}`);
  if (!response.ok) throw new Error(`OSS 列表查询失败: ${response.status}`);
  return response.json() as Promise<OSSListResult>;
}

/** 检查 OSS 配置状态 */
export function isOSSConfigured(): boolean {
  return !!(
    process.env.ALIYUN_ACCESS_KEY_ID &&
    process.env.ALIYUN_ACCESS_KEY_SECRET &&
    process.env.ALIYUN_BUCKET &&
    process.env.ALIYUN_REGION
  );
}
