/**
 * 阿里云 OSS 文件上传工具
 * 提供文件上传到阿里云 OSS 的统一封装，支持图片、文档等常见文件类型
 *
 * @example
 * import { uploadFile } from "@/lib/upload"
 * const url = await uploadFile(file, "avatars")
 */

import { ALIYUN_CONFIG } from "@/lib/constants";

/** 支持上传的文件类型 */
export const ALLOWED_FILE_TYPES: Record<string, readonly string[]> = {
  images: ["image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"],
  documents: ["application/pdf", "text/plain", "text/csv"],
  data: ["application/json", "text/yaml", "text/xml"],
};

/** 文件大小限制（字节） */
export const MAX_FILE_SIZE = {
  image: 10 * 1024 * 1024, // 10MB
  document: 20 * 1024 * 1024, // 20MB
  default: 5 * 1024 * 1024, // 5MB
} as const;

/** 上传结果 */
interface UploadResult {
  url: string;
  key: string;
  fileName: string;
  size: number;
  mimeType: string;
}

/** 上传选项 */
interface UploadOptions {
  directory?: string;
  fileName?: string;
  useCDN?: boolean;
  onProgress?: (percent: number) => void;
}

/**
 * 获取文件扩展名
 */
function getExtension(filename: string): string {
  const parts = filename.split(".");
  return parts.length > 1 ? `.${parts[parts.length - 1]}` : "";
}

/**
 * 生成唯一的文件名称
 */
function generateFileName(original: string): string {
  const ext = getExtension(original);
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${random}${ext}`;
}

/**
 * 验证上传文件
 */
function validateFile(file: File): { valid: boolean; error?: string } {
  // 检查文件大小
  const maxSize = MAX_FILE_SIZE.image;
  if (file.size > maxSize) {
    return {
      valid: false,
      error: `文件大小超出限制（最大 ${Math.round(maxSize / 1024 / 1024)}MB）`,
    };
  }

  // 检查文件类型
  const allowedTypes = (Object.values(ALLOWED_FILE_TYPES).flat() as string[]);
  if (!allowedTypes.includes(file.type) && file.type !== "") {
    return { valid: false, error: "不支持的文件类型" };
  }

  return { valid: true };
}

/**
 * 通过 presigned URL 上传文件到阿里云 OSS
 */
export async function uploadFile(
  file: File,
  directory: string = "general",
  options: UploadOptions = {}
): Promise<UploadResult> {
  const validation = validateFile(file);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const fileName = options.fileName ?? generateFileName(file.name);
  const key = `${directory}/${fileName}`;

  try {
    const presignResponse = await fetch("/api/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, contentType: file.type, directory }),
    });

    if (!presignResponse.ok) {
      throw new Error("获取上传凭证失败");
    }

    const { url, publicUrl } = await presignResponse.json();

    const uploadResponse = await fetch(url, {
      method: "PUT",
      body: file,
      headers: { "Content-Type": file.type },
    });

    if (!uploadResponse.ok) {
      throw new Error("文件上传失败");
    }

    const cdnDomain = options.useCDN !== false ? ALIYUN_CONFIG.cdnDomain : undefined;
    const finalUrl = cdnDomain
      ? `${cdnDomain}/${key}`
      : publicUrl ?? `${process.env.NEXT_PUBLIC_APP_URL}/api/files/${key}`;

    return { url: finalUrl, key, fileName, size: file.size, mimeType: file.type };
  } catch (error) {
    throw new Error(`上传失败: ${error instanceof Error ? error.message : "未知错误"}`);
  }
}

/**
 * 上传 base64 图片
 */
export async function uploadBase64Image(
  base64: string,
  directory: string = "images",
  options: UploadOptions = {}
): Promise<UploadResult> {
  const matches = base64.match(/^data:(image\/(\w+));base64,(.+)$/);
  if (!matches) {
    throw new Error("无效的 base64 图片数据");
  }

  const mimeType = matches[1];
  const ext = matches[2];

  // 将 base64 转为二进制
  const base64Data = matches[3];
  const byteString = typeof atob === "function" ? atob(base64Data) : Buffer.from(base64Data, "base64").toString("binary");
  const byteArray = new Uint8Array(byteString.length);
  for (let i = 0; i < byteString.length; i++) {
    byteArray[i] = byteString.charCodeAt(i);
  }

  const blob = new Blob([byteArray], { type: mimeType });
  const fileName = `${options.fileName ?? `img-${Date.now()}`}.${ext}`;
  const file = new File([blob], fileName, { type: mimeType });

  return uploadFile(file, directory, options);
}

/**
 * 获取文件类型分类
 */
export function getFileCategory(mimeType: string): string {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("text/")) return "text";
  return "other";
}

/**
 * 格式化文件大小显示
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}
