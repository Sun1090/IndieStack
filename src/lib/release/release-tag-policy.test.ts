import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  auditReleasePolicy,
  auditReleaseTag,
  auditReleaseWorkflow,
  buildReleaseNotes,
  extractChangelogEntry,
  formatReleaseTagIssues,
  isValidIsoDate,
  parseReleaseVersion,
  RELEASE_TAG_CONTRACT,
  versionFromTag,
} from "./release-tag-policy";
import {
  buildReleaseTagSnapshot,
  parseReleaseTagArgs,
  runReleaseTagCheck,
} from "../../../scripts/lib/release-tag-check.js";

const VALID_CHANGELOG = `# Changelog

All notable changes to IndieStack will be documented in this file.

## [Unreleased]

### Added

- Pending work

## [1.2.3] — 2026-09-13

### Added

- Verified release content

## [1.2.2] — 2026-09-12

### Fixed

- Older release
`;

const VALID_WORKFLOW = `name: Release

on:
  push:
    tags:
      - "v*"

permissions:
  contents: write

jobs:
  release:
    name: Create GitHub Release
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0

      - uses: pnpm/action-setup@v6

      - uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: "pnpm"

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Verify release
        run: pnpm check:all

      - name: Render verified notes
        run: pnpm check:release-tag --tag "$GITHUB_REF_NAME" --notes-output release-notes.md

      - name: Create release
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: gh release create "$GITHUB_REF_NAME" --title "$GITHUB_REF_NAME" --notes-file release-notes.md
`;

const tempDirs: string[] = [];

function workflowIssues(workflow: string): string[] {
  return auditReleaseWorkflow({ workflow }).issues.map((item) => item.code);
}

function writeRepo(overrides: Record<string, string> = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "indiestack-release-tag-"));
  tempDirs.push(root);
  const files = {
    "package.json": JSON.stringify({ name: "fixture", version: "1.2.3" }),
    "CHANGELOG.md": VALID_CHANGELOG,
    ".github/workflows/release.yml": VALID_WORKFLOW,
    ...overrides,
  };
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(root, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content, "utf8");
  }
  return root;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("release version parsing", () => {
  it("accepts strict semver core versions and trims whitespace", () => {
    expect(parseReleaseVersion(" 1.2.3 ")).toBe("1.2.3");
  });

  it.each(["1.2", "v1.2.3", "1.2.3-beta.1", "", "01.2.3"])(
    "rejects unsupported release version %j",
    (value) => {
      expect(parseReleaseVersion(value)).toBeNull();
    },
  );

  it("extracts a version only when the configured tag prefix is present", () => {
    expect(versionFromTag("v1.2.3")).toBe("1.2.3");
    expect(versionFromTag("release-1.2.3", "release-")).toBe("1.2.3");
    expect(versionFromTag("1.2.3")).toBe("");
  });

  it("validates real UTC dates, including leap days", () => {
    expect(isValidIsoDate("2024-02-29")).toBe(true);
    expect(isValidIsoDate("2023-02-29")).toBe(false);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(isValidIsoDate("2026-09-1")).toBe(false);
  });
});

describe("CHANGELOG release notes", () => {
  it("extracts one published section without leaking the next version", () => {
    expect(extractChangelogEntry(VALID_CHANGELOG, "1.2.3")).toEqual({
      version: "1.2.3",
      date: "2026-09-13",
      body: "### Added\n\n- Verified release content",
    });
  });

  it("accepts an ASCII hyphen and returns undefined for missing versions", () => {
    const changelog = "## [1.0.0] - 2026-01-01\n\n### Added\n\n- Initial";
    expect(extractChangelogEntry(changelog, "1.0.0")?.date).toBe("2026-01-01");
    expect(extractChangelogEntry(changelog, "2.0.0")).toBeUndefined();
  });

  it("builds notes from the exact CHANGELOG body", () => {
    const entry = extractChangelogEntry(VALID_CHANGELOG, "1.2.3");
    expect(entry).toBeDefined();
    expect(buildReleaseNotes("v1.2.3", entry!)).toEqual({
      version: "1.2.3",
      tagName: "v1.2.3",
      date: "2026-09-13",
      title: "v1.2.3",
      body: "## v1.2.3 — 2026-09-13\n\n### Added\n\n- Verified release content\n",
    });
  });
});

describe("auditReleaseTag", () => {
  it("accepts an aligned tag, package version, and published CHANGELOG section", () => {
    const report = auditReleaseTag({
      tagName: "v1.2.3",
      packageVersion: "1.2.3",
      changelog: VALID_CHANGELOG,
    });
    expect(report.issues).toEqual([]);
    expect(report.notes?.body).toContain("Verified release content");
  });

  it("reports an invalid package version and missing CHANGELOG section", () => {
    const codes = auditReleaseTag({
      tagName: "v1.2.3",
      packageVersion: "1.2.3-beta.1",
      changelog: VALID_CHANGELOG,
    }).issues.map((item) => item.code);
    expect(codes).toContain("RELEASE_PACKAGE_VERSION_INVALID");
    expect(codes).toContain("RELEASE_CHANGELOG_ENTRY_MISSING");
  });

  it("reports a missing tag prefix and invalid tag version", () => {
    const codes = auditReleaseTag({
      tagName: "1.2.3",
      packageVersion: "1.2.3",
      changelog: VALID_CHANGELOG,
    }).issues.map((item) => item.code);
    expect(codes).toContain("RELEASE_TAG_PREFIX_MISSING");
    expect(codes).toContain("RELEASE_TAG_VERSION_INVALID");
  });

  it("reports a tag/package mismatch", () => {
    const codes = auditReleaseTag({
      tagName: "v1.2.2",
      packageVersion: "1.2.3",
      changelog: VALID_CHANGELOG,
    }).issues.map((item) => item.code);
    expect(codes).toEqual(["RELEASE_TAG_VERSION_MISMATCH"]);
  });

  it("reports empty release bodies and invalid dates", () => {
    const changelog = "## [1.2.3] — 2025-02-30\n\n## [1.2.2] — 2026-01-01\n\n### Fixed\n\n- Old";
    const codes = auditReleaseTag({ tagName: "v1.2.3", packageVersion: "1.2.3", changelog }).issues.map(
      (item) => item.code,
    );
    expect(codes).toContain("RELEASE_CHANGELOG_ENTRY_EMPTY");
    expect(codes).toContain("RELEASE_CHANGELOG_DATE_INVALID");
  });

  it("does not build notes when the tag does not match the package", () => {
    expect(
      auditReleaseTag({
        tagName: "v1.2.2",
        packageVersion: "1.2.3",
        changelog: VALID_CHANGELOG,
      }).notes,
    ).toBeUndefined();
  });
});

describe("auditReleaseWorkflow", () => {
  it("accepts a workflow that gates, validates, and publishes reviewed notes", () => {
    expect(auditReleaseWorkflow({ workflow: VALID_WORKFLOW }).issues).toEqual([]);
  });

  it("accepts the inline v* tag trigger form", () => {
    const workflow = VALID_WORKFLOW.replace('    tags:\n      - "v*"', '    tags: ["v*"]');
    expect(workflowIssues(workflow)).not.toContain("RELEASE_TRIGGER_DRIFT");
  });

  it("fails closed for an empty workflow", () => {
    expect(workflowIssues("")).toEqual(["RELEASE_WORKFLOW_MISSING"]);
  });

  it.each([
    ["RELEASE_TRIGGER_DRIFT", '      - "v*"', '      - "release-*"'],
    ["RELEASE_PERMISSION_MISSING", "  contents: write", "  contents: read"],
    ["RELEASE_FETCH_DEPTH_DRIFT", "          fetch-depth: 0", "          fetch-depth: 1"],
    [
      "RELEASE_INSTALL_MISSING",
      "        run: pnpm install --frozen-lockfile",
      "        run: pnpm install",
    ],
    ["RELEASE_GATE_MISSING", "        run: pnpm check:all", "        run: pnpm type-check"],
    [
      "RELEASE_TAG_CHECK_MISSING",
      '        run: pnpm check:release-tag --tag "$GITHUB_REF_NAME" --notes-output release-notes.md',
      "        run: pnpm check:release-docs",
    ],
    ["RELEASE_TAG_REF_DRIFT", '--tag "$GITHUB_REF_NAME"', '--tag "v1.2.3"'],
    ["RELEASE_NOTES_OUTPUT_MISSING", " --notes-output release-notes.md", ""],
    ["RELEASE_NOTES_FILE_MISSING", " --notes-file release-notes.md", ""],
    ["RELEASE_NOTES_PATH_MISMATCH", "--notes-file release-notes.md", "--notes-file other-notes.md"],
    ["RELEASE_GENERATED_NOTES_FORBIDDEN", "--notes-file release-notes.md", "--generate-notes"],
    ["RELEASE_TIMEOUT_MISSING", "    timeout-minutes: 30\n", ""],
  ])("reports %s for a drifted workflow", (code, search, replacement) => {
    const workflow = VALID_WORKFLOW.replace(search, replacement);
    expect(workflow).not.toBe(VALID_WORKFLOW);
    expect(workflowIssues(workflow)).toContain(code);
  });

  it("requires gate commands before gh release create", () => {
    const releaseLine =
      'gh release create "$GITHUB_REF_NAME" --title "$GITHUB_REF_NAME" --notes-file release-notes.md';
    const workflow = VALID_WORKFLOW.replace(releaseLine, "").replace(
      "    steps:\n",
      `    steps:\n      - name: Early release\n        run: ${releaseLine}\n`,
    );
    expect(workflowIssues(workflow)).toContain("RELEASE_ORDER_INVALID");
  });

  it("does not treat commented commands as wired gates", () => {
    const workflow = VALID_WORKFLOW.replace(
      "        run: pnpm check:all",
      "        run: '# pnpm check:all'",
    );
    expect(workflowIssues(workflow)).toContain("RELEASE_GATE_MISSING");
  });

  it("does not treat a quoted command as wired", () => {
    const workflow = VALID_WORKFLOW.replace(
      "        run: pnpm check:all",
      '        run: echo "pnpm check:all"',
    );
    expect(workflowIssues(workflow)).toContain("RELEASE_GATE_MISSING");
  });
});

describe("auditReleasePolicy / formatting", () => {
  it("merges tag and workflow checks and preserves notes", () => {
    const report = auditReleasePolicy(
      { tagName: "v1.2.3", packageVersion: "1.2.3", changelog: VALID_CHANGELOG },
      { workflow: VALID_WORKFLOW },
    );
    expect(report.issues).toEqual([]);
    expect(report.checks).toBe(22);
    expect(report.notes?.tagName).toBe("v1.2.3");
  });

  it("formats issues with stable rule codes", () => {
    expect(
      formatReleaseTagIssues([
        { code: "RELEASE_TAG_VERSION_MISMATCH", path: "CHANGELOG.md", detail: "mismatch" },
      ]),
    ).toContain("[RELEASE_TAG_VERSION_MISMATCH]");
  });
});

describe("release tag CLI", () => {
  it("parses inline and separate option values", () => {
    expect(parseReleaseTagArgs(["--tag=v1.2.3", "--notes-output", "notes.md"])).toEqual({
      tag: "v1.2.3",
      notesOutput: "notes.md",
      help: false,
    });
  });

  it("rejects unknown and valueless options", () => {
    expect(() => parseReleaseTagArgs(["--bogus"])).toThrow(/unknown argument/);
    expect(() => parseReleaseTagArgs(["--tag"])).toThrow(/requires a non-empty value/);
  });

  it("reads the real repository snapshot", () => {
    const snapshot = buildReleaseTagSnapshot();
    expect(snapshot.packageVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(snapshot.changelog).toContain(`[${snapshot.packageVersion}]`);
    expect(snapshot.workflow).toContain("check:release-tag");
  });

  it("passes the real repository and respects --help without reading files", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(runReleaseTagCheck([])).toBe(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("发布标签校验通过"));
    expect(runReleaseTagCheck(["--help"], path.join(os.tmpdir(), "missing-release-root"))).toBe(0);
  });

  it("writes verified CHANGELOG notes to the requested output", () => {
    const root = writeRepo();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(runReleaseTagCheck(["--notes-output", "release-notes.md"], root)).toBe(0);
    expect(fs.readFileSync(path.join(root, "release-notes.md"), "utf8")).toBe(
      "## v1.2.3 — 2026-09-13\n\n### Added\n\n- Verified release content\n",
    );
    expect(log).toHaveBeenCalledWith(expect.stringContaining("release-notes.md"));
  });

  it("returns 1 for a tag/version mismatch without writing notes", () => {
    const root = writeRepo();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(
      runReleaseTagCheck(["--tag", "v1.2.2", "--notes-output", "release-notes.md"], root),
    ).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("RELEASE_TAG_VERSION_MISMATCH"));
    expect(fs.existsSync(path.join(root, "release-notes.md"))).toBe(false);
  });

  it("returns 1 when a required release document is missing", () => {
    const root = writeRepo({ "CHANGELOG.md": "# Changelog\n" });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(runReleaseTagCheck([], root)).toBe(1);
  });

  it("returns 2 for malformed options and unreadable JSON", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(runReleaseTagCheck(["--bogus"])).toBe(2);
    const root = writeRepo({ "package.json": "{" });
    expect(runReleaseTagCheck([], root)).toBe(2);
    expect(error).toHaveBeenCalled();
  });

  it("exposes the stable contract", () => {
    expect(RELEASE_TAG_CONTRACT.requiredGateCommands).toEqual([
      "pnpm check:all",
      "pnpm check:release-tag",
    ]);
  });
});
