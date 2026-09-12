/**
 * Compare Supabase's local migration files with the history recorded in the local database.
 *
 * The command is intentionally read-only and local-only. Remote/linked history checks should
 * run from the release runbook with explicit credentials and a separately approved target.
 */
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  formatMigrationIssues,
  parseSupabaseMigrationOutput,
  validateMigrationHistory,
} from "../../src/lib/migrations/migration-drift.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function readLocalMigrationHistory() {
  return execFileSync(
    "pnpm",
    ["exec", "supabase", "migration", "list", "--local", "--output-format", "json"],
    { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

/** Return a process exit code without terminating the caller. */
export function runMigrationHistoryCheck(options = {}) {
  const readHistory = options.readHistory ?? readLocalMigrationHistory;

  let rows;
  try {
    rows = parseSupabaseMigrationOutput(readHistory());
  } catch (error) {
    console.error(`❌ cannot read local migration history: ${error.message}`);
    console.error("   Start Supabase with `pnpm exec supabase start` and retry.");
    return 1;
  }

  const issues = validateMigrationHistory(rows);
  if (issues.length > 0) {
    console.error(`❌ migration history drift failed (${issues.length})`);
    console.error(formatMigrationIssues(issues));
    return 1;
  }

  const applied = rows.filter((row) => Boolean(row.local && row.remote)).length;
  console.log(`✅ migration history is aligned: ${applied} local migrations applied`);
  return 0;
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedAsScript) {
  process.exitCode = runMigrationHistoryCheck();
}
