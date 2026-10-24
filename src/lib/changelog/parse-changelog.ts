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
/**
 * ATX 标题：`#` 之后必须有空白或换行（CommonMark 的规定）。
 *
 * 这里曾经是一条 `text.startsWith("#")` 的兜底判断，于是**中文正文里以告警 / issue
 * 编号开头的续行**（`#17 的判定日期是…`）被判成「非预期标题层级」，
 * 整条 CHANGELOG 校验直接红——而它根本不是标题。
 * 2026-10-13 写 `ops:codeql-alerts` 的条目时踩到，故按标准收紧成必须带空白。
 * 上面三个分支（`## ` / `### ` / `# `）都要求空白，只有这条兜底不要求，属自相矛盾。
 */
const ANY_HEADING = /^#{1,6}(\s|$)/;
const INTRO_MAX_LENGTH = 280;
const MAX_BULLET_LENGTH = 2000;
const UNRELEASED = "Unreleased";
/**
 * 版本章节里「不属于任何条目」的正文行。
 *
 * 判据：在 `## [版本]` 之下、顶格（indent 0）、非空、既不是 `- ` 条目也不是标题。
 * 刻意放行 `>` 引用块——`### 说明` 那类小节用「> 主题：…」是既有版式，
 * 收紧成「只许条目」会把 8 处合法写法判成缺陷（先量后写，别对着版式报警）。
 */
const ORPHAN_PROSE = /^(?![-#>\s])\S/;
/** 围栏代码块：块内的 `## ` / `- ` 是示例，不参与结构判定。 */
const FENCE = /^\s*```/;

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
    if (ANY_HEADING.test(text)) {
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

/**
 * 收集「掉出条目树」的正文行。
 *
 * ## 为什么需要它（这条规则是被两次真实损坏逼出来的）
 *
 * 解析器只认 `- ` 开头的行是条目。所以**一行只要丢了开头的 `- `，它对门禁就彻底隐形**：
 * 不报 `bullet-empty`、不报 `section-empty`、字数统计里没有它、条目数里也没有它，
 * `check:changelog` 一路绿。而它读起来完全正常——人眼看到的是一段正常的中文。
 *
 * 实测两处（都不是设想）：
 *   - `2f110bf2`（PR #258）编辑 CHANGELOG 时把下一条目的整行标题
 *     `- **summarizeRegistry()：…` 吃掉了，只剩续行 `：\`docs/testing.md\` 里那句…` 顶格悬着；
 *   - `ce4a3b25` 写的那条「发布核对方法落成模板（D03）」，标题行在后续某次编辑中丢了
 *     `- ` 前缀，正文 9 行从此挂在 `### Added` 下而不属于任何条目。
 *
 * 两处的共同点是**缺陷形态对现有判据不可见**，所以补的是「可见性」而不是「内容」。
 * 这也是本仓库反复在做的动作：把「只有跑出来才知道的事实」变成一条会红的检查。
 */
function collectOrphanProse(markdown: string): ChangelogIssue[] {
  const issues: ChangelogIssue[] = [];
  let insideVersion = false;
  let insideFence = false;
  toLines(markdown).forEach((raw, index) => {
    const text = raw.trim();
    if (FENCE.test(raw)) {
      insideFence = !insideFence;
      return;
    }
    if (insideFence) return;
    if (/^## \[/.test(text)) {
      insideVersion = true;
      return;
    }
    if (/^## /.test(text)) {
      insideVersion = false;
      return;
    }
    if (!insideVersion || text === "") return;
    // 缩进行是条目的续行，合法；`#` 开头的标题由 stray-heading 那支负责。
    if (!ORPHAN_PROSE.test(raw)) return;
    issues.push({
      code: "prose-outside-bullet",
      line: index + 1,
      message:
        "这一行不属于任何条目（开头缺少条目符号）：" +
        text.slice(0, 60) +
        "——它会被解析器完全忽略，等于这条内容从未写进 CHANGELOG",
    });
  });
  return issues;
}

/** 对 markdown 文本执行不变量校验。errors 阻断门禁，warnings 只提示。 */
export function validateChangelog(markdown: string): ChangelogReport {
  const { parsed, issues: parseIssues } = parseChangelog(markdown);
  const errors: ChangelogIssue[] = [
    ...validatePreamble(parsed),
    ...validateDuplicateLabels(parsed.entries),
    ...parsed.entries.flatMap(validateEntry),
    ...compareEntries(parsed.entries),
    ...collectOrphanProse(markdown),
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
