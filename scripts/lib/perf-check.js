/**
 * 客户端构建产物性能断言的实现。
 *
 * 规则本体在 src/lib/release/perf-audit.ts（纯函数，由 vitest 覆盖，20 项）；
 * 这里只负责把 `.next/static` 读成 snapshot、把 `.next/build-manifest.json` 的
 * `rootMainFiles` 归一成产物相对路径、打印结果并给出退出码。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditPerf, formatPerfIssues, formatPerfSummary } from "../../src/lib/release/perf-audit.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const NEXT = path.join(REPO_ROOT, ".next");
const STATIC = path.join(NEXT, "static");
const BUILD_MANIFEST = path.join(NEXT, "build-manifest.json");

/** 读文本；读不出字节（二进制）返回 null——与「文件里没有这个标记」是两件事。 */
function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/**
 * 把 `build-manifest.json` 的 `rootMainFiles`（相对 `.next`，形如
 * `static/chunks/x.js`）归一成相对 `.next/static` 的路径。取不到就返回空数组——
 * 规则那一侧会把「落地页 payload 未知」当成问题项报红，而不是安静地放行。
 */
function readRootMainFiles() {
  if (!fs.existsSync(BUILD_MANIFEST)) return [];
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(BUILD_MANIFEST, "utf8"));
  } catch {
    return [];
  }
  return (manifest.rootMainFiles ?? [])
    .map((rel) => String(rel).split("?")[0])
    .filter((rel) => rel.startsWith("static/"))
    .map((rel) => rel.slice("static/".length));
}

/** 把 `.next/static` 读成审计快照（导出以便单测用临时目录构造反例）。 */
export function buildSnapshot(repoRoot = REPO_ROOT) {
  const staticDir = path.join(repoRoot, ".next", "static");
  return walk(staticDir).map((absolute) => ({
    path: path.relative(staticDir, absolute).split(path.sep).join("/"),
    bytes: fs.statSync(absolute).size,
    content: readText(absolute),
  }));
}

/** 返回进程退出码：0 表示三格全绿，1 表示存在阻断项。 */
export function runPerfCheck(repoRoot = REPO_ROOT) {
  const staticDir = path.join(repoRoot, ".next", "static");
  if (!fs.existsSync(staticDir)) {
    console.error("❌ 请先 pnpm build");
    return 1;
  }

  let files;
  try {
    files = buildSnapshot(repoRoot);
  } catch (error) {
    console.error(`❌ 无法读取构建产物快照：${error.message}`);
    return 1;
  }

  const known = new Set(files.map((file) => file.path));
  const report = auditPerf({
    files,
    rootMainFiles: readRootMainFiles(),
    exists: (candidate) => {
      const target = path.join(staticDir, candidate);
      return known.has(candidate) && fs.existsSync(target);
    },
  });

  if (report.errors.length > 0) {
    console.error(formatPerfIssues(report.errors));
    return 1;
  }
  console.log(formatPerfSummary(report));
  return 0;
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedAsScript) {
  process.exitCode = runPerfCheck(process.argv[2] ?? REPO_ROOT);
}
