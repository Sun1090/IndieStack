/**
 * 允许写进 `audit_logs.action` 的认证动作清单。
 *
 * **这个模块刻意不带 `"use server"`。** 清单原本写在 `src/lib/actions/audit.ts` 里，
 * 而那是 `"use server"` 文件——Next 对这类文件有一条硬约束：
 * **每个 export 都必须是 async 函数**。一个 `export const [...]` 会让整个模块在加载时抛
 * `A "use server" file can only export async functions, found object`，
 * 而代价不止是这一条：`/auth/login` 的 actions 加载器把 `recordLoginResult`、
 * `checkLoggedIn` 等同一个 loader 里的 action 一起挂掉，**登录表单整体失效**。
 *
 * 它没有在任何本地门禁里红过：lint / tsc / 单测 / `next build` 全绿——这条约束只在
 * 模块真的被求值时才检查。第一次红是 CI 的 E2E（17 条用例卡在「点了登录没跳转」），
 * 也就是说**唯一抓到它的是「真的点一次登录」**。
 *
 * 所以清单放在普通模块里（只有类型与一个数组，没有网络表面），
 * `src/lib/actions/audit.ts` 只保留那个 async 的 `logAuthEvent`。
 */
export const AUTH_AUDIT_ACTIONS = [
  "auth.login",
  "auth.login_failed",
  "auth.oauth_login",
  "auth.passkey_login",
  "auth.mfa_verified",
  "auth.recovery_redeemed",
] as const;

export type AuthAuditAction = (typeof AUTH_AUDIT_ACTIONS)[number];
