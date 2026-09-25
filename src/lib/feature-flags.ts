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

/**
 * 每个开关键都必须是 `process.env.X` 这样的**静态成员表达式**，不能用 `process.env[名]` 计算式。
 *
 * 这不是风格约束：Next 只替换静态成员表达式。写成计算式时，客户端产物里留下的是
 * `processModule.default.env[\`NEXT_PUBLIC_FEATURE_${name}\`]`，而浏览器里
 * `typeof process === "undefined"`（实测，见下），那个垫片给出的是空对象——
 * 于是**客户端永远读到 undefined、永远走默认值**，而服务端渲染读的是真实值。
 * 两侧不一致的可见后果就是 hydration 不匹配：`NEXT_PUBLIC_FEATURE_AUDIT_LOG_EXPORT=false`
 * 时服务端不渲染导出按钮，客户端 hydration 后又把它补出来。
 *
 * 实测（`NEXT_PUBLIC_FEATURE_AUDIT_LOG_EXPORT=false` 的生产构建）：整个 `.next/static` 里
 * 关于这一族只有模板前缀 `NEXT_PUBLIC_FEATURE_` 一个字符串，没有那个 `false`；
 * 同一份产物里对照组 `NEXT_PUBLIC_SUPABASE_URL`（静态读法）的值是内联进去的。
 * 这条性质由 feature-flags.test.ts 的源码形状断言钉住（运行时用例看不见浏览器那一侧，
 * 因为 vitest 的 jsdom 里 `process` 照样存在）。
 */
const RAW_FLAGS = {
  AVATAR_UPLOAD: process.env.NEXT_PUBLIC_FEATURE_AVATAR_UPLOAD,
  AUDIT_LOG_EXPORT: process.env.NEXT_PUBLIC_FEATURE_AUDIT_LOG_EXPORT,
  WEBHOOK_DEBUG_PAGE: process.env.NEXT_PUBLIC_FEATURE_WEBHOOK_DEBUG_PAGE,
  PASSKEY: process.env.NEXT_PUBLIC_FEATURE_PASSKEY,
  PASSKEY_LOGIN: process.env.NEXT_PUBLIC_FEATURE_PASSKEY_LOGIN,
};

type FlagName = keyof typeof RAW_FLAGS;

const flag = (name: FlagName, defaultValue: boolean): boolean => {
  const value = RAW_FLAGS[name];
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
  /** Passkey sign-in requires a complete Supabase session bridge; disabled until then. */
  passkeyLogin: flag("PASSKEY_LOGIN", false),
} as const;

export type FeatureFlags = typeof features;
