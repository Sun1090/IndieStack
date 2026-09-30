/**
 * `AGENTS.md` 索引一致性规则。
 *
 * 背景：这条门禁原先只判两件事——「索引里引用的文件存在吗」与「`agents/` 目录有孤儿吗」，
 * 而它判「被引用」的方式是**在整份文件里正则搜 `agents/xxx.md`**。
 * 后果是：**同一个 agent 在 `AGENTS.md` 里被引用两次**（Quick Reference 表一行、
 * When to Use Which 表一行），而门禁只要求「**至少出现一次**」。
 * 于是只从 Quick Reference 表里删掉一行，另一处引用还在，**门禁照样绿**——
 * 而 `AGENTS.md` 是本仓库**所有人（包括 AI agent）开工前读的第一份文件**，
 * 它的索引表少一行意味着那个 agent 按 ID 查不到。
 *
 * 这不是理论：2026-09-30 用变异核对实测到过（删掉 `09-ui-ux` 的表行 → 门禁仍绿）。
 * 本模块把判据换成**结构化解析那张表**，而不是全文搜索：
 *
 *   - Quick Reference 表必须**逐个**列出 `agents/` 下的每个文件（不多不少）；
 *   - 行的**编号必须与文件名的数字前缀一致**（`09` ↔ `09-ui-ux.md`）——
 *     全文搜索永远查不出「编号写错了但链接是对的」；
 *   - 表外的正文链接不再算作「已索引」，但**指向不存在的文件仍然报错**
 *     （那是一条坏链接，与它出现在哪儿无关）。
 *
 * 「When to Use Which」那张表是**用法指南**，不是索引：它的行没有编号，
 * 一行对应「什么时候用哪个 agent」而不是「有哪些 agent」。**刻意不判它**——
 * 判它就要把「用法」和「清单」混成一件事，而它的行数本来就不等于 agent 数。
 */

export type AgentsIndexCode =
  | "AGENTS_TABLE_MISSING"
  | "AGENTS_TABLE_MISSING_ROW"
  | "AGENTS_TABLE_UNKNOWN_ROW"
  | "AGENTS_ID_MISMATCH"
  | "AGENTS_DUPLICATE_ROW"
  | "AGENTS_LINK_TARGET_MISSING";

export interface AgentsIndexIssue {
  code: AgentsIndexCode;
  /** 出问题的行号（1 起算），拿不到则为 null。 */
  line: number | null;
  message: string;
}

export interface AgentsIndexInput {
  /** `AGENTS.md` 全文。 */
  indexContent: string;
  /** `agents/` 目录下的文件名，如 `01-code-writer.md`。 */
  agentFiles: readonly string[];
  /** 链接目标目录前缀，判定「链接指向的文件是否存在」用。 */
  agentDir?: string;
}

export interface AgentsIndexRow {
  /** 表格里的编号，如 `01`。 */
  id: string;
  /** 链接指向的文件名。 */
  file: string;
  line: number;
}

/** Quick Reference 表的一行：`| 01 | 名称 | 职责 | [agents/01-x.md](./agents/01-x.md) |` */
const TABLE_ROW =
  /^\|\s*(\d{2})\s*\|[^|]*\|[^|]*\|\s*\[agents\/([\w-]+\.md)\]\([^)]*\)\s*\|\s*$/;

const RULE_MESSAGES: Record<AgentsIndexCode, string> = {
  AGENTS_TABLE_MISSING:
    "AGENTS.md 里找不到 Quick Reference 索引表的表头——索引表本身不见了，这道门禁就量不到任何东西",
  AGENTS_TABLE_MISSING_ROW: "这个 agent 文件没有出现在 Quick Reference 索引表里",
  AGENTS_TABLE_UNKNOWN_ROW: "Quick Reference 索引表引用了一个 agents/ 目录下不存在的文件",
  AGENTS_ID_MISMATCH: "索引表里的编号与文件名的数字前缀不一致",
  AGENTS_DUPLICATE_ROW: "Quick Reference 索引表里同一行出现了多次",
  AGENTS_LINK_TARGET_MISSING: "AGENTS.md 里有一条指向不存在文件的链接",
};

/** 解析 Quick Reference 索引表的所有数据行。 */
export function parseIndexRows(indexContent: string): AgentsIndexRow[] {
  const rows: AgentsIndexRow[] = [];
  indexContent.split("\n").forEach((line, i) => {
    const match = line.match(TABLE_ROW);
    if (!match) return;
    rows.push({ id: match[1], file: match[2], line: i + 1 });
  });
  return rows;
}

/** 文件名的数字前缀，如 `09-ui-ux.md` → `09`。 */
export function idOf(file: string): string | null {
  const match = file.match(/^(\d{2})-[\w-]+\.md$/);
  return match ? match[1] : null;
}

/** 全文里所有 `agents/xxx.md` 形式的链接（不管出现在哪）。 */
export function allLinkTargets(indexContent: string, agentDir = "agents"): string[] {
  const pattern = new RegExp(`${agentDir}/([\\w-]+\\.md)`, "g");
  return [...indexContent.matchAll(pattern)].map((m) => m[1]);
}

/** 表头存在才说明那张表真的在——表没了，上面所有判据都会「因为没有行」而空转。 */
function hasTableHeader(indexContent: string): boolean {
  return indexContent.split("\n").some((line) => /^\|\s*ID\s*\|/i.test(line.trim()));
}

/** 审计 `AGENTS.md` 索引与 `agents/` 目录是否一致。 */
export function auditAgentsIndex(input: AgentsIndexInput): AgentsIndexIssue[] {
  const issues: AgentsIndexIssue[] = [];
  const files = new Set(input.agentFiles);
  const rows = parseIndexRows(input.indexContent);

  if (!hasTableHeader(input.indexContent)) {
    issues.push({
      code: "AGENTS_TABLE_MISSING",
      line: null,
      message: RULE_MESSAGES.AGENTS_TABLE_MISSING,
    });
  }

  const seen = new Map<string, number>();
  for (const row of rows) {
    const firstLine = seen.get(row.file);
    if (firstLine !== undefined) {
      issues.push({
        code: "AGENTS_DUPLICATE_ROW",
        line: row.line,
        message: `${RULE_MESSAGES.AGENTS_DUPLICATE_ROW}（${row.file}，首次出现在第 ${firstLine} 行）`,
      });
      continue;
    }
    seen.set(row.file, row.line);
    if (!files.has(row.file)) {
      issues.push({
        code: "AGENTS_TABLE_UNKNOWN_ROW",
        line: row.line,
        message: `${RULE_MESSAGES.AGENTS_TABLE_UNKNOWN_ROW}：${row.file}`,
      });
      continue;
    }
    const expected = idOf(row.file);
    if (expected !== null && expected !== row.id) {
      issues.push({
        code: "AGENTS_ID_MISMATCH",
        line: row.line,
        message: `${RULE_MESSAGES.AGENTS_ID_MISMATCH}：表里写 ${row.id}，文件名是 ${row.file}（应为 ${expected}）`,
      });
    }
  }

  for (const file of input.agentFiles) {
    if (seen.has(file)) continue;
    issues.push({
      code: "AGENTS_TABLE_MISSING_ROW",
      line: null,
      message: `${RULE_MESSAGES.AGENTS_TABLE_MISSING_ROW}：${file}`,
    });
  }

  // 表外的坏链接仍然要报：它是一条坏链接，与它出现在哪一段无关
  for (const target of allLinkTargets(input.indexContent, input.agentDir)) {
    if (files.has(target)) continue;
    if (rows.some((row) => row.file === target)) continue;
    issues.push({
      code: "AGENTS_LINK_TARGET_MISSING",
      line: null,
      message: `${RULE_MESSAGES.AGENTS_LINK_TARGET_MISSING}：${input.agentDir ?? "agents"}/${target}`,
    });
  }

  return issues;
}

/** 把问题列表格式化成多行文本（供 CLI 与单测断言）。 */
export function formatAgentsIndexIssues(issues: readonly AgentsIndexIssue[]): string {
  return issues
    .map((issue) => `❌ [${issue.code}]${issue.line ? ` 第 ${issue.line} 行` : ""}：${issue.message}`)
    .join("\n");
}
