import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  auditMigrationRunbook,
  extractReferencedMigrations,
  extractRunbookCommands,
  formatMigrationRunbookIssues,
  latestMigration,
  parseLatestMarker,
  REQUIRED_RUNBOOK_COMMANDS,
  REQUIRED_RUNBOOK_FACTS,
  REQUIRED_RUNBOOK_SECTIONS,
  type MigrationManifestEntry,
} from "./migration-runbook";

const REPO_ROOT = process.cwd();

const MIGRATIONS: MigrationManifestEntry[] = [
  { version: "001", fileName: "001_initial_schema.sql" },
  { version: "030", fileName: "030_webhook_event_idempotency.sql" },
  { version: "031", fileName: "031_upload_objects.sql" },
];

const SCRIPTS: Record<string, string> = {
  "check:migrations": "node scripts/check-migrations.js",
  "check:migration-history": "node scripts/check-migration-history.js",
  "update:migrations-manifest": "node scripts/update-migrations-manifest.js",
  "smoke:supabase-identity": "node scripts/smoke-supabase-identity.js",
};

function completeDoc(): string {
  return [
    "# 迁移回滚 Runbook",
    "",
    "<!-- migration-runbook:latest=031_upload_objects.sql -->",
    "",
    ...REQUIRED_RUNBOOK_SECTIONS.flatMap((section) => [`${section}`, "", "正文。", ""]),
    ...REQUIRED_RUNBOOK_FACTS.map((fact) => `说明：${fact}`),
    "```bash",
    ...REQUIRED_RUNBOOK_COMMANDS.map((command) => `- \`pnpm ${command}\``),
    "```",
    "",
    "历史迁移 030_webhook_event_idempotency.sql 与 031_upload_objects.sql 保持只追加。",
  ].join("\n");
}

describe("migration rollback runbook audit", () => {
  it("passes a runbook that covers every section, fact, command and migration", () => {
    const report = auditMigrationRunbook({
      documents: [
        { path: "docs/operations/migration-rollback-runbook.md", content: completeDoc() },
      ],
      migrations: MIGRATIONS,
      scripts: SCRIPTS,
    });
    expect(report.issues).toEqual([]);
    expect(report.latest).toBe("031_upload_objects.sql");
    expect(report.migrations).toBe(3);
  });

  it("fails closed for an empty runbook", () => {
    const report = auditMigrationRunbook({
      documents: [{ path: "empty.md", content: "   \n" }],
      migrations: MIGRATIONS,
      scripts: SCRIPTS,
    });
    expect(report.issues.map((issue) => issue.code)).toContain("RUNBOOK_SOURCE_EMPTY");
  });

  it("fails closed when the migration manifest is empty", () => {
    const report = auditMigrationRunbook({
      documents: [{ path: "runbook.md", content: completeDoc() }],
      migrations: [],
      scripts: SCRIPTS,
    });
    expect(report.issues.map((issue) => issue.code)).toContain("RUNBOOK_SOURCE_EMPTY");
    expect(report.latest).toBeNull();
  });

  it("fails closed when no documents are supplied", () => {
    const report = auditMigrationRunbook({
      documents: [],
      migrations: MIGRATIONS,
      scripts: SCRIPTS,
    });
    expect(report.issues[0]).toMatchObject({ code: "RUNBOOK_SOURCE_EMPTY", path: "-" });
  });

  it("reports every missing section", () => {
    const content = completeDoc().replace("## 权限与审批\n\n正文。\n", "");
    const report = auditMigrationRunbook({
      documents: [{ path: "runbook.md", content }],
      migrations: MIGRATIONS,
      scripts: SCRIPTS,
    });
    const issues = report.issues.filter((issue) => issue.code === "RUNBOOK_MISSING_SECTION");
    expect(issues).toHaveLength(1);
    expect(issues[0].detail).toContain("## 权限与审批");
  });

  it("reports a missing required fact", () => {
    const content = completeDoc().replace("SUPABASE_PROJECT_REF", "PROJECT_REF");
    const report = auditMigrationRunbook({
      documents: [{ path: "runbook.md", content }],
      migrations: MIGRATIONS,
      scripts: SCRIPTS,
    });
    const issues = report.issues.filter((issue) => issue.code === "RUNBOOK_MISSING_SECTION");
    expect(issues.some((issue) => issue.detail.includes("SUPABASE_PROJECT_REF"))).toBe(true);
  });

  it("reports a missing latest-migration marker", () => {
    const content = completeDoc().replace(/<!-- migration-runbook:latest=[^>]+-->\n/, "");
    const report = auditMigrationRunbook({
      documents: [{ path: "runbook.md", content }],
      migrations: MIGRATIONS,
      scripts: SCRIPTS,
    });
    expect(report.issues.map((issue) => issue.code)).toContain("RUNBOOK_MISSING_LATEST_MARKER");
  });

  it("reports a stale latest-migration marker", () => {
    const content = completeDoc().replace(
      "migration-runbook:latest=031_upload_objects.sql",
      "migration-runbook:latest=030_webhook_event_idempotency.sql",
    );
    const report = auditMigrationRunbook({
      documents: [{ path: "runbook.md", content }],
      migrations: MIGRATIONS,
      scripts: SCRIPTS,
    });
    const issues = report.issues.filter((issue) => issue.code === "RUNBOOK_STALE_LATEST");
    expect(issues).toHaveLength(1);
    expect(issues[0].detail).toContain("031_upload_objects.sql");
  });

  it("reports a referenced migration that does not exist", () => {
    const content = `${completeDoc()}\n见 099_never_applied.sql。`;
    const report = auditMigrationRunbook({
      documents: [{ path: "runbook.md", content }],
      migrations: MIGRATIONS,
      scripts: SCRIPTS,
    });
    const issues = report.issues.filter((issue) => issue.code === "RUNBOOK_UNKNOWN_MIGRATION");
    expect(issues).toHaveLength(1);
    expect(issues[0].detail).toContain("099_never_applied.sql");
  });

  it("reports a missing required command", () => {
    const content = completeDoc().replace("- `pnpm check:migration-history`\n", "");
    const report = auditMigrationRunbook({
      documents: [{ path: "runbook.md", content }],
      migrations: MIGRATIONS,
      scripts: SCRIPTS,
    });
    const issues = report.issues.filter(
      (issue) => issue.code === "RUNBOOK_MISSING_REQUIRED_COMMAND",
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].detail).toContain("check:migration-history");
  });

  it("rejects a pnpm command that is not a real script", () => {
    const content = `${completeDoc()}\n\n另外跑 \`pnpm check:nope\`。`;
    const report = auditMigrationRunbook({
      documents: [{ path: "runbook.md", content }],
      migrations: MIGRATIONS,
      scripts: SCRIPTS,
    });
    const issues = report.issues.filter((issue) => issue.code === "RUNBOOK_UNKNOWN_COMMAND");
    expect(issues).toHaveLength(1);
    expect(issues[0].detail).toContain("check:nope");
  });

  it("allows allow-listed pnpm built-ins", () => {
    const content = `${completeDoc()}\n\n先 \`pnpm install\`，再 \`pnpm exec supabase start\`。`;
    const report = auditMigrationRunbook({
      documents: [{ path: "runbook.md", content }],
      migrations: MIGRATIONS,
      scripts: SCRIPTS,
    });
    expect(report.issues).toEqual([]);
  });
});

describe("migration runbook helpers", () => {
  it("picks the highest version regardless of manifest order", () => {
    expect(latestMigration([MIGRATIONS[2], MIGRATIONS[0], MIGRATIONS[1]])?.fileName).toBe(
      "031_upload_objects.sql",
    );
  });

  it("returns null for an empty manifest", () => {
    expect(latestMigration([])).toBeNull();
  });

  it("reads the latest marker", () => {
    expect(parseLatestMarker("x <!-- migration-runbook:latest=031_upload_objects.sql -->")).toBe(
      "031_upload_objects.sql",
    );
    expect(parseLatestMarker("no marker")).toBeNull();
  });

  it("extracts referenced migrations in order without duplicates", () => {
    expect(
      extractReferencedMigrations(
        "031_upload_objects.sql then 001_initial_schema.sql then 031_upload_objects.sql",
      ),
    ).toEqual(["031_upload_objects.sql", "001_initial_schema.sql"]);
  });

  it("ignores partial version numbers that are not full file names", () => {
    expect(extractReferencedMigrations("只删掉 031 而不是 031_upload_objects.sql")).toEqual([
      "031_upload_objects.sql",
    ]);
  });

  it("extracts pnpm commands without duplicates", () => {
    expect(extractRunbookCommands("`pnpm check:migrations` 与 `pnpm check:migrations`")).toEqual([
      "check:migrations",
    ]);
  });

  it("formats issues with codes and paths", () => {
    const report = auditMigrationRunbook({
      documents: [{ path: "broken.md", content: "nope" }],
      migrations: MIGRATIONS,
      scripts: SCRIPTS,
    });
    const formatted = formatMigrationRunbookIssues(report.issues);
    expect(formatted).toContain("[RUNBOOK_MISSING_SECTION]");
    expect(formatted).toContain("broken.md");
  });
});

describe("migration rollback runbook in this repository", () => {
  const runbook = fs.readFileSync(
    path.join(REPO_ROOT, "docs/operations/migration-rollback-runbook.md"),
    "utf8",
  );
  const manifest = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "supabase/migration-manifest.json"), "utf8"),
  ).migrations.map(({ version, fileName }: MigrationManifestEntry) => ({ version, fileName }));
  const scripts = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")).scripts;

  it("keeps the runbook in sync with the migration manifest", () => {
    const report = auditMigrationRunbook({
      documents: [{ path: "docs/operations/migration-rollback-runbook.md", content: runbook }],
      migrations: manifest,
      scripts,
    });
    expect(report.issues).toEqual([]);
    // 期望值从 manifest 推导，而不是把某个迁移名抄在这里：抄的那个数每加一条迁移就得改一次，
    // 而它并没有多证明任何事——「标记必须等于真实最新迁移」这件事由上面那条
    // `RUNBOOK_STALE_LATEST` 判定负责，这里只核对报告读到的确实是那一条。
    const newest = manifest.reduce((max: MigrationManifestEntry, entry: MigrationManifestEntry) =>
      Number(entry.version) > Number(max.version) ? entry : max,
    );
    expect(report.latest).toBe(newest.fileName);
  });
});
