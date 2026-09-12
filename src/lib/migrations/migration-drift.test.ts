import { describe, expect, it } from "vitest";
import {
  createMigrationManifest,
  formatMigrationIssues,
  inspectMigrationFiles,
  parseSupabaseMigrationOutput,
  validateMigrationHistory,
  validateMigrationManifest,
  type MigrationSource,
} from "./migration-drift";

function migration(number: number, description = "change"): MigrationSource {
  const version = String(number).padStart(3, "0");
  return {
    fileName: `${version}_${description}.sql`,
    content: `-- ${description}\nselect ${number};\n`,
  };
}

function inspection(sources: MigrationSource[]) {
  const result = inspectMigrationFiles(sources);
  expect(result.issues).toEqual([]);
  return result;
}

function codes(issues: ReturnType<typeof inspectMigrationFiles>["issues"]): string[] {
  return issues.map((item) => item.code);
}

describe("inspectMigrationFiles", () => {
  it("accepts contiguous migrations and sorts them numerically", () => {
    const result = inspection([migration(2, "second"), migration(1, "first")]);
    expect(result.files.map((file) => file.version)).toEqual(["001", "002"]);
    expect(result.files[0]).toMatchObject({
      number: 1,
      description: "first",
      fileName: "001_first.sql",
    });
    expect(result.files[0].sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects invalid SQL filenames", () => {
    const result = inspectMigrationFiles([{ fileName: "001-change.sql", content: "select 1;\n" }]);
    expect(codes(result.issues)).toContain("MIGRATION_FILENAME_INVALID");
  });

  it("rejects non-SQL files in the migration directory", () => {
    const result = inspectMigrationFiles([{ fileName: "README.md", content: "notes\n" }]);
    expect(codes(result.issues)).toContain("MIGRATION_UNEXPECTED_FILE");
  });

  it("rejects duplicate migration versions", () => {
    const result = inspectMigrationFiles([
      migration(1, "first"),
      {
        fileName: "001_duplicate.sql",
        content: "select 1;\n",
      },
    ]);
    expect(codes(result.issues)).toContain("MIGRATION_DUPLICATE_VERSION");
  });

  it("rejects sequence gaps", () => {
    const result = inspectMigrationFiles([migration(1), migration(3)]);
    const gap = result.issues.find((item) => item.code === "MIGRATION_SEQUENCE_GAP");
    expect(gap?.message).toContain("002");
  });

  it("requires the first migration version to be 001", () => {
    const result = inspectMigrationFiles([migration(2)]);
    expect(codes(result.issues)).toContain("MIGRATION_SEQUENCE_GAP");
  });

  it("rejects empty migrations", () => {
    const result = inspectMigrationFiles([{ fileName: "001_empty.sql", content: "\n" }]);
    expect(codes(result.issues)).toContain("MIGRATION_EMPTY");
  });

  it("rejects UTF-8 BOM", () => {
    const result = inspectMigrationFiles([
      { fileName: "001_bom.sql", content: "\uFEFFselect 1;\n" },
    ]);
    expect(codes(result.issues)).toContain("MIGRATION_BOM");
  });

  it("rejects CRLF line endings", () => {
    const result = inspectMigrationFiles([{ fileName: "001_crlf.sql", content: "select 1;\r\n" }]);
    expect(codes(result.issues)).toContain("MIGRATION_CRLF");
  });

  it("requires a final newline", () => {
    const result = inspectMigrationFiles([
      { fileName: "001_no_newline.sql", content: "select 1;" },
    ]);
    expect(codes(result.issues)).toContain("MIGRATION_FINAL_NEWLINE");
  });
});

describe("migration manifest", () => {
  it("creates a deterministic SHA-256 manifest", () => {
    const manifest = createMigrationManifest(inspection([migration(1), migration(2)]));
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.algorithm).toBe("sha256");
    expect(manifest.migrations.map((entry) => entry.version)).toEqual(["001", "002"]);
  });

  it("accepts a manifest that exactly matches migration files", () => {
    const inspected = inspection([migration(1)]);
    const issues = validateMigrationManifest(inspected, createMigrationManifest(inspected));
    expect(issues).toEqual([]);
  });

  it("rejects non-object manifests", () => {
    const issues = validateMigrationManifest(inspection([migration(1)]), null);
    expect(codes(issues)).toContain("MANIFEST_SHAPE_INVALID");
  });

  it("rejects unsupported schema versions and algorithms", () => {
    const inspected = inspection([migration(1)]);
    const issues = validateMigrationManifest(inspected, {
      schemaVersion: 2,
      algorithm: "md5",
      migrations: [],
    });
    expect(codes(issues)).toEqual(
      expect.arrayContaining(["MANIFEST_VERSION_UNSUPPORTED", "MANIFEST_ALGORITHM_UNSUPPORTED"]),
    );
  });

  it("rejects a non-array migrations field", () => {
    const issues = validateMigrationManifest(inspection([migration(1)]), {
      schemaVersion: 1,
      algorithm: "sha256",
      migrations: {},
    });
    expect(codes(issues)).toContain("MANIFEST_SHAPE_INVALID");
  });

  it("rejects malformed manifest entries", () => {
    const issues = validateMigrationManifest(inspection([migration(1)]), {
      schemaVersion: 1,
      algorithm: "sha256",
      migrations: [{ version: "001", fileName: "001_change.sql", sha256: "bad" }],
    });
    expect(codes(issues)).toContain("MANIFEST_ENTRY_INVALID");
  });

  it("rejects duplicate manifest entries", () => {
    const inspected = inspection([migration(1)]);
    const entry = createMigrationManifest(inspected).migrations[0];
    const issues = validateMigrationManifest(inspected, {
      schemaVersion: 1,
      algorithm: "sha256",
      migrations: [entry, { ...entry, sha256: "0".repeat(64) }],
    });
    expect(codes(issues)).toContain("MANIFEST_ENTRY_DUPLICATE");
  });

  it("rejects a manifest entry whose version does not match the filename", () => {
    const inspected = inspection([migration(1)]);
    const issues = validateMigrationManifest(inspected, {
      schemaVersion: 1,
      algorithm: "sha256",
      migrations: [
        { version: "002", fileName: "001_change.sql", sha256: inspected.files[0].sha256 },
      ],
    });
    expect(codes(issues)).toContain("MANIFEST_ENTRY_INVALID");
  });

  it("reports migration files missing from the manifest", () => {
    const inspected = inspection([migration(1)]);
    const issues = validateMigrationManifest(inspected, {
      schemaVersion: 1,
      algorithm: "sha256",
      migrations: [],
    });
    expect(codes(issues)).toContain("MANIFEST_ENTRY_MISSING");
  });

  it("reports checksum drift for modified migrations", () => {
    const original = inspection([migration(1)]);
    const modified = inspection([migration(1, "modified")]);
    const issues = validateMigrationManifest(modified, createMigrationManifest(original));
    expect(codes(issues)).toContain("MANIFEST_ENTRY_MISSING");
    expect(codes(issues)).toContain("MANIFEST_ENTRY_EXTRA");
  });

  it("reports a changed checksum under the same filename", () => {
    const inspected = inspection([migration(1)]);
    const manifest = createMigrationManifest(inspected);
    manifest.migrations[0].sha256 = "0".repeat(64);
    const issues = validateMigrationManifest(inspected, manifest);
    expect(codes(issues)).toContain("MANIFEST_HASH_DRIFT");
  });

  it("reports stale manifest entries", () => {
    const inspected = inspection([migration(1)]);
    const manifest = createMigrationManifest(inspected);
    manifest.migrations.push({
      version: "002",
      fileName: "002_removed.sql",
      sha256: "0".repeat(64),
    });
    const issues = validateMigrationManifest(inspected, manifest);
    expect(codes(issues)).toContain("MANIFEST_ENTRY_EXTRA");
  });

  it("formats file and global issues consistently", () => {
    const output = formatMigrationIssues([
      { code: "MANIFEST_SHAPE_INVALID", message: "bad shape" },
      { code: "MANIFEST_HASH_DRIFT", message: "changed", fileName: "001_a.sql" },
    ]);
    expect(output).toContain("[MANIFEST_SHAPE_INVALID] bad shape");
    expect(output).toContain("001_a.sql: [MANIFEST_HASH_DRIFT] changed");
  });
});

describe("validateMigrationHistory", () => {
  it("accepts matching local and database versions", () => {
    expect(
      validateMigrationHistory([
        { local: "001", remote: "001" },
        { local: "002", remote: "002" },
      ]),
    ).toEqual([]);
  });

  it("reports local migrations pending in the database", () => {
    const issues = validateMigrationHistory([{ local: "002", remote: null }]);
    expect(codes(issues)).toContain("HISTORY_MIGRATION_PENDING");
  });

  it("reports database versions missing from local files", () => {
    const issues = validateMigrationHistory([{ local: null, remote: "002" }]);
    expect(codes(issues)).toContain("HISTORY_VERSION_MISSING_LOCAL");
  });

  it("reports duplicate local and remote versions", () => {
    const issues = validateMigrationHistory([
      { local: "001", remote: "001" },
      { local: "001", remote: "001" },
    ]);
    expect(codes(issues)).toEqual(
      expect.arrayContaining([
        "HISTORY_LOCAL_VERSION_DUPLICATE",
        "HISTORY_REMOTE_VERSION_DUPLICATE",
      ]),
    );
  });
});

describe("parseSupabaseMigrationOutput", () => {
  it("parses JSON after CLI status text", () => {
    const rows = parseSupabaseMigrationOutput(
      'Connecting to local database...\n{"migrations":[{"local":"001","remote":"001","time":"001"}]}',
    );
    expect(rows).toEqual([{ local: "001", remote: "001", time: "001" }]);
  });

  it("normalizes missing fields to null", () => {
    const rows = parseSupabaseMigrationOutput('{"migrations":[{"local":"001"}]}');
    expect(rows[0]).toEqual({ local: "001", remote: null, time: null });
  });

  it("rejects output without JSON", () => {
    expect(() => parseSupabaseMigrationOutput("not json")).toThrow(/did not return JSON/);
  });

  it("rejects JSON without a migrations array", () => {
    expect(() => parseSupabaseMigrationOutput("{}")).toThrow(/missing the migrations array/);
  });

  it("rejects non-object migration rows", () => {
    expect(() => parseSupabaseMigrationOutput('{"migrations":[null]}')).toThrow(/non-object row/);
  });
});
