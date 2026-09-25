/**
 * Mock 模式配置（零依赖轻量模块）
 * 仅供 Edge Middleware 等对 bundle 体积敏感的场景引入，
 * 避免把 faker 等 mock 数据依赖打进 Edge 运行时。
 */

/** 判定要读的三个变量。显式列出来，是为了让 /api/health 与 provider 诊断用同一份真值表。 */
export interface MockModeEnv {
  NODE_ENV?: string;
  NEXT_PUBLIC_MOCK_ENABLED?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
}

/**
 * Mock 只在非生产构型里成立，而且**两条来源都要过这道闸**。
 *
 * `NEXT_PUBLIC_*` 是构建期内联进产物的，所以一个忘在部署平台上的 `true` 会跟着产物一路进生产；
 * 而 mock 打开的第一件事就是「一个已登录的假用户」——那是静默的认证绕过，不是显示问题。
 * 自动启用那一半早就写了「仅非生产」（注释里就是这句话），显式那一半此前没有，
 * 于是同一个文件里两种语义，危险的那一种胜出。
 */
export function evaluateMockMode(env: MockModeEnv): boolean {
  if (env.NODE_ENV === "production") return false;
  return env.NEXT_PUBLIC_MOCK_ENABLED === "true" || !env.NEXT_PUBLIC_SUPABASE_URL;
}

/**
 * 是否启用 Mock 模式。
 *
 * `NODE_ENV === "production"` 这一层在 `evaluateMockMode` 里已经判过一次，这里不是第二份真值表，
 * 而是一条**构建期折叠提示**：Next 只把 `process.env.X` 这样的成员表达式替换成字面量，写成三元表达式
 * 才能让打包器把整个常量折成 `false`，进而把走不通的那一侧客户端依赖摇掉。
 * 实测（同一台机器、`rm -rf .next` 后干净构建）：直接写 `evaluateMockMode(process.env)` 折不出来，
 * 生产构建的客户端产物 2951.7 kB；写成下面这样折成常量后 2926.8 kB，而且
 * `NEXT_PUBLIC_MOCK_ENABLED` true / false 两种构建体积相同（2,997,015 / 2,997,011 字节，差的 4 字节
 * 是内嵌的 chunk id 字符串长度）——生产产物不再受这个开关影响。
 * 这 24.9 kB 只占基线的 0.9%，`check:bundle` 的 5% 预算拦不住，所以由 config.test.ts 钉住写法。
 */
export const isMockEnabled =
  process.env.NODE_ENV === "production" ? false : evaluateMockMode(process.env);

/** 当 Supabase 未配置时（且不在生产构型），自动启用 Mock 模式 */
export function shouldUseMock(): boolean {
  return isMockEnabled;
}
