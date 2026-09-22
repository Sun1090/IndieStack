/**
 * 每个 **worker** 一台自己的 dev server。
 *
 * 为什么按 worker 而不是按 project：Playwright 的 project 是依次跑的，同一个 project 里并发的
 * 那一批才是 worker，而它们共用同一个 Next 进程、也就是共用同一份默认 mock store——并行基线
 * 首跑那 4 条红就出在这（见 docs/roadmap-0.12.0.md 的 C02）。所以隔离边界必须落在 worker 上：
 * worker 序号直接选端口，config 里起几台服务器、`workers` 就是几。
 *
 * spec 里因此不要再写死 `http://localhost:3100`，也不要用裸相对路径：两种写法都会把第二个
 * worker 打回第一台服务器，「隔离」只剩形式。统一走 `appUrl()`（相对路径只允许出现在
 * `waitForURL` / `route` 这类按 glob 匹配、与端口无关的断言里）。
 *
 * 串行模式下只有一个 worker（`TEST_WORKER_INDEX=0`），取到的就是基准端口，与改动前完全一致。
 * 重跑会换 workerIndex（也就是换一台服务器），所以并行基线仍然强制 `--retries=0`：
 * 带着重跑测出来的「并行绿」测的是另一件事。
 */
const BASE_PORT = Number(process.env.E2E_BASE_PORT ?? 3100);
const SERVERS = Number(process.env.E2E_SERVERS ?? 1);
const WORKER = Number(process.env.TEST_WORKER_INDEX ?? 0);

export function appUrl(): string {
  return `http://localhost:${BASE_PORT + (SERVERS > 1 ? WORKER % SERVERS : 0)}`;
}
