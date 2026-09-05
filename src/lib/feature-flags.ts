/**
 * Feature Flags（功能开关）
 * 通过环境变量控制功能启停，命名规范: NEXT_PUBLIC_FEATURE_<NAME>=true|false
 *
 * 使用方式:
 *   import { features } from "@/lib/feature-flags";
 *   if (features.avatarUpload) { ... }
 *
 * 注意: NEXT_PUBLIC_* 在构建时内联，改开关需重新部署；
 *       需要运行时热切换时迁移到数据库/远程配置。
 */

const flag = (name: string, defaultValue = false): boolean => {
  const value = process.env[`NEXT_PUBLIC_FEATURE_${name}`];
  if (value === undefined || value === "") return defaultValue;
  return value === "true";
};

export const features = {
  /** 用户头像上传（依赖阿里云 OSS 接线，见 docs/architecture/11-integrations.md） */
  avatarUpload: flag("AVATAR_UPLOAD", false),
  /** 审计日志 CSV 导出 */
  auditLogExport: flag("AUDIT_LOG_EXPORT", true),
  /** Webhook 调试日志页 */
  webhookDebugPage: flag("WEBHOOK_DEBUG_PAGE", false),
  /** 通行密钥（Passkey/WebAuthn 试点，v0.5.0 D01，见 docs/adr/adr-012-passkey.md） */
  passkey: flag("PASSKEY", false),
} as const;

export type FeatureFlags = typeof features;
