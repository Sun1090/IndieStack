/**
 * 对象存储抽象（v0.5.0 B01，ADR-010）
 * 双驱动：默认 Supabase Storage（零新依赖、凭据已就绪）；配置 OSS_* 环境变量后
 * 切换阿里云 OSS。上传 action 与业务代码只面向 StorageDriver 接口。
 *
 * 说明：首版为服务端中转上传（小文件 ≤2MB），签名直传列为后续优化。
 */
import { createAdminClient } from "@/lib/supabase/admin";

/** 允许的图片类型 → 存储扩展名（content-type 白名单，拒绝任意扩展名拼接） */
export const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** 头像上限 2MB */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

export interface StorageDriver {
  /** 写入对象（公共读桶），返回可公开访问的 URL */
  put(key: string, body: Buffer, contentType: string): Promise<string>;
}

/** OSS_* 四项齐备即启用阿里云 OSS 驱动 */
export function isOssConfigured(): boolean {
  return Boolean(
    process.env.OSS_BUCKET &&
      process.env.OSS_REGION &&
      process.env.OSS_ACCESS_KEY_ID &&
      process.env.OSS_ACCESS_KEY_SECRET,
  );
}

function supabaseDriver(): StorageDriver {
  return {
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
  };
}

function ossDriver(): StorageDriver {
  // 动态加载：OSS 未配置时（默认路径）完全不引入该依赖
  const OSS = require("ali-oss");
  const store = new OSS({
    region: process.env.OSS_REGION as string,
    bucket: process.env.OSS_BUCKET as string,
    accessKeyId: process.env.OSS_ACCESS_KEY_ID as string,
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET as string,
  });
  return {
    async put(key, body, contentType) {
      const result = await store.put(key, body, { mime: contentType });
      return (result as { url: string }).url;
    },
  };
}

/** 按环境选择驱动；OSS 配置不完整时回退 Supabase（诊断信息见 warnOnEnvProblems 类日志） */
export function getStorageDriver(): StorageDriver {
  return isOssConfigured() ? ossDriver() : supabaseDriver();
}

/**
 * 构造对象键：{prefix}/{userId}/{随机串}.{ext}
 * 扩展名取自白名单映射（非用户文件名），杜绝路径穿越与任意后缀。
 */
export function buildObjectKey(prefix: string, userId: string, contentType: string): string {
  const ext = ALLOWED_IMAGE_TYPES[contentType];
  if (!ext) throw new Error(`unsupported content type: ${contentType}`);
  const random = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  return `${prefix}/${userId}/${Date.now()}-${random}.${ext}`;
}
