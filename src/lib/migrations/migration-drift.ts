import { createHash } from "node:crypto";

export const MIGRATION_MANIFEST_VERSION = 1;
const MIGRATION_FILE_PATTERN = /^(\d{3,})_([a-z0-9][a-z0-9_-]*)\.sql$/i;

export type MigrationIssueCode =
  | "MIGRATION_UNEXPECTED_FILE"
  | "MIGRATION_FILENAME_INVALID"
  | "MIGRATION_DUPLICATE_VERSION"
  | "MIGRATION_SEQUENCE_GAP"
  | "MIGRATION_EMPTY"
  | "MIGRATION_BOM"
  | "MIGRATION_CRLF"
  | "MIGRATION_FINAL_NEWLINE"
  | "MANIFEST_JSON_INVALID"
  | "MANIFEST_SHAPE_INVALID"
  | "MANIFEST_VERSION_UNSUPPORTED"
  | "MANIFEST_ALGORITHM_UNSUPPORTED"
  | "MANIFEST_ENTRY_INVALID"
  | "MANIFEST_ENTRY_DUPLICATE"
  | "MANIFEST_ENTRY_MISSING"
  | "MANIFEST_ENTRY_EXTRA"
  | "MANIFEST_HASH_DRIFT"
  | "HISTORY_LOCAL_VERSION_DUPLICATE"
  | "HISTORY_REMOTE_VERSION_DUPLICATE"
  | "HISTORY_MIGRATION_PENDING"
  | "HISTORY_VERSION_MISSING_LOCAL";

export interface MigrationIssue {
  code: MigrationIssueCode;
  message: string;
  fileName?: string;
}

export interface MigrationSource {
  fileName: string;
  content: string;
}

export interface MigrationFile {
  version: string;
  number: number;
  description: string;
  fileName: string;
  sha256: string;
}

export interface MigrationInspection {
  files: MigrationFile[];
  issues: MigrationIssue[];
  warnings: MigrationIssue[];
}

export interface MigrationManifestEntry {
  version: string;
  fileName: string;
  sha256: string;
}

export interface MigrationManifest {
  schemaVersion: typeof MIGRATION_MANIFEST_VERSION;
  algorithm: "sha256";
  migrations: MigrationManifestEntry[];
}

export interface MigrationHistoryRow {
  local?: string | null;
  remote?: string | null;
  time?: string | null;
}

function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function issue(code: MigrationIssueCode, message: string, fileName?: string): MigrationIssue {
  return fileName ? { code, message, fileName } : { code, message };
}

function inspectContent(source: MigrationSource): MigrationIssue[] {
  const issues: MigrationIssue[] = [];
  if (source.content.startsWith("\uFEFF")) {
    issues.push(issue("MIGRATION_BOM", "UTF-8 BOM is not allowed", source.fileName));
  }
  if (source.content.trim() === "") {
    issues.push(issue("MIGRATION_EMPTY", "migration must not be empty", source.fileName));
  }
  if (source.content.includes("\r\n")) {
    issues.push(issue("MIGRATION_CRLF", "migration must use LF line endings", source.fileName));
  }
  if (source.content !== "" && !source.content.endsWith("\n")) {
    issues.push(
      issue("MIGRATION_FINAL_NEWLINE", "migration must end with a newline", source.fileName),
    );
  }
  return issues;
}

function inspectSequence(files: MigrationFile[]): MigrationIssue[] {
  if (files.length === 0) {
    return [issue("MIGRATION_SEQUENCE_GAP", "at least one migration file is required")];
  }

  const numbers = new Set(files.map((file) => file.number));
  const missing: number[] = [];
  for (let expected = 1; expected <= Math.max(...numbers); expected += 1) {
    if (!numbers.has(expected)) missing.push(expected);
  }
  if (missing.length === 0) return [];

  const display = missing
    .slice(0, 8)
    .map((number) => String(number).padStart(3, "0"))
    .join(", ");
  const suffix = missing.length > 8 ? `, +${missing.length - 8} more` : "";
  return [
    issue(
      "MIGRATION_SEQUENCE_GAP",
      `migration versions must start at 001 and be contiguous; missing ${display}${suffix}`,
    ),
  ];
}

/** Inspect all migrations without touching the filesystem. */
export function inspectMigrationFiles(sources: MigrationSource[]): MigrationInspection {
  const issues: MigrationIssue[] = [];
  const files: MigrationFile[] = [];
  const versions = new Map<string, string>();

  for (const source of sources) {
    const match = MIGRATION_FILE_PATTERN.exec(source.fileName);
    if (!match) {
      const code = source.fileName.endsWith(".sql")
        ? "MIGRATION_FILENAME_INVALID"
        : "MIGRATION_UNEXPECTED_FILE";
      const message =
        code === "MIGRATION_FILENAME_INVALID"
          ? "migration filename must match <number>_<description>.sql"
          : "only .sql migration files are allowed in this directory";
      issues.push(issue(code, message, source.fileName));
      continue;
    }

    const version = match[1];
    const previous = versions.get(version);
    if (previous) {
      issues.push(
        issue(
          "MIGRATION_DUPLICATE_VERSION",
          `duplicate migration version ${version} (also ${previous})`,
          source.fileName,
        ),
      );
      continue;
    }
    versions.set(version, source.fileName);
    issues.push(...inspectContent(source));
    files.push({
      version,
      number: Number(version),
      description: match[2],
      fileName: source.fileName,
      sha256: hashContent(source.content),
    });
  }

  files.sort((left, right) => left.number - right.number);
  issues.push(...inspectSequence(files));
  return { files, issues, warnings: [] };
}

/** Build the committed checksum manifest from an already inspected directory. */
export function createMigrationManifest(inspection: MigrationInspection): MigrationManifest {
  return {
    schemaVersion: MIGRATION_MANIFEST_VERSION,
    algorithm: "sha256",
    migrations: inspection.files.map(({ version, fileName, sha256 }) => ({
      version,
      fileName,
      sha256,
    })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseManifestEntry(
  value: unknown,
  index: number,
): MigrationManifestEntry | MigrationIssue {
  if (!isRecord(value)) {
    return issue("MANIFEST_ENTRY_INVALID", `entry ${index + 1} must be an object`);
  }
  const { version, fileName, sha256 } = value;
  if (
    typeof version !== "string" ||
    typeof fileName !== "string" ||
    typeof sha256 !== "string" ||
    !/^\d{3,}$/.test(version) ||
    !MIGRATION_FILE_PATTERN.test(fileName) ||
    !/^[a-f0-9]{64}$/i.test(sha256)
  ) {
    return issue("MANIFEST_ENTRY_INVALID", `entry ${index + 1} has invalid fields`);
  }
  if (!fileName.startsWith(`${version}_`)) {
    return issue(
      "MANIFEST_ENTRY_INVALID",
      `entry ${index + 1} version ${version} does not match ${fileName}`,
    );
  }
  return { version, fileName, sha256: sha256.toLowerCase() };
}

/** Validate the manifest shape before comparing it with migration files. */
export function validateMigrationManifest(
  inspection: MigrationInspection,
  manifest: unknown,
): MigrationIssue[] {
  const issues = [...inspection.issues];
  if (!isRecord(manifest)) {
    issues.push(issue("MANIFEST_SHAPE_INVALID", "manifest must be a JSON object"));
    return issues;
  }
  if (manifest.schemaVersion !== MIGRATION_MANIFEST_VERSION) {
    issues.push(
      issue("MANIFEST_VERSION_UNSUPPORTED", `schemaVersion must be ${MIGRATION_MANIFEST_VERSION}`),
    );
  }
  if (manifest.algorithm !== "sha256") {
    issues.push(issue("MANIFEST_ALGORITHM_UNSUPPORTED", "algorithm must be sha256"));
  }
  if (!Array.isArray(manifest.migrations)) {
    issues.push(issue("MANIFEST_SHAPE_INVALID", "migrations must be an array"));
    return issues;
  }

  const entries = new Map<string, MigrationManifestEntry>();
  manifest.migrations.forEach((rawEntry, index) => {
    const parsed = parseManifestEntry(rawEntry, index);
    if ("code" in parsed) {
      issues.push(parsed);
      return;
    }
    if (entries.has(parsed.fileName)) {
      issues.push(issue("MANIFEST_ENTRY_DUPLICATE", `duplicate manifest entry ${parsed.fileName}`));
      return;
    }
    entries.set(parsed.fileName, parsed);
  });

  const expectedNames = new Set(inspection.files.map((file) => file.fileName));
  for (const file of inspection.files) {
    const entry = entries.get(file.fileName);
    if (!entry) {
      issues.push(
        issue(
          "MANIFEST_ENTRY_MISSING",
          "migration is missing from the checksum manifest",
          file.fileName,
        ),
      );
      continue;
    }
    if (entry.sha256 !== file.sha256) {
      issues.push(
        issue(
          "MANIFEST_HASH_DRIFT",
          `migration content changed after it was baselined (expected ${entry.sha256}, got ${file.sha256})`,
          file.fileName,
        ),
      );
    }
  }

  for (const [fileName] of entries) {
    if (expectedNames.has(fileName)) continue;
    issues.push(
      issue(
        "MANIFEST_ENTRY_EXTRA",
        "manifest references a migration that no longer exists",
        fileName,
      ),
    );
  }

  return issues;
}

/** Compare local database history with versions recorded by the database. */
export function validateMigrationHistory(rows: MigrationHistoryRow[]): MigrationIssue[] {
  const issues: MigrationIssue[] = [];
  const localVersions = new Set<string>();
  const remoteVersions = new Set<string>();

  for (const row of rows) {
    if (row.local) {
      if (localVersions.has(row.local)) {
        issues.push(
          issue(
            "HISTORY_LOCAL_VERSION_DUPLICATE",
            `local migration ${row.local} appears more than once`,
          ),
        );
      }
      localVersions.add(row.local);
    }
    if (row.remote) {
      if (remoteVersions.has(row.remote)) {
        issues.push(
          issue(
            "HISTORY_REMOTE_VERSION_DUPLICATE",
            `database migration ${row.remote} appears more than once`,
          ),
        );
      }
      remoteVersions.add(row.remote);
    }
  }

  for (const version of [...localVersions].sort()) {
    if (!remoteVersions.has(version)) {
      issues.push(
        issue(
          "HISTORY_MIGRATION_PENDING",
          `migration ${version} has not been applied to the database`,
        ),
      );
    }
  }
  for (const version of [...remoteVersions].sort()) {
    if (!localVersions.has(version)) {
      issues.push(
        issue(
          "HISTORY_VERSION_MISSING_LOCAL",
          `database contains migration ${version}, but no matching local file exists`,
        ),
      );
    }
  }
  return issues;
}

/** Parse the JSON document emitted by `supabase migration list --output-format json`. */
export function parseSupabaseMigrationOutput(stdout: string): MigrationHistoryRow[] {
  const start = stdout.indexOf("{");
  if (start < 0) throw new Error("Supabase migration list did not return JSON");
  const parsed: unknown = JSON.parse(stdout.slice(start));
  if (!isRecord(parsed) || !Array.isArray(parsed.migrations)) {
    throw new Error("Supabase migration list JSON is missing the migrations array");
  }
  return parsed.migrations.map((row) => {
    if (!isRecord(row)) throw new Error("Supabase migration list contains a non-object row");
    return {
      local: typeof row.local === "string" ? row.local : null,
      remote: typeof row.remote === "string" ? row.remote : null,
      time: typeof row.time === "string" ? row.time : null,
    };
  });
}

export function formatMigrationIssues(issues: MigrationIssue[]): string {
  return issues
    .map((item) => `  - ${item.fileName ? `${item.fileName}: ` : ""}[${item.code}] ${item.message}`)
    .join("\n");
}
