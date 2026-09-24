/**
 * 路由鉴权清单门禁的 IO 层（C11）。
 *
 * 规则与解析都在 `src/lib/security/route-auth.ts`（纯函数、由 vitest 覆盖）；这里只负责
 * 把 `src/**` 的源码读进内存。必须一次读全：只喂路由文件会得到一批假的「无守卫」结论
 * （`e2e/*` 的 `authOk` 是同文件局部函数，上传端点的 `guardUploadRequest` 在 `src/lib` 里）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditRouteAuth, collectRouteHandlers, formatRouteAuthIssues } from "../../src/lib/security/route-auth.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCAN_ROOT = "src";

function walkFiles(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** 读 `src/**` 全部 TS 源码（跳过测试文件：它们不参与运行时调用图）。 */
export function buildRouteAuthSources(repoRoot = REPO_ROOT) {
  const absolute = walkFiles(path.join(repoRoot, SCAN_ROOT), []).filter(
    (file) => !/\.test\.tsx?$/.test(file),
  );
  return absolute.map((full) => ({
    file: path.relative(repoRoot, full).split(path.sep).join("/"),
    text: fs.readFileSync(full, "utf8"),
  }));
}

/** 供 CLI 与单测共用的一次完整核对。 */
export function runRouteAuthCheck(repoRoot = REPO_ROOT) {
  const handlers = collectRouteHandlers(buildRouteAuthSources(repoRoot));
  const issues = auditRouteAuth(handlers);
  const unresolvable = handlers.filter((handler) => handler.reachable.length === 0);
  const truncated = handlers.reduce((total, handler) => total + handler.truncated, 0);

  if (issues.length > 0) {
    console.error(`❌ 路由鉴权清单核对失败（${issues.length} 项）`);
    console.error(formatRouteAuthIssues(issues));
    return 1;
  }
  console.log(
    `✅ 路由鉴权清单一致：${handlers.length} 个 handler 全部登记且守卫可达` +
      `（其中 ${unresolvable.length} 个登记为 public / 无守卫符号，调用图截断计数 ${truncated}）`,
  );
  return 0;
}

/** `--dump`：把解析结果打出来，供人写台账时核对（不参与判定）。 */
function dump() {
  for (const handler of collectRouteHandlers(buildRouteAuthSources(REPO_ROOT))) {
    console.log(`${handler.id}\t[${handler.reachable.join(",") || "-"}]\t${handler.file}`);
  }
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedAsScript) {
  const [target] = process.argv.slice(2);
  if (target === "--dump") dump();
  else if (target && target.startsWith("-")) {
    console.error(`❌ 未知参数：${target}（本 CLI 只认 --dump 或一个仓库路径）`);
    process.exitCode = 1;
  } else process.exitCode = runRouteAuthCheck(target ?? REPO_ROOT);
}
