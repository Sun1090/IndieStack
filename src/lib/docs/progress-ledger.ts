/**
 * 进度台账（`docs/progress.md`）自检。
 *
 * 背景：这个文件是「谁在什么时候改了什么东西」的唯一台账，也是 PR 合并顺序判断的依据，
 * 但它自己的约定一直是靠自觉。2026-09-23 一天之内就出过两种实际损坏：
 *   - 四条新条目被插在**文件顶部**（约定是末尾追加），当天每条分支都得各自搬一次；
 *   - 一次脚本追加把同一条目写了两遍，全部门禁照绿——台账里出现了重复条目而没人发现。
 * 顶部插入会让日期倒序、重复条目会让标题重复，两者都是可判定的静态事实，于是固化成门禁。
 *
 * 失败信息里带着「该怎么办」，而不是只说违反了一条约定：2026-09-24 把 19 个 open PR 的栈尖按编号
 * 升序合成一份模拟 main 时，日期乱序就红在这里——按台账写好的解法「两块都留」解决
 * `docs/progress.md` 只保证内容不丢，不保证顺序，少了一步排序。也就是说这个 code 有两种成因
 * （条目写错了位置 / 冲突解完没排序），处置动作不同，而看到红灯的人手上没有第二种成因的文档。
 *
 * 判定（全部只读文本，CI 与本地同口径）：
 *   - 台账为空或读不出任何条目 → 失败封闭（解析坏掉不能报「一切正常」）；
 *   - 每条 `## ` 标题必须带 `YYYY-MM-DD` 日期；
 *   - 日期必须**非递减**（末尾追加的直接推论）；
 *   - 标题不得重复（同日改同一条目应编辑那一条，而不是再写一遍）；
 *   - 每条条目必须有 `- 里程碑` 与 `- 状态`——这是台账里 29/29、30/30 都存在的两个字段，
 *     其余字段（分支 / 验证 / 下一件…）出现频率不一，刻意不强制，免得门禁第一天就红。
 */

const HEADING_PATTERN = /^## (.*)$/;
const DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})\b/;

/** 台账条目必须有这两个字段：实测在全部条目里 100% 出现。 */
const REQUIRED_FIELDS = ["里程碑", "状态"] as const;

export type LedgerIssueCode =
  | "ledger-empty"
  | "heading-undated"
  | "date-out-of-order"
  | "duplicate-heading"
  | "missing-field";

export interface LedgerIssue {
  code: LedgerIssueCode;
  /** 人可读的位置：文件名 + 行号或条目标题。 */
  subject: string;
  message: string;
}

export interface LedgerEntry {
  /** 标题所在行号（1 起）。 */
  line: number;
  /** 去掉 `## ` 的完整标题。 */
  heading: string;
  /** `YYYY-MM-DD`；缺日期时为 null。 */
  date: string | null;
  /** 该条目正文（到下一条 `## ` 之前）。 */
  body: string;
}

export interface LedgerReport {
  issues: LedgerIssue[];
  entries: LedgerEntry[];
}

function issue(code: LedgerIssueCode, subject: string, message: string): LedgerIssue {
  return { code, subject, message };
}

/** 把台账切成条目；`### ` 子标题属于所属条目，不参与切分。 */
export function parseLedgerEntries(markdown: string): LedgerEntry[] {
  const lines = markdown.split("\n");
  const marks: number[] = [];
  lines.forEach((line, index) => {
    if (HEADING_PATTERN.test(line)) marks.push(index);
  });

  return marks.map((start, index) => {
    const end = index + 1 < marks.length ? marks[index + 1] : lines.length;
    const heading = lines[start].replace(/^##\s+/, "").trim();
    const date = DATE_PREFIX.exec(heading);
    return {
      line: start + 1,
      heading,
      date: date ? date[1] : null,
      body: lines.slice(start + 1, end).join("\n"),
    };
  });
}

/**
 * 字段名允许是复合写法：台账里写的是 `- 里程碑 / 版本：`，
 * 所以判定的是「以该字段名开头的行首标签」，而不是整名相等。
 */
function hasField(body: string, field: string): boolean {
  const pattern = new RegExp(`^-\\s*${field}[^：:]*[：:]`, "m");
  return pattern.test(body);
}

/** 执行台账自检。 */
export function auditProgressLedger(markdown: string): LedgerReport {
  const entries = parseLedgerEntries(markdown);
  const issues: LedgerIssue[] = [];

  if (entries.length === 0) {
    return {
      issues: [issue("ledger-empty", "docs/progress.md", "读不出任何 `## ` 条目：台账为空或格式已坏")],
      entries,
    };
  }

  for (const entry of entries) {
    if (entry.date === null) {
      issues.push(
        issue(
          "heading-undated",
          `第 ${entry.line} 行`,
          `条目标题缺少 \`YYYY-MM-DD\` 日期：## ${entry.heading}`,
        ),
      );
    }
    for (const field of REQUIRED_FIELDS) {
      if (!hasField(entry.body, field)) {
        issues.push(
          issue("missing-field", `第 ${entry.line} 行`, `条目「${entry.heading.slice(0, 30)}…」缺少必填字段 \`- ${field}：\``),
        );
      }
    }
  }

  const seen = new Map<string, number>();
  for (const entry of entries) {
    const previous = seen.get(entry.heading);
    if (previous !== undefined) {
      issues.push(
        issue(
          "duplicate-heading",
          `第 ${entry.line} 行`,
          `条目标题与第 ${previous} 行重复——同日补记应当编辑那一条，而不是再写一遍`,
        ),
      );
    } else {
      seen.set(entry.heading, entry.line);
    }
  }

  const dated = entries.filter((entry): entry is LedgerEntry & { date: string } => entry.date !== null);
  for (let index = 1; index < dated.length; index += 1) {
    if (dated[index].date < dated[index - 1].date) {
      issues.push(
        issue(
          "date-out-of-order",
          `第 ${dated[index].line} 行`,
          `日期 ${dated[index].date} 早于上一条（第 ${dated[index - 1].line} 行的 ${dated[index - 1].date}）：` +
            `新条目应当追加在文件末尾；若这是解决 docs/progress.md 冲突（两块都留）之后才红的，` +
            `做法是把条目按日期稳定排序（同一天的保持原相对顺序），不要删掉其中一条`,
        ),
      );
    }
  }

  return { issues, entries };
}

/** 稳定的可读输出（供 CLI 与单测共用）。 */
export function formatLedgerIssues(issues: readonly LedgerIssue[]): string {
  return issues
    .map((item) => `  [${item.code}] ${item.subject}\n    ${item.message}`)
    .join("\n");
}
