/**
 * 「这台服务器到底是不是我们要测的那台」（v0.12.0 E2E 可信度）。
 *
 * 本地 E2E 通过 `webServer.url` 判断服务器就绪，而就绪检查只看「这个端口有没有 2xx」——
 * 端口被别的项目占着时它一样是 2xx。这条路已经真实咬过两次：一次是全量 E2E 跑完才发现
 * `:3100` 上是 `~/Projects/trade-buty` 的服务（那轮结果整份作废，记在 roadmap C07），
 * 一次是另一项目的 Playwright 与本轮并行跑在同一台机器上。
 * 所以用例开跑前必须**主动否认**一个不是我们的服务：判据是纯函数，放得进单测；
 * 拉取与抛错留在 `e2e/support/warm-up.ts`。
 *
 * 失败封闭：拿不到 JSON、缺字段、值不对，一律算「不是我们的服务器」。
 * 「认不出来」和「认出来不是」在这里是同一件事——一个证明不了的绿灯就是我们要防的那种绿。
 */

/** 本模块期望的健康检查响应里用到的字段（多出来的字段不影响判定）。 */
export interface HealthProbeShape {
  version?: unknown;
  mockMode?: unknown;
}

export interface IdentityExpectation {
  /** 本仓库 `package.json` 的版本：E2E 跑的必须是同一份代码编译出来的应用。 */
  version: string;
}

/**
 * 返回 `undefined` 表示「这就是本轮要测的那台」；否则返回**给人看的拒绝理由**。
 *
 * 理由里带上量到的实际值：端口冲突这件事的排查成本全在「它到底回了什么」，
 * 只说「不是我们的服务器」等于把一次作废的运行重新变成人肉扫一遍。
 */
export function describeForeignServer(
  body: unknown,
  expected: IdentityExpectation,
): string | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return `响应不是一个 JSON 对象（拿到的是 ${body === null ? "null" : typeof body}）`;
  }
  const { version, mockMode } = body as HealthProbeShape;
  if (mockMode !== true) {
    return `mockMode 不是 true（拿到 ${JSON.stringify(mockMode)}）——那台服务没有以 mock 模式启动`;
  }
  if (version !== expected.version) {
    return `version 是 ${JSON.stringify(version)}，本仓库是 ${JSON.stringify(expected.version)}`;
  }
  return undefined;
}

/** 给 globalSetup 用的一句话错误文案：把「怎么办」写在失败里，而不是让人去猜。 */
export function serverIdentityError(
  origin: string,
  reason: string,
  port: number,
): string {
  return (
    `${origin}/api/health 回的不是本仓库要测的应用：${reason}\n` +
    `  端口 :${port} 上可能是别的项目的服务（或者一个环境不对的残留 dev server）。\n` +
    `  排查：lsof -nP -iTCP:${port} -sTCP:LISTEN\n` +
    `  绕开：换一个基准端口跑 E2E —— E2E_BASE_PORT=3400 pnpm test:e2e`
  );
}

/**
 * 核对一台服务器，不对就抛。
 *
 * 「读不到 /api/health」同样要抛：拿不到证据就等于证明不了这台是我们的，
 * 而一次静默放行的启动检查正是本模块存在的理由。取数由调用方注入，
 * 这样这两条分支都在单测里，而不是只活在 e2e 目录的文本里。
 */
export async function assertOurServer(
  origin: string,
  port: number,
  expected: IdentityExpectation,
  fetchHealth: (url: string) => Promise<unknown>,
): Promise<void> {
  let body: unknown;
  try {
    body = await fetchHealth(`${origin}/api/health`);
  } catch (error) {
    throw new Error(
      serverIdentityError(origin, `读 /api/health 失败：${(error as Error).message}`, port),
    );
  }
  const reason = describeForeignServer(body, expected);
  if (reason) throw new Error(serverIdentityError(origin, reason, port));
}
