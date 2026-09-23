/**
 * Supabase 列名一致性门禁的 IO 层。
 *
 * 规则本身是纯函数，住在 `src/lib/db/query-columns.ts` 并由 Vitest 覆盖；
 * 这里只负责读文件、跑规则、打印结果。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectQueryColumns } from "../../src/lib/db/query-columns.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** 生成的类型文件是列名的唯一真相。 */
export const TYPES_PATH = "src/lib/supabase/database.types.ts";

/** 参与扫描的目录：业务代码在这里查库，脚本与测试里的链是假的。 */
export const SCAN_DIRS = ["src"];

function walk(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
    })
    .sort();
}

/** 相对仓库根的 POSIX 路径，便于报告与 `file:line` 直接可点。 */
function toRepoPath(repoRoot, absolute) {
  return path.relative(repoRoot, absolute).split(path.sep).join("/");
}

function buildSources(repoRoot) {
  const files = SCAN_DIRS.flatMap((dir) => walk(path.join(repoRoot, dir))).filter(
    (file) => !/\.test\.tsx?$/.test(file),
  );
  const sources = files.map((file) => ({
    file: toRepoPath(repoRoot, file),
    content: fs.readFileSync(file, "utf8"),
  }));
  if (sources.length === 0) throw new Error(`no TypeScript sources found under ${SCAN_DIRS.join(", ")}`);
  return sources;
}

/** 返回进程退出码：0 表示每个字面量列名都在生成的行类型里。 */
export function runQueryColumnCheck(repoRoot = REPO_ROOT) {
  let report;
  try {
    report = inspectQueryColumns({
      typesContent: fs.readFileSync(path.join(repoRoot, TYPES_PATH), "utf8"),
      sources: buildSources(repoRoot),
    });
  } catch (error) {
    console.error(`❌ 无法执行列名校验：${error.message}`);
    return 1;
  }

  const { stats } = report;
  const coverage =
    `覆盖：${stats.tables} 张表 / ${stats.fromCalls} 处 .from() / ${stats.checked} 个字面量列名 / ` +
    `${stats.writeCalls} 处写入载荷（判定 ${stats.writeChecked} 个键，跳过 ${stats.writeSkippedShapes} 个读不出的载荷形状），` +
    `跳过 ${stats.skippedEmbedded} 条含关联查询的链、${stats.skippedArguments} 个非纯列名参数` +
    (stats.writeVocabularyMissing > 0
      ? `；${stats.writeVocabularyMissing} 张被写入的表没有 Insert/Update 可判`
      : "");

  if (report.issues.length > 0) {
    console.error(`❌ 查询列名与 database.types.ts 不一致（${report.issues.length} 项）`);
    for (const issue of report.issues) console.error(`   ${issue.code}: ${issue.message}`);
    console.error(`   ${coverage}`);
    return 1;
  }

  console.log(`✅ 查询列名校验通过：${coverage}`);
  return 0;
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedAsScript) process.exitCode = runQueryColumnCheck(process.argv[2] ?? REPO_ROOT);
