/**
 * CHANGELOG.md 结构解析与校验（Keep a Changelog 风格）
 *
 * 供 `pnpm check:changelog` 门禁与单测复用：先解析为版本 / 章节 / 条目树，
 * 再逐条规则返回带行号的 errors / warnings。
 */

const VERSION_HEADING = /^## \[([^\]]+)\](?:\s*[—–-]\s*(\S+))?\s*$/;
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const BULLET = /^([ \t]*)-(.*)$/;
const INTRO_MAX_LENGTH = 280;
const MAX_BULLET_LENGTH = 2000;
const UNRELEASED = "Unreleased";

export interface ChangelogBullet {
  /** 已 trim 的条目正文（不含 "- " 前缀） */
  text: string;
  line: number;
  /** 前导空白数量；> 0 表示嵌套条目 */
  indent: number;
}

export interface ChangelogSection {
  name: string;
  line: number;
  bullets: ChangelogBullet[];
}

export interface ChangelogEntry {
  /** `Unreleased` 或 semver，如 `0.6.0` */
  label: string;
  /** 发布日期 YYYY-MM-DD；Unreleased 或无日期的版本标题为 null */
  date: string | null;
  line: number;
  sections: ChangelogSection[];
}

export interface ChangelogDocument {
  title: string | null;
  titleLine: number | null;
  intro: string;
  entries: ChangelogEntry[];
}

export interface ChangelogIssue {
  code: string;
  line: number | null;
  message: string;
}

export interface ChangelogReport {
  errors: ChangelogIssue[];
  warnings: ChangelogIssue[];
  entries: ChangelogEntry[];
}

export interface ChangelogParseResult {
  parsed: ChangelogDocument;
  issues: ChangelogIssue[];
}

function toLines(markdown: string): string[] {
  return markdown.replace(/\r\n?/g, "\n").split("\n");
}

function readVersionHeading(text: string): { label: string; date: string | null } | undefined {
  const match = VERSION_HEADING.exec(text);
  if (!match) return undefined;
  return { label: match[1], date: match[2] ?? null };
}

function readBullet(raw: string): { text: string; indent: number } | undefined {
  const match = BULLET.exec(raw);
  if (!match) return undefined;
  const body = match[2];
  if (body !== "" && !/^\s/.test(body)) return undefined;
  return { text: body.trim(), indent: match[1].replace(/\t/g, "  ").length };
}

function strayHeadingIssue(message: string, line: number): ChangelogIssue {
  return { code: "stray-heading", line, message };
}

/** 解析 markdown 文本为 CHANGELOG 结构；只做结构拆分，规则判断交给 validateChangelog。 */
export function parseChangelog(markdown: string): ChangelogParseResult {
  const parsed: ChangelogDocument = { title: null, titleLine: null, intro: "", entries: [] };
  const issues: ChangelogIssue[] = [];
  const introLines: string[] = [];
  let entry: ChangelogEntry | undefined;
  let section: ChangelogSection | undefined;

  toLines(markdown).forEach((raw, index) => {
    const line = index + 1;
    const text = raw.trim();
    const heading = readVersionHeading(text);

    if (heading) {
      entry = { label: heading.label, date: heading.date, line, sections: [] };
      section = undefined;
      parsed.entries.push(entry);
      return;
    }
    if (text.startsWith("## ")) {
      entry = undefined;
      section = undefined;
      issues.push(strayHeadingIssue(`无法识别的版本标题：${text}`, line));
      return;
    }
    if (text.startsWith("### ")) {
      if (!entry) {
        issues.push({
          code: "section-outside-version",
          line,
          message: `### 标题不在任何版本下：${text.slice(4).trim()}`,
        });
        return;
      }
      section = { name: text.slice(4).trim(), line, bullets: [] };
      entry.sections.push(section);
      return;
    }
    if (text.startsWith("# ")) {
      parsed.title = text.slice(2).trim();
      parsed.titleLine = line;
      return;
    }
    if (text.startsWith("#")) {
      issues.push(strayHeadingIssue(`非预期标题层级：${text}`, line));
      return;
    }

    const bullet = readBullet(raw);
    if (bullet) {
      if (section) section.bullets.push({ ...bullet, line });
      else {
        issues.push({
          code: "bullet-outside-section",
          line,
          message: `条目不在任何 ### 章节下：${bullet.text}`,
        });
      }
      return;
    }
    if (!entry && text !== "") introLines.push(text);
  });

  parsed.intro = introLines.join(" ").trim();
  return { parsed, issues };
}

function compareVersions(a: string, b: string): number | null {
  const left = SEMVER.exec(a);
  const right = SEMVER.exec(b);
  if (!left || !right) return null;
  for (let index = 1; index <= 3; index += 1) {
    const diff = Number(left[index]) - Number(right[index]);
    if (diff !== 0) return diff;
  }
  return 0;
}

function compareEntries(entries: ChangelogEntry[]): ChangelogIssue[] {
  const issues: ChangelogIssue[] = [];
  const released = entries.filter((item) => item.label !== UNRELEASED);
  for (let index = 1; index < released.length; index += 1) {
    const previous = released[index - 1];
    const current = released[index];
    const diff = compareVersions(previous.label, current.label);
    if (diff !== null && diff < 0) {
      issues.push({
        code: "version-order",
        line: current.line,
        message: `版本必须按降序排列：${previous.label} 之后出现 ${current.label}`,
      });
    }
  }
  return issues;
}

function validateEntryShape(entry: ChangelogEntry): ChangelogIssue[] {
  const issues: ChangelogIssue[] = [];
  if (entry.sections.length === 0) {
    issues.push({
      code: "version-empty",
      line: entry.line,
      message: `版本 ${entry.label} 没有任何 ### 章节`,
    });
  }
  if (entry.label === UNRELEASED) {
    if (entry.date !== null) {
      issues.push({
        code: "unreleased-date",
        line: entry.line,
        message: "[Unreleased] 不应带发布日期",
      });
    }
    return issues;
  }
  if (!SEMVER.test(entry.label)) {
    issues.push({
      code: "version-format",
      line: entry.line,
      message: `版本号必须为 x.y.z：${entry.label}`,
    });
  }
  if (entry.date === null) {
    issues.push({
      code: "version-date-missing",
      line: entry.line,
      message: `版本 ${entry.label} 缺少发布日期，格式为 ## [${entry.label}] — YYYY-MM-DD`,
    });
  } else if (!ISO_DATE.test(entry.date) || Number.isNaN(Date.parse(`${entry.date}T00:00:00Z`))) {
    issues.push({
      code: "version-date-format",
      line: entry.line,
      message: `发布日期必须为 YYYY-MM-DD：${entry.date}`,
    });
  }
  return issues;
}

function validateSectionShape(entry: ChangelogEntry, section: ChangelogSection): ChangelogIssue[] {
  const first = section.bullets.find((bullet) => bullet.text !== "");
  if (!first) {
    return [
      {
        code: "section-empty",
        line: section.line,
        message: `${entry.label} 的 ### ${section.name} 章节没有任何条目`,
      },
    ];
  }
  if (first.indent > 0) {
    return [
      {
        code: "section-no-items",
        line: first.line,
        message: `${entry.label} 的 ### ${section.name} 章节以嵌套条目开始，缺少顶层条目`,
      },
    ];
  }
  return [];
}

function validateBullets(entry: ChangelogEntry, section: ChangelogSection): ChangelogIssue[] {
  const issues: ChangelogIssue[] = [];
  for (const bullet of section.bullets) {
    const where = `${entry.label} / ${section.name}`;
    if (bullet.text === "") {
      issues.push({ code: "bullet-empty", line: bullet.line, message: `${where} 存在空条目` });
    } else if (bullet.text.length > MAX_BULLET_LENGTH) {
      issues.push({
        code: "bullet-too-long",
        line: bullet.line,
        message: `${where} 条目长度 ${bullet.text.length} 超过 ${MAX_BULLET_LENGTH} 字符`,
      });
    }
  }
  return issues;
}

function validateEntry(entry: ChangelogEntry): ChangelogIssue[] {
  const issues = validateEntryShape(entry);
  for (const section of entry.sections) {
    issues.push(...validateSectionShape(entry, section), ...validateBullets(entry, section));
  }
  return issues;
}

function validateDuplicateLabels(entries: ChangelogEntry[]): ChangelogIssue[] {
  const issues: ChangelogIssue[] = [];
  const seen = new Map<string, number>();
  for (const entry of entries) {
    const firstLine = seen.get(entry.label);
    if (firstLine !== undefined) {
      issues.push({
        code: "version-duplicate",
        line: entry.line,
        message: `重复的版本标题：${entry.label}（首次出现在第 ${firstLine} 行）`,
      });
      continue;
    }
    seen.set(entry.label, entry.line);
  }
  return issues;
}

function validatePreamble(parsed: ChangelogDocument): ChangelogIssue[] {
  const issues: ChangelogIssue[] = [];
  if (parsed.title !== "Changelog") {
    issues.push({ code: "title", line: parsed.titleLine, message: "首行标题必须是 `# Changelog`" });
  }
  if (!parsed.intro) {
    issues.push({ code: "intro", line: null, message: "标题后需要一段 CHANGELOG 说明文字" });
  } else if (parsed.intro.length > INTRO_MAX_LENGTH) {
    issues.push({
      code: "intro-length",
      line: null,
      message: `说明文字 ${parsed.intro.length} 字符，超过 ${INTRO_MAX_LENGTH}`,
    });
  }
  const first = parsed.entries[0];
  if (!first || first.label !== UNRELEASED) {
    issues.push({
      code: "unreleased-first",
      line: first?.line ?? null,
      message: "第一个版本标题必须是 `## [Unreleased]`",
    });
  }
  return issues;
}

function collectTrailingWhitespace(markdown: string): ChangelogIssue[] {
  return toLines(markdown).flatMap((raw, index) =>
    /[ \t]+$/.test(raw)
      ? [{ code: "trailing-whitespace", line: index + 1, message: "行尾存在多余空白" }]
      : [],
  );
}

/** 对 markdown 文本执行不变量校验。errors 阻断门禁，warnings 只提示。 */
export function validateChangelog(markdown: string): ChangelogReport {
  const { parsed, issues: parseIssues } = parseChangelog(markdown);
  const errors: ChangelogIssue[] = [
    ...validatePreamble(parsed),
    ...validateDuplicateLabels(parsed.entries),
    ...parsed.entries.flatMap(validateEntry),
    ...compareEntries(parsed.entries),
    ...parseIssues,
  ];
  if (markdown !== "" && !markdown.endsWith("\n")) {
    errors.push({
      code: "final-newline",
      line: toLines(markdown).length,
      message: "文件必须以换行符结尾",
    });
  }
  return {
    errors: [...errors].sort((a, b) => (a.line ?? 0) - (b.line ?? 0)),
    warnings: collectTrailingWhitespace(markdown),
    entries: parsed.entries,
  };
}

/** 将问题列表格式化为可直接打印的多行文本。 */
export function formatChangelogIssues(
  level: "error" | "warning",
  issues: ChangelogIssue[],
): string {
  const icon = level === "error" ? "❌" : "⚠️";
  return issues
    .map((issue) => `${icon} ${issue.line === null ? "" : `第 ${issue.line} 行：`}${issue.message}`)
    .join("\n");
}
