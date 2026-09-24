/**
 * `auth.getUser()` 返回的 `error` 分两类，把它们混成一谈会把一种故障说成另一种事实。
 *
 * 起因是 Auth 客户端和 PostgREST 一样**不抛异常**、把失败装在 `error` 里返回（roadmap C09），
 * 于是第一版修法读到了 `error` 就答「暂时不可用」。但 `error` 非空里最常见的一种根本不是故障：
 * `auth-js` 在没有本地会话时直接返回 `AuthSessionMissingError`（见 `_getUser`：
 * 没有 `access_token` 也没有自定义鉴权头时 `{ data: { user: null }, error: new AuthSessionMissingError() }`），
 * 也就是说**每一个匿名访客都会带着一个非空 `error`**。把它当成基础设施故障，等于把一个
 * 「请先登录」的正确答案换成一个重试也不会好的 503——比原来的错误更难解释。
 *
 * 所以这里只把**能叫出名字**的读取故障分出来：
 * - `AuthRetryableFetchError`：fetch 本身失败（网络断开、请求被丢弃），重试有意义；
 * - 状态码 ≥ 500 的 `AuthApiError`：Auth 服务端答不上来。
 *
 * 其余一律按「这个会话不存在或已失效」处理，维持 `main` 上的既有行为。判不准的宁可归到这一侧：
 * 本模块的职责是把被误报成「你没登录」的故障救出来，不是扩大 503 的面。
 */
import { isAuthApiError, isAuthRetryableFetchError } from "@supabase/supabase-js";

/** 这次会话读取是不是「没读到」而不是「没有」——只有 true 才该答 SERVICE_UNAVAILABLE。 */
export function isRetryableSessionReadFailure(error: unknown): boolean {
  if (!error) return false;
  if (isAuthRetryableFetchError(error)) return true;
  if (isAuthApiError(error)) {
    return typeof error.status === "number" && error.status >= 500;
  }
  return false;
}
