/**
 * ADR 治理门禁（I04）。
 *
 * 背景：仓库当前有 13 个 ADR，但 README 索引只到 ADR-009；ADR-010–013 使用英文
 * `accepted`，ADR-005 已在 ADR-013 中失去约束力却仍标为“已接受”，ADR-009 的
 * legacy 桥也被原生 v9 API 取代但没有正式的后继 ADR。人工维护索引会在新增 ADR 时
 * 继续漂移，因此本模块把以下约定固化为可执行规则：
 *
 *   - 文件名、标题编号、日期、状态字段和必要章节必须完整；
 *   - 状态只允许“提议 / 已接受（附注）/ 已废弃（被 ADR-NNN 取代）”；
 *   - README 索引必须与目录双向一致，标题和状态逐字匹配；
 *   - ADR 编号连续、索引按编号升序；
 *   - 被取代的 ADR 必须指向存在且明确引用它的后继 ADR。
 *
 * 规则只做结构治理，不判断技术决策本身是否正确。
 */

export type AdrStatusKind = "proposed" | "accepted" | "superseded";

export interface AdrStatus {
  raw: string;
  kind: AdrStatusKind;
  supersededBy?: string;
}

export interface AdrAuditFile {
  path: string;
  content: string;
}

export interface AdrDocument {
  file: string;
  number: number;
  id: string;
  title: string;
  date: string;
  status: AdrStatus;
  sections: string[];
  /** 正文原文；仅用于核对后继 ADR 是否显式引用了被取代项。 */
  content: string;
}

export interface AdrIndexEntry {
  line: number;
  number: number;
  file: string;
  title: string;
  status: AdrStatus;
}

export interface AdrIssue {
  code: string;
  file: string;
  line: number;
  message: string;
}

export interface AdrAuditReport {
  errors: AdrIssue[];
  documents: AdrDocument[];
  entries: AdrIndexEntry[];
  stats: {
    documents: number;
    indexed: number;
    accepted: number;
    proposed: number;
    superseded: number;
  };
}

export interface AdrAuditInput {
  files: readonly AdrAuditFile[];
  indexMarkdown: string;
  indexFile?: string;
  /** 可注入的 ISO 日期，便于单测固定“未来日期”行为。 */
  today?: string;
}

const ADR_FILE = /(?:^|\/)adr-(\d{3})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;
const ADR_HEADING = /^# ADR-(\d{3}):\s*(.+?)\s*$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const INDEX_ROW = /^\|\s*\[ADR-(\d{3})\]\(([^)]+)\)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/;
const REQUIRED_GROUPS = [["背景"], ["决策"], ["影响", "后果"]] as const;

function lineOf(content: string, index: number): number {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (content[cursor] === "\n") line += 1;
  }
  return line;
}

function issue(code: string, file: string, line: number, message: string): AdrIssue {
  return { code, file, line, message };
}

function readMetadata(content: string, label: string): RegExpMatchArray | null {
  const pattern = new RegExp(`^(?:-\\s*)?${label}\\s*[:：]\\s*(.+?)\\s*$`, "m");
  return pattern.exec(content);
}

function validCalendarDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** 解析 ADR 的状态文本；无法识别时返回 null，由审计层统一给出错误。 */
export function parseAdrStatus(raw: string): AdrStatus | null {
  const value = raw.trim();
  if (value === "提议") return { raw: value, kind: "proposed" };
  if (/^已接受(?:（.+）)?$/.test(value)) return { raw: value, kind: "accepted" };

  const superseded = /^已废弃（被 (ADR-\d{3}) 取代）$/.exec(value);
  if (superseded) {
    return { raw: value, kind: "superseded", supersededBy: superseded[1] };
  }
  return null;
}

function auditHeading(
  file: AdrAuditFile,
  numberText: string,
  id: string,
): { title: string; issues: AdrIssue[] } {
  const firstLine = file.content.split(/\r?\n/, 1)[0] ?? "";
  const heading = ADR_HEADING.exec(firstLine.trim());
  if (!heading) {
    return {
      title: "",
      issues: [issue("HEADING_FORMAT", file.path, 1, `首行必须形如 “# ${id}: 决策标题”`)],
    };
  }
  const title = heading[2].trim();
  const issues: AdrIssue[] = [];
  if (heading[1] !== numberText) {
    issues.push(
      issue("HEADING_NUMBER", file.path, 1, `标题编号 ADR-${heading[1]} 与文件名 ${id} 不一致`),
    );
  }
  if (!title) issues.push(issue("TITLE_EMPTY", file.path, 1, "ADR 标题不得为空"));
  return { title, issues };
}

function auditStatusField(file: AdrAuditFile): { status: AdrStatus | null; issues: AdrIssue[] } {
  const match = readMetadata(file.content, "状态");
  if (!match) {
    return { status: null, issues: [issue("STATUS_MISSING", file.path, 1, "缺少“状态:”字段")] };
  }
  const status = parseAdrStatus(match[1]);
  if (status) return { status, issues: [] };
  return {
    status: null,
    issues: [
      issue(
        "STATUS_INVALID",
        file.path,
        lineOf(file.content, match.index ?? 0),
        "状态只允许“提议 / 已接受（附注）/ 已废弃（被 ADR-NNN 取代）”",
      ),
    ],
  };
}

function auditDateField(file: AdrAuditFile, today: string): { date: string; issues: AdrIssue[] } {
  const match = readMetadata(file.content, "日期");
  if (!match) {
    return { date: "", issues: [issue("DATE_MISSING", file.path, 1, "缺少“日期:”字段")] };
  }
  const date = match[1].trim();
  const line = lineOf(file.content, match.index ?? 0);
  if (!validCalendarDate(date)) {
    return {
      date: "",
      issues: [issue("DATE_INVALID", file.path, line, `日期 ${date} 不是合法的 YYYY-MM-DD`)],
    };
  }
  if (date > today) {
    return {
      date: "",
      issues: [issue("DATE_FUTURE", file.path, line, `日期 ${date} 晚于当前日期 ${today}`)],
    };
  }
  return { date, issues: [] };
}

function auditRequiredSections(file: AdrAuditFile): { sections: string[]; issues: AdrIssue[] } {
  const sections = [...file.content.matchAll(/^##\s+(.+?)\s*$/gm)].map((match) => match[1]);
  const issues: AdrIssue[] = [];
  for (const alternatives of REQUIRED_GROUPS) {
    if (!alternatives.some((section) => sections.includes(section))) {
      issues.push(
        issue("SECTION_MISSING", file.path, 1, `缺少必要章节：${alternatives.join(" / ")}`),
      );
    }
  }
  return { sections, issues };
}

function parseAdrDocument(
  file: AdrAuditFile,
  today: string,
): { document?: AdrDocument; issues: AdrIssue[] } {
  const name = ADR_FILE.exec(file.path);
  if (!name) {
    return {
      issues: [issue("FILE_NAME", file.path, 1, "ADR 文件名必须形如 adr-NNN-kebab-title.md")],
    };
  }

  const number = Number(name[1]);
  const id = `ADR-${name[1]}`;
  const heading = auditHeading(file, name[1], id);
  const status = auditStatusField(file);
  const date = auditDateField(file, today);
  const sections = auditRequiredSections(file);
  const issues = [...heading.issues, ...status.issues, ...date.issues, ...sections.issues];

  const blocking = issues.some(
    (item) => item.code === "HEADING_FORMAT" || item.code === "STATUS_INVALID",
  );
  if (blocking || !status.status || !heading.title || !date.date) {
    return { issues };
  }

  return {
    document: {
      file: file.path,
      number,
      id,
      title: heading.title,
      date: date.date,
      status: status.status,
      sections: sections.sections,
      content: file.content,
    },
    issues,
  };
}

/** 解析 README 索引表格；返回可识别的行和结构错误。 */
export function parseAdrIndex(
  markdown: string,
  indexFile = "docs/adr/README.md",
): { entries: AdrIndexEntry[]; issues: AdrIssue[] } {
  const entries: AdrIndexEntry[] = [];
  const issues: AdrIssue[] = [];
  markdown.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    const row = INDEX_ROW.exec(raw.trim());
    if (!row) return;
    const status = parseAdrStatus(row[4]);
    const entry = {
      line,
      number: Number(row[1]),
      file: row[2].trim(),
      title: row[3].trim(),
      status: status ?? { raw: row[4].trim(), kind: "accepted" as const },
    };
    entries.push(entry);
    if (!status) {
      issues.push(
        issue("INDEX_STATUS_INVALID", indexFile, line, `索引状态无法识别：${row[4].trim()}`),
      );
    }
  });
  return { entries, issues };
}

function auditNumbering(documents: readonly AdrDocument[]): AdrIssue[] {
  const issues: AdrIssue[] = [];
  const seen = new Set<number>();
  for (const document of documents) {
    if (seen.has(document.number)) {
      issues.push(issue("NUMBER_DUPLICATE", document.file, 1, `ADR 编号 ${document.number} 重复`));
    }
    seen.add(document.number);
  }
  for (let number = 1; number <= documents.length; number += 1) {
    if (!seen.has(number)) {
      issues.push(
        issue(
          "NUMBER_GAP",
          "docs/adr",
          1,
          `ADR 编号不连续：缺少 ADR-${String(number).padStart(3, "0")}`,
        ),
      );
    }
  }
  return issues;
}

function auditIndexOrder(entries: readonly AdrIndexEntry[], indexFile: string): AdrIssue[] {
  const issues: AdrIssue[] = [];
  const seen = new Set<number>();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (seen.has(entry.number)) {
      issues.push(
        issue("INDEX_DUPLICATE", indexFile, entry.line, `ADR-${entry.number} 在索引中重复`),
      );
    }
    seen.add(entry.number);
    if (index > 0 && entries[index - 1].number > entry.number) {
      issues.push(issue("INDEX_ORDER", indexFile, entry.line, "索引必须按 ADR 编号升序排列"));
    }
  }
  return issues;
}

function auditIndexAgainstDocuments(
  documents: readonly AdrDocument[],
  entries: readonly AdrIndexEntry[],
  indexFile: string,
): AdrIssue[] {
  const issues: AdrIssue[] = [];
  const documentByNumber = new Map(documents.map((document) => [document.number, document]));
  const entryByNumber = new Map(entries.map((entry) => [entry.number, entry]));

  for (const document of documents) {
    const entry = entryByNumber.get(document.number);
    if (!entry) {
      issues.push(issue("INDEX_MISSING", indexFile, 1, `${document.id} 未登记在 README 索引`));
      continue;
    }
    const documentFile = document.file.split("/").at(-1);
    if (entry.file !== documentFile) {
      issues.push(
        issue("INDEX_FILE", indexFile, entry.line, `${document.id} 的索引链接与文件名不一致`),
      );
    }
    if (entry.title !== document.title) {
      issues.push(
        issue("INDEX_TITLE", indexFile, entry.line, `${document.id} 索引标题与正文标题不一致`),
      );
    }
    if (entry.status.raw !== document.status.raw) {
      issues.push(
        issue("INDEX_STATUS", indexFile, entry.line, `${document.id} 索引状态与正文状态不一致`),
      );
    }
  }

  for (const entry of entries) {
    if (!documentByNumber.has(entry.number)) {
      issues.push(
        issue("INDEX_ORPHAN", indexFile, entry.line, `索引引用了不存在的 ADR-${entry.number}`),
      );
    }
  }
  return issues;
}

function auditSupersession(documents: readonly AdrDocument[]): AdrIssue[] {
  const issues: AdrIssue[] = [];
  const byId = new Map(documents.map((document) => [document.id, document]));
  for (const document of documents) {
    if (document.status.kind !== "superseded") continue;
    const targetId = document.status.supersededBy;
    if (!targetId) continue;
    if (targetId === document.id) {
      issues.push(issue("SUPERSEDE_SELF", document.file, 1, `${document.id} 不能取代自身`));
      continue;
    }
    const target = byId.get(targetId);
    if (!target) {
      issues.push(
        issue("SUPERSEDE_TARGET", document.file, 1, `${document.id} 指向不存在的后继 ${targetId}`),
      );
      continue;
    }
    if (!target.content.includes(document.id)) {
      issues.push(
        issue(
          "SUPERSEDE_REFERENCE",
          target.file,
          1,
          `${target.id} 必须在正文中显式引用被其取代的 ${document.id}`,
        ),
      );
    }
  }
  return issues;
}

/** 审计完整 ADR 仓库；纯函数，不读取文件系统。 */
export function auditAdrRepository(input: AdrAuditInput): AdrAuditReport {
  const indexFile = input.indexFile ?? "docs/adr/README.md";
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const documents: AdrDocument[] = [];
  const errors: AdrIssue[] = [];

  for (const file of input.files) {
    const parsed = parseAdrDocument(file, today);
    errors.push(...parsed.issues);
    if (parsed.document) documents.push(parsed.document);
  }
  documents.sort((left, right) => left.number - right.number);

  const index = parseAdrIndex(input.indexMarkdown, indexFile);
  errors.push(...index.issues);
  errors.push(...auditNumbering(documents));
  errors.push(...auditIndexOrder(index.entries, indexFile));
  errors.push(...auditIndexAgainstDocuments(documents, index.entries, indexFile));
  errors.push(...auditSupersession(documents));

  return {
    errors,
    documents,
    entries: index.entries,
    stats: {
      documents: documents.length,
      indexed: index.entries.length,
      accepted: documents.filter((document) => document.status.kind === "accepted").length,
      proposed: documents.filter((document) => document.status.kind === "proposed").length,
      superseded: documents.filter((document) => document.status.kind === "superseded").length,
    },
  };
}

/** 格式化为带文件与行号的文本，供 CLI 和测试复用。 */
export function formatAdrIssues(issues: readonly AdrIssue[]): string {
  return issues
    .map((item) => `❌ [${item.code}] ${item.file}:${item.line} ${item.message}`)
    .join("\n");
}
