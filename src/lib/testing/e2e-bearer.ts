/**
 * Mock/E2E 调试端点的 Bearer 校验：一处实现，防的是「没配凭据」被读成「空凭据」。
 *
 * 这 8 个端点原先各自写 `const expected = \`Bearer ${process.env.E2E_BEARER_TOKEN ?? ""}\``，
 * 然后 `if (!expected || got !== expected)`。那个 `!expected` **永远不成立**——模板字符串先塞了
 * `"Bearer "` 前缀，所以 `expected` 至少是 `"Bearer "`，是真值。于是凭据未配置时，
 * 一个 `Authorization: Bearer `（尾部空格、空 token）的请求就能通过：写、清、注入数据的入口全部敞开。
 * 而「未配置」正是 Mock 模式的常态：`NEXT_PUBLIC_MOCK_ENABLED=true` 且没给 token 的环境
 * （本地跑、手写预览、照着模板文档开 Mock 的人）就是那扇门开着的环境。
 *
 * 判据只有一条：**没有配凭据 ⇒ 没有任何请求是合法的**。空串与未设置是同一件事。
 * 比较仍是整串等值（`Bearer <token>`），不做前缀匹配、不做大小写宽容——这些端点没有理由宽松。
 */

/** 校验一次 Bearer 头。`configuredToken` 默认取环境变量，测试里显式传入。 */
export function e2eBearerAuthorized(
  authorizationHeader: string | null | undefined,
  configuredToken: string | undefined = process.env.E2E_BEARER_TOKEN,
): boolean {
  if (!configuredToken) return false;
  return authorizationHeader === `Bearer ${configuredToken}`;
}
