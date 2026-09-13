/**
 * cron worker 调度与指标契约门禁实现（E03）。
 *
 * 规则本体在 src/lib/observability/cron-contract.ts（纯函数，由 vitest 覆盖）；这里负责
 * 收集 src/app/api/cron 下的路由文件、vercel.json 的 crons 与运维文档，输出带规则码的
 * 报告并给出退出码。
 *
 * 使用 Node 原生 type stripping 运行，因此导入 .ts 必须写显式相对路径（不能用 `@/` 别名），
 * 被导入的模块同样受此约束。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditCronContract,
  formatCronIssues,
  CRON_OPERATIONS_DOC,
  CRON_ROUTE_DIRECTORY,
  CRON_WORKERS,
} from "../../src/lib/observability/cron-contract.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const SKIP_DIRECTORIES = new Set(["node_modules", ".next", "coverage", ".git"]);

export const VERCEL_CONFIG_PATH = "vercel.json";

/** 仓库相对 POSIX 路径。 */
function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

/**
 * 收集 cron 路由文件。
 *
 * 只认 App Router 的 route.ts；测试文件（route.test.ts）与其它辅助文件都排除，
 * 否则「未注册的 cron 路由」会被测试文件误报。
 */
export function collectCronRouteFiles(root = REPO_ROOT) {
  const files = [];
  const start = path.join(root, CRON_ROUTE_DIRECTORY);
  if (!fs.existsSync(start)) return files;

  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name === "route.ts") {
        files.push(toPosixPath(path.relative(root, fullPath)));
      }
    }
  };
  walk(start);
  return files.sort();
}

/** 读取 vercel.json 的 crons；缺字段或多层结构都按空数组处理，由规则报缺失。 */
export function readPlatformCrons(root = REPO_ROOT) {
  const absolute = path.join(root, VERCEL_CONFIG_PATH);
  if (!fs.existsSync(absolute)) return [];
  const parsed = JSON.parse(fs.readFileSync(absolute, "utf8"));
  const crons = Array.isArray(parsed.crons) ? parsed.crons : [];
  return crons
    .filter((entry) => entry && typeof entry.path === "string" && typeof entry.schedule === "string")
    .map((entry) => ({ path: entry.path, schedule: entry.schedule }));
}

/** 组装审计所需的完整输入，导出以便测试用临时目录验证 CLI。 */
export function buildCronContractSnapshot(root = REPO_ROOT, overrides = {}) {
  const routeFiles = collectCronRouteFiles(root);
  const sources = {};
  for (const routeFile of routeFiles) {
    sources[routeFile] = fs.readFileSync(path.join(root, routeFile), "utf8");
  }
  const operationsDocPath = path.join(root, CRON_OPERATIONS_DOC);
  return {
    workers: overrides.workers ?? CRON_WORKERS,
    routeFiles,
    sources,
    platformCrons: readPlatformCrons(root),
    operationsDoc: fs.existsSync(operationsDocPath)
      ? fs.readFileSync(operationsDocPath, "utf8")
      : "",
    excludedSchedules: overrides.excludedSchedules,
  };
}

/**
 * 返回进程退出码：0 表示每个 cron worker 都被正确调度且指标与文档一致，
 * 1 表示存在漂移或 IO 错误。
 */
export function runCronContractCheck(root = REPO_ROOT, overrides = {}) {
  let snapshot;
  try {
    snapshot = buildCronContractSnapshot(root, overrides);
  } catch (error) {
    console.error(`❌ 无法读取 cron 契约快照：${error.message}`);
    return 1;
  }

  const report = auditCronContract(snapshot);
  if (report.issues.length > 0) {
    console.error(`❌ cron 调度与指标契约校验失败（${report.issues.length} 项）`);
    console.error(formatCronIssues(report.issues));
    return 1;
  }

  console.log(
    `✅ cron 调度与指标契约通过：${report.workers.length} 个 worker（${report.workerPaths.join("、")}）/ ` +
      `${report.metrics.length} 个指标 / 调度表达式与 vercel.json 及运维文档一致 / ` +
      `${report.exemptedPaths.length} 个平台级豁免`,
  );
  return 0;
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedAsScript) process.exitCode = runCronContractCheck(process.argv[2] ?? REPO_ROOT);
