/**
 * 迁移回滚 runbook 一致性检查实现（I10）。
 *
 * 规则本体在 src/lib/db/migration-runbook.ts（纯函数，由 vitest 覆盖）；这里负责读取
 * supabase/migration-manifest.json、package.json scripts 与 runbook 正文。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditMigrationRunbook,
  formatMigrationRunbookIssues,
} from "../../src/lib/db/migration-runbook.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const MANIFEST_PATH = "supabase/migration-manifest.json";
export const RUNBOOK_PATH = "docs/operations/migration-rollback-runbook.md";

/** 读取迁移清单（只取校验规则需要的字段）。 */
export function readMigrations(repoRoot = REPO_ROOT) {
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, MANIFEST_PATH), "utf8"));
  return (manifest.migrations ?? []).map(({ version, fileName }) => ({ version, fileName }));
}

/** 读取 package.json 的 scripts 注册表。 */
export function readScripts(repoRoot = REPO_ROOT) {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  return pkg.scripts ?? {};
}

/** 读取 runbook 校验所需的全部输入，导出以便测试用临时目录验证 CLI。 */
export function buildSnapshot(repoRoot = REPO_ROOT) {
  return {
    scripts: readScripts(repoRoot),
    migrations: readMigrations(repoRoot),
    documents: [
      {
        path: RUNBOOK_PATH,
        content: fs.readFileSync(path.join(repoRoot, RUNBOOK_PATH), "utf8"),
      },
    ],
  };
}

/** 返回进程退出码：0 表示 runbook 与仓库事实一致，1 表示存在漂移或 IO 错误。 */
export function runMigrationRunbookCheck(repoRoot = REPO_ROOT) {
  let snapshot;
  try {
    snapshot = buildSnapshot(repoRoot);
  } catch (error) {
    console.error(`❌ 无法读取迁移回滚 runbook 快照：${error.message}`);
    return 1;
  }

  const report = auditMigrationRunbook(snapshot);
  if (report.issues.length > 0) {
    console.error(`❌ 迁移回滚 runbook 校验失败（${report.issues.length} 项）`);
    console.error(formatMigrationRunbookIssues(report.issues));
    return 1;
  }
  console.log(`✅ 迁移回滚 runbook 通过：${report.migrations} 条迁移，最新 ${report.latest}`);
  return 0;
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedAsScript) process.exitCode = runMigrationRunbookCheck(process.argv[2] ?? REPO_ROOT);
