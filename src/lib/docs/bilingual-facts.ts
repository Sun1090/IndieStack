/**
 * 双语调度事实一致性规则（v0.12.0 D02）。
 *
 * 背景：`docs-site/` 与 `docs-site/zh-CN/` 是同一份文档的两种语言，但没有任何门禁保证
 * 两边说同一件事。v0.6.0 的 I01 就是这么烂掉的——英文版写着「外部 cron 逐小时调度」，
 * 中文版写着「每天 09:00 UTC」，两条互斥的陈述并存了很久，而 digest 的真实投递语义
 * （以及随之而来的那个 P0）恰好就藏在这个调度频率的分歧里。同类问题在本次核对中又出现一次：
 * 英文版 `web-push.md` 说 `/api/cron/push-retry` 每 15 分钟跑一次，中文版已经改成每天一次。
 *
 * 只核对**结构化的调度事实**，不核对文案：
 *
 *   - 5 字段 cron 表达式（必须能被 `isValidCronSchedule` 接受，避免把散文里的数字串当表达式）；
 *   - `HH:MM` 且紧跟 `UTC` 的时刻。
 *
 * 规则：同一页的两种语言，两边抽出的集合必须完全相等——一边提到而另一边没有，也算失败，
 * 因为「只改一种语言」正是漂移的发生方式。抽取全空视为通过（多数页面没有调度事实），
 * 但一份文档整体为空或根本找不到配对时失败封闭。
 */

import { isValidCronSchedule } from "../observability/cron-contract.ts";

export type BilingualDocIssueCode =
  | "DOC_NO_PAIRS"
  | "DOC_PAIR_MISSING"
  | "DOC_SOURCE_EMPTY"
  | "DOC_CRON_MISMATCH"
  | "DOC_TIME_MISMATCH";

export interface BilingualDocIssue {
  code: BilingualDocIssueCode;
  /** 出问题的文档路径（配对缺失时用英文页路径）。 */
  document: string;
  detail: string;
}

export interface BilingualDocDocument {
  /** 仓库相对路径，如 `docs-site/email.md` 或 `docs-site/zh-CN/email.md`。 */
  path: string;
  content: string;
}

export interface BilingualDocFacts {
  /** 归一化后的 5 字段 cron 表达式。 */
  cronExpressions: string[];
  /** 归一化为 `HH:MM` 的 UTC 时刻。 */
  utcTimes: string[];
}

/** zh 文档目录；配对口径是「同目录树下的同名文件」。 */
export const ZH_DIRECTORY = "docs-site/zh-CN/";

const CRON_CANDIDATE = /(?:^|[^0-9*/,-])((?:[\d*,/\-]+\s+){4}[\d*,/\-]+)(?![0-9*/,-])/g;
const UTC_TIME = /(\d{1,2}):(\d{2})\s*UTC/g;

/** 从一篇文档里抽出可机器核对的调度事实。 */
export function extractSchedulingFacts(content: string): BilingualDocFacts {
  const cron = new Set<string>();
  for (const match of content.matchAll(CRON_CANDIDATE)) {
    const expression = match[1].trim().replace(/\s+/g, " ");
    if (isValidCronSchedule(expression)) cron.add(expression);
  }

  const times = new Set<string>();
  for (const match of content.matchAll(UTC_TIME)) {
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) continue;
    times.add(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
  }

  return {
    cronExpressions: [...cron].sort(),
    utcTimes: [...times].sort(),
  };
}

/** 英文页路径 → 中文页路径。 */
export function zhCounterpartPath(path: string): string {
  return `${ZH_DIRECTORY}${path.slice("docs-site/".length)}`;
}

function differenceText(missing: string[], extra: string[]): string {
  const parts: string[] = [];
  if (missing.length > 0) parts.push(`缺少 ${missing.join("、")}`);
  if (extra.length > 0) parts.push(`多出 ${extra.join("、")}`);
  return parts.join("；");
}

/** 比对一组事实集合，把差异写成规则码。 */
function compareFact(
  code: BilingualDocIssueCode,
  document: string,
  label: string,
  en: string[],
  zh: string[],
  issues: BilingualDocIssue[],
): void {
  const missing = en.filter((value) => !zh.includes(value));
  const extra = zh.filter((value) => !en.includes(value));
  if (missing.length === 0 && extra.length === 0) return;
  issues.push({
    code,
    document,
    detail: `${label}与中文版不一致：${differenceText(missing, extra)}`,
  });
}

/**
 * 核对所有 `docs-site/*.md` 与其 `zh-CN` 配对的调度事实。
 *
 * 一篇英文页找不到配对时按 `DOC_PAIR_MISSING` 报告——删掉中文页来让门禁闭嘴
 * 与「只改一种语言」是同一类漂移。
 */
export function auditBilingualDocs(
  documents: readonly BilingualDocDocument[],
): { issues: BilingualDocIssue[]; pairs: string[]; facts: BilingualDocFacts } {
  const byPath = new Map(documents.map((doc) => [doc.path, doc.content]));
  const issues: BilingualDocIssue[] = [];
  const pairs: string[] = [];
  const allCron = new Set<string>();
  const allTimes = new Set<string>();

  for (const doc of documents) {
    if (doc.path.startsWith(ZH_DIRECTORY)) continue;
    if (!doc.path.startsWith("docs-site/")) continue;
    const zhPath = zhCounterpartPath(doc.path);
    if (!byPath.has(zhPath)) {
      issues.push({
        code: "DOC_PAIR_MISSING",
        document: doc.path,
        detail: `没有 ${zhPath}：双语只有一边，调度事实无法互相核对`,
      });
      continue;
    }
    const enContent = doc.content;
    const zhContent = byPath.get(zhPath) ?? "";
    if (!enContent.trim() || !zhContent.trim()) {
      issues.push({
        code: "DOC_SOURCE_EMPTY",
        document: enContent.trim() ? zhPath : doc.path,
        detail: "文档内容为空，按「无法核对」处理而不是「没有差异」",
      });
      continue;
    }

    pairs.push(doc.path);
    const en = extractSchedulingFacts(enContent);
    const zh = extractSchedulingFacts(zhContent);
    for (const expression of [...en.cronExpressions, ...zh.cronExpressions]) allCron.add(expression);
    for (const time of [...en.utcTimes, ...zh.utcTimes]) allTimes.add(time);
    compareFact("DOC_CRON_MISMATCH", doc.path, "cron 表达式", en.cronExpressions, zh.cronExpressions, issues);
    compareFact("DOC_TIME_MISMATCH", doc.path, "UTC 时刻", en.utcTimes, zh.utcTimes, issues);
  }

  if (pairs.length === 0) {
    issues.push({
      code: "DOC_NO_PAIRS",
      document: "docs-site",
      detail: "没有核对到任何双语页：要么文档目录被清空，要么配对口径写错，按失败封闭处理",
    });
  }

  return {
    issues,
    pairs: pairs.sort(),
    facts: { cronExpressions: [...allCron].sort(), utcTimes: [...allTimes].sort() },
  };
}

/** 渲染问题列表，每行一个规则码。 */
export function formatBilingualDocIssues(issues: readonly BilingualDocIssue[]): string {
  return issues.map((issue) => `❌ [${issue.code}] ${issue.document} ${issue.detail}`).join("\n");
}
