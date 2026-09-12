/**
 * `pnpm check:changelog` 门禁行为单测
 * 保证脚本可读文件、按 errors 返回退出码 1、warnings 只提示不阻断。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CHANGELOG_PATH, runChangelogCheck } from "../../../scripts/lib/changelog-check.js";

const VALID_CHANGELOG = `# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- 条目。

## [0.6.0] — 2026-09-12

### Added

- 发布条目。
`;

const tempDirs: string[] = [];

function writeTempChangelog(content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "indiestack-changelog-"));
  tempDirs.push(dir);
  const file = path.join(dir, "CHANGELOG.md");
  fs.writeFileSync(file, content, "utf8");
  return file;
}

afterEach(() => {
  vi.restoreAllMocks();
  while (tempDirs.length > 0) fs.rmSync(tempDirs.pop() as string, { recursive: true, force: true });
});

describe("runChangelogCheck()", () => {
  it("默认校验仓库 CHANGELOG.md 并返回 0", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(DEFAULT_CHANGELOG_PATH.endsWith("CHANGELOG.md")).toBe(true);
    expect(runChangelogCheck()).toBe(0);
  });

  it("结构合法时返回 0 并输出统计", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const status = runChangelogCheck(writeTempChangelog(VALID_CHANGELOG));
    expect(status).toBe(0);
    expect(log.mock.calls.flat().join(" ")).toContain("CHANGELOG 结构校验通过");
  });

  it("结构非法时返回 1 并打印定位信息", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const status = runChangelogCheck(writeTempChangelog("# Changelog\n\nintro\n"));
    expect(status).toBe(1);
    expect(error.mock.calls.flat().join("\n")).toContain("`## [Unreleased]`");
  });

  it("文件不存在时返回 1 而不是抛出", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(runChangelogCheck(path.join(os.tmpdir(), "missing-changelog-xyz.md"))).toBe(1);
    expect(error.mock.calls.flat().join("\n")).toContain("无法读取 CHANGELOG");
  });

  it("warnings 不阻断退出码", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const withTrailingWhitespace = VALID_CHANGELOG.replace(
      "documented in this file.",
      "documented in this file.   ",
    );
    expect(runChangelogCheck(writeTempChangelog(withTrailingWhitespace))).toBe(0);
    expect(warn).toHaveBeenCalled();
  });
});
