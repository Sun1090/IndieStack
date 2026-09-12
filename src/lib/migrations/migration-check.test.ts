import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MANIFEST_PATH,
  runMigrationDriftCheck,
} from "../../../scripts/lib/migration-drift-check.js";
import { runMigrationHistoryCheck } from "../../../scripts/lib/migration-history-check.js";

const tempDirs: string[] = [];

function createFixture(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "indiestack-migrations-"));
  const directory = path.join(root, "migrations");
  fs.mkdirSync(directory);
  for (const [fileName, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(directory, fileName), content, "utf8");
  }
  tempDirs.push(root);
  return { root, directory, manifestPath: path.join(root, "migration-manifest.json") };
}

afterEach(() => {
  vi.restoreAllMocks();
  while (tempDirs.length > 0) fs.rmSync(tempDirs.pop() as string, { recursive: true, force: true });
});

describe("runMigrationDriftCheck", () => {
  it("passes against the committed repository manifest", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(DEFAULT_MANIFEST_PATH.endsWith("migration-manifest.json")).toBe(true);
    expect(runMigrationDriftCheck()).toBe(0);
  });

  it("updates a manifest and then validates it", () => {
    const fixture = createFixture({
      "001_initial.sql": "select 1;\n",
      "002_second.sql": "select 2;\n",
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(runMigrationDriftCheck({ ...fixture, update: true })).toBe(0);
    expect(fs.existsSync(fixture.manifestPath)).toBe(true);
    expect(runMigrationDriftCheck(fixture)).toBe(0);
  });

  it("fails clearly when the manifest is missing", () => {
    const fixture = createFixture({ "001_initial.sql": "select 1;\n" });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(runMigrationDriftCheck(fixture)).toBe(1);
    expect(error.mock.calls.flat().join("\n")).toContain("update:migrations-manifest");
  });

  it("fails on malformed manifest JSON", () => {
    const fixture = createFixture({ "001_initial.sql": "select 1;\n" });
    fs.writeFileSync(fixture.manifestPath, "{broken", "utf8");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(runMigrationDriftCheck(fixture)).toBe(1);
    expect(error.mock.calls.flat().join("\n")).toContain("MANIFEST_JSON_INVALID");
  });

  it("rejects invalid migrations even in update mode", () => {
    const fixture = createFixture({ "001_initial.sql": "select 1;" });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(runMigrationDriftCheck({ ...fixture, update: true })).toBe(1);
    expect(fs.existsSync(fixture.manifestPath)).toBe(false);
    expect(error.mock.calls.flat().join("\n")).toContain("MIGRATION_FINAL_NEWLINE");
  });

  it("refuses to rewrite an already baselined migration", () => {
    const fixture = createFixture({ "001_initial.sql": "select 1;\n" });
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(runMigrationDriftCheck({ ...fixture, update: true })).toBe(0);
    const before = fs.readFileSync(fixture.manifestPath, "utf8");

    fs.writeFileSync(path.join(fixture.directory, "001_initial.sql"), "select 42;\n", "utf8");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(runMigrationDriftCheck({ ...fixture, update: true })).toBe(1);
    expect(fs.readFileSync(fixture.manifestPath, "utf8")).toBe(before);
    expect(error.mock.calls.flat().join("\n")).toContain("MANIFEST_HASH_DRIFT");
    expect(error.mock.calls.flat().join("\n")).toContain("immutable");
  });

  it("appends a new migration without rewriting existing baselines", () => {
    const fixture = createFixture({ "001_initial.sql": "select 1;\n" });
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(runMigrationDriftCheck({ ...fixture, update: true })).toBe(0);

    fs.writeFileSync(path.join(fixture.directory, "002_second.sql"), "select 2;\n", "utf8");
    expect(runMigrationDriftCheck({ ...fixture, update: true })).toBe(0);
    expect(runMigrationDriftCheck(fixture)).toBe(0);

    const manifest = JSON.parse(fs.readFileSync(fixture.manifestPath, "utf8"));
    expect(manifest.migrations.map((entry: { version: string }) => entry.version)).toEqual([
      "001",
      "002",
    ]);
  });

  it("refuses to overwrite a malformed manifest when updating", () => {
    const fixture = createFixture({ "001_initial.sql": "select 1;\n" });
    fs.writeFileSync(fixture.manifestPath, "{broken", "utf8");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(runMigrationDriftCheck({ ...fixture, update: true })).toBe(1);
    expect(fs.readFileSync(fixture.manifestPath, "utf8")).toBe("{broken");
    expect(error.mock.calls.flat().join("\n")).toContain("MANIFEST_JSON_INVALID");
  });
});

describe("runMigrationHistoryCheck", () => {
  it("passes when local and database histories match", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const status = runMigrationHistoryCheck({
      readHistory: () =>
        '{"migrations":[{"local":"001","remote":"001"},{"local":"002","remote":"002"}]}',
    });
    expect(status).toBe(0);
    expect(log.mock.calls.flat().join(" ")).toContain("2 local migrations applied");
  });

  it("fails when a local migration is pending", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const status = runMigrationHistoryCheck({
      readHistory: () => '{"migrations":[{"local":"002","remote":null}]}',
    });
    expect(status).toBe(1);
    expect(error.mock.calls.flat().join("\n")).toContain("HISTORY_MIGRATION_PENDING");
  });

  it("fails with recovery guidance when Supabase is unavailable", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const status = runMigrationHistoryCheck({
      readHistory: () => {
        throw new Error("connection refused");
      },
    });
    expect(status).toBe(1);
    expect(error.mock.calls.flat().join("\n")).toContain("supabase start");
  });
});
