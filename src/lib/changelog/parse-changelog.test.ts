/**
 * CHANGELOG 结构解析与校验单测
 * 覆盖 `pnpm check:changelog` 门禁依赖的全部规则，避免文档漂移无声通过。
 */
import { describe, it, expect } from "vitest";
import { formatChangelogIssues, parseChangelog, validateChangelog } from "./parse-changelog";

const VALID = `# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- 新增能力 A，覆盖边界场景。

## [0.6.0] — 2026-09-12

### Added

- 发布版本条目。

### Fixed

- 修复既有问题。
`;

const codes = (markdown: string) => validateChangelog(markdown).errors.map((issue) => issue.code);

describe("parseChangelog()", () => {
  it("解析标题、说明与版本树", () => {
    const { parsed } = parseChangelog(VALID);
    expect(parsed.title).toBe("Changelog");
    expect(parsed.titleLine).toBe(1);
    expect(parsed.intro).toBe(
      "All notable changes to this project will be documented in this file.",
    );
    expect(parsed.entries.map((entry) => entry.label)).toEqual(["Unreleased", "0.6.0"]);
    expect(parsed.entries[0].date).toBeNull();
    expect(parsed.entries[1].date).toBe("2026-09-12");
  });

  it("解析章节与顶层/嵌套条目", () => {
    const markdown = `# Changelog

intro

## [Unreleased]

### Added

- 顶层条目
  - 嵌套细节
`;
    const { parsed } = parseChangelog(markdown);
    const [section] = parsed.entries[0].sections;
    expect(section.name).toBe("Added");
    expect(section.bullets).toEqual([
      { text: "顶层条目", line: 9, indent: 0 },
      { text: "嵌套细节", line: 10, indent: 2 },
    ]);
  });

  it("记录行号，便于门禁输出定位", () => {
    const { parsed } = parseChangelog(VALID);
    expect(parsed.entries[0].line).toBe(5);
    expect(parsed.entries[0].sections[0].line).toBe(7);
    expect(parsed.entries[0].sections[0].bullets[0].line).toBe(9);
  });

  it("无日期的版本标题不报解析错误", () => {
    const { parsed, issues } = parseChangelog(
      `# Changelog\n\nintro\n\n## [0.1.0]\n\n### Added\n\n- x\n`,
    );
    expect(issues).toEqual([]);
    expect(parsed.entries[0].date).toBeNull();
  });

  it("接受连字符分隔的日期标题", () => {
    const { parsed } = parseChangelog(
      `# Changelog\n\nintro\n\n## [0.1.0] - 2026-01-01\n\n### Added\n\n- x\n`,
    );
    expect(parsed.entries[0]).toMatchObject({ label: "0.1.0", date: "2026-01-01" });
  });
});

describe("validateChangelog() 通过用例", () => {
  it("合法的 CHANGELOG 无错误无告警", () => {
    const report = validateChangelog(VALID);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it("当前仓库 CHANGELOG.md 通过校验", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
    const markdown = readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
    const report = validateChangelog(markdown);
    expect(report.errors).toEqual([]);
  });

  it("非标准章节名与嵌套条目不算错误", () => {
    const markdown = `# Changelog

intro

## [Unreleased]

### 质量

- 条目
  - 细节
`;
    expect(codes(markdown)).toEqual([]);
  });
});

describe("validateChangelog() 标题与前言规则", () => {
  it("标题缺失或非 Changelog 报错", () => {
    expect(codes(`intro\n\n## [Unreleased]\n\n### Added\n\n- x\n`)).toContain("title");
    expect(codes(`# CHANGELOG\n\nintro\n\n## [Unreleased]\n\n### Added\n\n- x\n`)).toContain(
      "title",
    );
  });

  it("缺少说明文字报错", () => {
    expect(codes(`# Changelog\n\n## [Unreleased]\n\n### Added\n\n- x\n`)).toContain("intro");
  });

  it("说明文字过长报错", () => {
    const intro = "a".repeat(281);
    expect(codes(`# Changelog\n\n${intro}\n\n## [Unreleased]\n\n### Added\n\n- x\n`)).toContain(
      "intro-length",
    );
  });

  it("Unreleased 必须排在第一", () => {
    const markdown = `# Changelog\n\nintro\n\n## [0.1.0] — 2026-01-01\n\n### Added\n\n- x\n\n## [Unreleased]\n\n### Added\n\n- y\n`;
    expect(codes(markdown)).toContain("unreleased-first");
  });
});

describe("validateChangelog() 版本规则", () => {
  it("版本号必须为 x.y.z", () => {
    expect(
      codes(
        `# Changelog\n\nintro\n\n## [Unreleased]\n\n### Added\n\n- x\n\n## [v1.0] — 2026-01-01\n\n### Added\n\n- y\n`,
      ),
    ).toContain("version-format");
  });

  it("已发布版本必须带发布日期", () => {
    expect(
      codes(
        `# Changelog\n\nintro\n\n## [Unreleased]\n\n### Added\n\n- x\n\n## [1.0.0]\n\n### Added\n\n- y\n`,
      ),
    ).toContain("version-date-missing");
  });

  it("发布日期必须为合法 YYYY-MM-DD", () => {
    expect(
      codes(
        `# Changelog\n\nintro\n\n## [Unreleased]\n\n### Added\n\n- x\n\n## [1.0.0] — 2026-13-45\n\n### Added\n\n- y\n`,
      ),
    ).toContain("version-date-format");
    expect(
      codes(
        `# Changelog\n\nintro\n\n## [Unreleased]\n\n### Added\n\n- x\n\n## [1.0.0] — 2026/01/01\n\n### Added\n\n- y\n`,
      ),
    ).toContain("version-date-format");
  });

  it("Unreleased 不应带日期", () => {
    expect(
      codes(`# Changelog\n\nintro\n\n## [Unreleased] — 2026-01-01\n\n### Added\n\n- x\n`),
    ).toContain("unreleased-date");
  });

  it("重复版本号报错并指出首次出现行号", () => {
    const markdown = `# Changelog\n\nintro\n\n## [Unreleased]\n\n### Added\n\n- x\n\n## [1.0.0] — 2026-01-01\n\n### Added\n\n- y\n\n## [1.0.0] — 2026-02-02\n\n### Added\n\n- z\n`;
    const issue = validateChangelog(markdown).errors.find(
      (item) => item.code === "version-duplicate",
    );
    expect(issue?.message).toContain("第 11 行");
    expect(issue?.line).toBe(17);
  });

  it("版本必须按降序排列", () => {
    const markdown = `# Changelog\n\nintro\n\n## [Unreleased]\n\n### Added\n\n- x\n\n## [0.1.0] — 2026-01-01\n\n### Added\n\n- y\n\n## [0.2.0] — 2026-02-02\n\n### Added\n\n- z\n`;
    expect(codes(markdown)).toContain("version-order");
  });

  it("非法版本号不参与排序比较，只报格式错误", () => {
    const markdown = `# Changelog\n\nintro\n\n## [Unreleased]\n\n### Added\n\n- x\n\n## [1.0] — 2026-01-01\n\n### Added\n\n- y\n\n## [0.2.0] — 2026-02-02\n\n### Added\n\n- z\n`;
    const errors = codes(markdown);
    expect(errors).toContain("version-format");
    expect(errors).not.toContain("version-order");
  });

  it("版本下没有章节且条目悬空时报错", () => {
    const errors = codes(`# Changelog\n\nintro\n\n## [Unreleased]\n\n- 悬空条目\n`);
    expect(errors).toContain("version-empty");
    expect(errors).toContain("bullet-outside-section");
  });
});

describe("validateChangelog() 章节与条目规则", () => {
  it("空章节报错", () => {
    expect(codes(`# Changelog\n\nintro\n\n## [Unreleased]\n\n### Added\n`)).toContain(
      "section-empty",
    );
  });

  it("章节以嵌套条目开始报错", () => {
    const markdown = `# Changelog\n\nintro\n\n## [Unreleased]\n\n### Added\n\n  - 只有嵌套\n`;
    expect(codes(markdown)).toContain("section-no-items");
  });

  it("空条目报错", () => {
    expect(codes(`# Changelog\n\nintro\n\n## [Unreleased]\n\n### Added\n\n- \n`)).toContain(
      "bullet-empty",
    );
  });

  it("超长条目报错", () => {
    const markdown = `# Changelog\n\nintro\n\n## [Unreleased]\n\n### Added\n\n- ${"a".repeat(2001)}\n`;
    expect(codes(markdown)).toContain("bullet-too-long");
  });

  it("章节外的条目报错", () => {
    expect(
      codes(`# Changelog\n\n- 前言里的条目\n\n## [Unreleased]\n\n### Added\n\n- x\n`),
    ).toContain("bullet-outside-section");
  });

  it("### 出现在任何版本之前报错", () => {
    expect(
      codes(`# Changelog\n\nintro\n\n### Added\n\n- x\n\n## [Unreleased]\n\n### Added\n\n- y\n`),
    ).toContain("section-outside-version");
  });

  it("无法识别的版本标题报错", () => {
    expect(
      codes(
        `# Changelog\n\nintro\n\n## [Unreleased]\n\n### Added\n\n- x\n\n## 0.1.0\n\n### Added\n\n- y\n`,
      ),
    ).toContain("stray-heading");
  });
});

describe("validateChangelog() 告警与文件格式", () => {
  it("空 Unreleased 报错，避免发布时漏写条目", () => {
    const markdown = `# Changelog\n\nintro\n\n## [Unreleased]\n\n## [1.0.0] — 2026-01-01\n\n### Added\n\n- x\n`;
    const report = validateChangelog(markdown);
    const issue = report.errors.find((item) => item.code === "version-empty");
    expect(issue?.line).toBe(5);
    expect(report.warnings.map((item) => item.code)).not.toContain("unreleased-empty");
  });

  it("行尾空白产生告警并带行号", () => {
    const report = validateChangelog(
      `# Changelog\n\nintro   \n\n## [Unreleased]\n\n### Added\n\n- x\n`,
    );
    expect(report.errors).toEqual([]);
    expect(report.warnings[0]).toMatchObject({ code: "trailing-whitespace", line: 3 });
  });

  it("缺少结尾换行报错", () => {
    const markdown = VALID.trimEnd();
    expect(validateChangelog(markdown).errors.map((issue) => issue.code)).toContain(
      "final-newline",
    );
  });

  it("错误按行号排序", () => {
    const markdown = `# CHANGELOG\n\n## [Unreleased]\n\n### Added\n\n- x\n`;
    const lines = validateChangelog(markdown).errors.map((issue) => issue.line ?? 0);
    expect([...lines]).toEqual([...lines].sort((a, b) => a - b));
  });
});

describe("formatChangelogIssues()", () => {
  it("输出带行号的错误文本", () => {
    const text = formatChangelogIssues("error", [{ code: "x", line: 7, message: "示例问题" }]);
    expect(text).toBe("❌ 第 7 行：示例问题");
  });

  it("无行号时省略行号前缀", () => {
    const text = formatChangelogIssues("warning", [{ code: "x", line: null, message: "示例提示" }]);
    expect(text).toBe("⚠️ 示例提示");
  });
});
