/**
 * 通知类型的单一事实源（无依赖模块）。
 *
 * 之所以从 `@/lib/repositories/notifications` 里抽出来：那个模块在导入时就会拉起
 * `@/lib/supabase/server` 与 `@/lib/supabase/admin`。而需要这份枚举的两侧都不能带那些依赖——
 * mock 数据层存在的意义正是「Supabase 未配置时也能跑」，i18n 门禁脚本也不该为了读一个数组
 * 去初始化数据库客户端。所以这里只放常量与派生类型，仓储层原样再导出，对外 API 不变。
 *
 * `NOTIFICATION_TYPES` 同时是 i18n 动态键契约（`src/lib/i18n/dynamic-keys.ts`）的权威取值集合：
 * 通知页用 `t(\`notifications.list.types.${type}\`)` 渲染类型标签，而 `check:i18n` 按设计只扫静态
 * `t("字面量")`，动态模板会被跳过——`pnpm check:dynamic-keys` 就是补这个盲区的，
 * 它要求每个类型在**每个 locale** 都有对应键，且消息文件里不得出现集合之外的孤儿键。
 */

/** 通知类型（seed 既有 + v0.4.0 新增；展示映射见通知页 badgeVariant）。 */
export const NOTIFICATION_TYPES = [
  "system",
  "team_invite",
  "role_changed",
  "payment_succeeded",
  "billing_update",
  "deployment",
  "security_alert",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
