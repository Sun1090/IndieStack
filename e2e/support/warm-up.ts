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
 *
 * **但身份检查是阻断的**，而且它在所有模式下都跑：Playwright 的就绪判断只看「这个端口有没有
 * 响应」，端口上要是站着别的项目的服务，整套用例就会对着一个不相干的应用跑完并且**全绿**。
 * 这已经真实发生过一次（roadmap C07：那轮全量 E2E 整份作废）。见
 * `src/lib/testing/e2e-server-identity.ts`。
 */
import fs from "node:fs";
import path from "node:path";
import { assertOurServer } from "../../src/lib/testing/e2e-server-identity";

const BASE_PORT = Number(process.env.E2E_BASE_PORT ?? 3100);
const SERVERS = Number(process.env.E2E_SERVERS ?? 1);
const ROUTES = ["/", "/auth/login", "/dashboard", "/dashboard/settings"];

/** 本仓库的版本号：健康检查里的 `version` 必须与它一致。 */
function repoVersion(): string {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../../package.json"), "utf8"),
  ) as { version?: string };
  if (!manifest.version) throw new Error("package.json 里没有 version，无法核对服务器身份");
  return manifest.version;
}

export default async function warmUpServers(): Promise<void> {
  // 身份核对在「只在并行时预热」那句早退**之前**：串行才是最常用的模式，
  // 把检查放在早退之后等于在最常跑的那条路上不设防。
  const version = repoVersion();
  for (const slot of Array.from({ length: SERVERS }, (_, i) => i)) {
    const port = BASE_PORT + slot;
    await assertOurServer(
      `http://localhost:${port}`,
      port,
      { version },
      (url) =>
        fetch(url, { signal: AbortSignal.timeout(20_000) }).then((response) => response.json()),
    );
  }

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
