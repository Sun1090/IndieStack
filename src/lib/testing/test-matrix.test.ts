import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  auditTestMatrix,
  extractDocumentedCommands,
  extractMatrixRows,
  formatTestMatrixIssues,
  TEST_MATRIX,
  type TestMatrixArea,
} from "./test-matrix";

const SCRIPTS: Record<string, string> = Object.fromEntries(
  TEST_MATRIX.flatMap((area) => area.commands).map((command) => [command, `node ${command}.js`]),
);

const REPO_ROOT = process.cwd();

function row(area: TestMatrixArea): string {
  const commands = area.commands.map((command) => `\`pnpm ${command}\``).join(" · ");
  return `| \`${area.id}\` | ${area.paths.join(", ")} | ${commands} |`;
}

function completeDoc(areas: readonly TestMatrixArea[] = TEST_MATRIX): string {
  return [
    "| Area | Covered paths | Required checks |",
    "| --- | --- | --- |",
    ...areas.map(row),
  ].join("\n");
}

describe("contributor test matrix audit", () => {
  it("passes when a document covers every area, path and command", () => {
    const report = auditTestMatrix({
      documents: [{ path: "docs-site/testing.md", content: completeDoc() }],
      scripts: SCRIPTS,
    });
    expect(report.issues).toEqual([]);
    expect(report.areas).toBe(TEST_MATRIX.length);
    const commandCount = TEST_MATRIX.reduce((total, area) => total + area.commands.length, 0);
    expect(report.commands).toBe(commandCount);
  });

  it("fails closed for an empty document", () => {
    const report = auditTestMatrix({
      documents: [{ path: "empty.md", content: "   \n" }],
      scripts: SCRIPTS,
    });
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]).toMatchObject({ code: "MATRIX_SOURCE_EMPTY", path: "empty.md" });
  });

  it("fails closed when no matrix table can be parsed", () => {
    const report = auditTestMatrix({
      documents: [{ path: "prose.md", content: "# no table here\n\njust prose" }],
      scripts: SCRIPTS,
    });
    expect(report.issues.map((issue) => issue.code)).toContain("MATRIX_SOURCE_EMPTY");
    expect(report.issues.map((issue) => issue.code)).toContain("MATRIX_MISSING_AREA");
  });

  it("reports an area that is registered but not documented", () => {
    const reduced = TEST_MATRIX.filter((area) => area.id !== "i18n");
    const report = auditTestMatrix({
      documents: [{ path: "docs-site/testing.md", content: completeDoc(reduced) }],
      scripts: SCRIPTS,
    });
    const issues = report.issues.filter((issue) => issue.code === "MATRIX_MISSING_AREA");
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ area: "i18n" });
  });

  it("reports an unknown area id documented in the table", () => {
    const content = `${completeDoc()}\n| \`payments\` | src/lib | \`pnpm test\` |`;
    const report = auditTestMatrix({
      documents: [{ path: "docs-site/testing.md", content }],
      scripts: SCRIPTS,
    });
    const issues = report.issues.filter((issue) => issue.code === "MATRIX_UNKNOWN_AREA");
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ area: "payments" });
  });

  it("requires each command inside its own area row", () => {
    const rows = TEST_MATRIX.map((area) =>
      area.id === "i18n" ? row({ ...area, commands: ["check:locales"] }) : row(area),
    );
    const content = [
      "| Area | Covered paths | Required checks |",
      "| --- | --- | --- |",
      ...rows,
    ].join("\n");
    const report = auditTestMatrix({
      documents: [
        { path: "docs-site/testing.md", content: `${content}\n\nElsewhere: \`pnpm check:i18n\`` },
      ],
      scripts: SCRIPTS,
    });
    const issues = report.issues.filter((issue) => issue.code === "MATRIX_MISSING_COMMAND");
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ area: "i18n", command: "check:i18n" });
  });

  it("reports a covered path that disappeared from the document", () => {
    const content = completeDoc().replace(/src\/lib\/actions/g, "src/lib/acts");
    const report = auditTestMatrix({
      documents: [{ path: "docs-site/testing.md", content }],
      scripts: SCRIPTS,
    });
    const issues = report.issues.filter((issue) => issue.code === "MATRIX_MISSING_PATH");
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          area: "server-actions",
          detail: expect.stringContaining("src/lib/actions"),
        }),
      ]),
    );
  });

  it("rejects a pnpm command that is not a real script", () => {
    const report = auditTestMatrix({
      documents: [
        {
          path: "docs-site/testing.md",
          content: `${completeDoc()}\n\nRun \`pnpm check:nope\` too.`,
        },
      ],
      scripts: SCRIPTS,
    });
    const issues = report.issues.filter((issue) => issue.code === "MATRIX_UNKNOWN_COMMAND");
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ command: "check:nope" });
  });

  it("allows allow-listed pnpm built-ins", () => {
    const report = auditTestMatrix({
      documents: [
        {
          path: "docs-site/testing.md",
          content: `${completeDoc()}\n\nStart with \`pnpm install\` before running anything.`,
        },
      ],
      scripts: SCRIPTS,
    });
    expect(report.issues).toEqual([]);
  });

  it("extracts matrix rows keyed by inline-code area id", () => {
    const rows = extractMatrixRows(completeDoc());
    expect([...rows.keys()].sort()).toEqual(TEST_MATRIX.map((area) => area.id).sort());
  });

  it("extracts pnpm commands in document order without duplicates", () => {
    const commands = extractDocumentedCommands(
      "`pnpm test` then `pnpm check:all` then `pnpm test` again",
    );
    expect(commands).toEqual(["test", "check:all"]);
  });

  it("formats issues with codes and paths", () => {
    const report = auditTestMatrix({
      documents: [{ path: "broken.md", content: completeDoc().replace(/`ui`/g, "`ux`") }],
      scripts: SCRIPTS,
    });
    const formatted = formatTestMatrixIssues(report.issues);
    expect(formatted).toContain("[MATRIX_UNKNOWN_AREA]");
    expect(formatted).toContain("[MATRIX_MISSING_AREA]");
    expect(formatted).toContain("broken.md");
  });
});

describe("contributor test matrix in this repository", () => {
  const documents = ["docs-site/testing.md", "docs-site/zh-CN/testing.md"].map((relative) => ({
    path: relative,
    content: fs.readFileSync(path.join(REPO_ROOT, relative), "utf8"),
  }));
  const scripts = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")).scripts;

  it("keeps both locale pages in sync with the registry and package.json", () => {
    const report = auditTestMatrix({ documents, scripts });
    expect(report.issues).toEqual([]);
    expect(report.areas).toBe(TEST_MATRIX.length);
  });

  it("points every registered path at something that exists on disk", () => {
    const missing = TEST_MATRIX.flatMap((area) =>
      area.paths
        .filter((repoPath) => !fs.existsSync(path.join(REPO_ROOT, repoPath)))
        .map((repoPath) => `${area.id}: ${repoPath}`),
    );
    expect(missing).toEqual([]);
  });
});
