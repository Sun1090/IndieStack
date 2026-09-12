/**
 * Migration checksum gate implementation.
 *
 * Pure inspection logic lives in src/lib/migrations/migration-drift.ts and is covered by
 * Vitest. This module only handles filesystem IO and process output.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createMigrationManifest,
  formatMigrationIssues,
  inspectMigrationFiles,
  validateMigrationManifest,
} from "../../src/lib/migrations/migration-drift.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const DEFAULT_MIGRATIONS_DIR = path.join(REPO_ROOT, "supabase", "migrations");
export const DEFAULT_MANIFEST_PATH = path.join(REPO_ROOT, "supabase", "migration-manifest.json");

function readSources(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => ({
      fileName: entry.name,
      content: fs.readFileSync(path.join(directory, entry.name), "utf8"),
    }))
    .sort((left, right) => left.fileName.localeCompare(right.fileName));
}

function readManifest(manifestPath, missingIsEmpty = false) {
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    if (missingIsEmpty && error && typeof error === "object" && error.code === "ENOENT") {
      return null;
    }
    const message =
      error && typeof error === "object" && "code" in error && error.code === "ENOENT"
        ? `manifest not found at ${manifestPath}; run pnpm update:migrations-manifest`
        : `cannot parse manifest at ${manifestPath}: ${error.message}`;
    return { __error: message };
  }
}

/** Return a process exit code without terminating the caller. */
export function runMigrationDriftCheck(options = {}) {
  const directory = options.directory ?? DEFAULT_MIGRATIONS_DIR;
  const manifestPath = options.manifestPath ?? DEFAULT_MANIFEST_PATH;
  const update = options.update ?? false;

  let inspection;
  try {
    inspection = inspectMigrationFiles(readSources(directory));
  } catch (error) {
    console.error(`❌ cannot read migrations: ${error.message}`);
    return 1;
  }

  if (inspection.issues.length > 0) {
    console.error(`❌ migration drift check failed (${inspection.issues.length})`);
    console.error(formatMigrationIssues(inspection.issues));
    return 1;
  }

  const manifest = createMigrationManifest(inspection);
  if (update) {
    const previousManifest = readManifest(manifestPath, true);
    if (previousManifest && previousManifest.__error) {
      console.error(`❌ migration manifest update refused (1)`);
      console.error(`  - [MANIFEST_JSON_INVALID] ${previousManifest.__error}`);
      return 1;
    }
    if (previousManifest) {
      const updateIssues = validateMigrationManifest(inspection, previousManifest).filter(
        (item) => item.code !== "MANIFEST_ENTRY_MISSING",
      );
      if (updateIssues.length > 0) {
        console.error(`❌ migration manifest update refused (${updateIssues.length})`);
        console.error("   Existing migrations are immutable; add a new forward migration instead.");
        console.error(formatMigrationIssues(updateIssues));
        return 1;
      }
    }
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    console.log(`✅ migration manifest updated: ${manifest.migrations.length} files`);
    return 0;
  }

  const storedManifest = readManifest(manifestPath);
  if (storedManifest && storedManifest.__error) {
    console.error(`❌ migration drift check failed (1)`);
    console.error(`  - [MANIFEST_JSON_INVALID] ${storedManifest.__error}`);
    return 1;
  }

  const issues = validateMigrationManifest(inspection, storedManifest);
  if (issues.length > 0) {
    console.error(`❌ migration drift check failed (${issues.length})`);
    console.error(formatMigrationIssues(issues));
    return 1;
  }

  console.log(
    `✅ migration drift check passed: ${inspection.files.length} immutable migrations match SHA-256 manifest`,
  );
  return 0;
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedAsScript) {
  process.exitCode = runMigrationDriftCheck({ update: process.argv.includes("--update") });
}
