/**
 * Whole-table RLS coverage gate.
 *
 * The rules live in `src/lib/security/rls-coverage.ts` and are covered by Vitest; this module
 * only reads the migrations off disk and renders the result.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatRlsCoverageIssues,
  inspectRlsCoverage,
} from "../../src/lib/security/rls-coverage.ts";
import {
  extractEffectivePolicies,
  splitSqlStatements,
} from "../../src/lib/security/client-write-policies.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const DEFAULT_MIGRATION_DIR = path.join(REPO_ROOT, "supabase", "migrations");

export function readMigrationSources(migrationDir = DEFAULT_MIGRATION_DIR) {
  return fs
    .readdirSync(migrationDir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => ({
      fileName: file,
      content: fs.readFileSync(path.join(migrationDir, file), "utf8"),
    }));
}

/** Count `public` tables the same way the rule module does, for the success line. */
export function countPublicTables(sources) {
  const tables = new Set();
  for (const source of sources) {
    for (const statement of splitSqlStatements(source.content)) {
      const match = /^create\s+table\s+(?:if\s+not\s+exists\s+)?(?:(?:public)\s*\.\s*)?"?([a-z_][a-z0-9_]*)"?/i.exec(
        statement,
      );
      if (match) tables.add(`public.${match[1].toLowerCase()}`);
    }
  }
  return tables.size;
}

export function runRlsCoverageCheck(options = {}) {
  const migrationDir = options.migrationDir ?? DEFAULT_MIGRATION_DIR;
  const sources = readMigrationSources(migrationDir);
  const issues = inspectRlsCoverage(sources);
  const tableCount = countPublicTables(sources);
  const policyCount = extractEffectivePolicies(sources).filter((policy) =>
    policy.table.startsWith("public."),
  ).length;

  if (issues.length > 0) {
    console.error(`❌ RLS 全表回归发现 ${issues.length} 个问题：`);
    console.error(formatRlsCoverageIssues(issues));
    console.error("  hint: 新表要么补策略，要么登记到 SERVER_ONLY_TABLES 并保持零策略");
    return 1;
  }

  console.log(
    `✅ RLS 全表回归通过：${sources.length} 个迁移、${tableCount} 张 public 表、` +
      `${policyCount} 条生效策略均带 USING / WITH CHECK，且每张表都已分类`,
  );
  return 0;
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedAsScript) {
  process.exitCode = runRlsCoverageCheck();
}
