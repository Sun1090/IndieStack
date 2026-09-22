/**
 * 并行基线的预热步骤（globalSetup）：Playwright 会在用例开跑前起好 N 台 dev server，
 * 但 `next dev` 是**按路由**冷编译的——第一个打到某台服务器的用例要为 `/auth/login` +
 * `/dashboard` 付编译时间。两轮并行复跑里红掉的 `uploads`（登录后 waitForURL 15s）与
 * `smoke`（page.goto 60s + `ERR_ABORTED`）都是这个形状，而不是共享状态。
 *
 * 这里让每台服务器在跑测试之前先把这几个路由编译一遍。它只在并行模式下生效
 * （`E2E_SERVERS > 1`）：串行模式本来就测不出这种争抢，不值得为它多花 CI 时间。
 * 预热失败不阻断——它只是把冷编译从「第一个用例」挪到「这一步」，用例该超时还是会超时，
 * 让红留在真正该被看到的地方。
 */
const BASE_PORT = Number(process.env.E2E_BASE_PORT ?? 3100);
const SERVERS = Number(process.env.E2E_SERVERS ?? 1);
const ROUTES = ["/", "/auth/login", "/dashboard", "/dashboard/settings"];

export default async function warmUpServers(): Promise<void> {
  if (SERVERS < 2) return;

  for (const slot of Array.from({ length: SERVERS }, (_, i) => i)) {
    const origin = `http://localhost:${BASE_PORT + slot}`;
    for (const route of ROUTES) {
      try {
        await fetch(`${origin}${route}`, {
          redirect: "manual",
          signal: AbortSignal.timeout(120_000),
        });
      } catch {
        // 冷编译期间 dev server 可能直接断开连接；紧接着的用例请求会再触发一次编译。
      }
    }
  }
}
