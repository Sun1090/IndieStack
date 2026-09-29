/**
 * 会话用户：把「确实没有会话」与「没读到会话」分成两件事再交出去（roadmap C09）。
 *
 * 起因是 8 个仪表盘页面当时写成同一个形状——只解构 `user`、不取 `error`、然后用
 * `user!.id` 往下走。那条 `!` 在**类型**上宣称「这里不可能是 null」，而 `auth.getUser()`
 * 把失败装在 `error` 里返回而不是抛出（`auth-js` 的 `_getUser`），于是 Auth 服务一次抖动
 * 与「这个用户真的没登录」在下游长得一模一样，页面只能靠抛一个 `TypeError` 表达这件事。
 * 抛 TypeError 不是撒谎，但它是**一次没有分类的崩溃**：错误边界收到的 `message` 是
 * "Cannot read properties of null (reading 'id')"，日志里没有任何线索指向 Auth 读取失败。
 *
 * 为什么不直接用 `guards.ts` 的 `requireAuth()`：那一支还要多读一次 `profiles.role`，
 * 而这 8 个页面大多只要用户本身。多读一次是白读，而且角色读失败会被答成
 * SERVICE_UNAVAILABLE——一个只想显示邮箱的页面不该因为角色读不出来而整页失败。
 *
 * 返回整个 user 而不是只有 id，是因为有两页本来就读了 `user?.email` / `user?.created_at` /
 * `user?.last_sign_in_at`。把返回值收窄成 id 会把那些「容忍 null 的可选链」变成
 * 「为了拿到邮箱再发一次请求」——那是拿一个真缺陷换另一个。这里交出去的是**已经判过空**
 * 的用户，页面于是可以写 `user.email` 而不是 `user?.email ?? ""`。
 *
 * 分类仍然交给 `session-error`：`error` 非空**不等于**抖动（匿名访客拿到的就是
 * `AuthSessionMissingError`），所以只把「能叫出名字」的读取故障算成读失败，其余照旧
 * 答「请登录」。这条与 `guards.ts`、`api/auth/callback`、`actions/audit` 是同一套判据。
 */
import type { User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { ROUTES } from "@/lib/constants";
import { createClient } from "@/lib/supabase/server";
import { isRetryableSessionReadFailure } from "./session-error";

/** 会话读取本身没成功——不是一个关于用户的事实，错误边界应当显示「暂时不可用」并允许重试。 */
export class SessionReadUnavailableError extends Error {
  readonly code = "SESSION_READ_UNAVAILABLE";
  constructor(message: string) {
    super(message);
    this.name = "SessionReadUnavailableError";
  }
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * 取当前会话用户。三条出口，各自有名字：
 *
 * 1. 读到用户 ⇒ 返回它（已判空，调用方不必再判，也不必写 `!`）；
 * 2. 确认没有会话 ⇒ 重定向登录页——`dashboard/layout.tsx` 已经做过一次，这里是同一请求里
 *    第二次读取的兜底：两次调用相隔几毫秒，第二次失败不应该让页面崩；
 * 3. 确认是读取故障 ⇒ 抛 `SessionReadUnavailableError`。仪表盘的 `error.tsx` 带重试按钮，
 *    这比「跳登录页再让用户登一次」更接近该有的行为——重新登录走的正是同一条读取，
 *    用户除了被登出之外得不到任何新信息。
 */
export async function requireSessionUser(supabase: Supabase): Promise<User> {
  const { data, error } = await supabase.auth.getUser();
  if (error && isRetryableSessionReadFailure(error)) {
    throw new SessionReadUnavailableError(`读取会话失败：${error.message}`);
  }
  if (!data.user) redirect(ROUTES.login);
  return data.user;
}
