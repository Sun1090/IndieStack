/**
 * 请求链路追踪覆盖门禁实现（E02）。
 *
 * 规则本体在 src/lib/observability/trace-coverage.ts（纯函数，由 vitest 覆盖）；这里负责按
 * glob 收集服务端边界文件与三个契约文件，输出带规则码的报告并给出退出码。
 *
 * 使用 Node 原生 type stripping 运行，因此导入 .ts 必须写显式相对路径（不能用 `@/` 别名），
 * 被导入的模块同样受此约束。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditTraceCoverage,
  formatTraceIssues,
  TRACE_BOUNDARY_TEST_SUFFIX,
  TRACE_EXEMPT_BOUNDARY_FILES,
  TRACE_FUNNEL_PATH,
  TRACE_ID_PATH,
  TRACE_PROXY_PATH,
} from "../../src/lib/observability/trace-coverage.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const SKIP_DIRECTORIES = new Set(["node_modules", ".next", "coverage", ".git"]);

/** 仓库相对 POSIX 路径。 */
function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

function readBoundaryFile(root, relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) return undefined;
  return { fileName: relativePath, content: fs.readFileSync(absolute, "utf8") };
}

/**
 * 按 glob 收集服务端边界文件。
 *
 * route.ts 支持任意深度（App Router 的 src/app/api 子树），Server Action 只取
 * src/lib/actions 的直接子文件；测试文件必须排除，否则会被当成生产边界误报。
 */
export function collectTraceBoundaryFiles(root = REPO_ROOT) {
  const files = [];

  const walkRoutes = (directory) => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walkRoutes(fullPath);
        continue;
      }
      if (!entry.isFile() || entry.name !== "route.ts") continue;
      files.push({
        fileName: toPosixPath(path.relative(root, fullPath)),
        content: fs.readFileSync(fullPath, "utf8"),
      });
    }
  };
  walkRoutes(path.join(root, "src", "app", "api"));

  const actionDirectory = path.join(root, "src", "lib", "actions");
  if (fs.existsSync(actionDirectory)) {
    for (const entry of fs.readdirSync(actionDirectory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
      if (entry.name.endsWith(TRACE_BOUNDARY_TEST_SUFFIX)) continue;
      files.push({
        fileName: toPosixPath(path.relative(root, path.join(actionDirectory, entry.name))),
        content: fs.readFileSync(path.join(actionDirectory, entry.name), "utf8"),
      });
    }
  }

  return files.sort((left, right) => left.fileName.localeCompare(right.fileName));
}

/** 组装审计所需的完整输入，导出以便测试用临时目录验证 CLI。 */
export function buildTraceCoverageSnapshot(root = REPO_ROOT) {
  return {
    boundaryFiles: collectTraceBoundaryFiles(root),
    proxy: readBoundaryFile(root, TRACE_PROXY_PATH),
    apiLog: readBoundaryFile(root, TRACE_FUNNEL_PATH),
    traceId: readBoundaryFile(root, TRACE_ID_PATH),
    exemptions: TRACE_EXEMPT_BOUNDARY_FILES,
  };
}

/**
 * 返回进程退出码：0 表示所有服务端边界都走带 trace 的日志入口且契约文件未漂移，
 * 1 表示漂移或 IO 错误。
 */
export function runTraceCoverageCheck(root = REPO_ROOT) {
  let snapshot;
  try {
    snapshot = buildTraceCoverageSnapshot(root);
  } catch (error) {
    console.error(`❌ 无法读取请求追踪覆盖快照：${error.message}`);
    return 1;
  }

  for (const key of ["proxy", "apiLog", "traceId"]) {
    if (!snapshot[key]) {
      console.error(`❌ 请求追踪覆盖校验失败：契约文件缺失（${key}）`);
      return 1;
    }
  }

  const report = auditTraceCoverage(snapshot);
  if (report.issues.length > 0) {
    console.error(`❌ 请求追踪覆盖校验失败（${report.issues.length} 项）`);
    console.error(formatTraceIssues(report.issues));
    return 1;
  }

  console.log(
    `✅ 请求追踪覆盖校验通过：${report.scannedFiles.length} 个服务端边界 / ` +
      `${report.tracedFiles.length} 个使用带 trace 的错误入口 / ` +
      `${report.exemptedFiles.length} 个豁免；proxy、trace-id 与错误入口契约一致`,
  );
  return 0;
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedAsScript) process.exitCode = runTraceCoverageCheck(process.argv[2] ?? REPO_ROOT);
