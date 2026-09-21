/**
 * 术语一致性审计（D01）
 *
 * `pnpm check:locales` 能挡住「没翻译」，但挡不住「翻错了词」：同一个角色在成员列表里叫
 * 「拥有者」、在错误提示里叫「所有者」，两侧键对称、两边都有汉字，值审计完全无感——
 * 而用户看到的是同一个东西有两个名字。
 *
 * 本模块把「英文术语 → 唯一指定译法」钉成一张表，并规定：
 *
 *   - 英文文案里出现某个术语时，中文**不得**使用登记在 `avoid` 里的其它译法；
 *   - 只有在指定译法**缺席**时才算违规——一句话里可以同时翻译两个不同概念
 *     （`notification` 与 `alert` → 「通知偏好和提醒」里的「提醒」是对 `alert` 的翻译，
 *     不是 `notification` 的漂移）；
 *   - 术语表必须与 `docs/architecture/10-i18n.md` 的表格逐项相等，文档不能比规则更宽或更旧。
 *
 * 「中文没出现指定译法」不算错误：翻译完全可能合理地绕开某个词，所以只统计不失败。
 * 三条失败封闭：抽不到任何匹配键（术语正则或扫描范围失效）、术语条目一次都没被用到（僵尸规则）、
 * 登记的豁免不再命中（例外清单不能只增不减）。
 */

export interface GlossaryEntry {
  /** 英文源文案里的术语，按词边界匹配并允许 `-s` / `-es` 复数。 */
  term: string;
  /** 该术语在 zh-CN 里的唯一指定译法。 */
  approved: string;
  /** 明确禁止的其它译法；仅在 `approved` 缺席时判定为违规。 */
  avoid: readonly string[];
  /** 为什么这样定，一句话。 */
  reason: string;
}

/**
 * 术语表。每一项都按当前 1235 条 zh-CN 文案实测过：指定译法确有出现，
 * 且 `avoid` 里的变体要么不存在、要么是已经修掉的真实漂移。
 */
export const GLOSSARY: readonly GlossaryEntry[] = [
  { term: "account", approved: "账户", avoid: ["账号", "帐户"], reason: "全站统一用「账户」" },
  { term: "project", approved: "项目", avoid: ["工程", "专案"], reason: "project 是产品内对象，不是软件工程" },
  { term: "team", approved: "团队", avoid: ["小组", "组织"], reason: "全站统一用「团队」" },
  { term: "member", approved: "成员", avoid: ["会员"], reason: "「会员」是付费身份，团队成员不是会员" },
  { term: "owner", approved: "所有者", avoid: ["拥有者", "负责人"], reason: "团队角色名统一为「所有者」" },
  { term: "password", approved: "密码", avoid: ["口令"], reason: "全站统一用「密码」" },
  { term: "dashboard", approved: "仪表盘", avoid: ["仪表板", "控制台"], reason: "导航与标题统一为「仪表盘」" },
  { term: "notification", approved: "通知", avoid: ["告警"], reason: "「告警」保留给运维告警（Sentry / cron）" },
  { term: "settings", approved: "设置", avoid: ["设定"], reason: "全站统一用「设置」" },
  { term: "sign in", approved: "登录", avoid: ["登入", "登陆"], reason: "「登陆」是常见错别字，「登入」属台式用法" },
  { term: "verify", approved: "验证", avoid: ["校验", "核实"], reason: "面向用户的核对统一为「验证」" },
  { term: "invite", approved: "邀请", avoid: ["邀约"], reason: "全站统一用「邀请」" },
  { term: "subscription", approved: "订阅", avoid: ["订购", "包月"], reason: "Stripe 周期订阅统一为「订阅」" },
  { term: "api key", approved: "密钥", avoid: ["秘钥"], reason: "「秘钥」是常见错别字" },
];

/** 被审计的目标 locale（源语言固定为 `en`）。 */
export const GLOSSARY_SOURCE_LOCALE = "en";
export const GLOSSARY_TARGET_LOCALE = "zh-CN";

export type GlossaryIssueCode =
  | "GLOSSARY_TERM_FORBIDDEN"
  | "GLOSSARY_ENTRY_UNUSED"
  | "GLOSSARY_NO_MATCHED_KEYS"
  | "GLOSSARY_STALE_EXEMPTION"
  | "GLOSSARY_DOC_MISMATCH";

export interface GlossaryIssue {
  code: GlossaryIssueCode;
  file: string;
  key: string;
  message: string;
}

export interface GlossaryInput {
  /** `en` 与 `zh-CN` 的 `namespace.path` → 文案，取自 `messages/<locale>/*.json`。 */
  messages: Readonly<Record<string, Record<string, string>>>;
  /** `docs/architecture/10-i18n.md` 的术语表原文，用于双向校验。 */
  glossaryDoc?: string;
  /** `<locale>:<namespace>.<key>:<term>` → 豁免理由。 */
  exemptions?: Readonly<Record<string, string>>;
}

export interface GlossaryReport {
  issues: GlossaryIssue[];
  /** 英文文案命中术语的 (键, 术语) 次数，是「抽取是否还在工作」的分母。 */
  matchedTerms: number;
  /** 两侧都有该键、因而真正可比对的 (键, 术语) 次数。 */
  checkedPairs: number;
  /** 因登记豁免而被放过的 (键, 术语) 组合。 */
  exempted: string[];
  /** 每个术语在中文侧使用指定译法的次数。 */
  approvedUsage: Record<string, number>;
}

/** 术语匹配：词边界 + 允许 -s / -es 复数，大小写不敏感。 */
export function termPattern(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}(?:s|es)?\\b`, "i");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** 术语表所在小节，供定位与解析。 */
export const GLOSSARY_DOC_HEADING = "## 术语表";

/** 术语表所在文档。 */
export const GLOSSARY_DOC_FILE = "docs/architecture/10-i18n.md";

/**
 * 只截取 `## 术语表` 小节：同一篇文档里还有语言配置、门禁等多张表格，
 * 全文档扫表会把它们当成术语行。
 */
export function extractGlossarySection(markdown: string): string {
  const start = markdown.indexOf(GLOSSARY_DOC_HEADING);
  if (start < 0) return "";
  const rest = markdown.slice(start + GLOSSARY_DOC_HEADING.length);
  const next = rest.search(/^## /m);
  return next < 0 ? rest : rest.slice(0, next);
}

/** 解析术语表小节：取 markdown 表格里的 `| term | approved | avoid |` 行。 */
export function parseGlossaryDoc(
  markdown: string,
): { entries: { term: string; approved: string; avoid: string[] }[]; error: string | null } {
  const entries: { term: string; approved: string; avoid: string[] }[] = [];
  for (const line of extractGlossarySection(markdown).split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 3) continue;
    const [term, approved] = cells;
    if (term === "英文术语" || /^:?-{2,}/.test(term)) continue;
    const cleaned = term.replace(/`/g, "").trim();
    if (!cleaned || !approved) return { entries: [], error: `术语表表格行缺少列：${line.trim()}` };
    entries.push({
      term: cleaned,
      approved: approved.replace(/`/g, "").trim(),
      avoid: cells[2]
        .replace(/`/g, "")
        .split(/[、,，]/)
        .map((item) => item.trim())
        .filter((item) => item && item !== "—"),
    });
  }
  if (!entries.length) return { entries: [], error: "术语表表格为空，文档与规则的比对失效" };
  return { entries, error: null };
}

/** 文档与代码必须逐项相等：术语、指定译法、禁止变体的集合。 */
function checkGlossaryDoc(doc: string | undefined, glossary: readonly GlossaryEntry[]): GlossaryIssue[] {
  if (doc === undefined) return [];
  const parsed = parseGlossaryDoc(doc);
  if (parsed.error) {
    return [
      {
        code: "GLOSSARY_DOC_MISMATCH",
        file: GLOSSARY_DOC_FILE,
        key: "*",
        message: parsed.error,
      },
    ];
  }
  const issues: GlossaryIssue[] = [];
  const expected = glossary.map((entry) => `${entry.term}\u0000${entry.approved}\u0000${[...entry.avoid].sort().join(",")}`);
  const actual = parsed.entries.map(
    (entry) => `${entry.term}\u0000${entry.approved}\u0000${[...entry.avoid].sort().join(",")}`,
  );
  for (const row of expected) {
    if (!actual.includes(row)) {
      const [term] = row.split("\u0000");
      issues.push({
        code: "GLOSSARY_DOC_MISMATCH",
        file: GLOSSARY_DOC_FILE,
        key: term,
        message: "术语表文档缺少或写错了这一项（与 GLOSSARY 不一致）",
      });
    }
  }
  for (const row of actual) {
    if (!expected.includes(row)) {
      const [term] = row.split("\u0000");
      issues.push({
        code: "GLOSSARY_DOC_MISMATCH",
        file: GLOSSARY_DOC_FILE,
        key: term,
        message: "术语表文档里有规则未登记的条目",
      });
    }
  }
  return issues;
}

/** 单个术语的比对：命中次数、可比对次数、指定译法使用次数与违规。 */
function auditTerm(
  entry: GlossaryEntry,
  source: Record<string, string>,
  target: Record<string, string>,
  exemptions: Readonly<Record<string, string>>,
): { issues: GlossaryIssue[]; used: number; matchedTerms: number; checkedPairs: number; exempted: string[] } {
  const pattern = termPattern(entry.term);
  const issues: GlossaryIssue[] = [];
  const exempted: string[] = [];
  let used = 0;
  let matchedTerms = 0;
  let checkedPairs = 0;

  for (const [key, enValue] of Object.entries(source)) {
    if (!pattern.test(enValue)) continue;
    matchedTerms += 1;
    const zhValue = target[key];
    if (zhValue === undefined) continue;
    checkedPairs += 1;
    if (zhValue.includes(entry.approved)) {
      used += 1;
      continue;
    }
    const forbidden = entry.avoid.filter((variant) => zhValue.includes(variant));
    if (!forbidden.length) continue;

    const registrationKey = `${GLOSSARY_TARGET_LOCALE}:${key}:${entry.term}`;
    if (isNonEmptyString(exemptions[registrationKey])) {
      exempted.push(registrationKey);
      continue;
    }
    issues.push({
      code: "GLOSSARY_TERM_FORBIDDEN",
      file: `messages/${GLOSSARY_TARGET_LOCALE}/${key.split(".")[0]}.json`,
      key,
      message: `"${entry.term}" 应译为「${entry.approved}」，实际用了「${forbidden.join("」「")}」（${entry.reason}）`,
    });
  }
  return { issues, used, matchedTerms, checkedPairs, exempted };
}

/** 执行术语一致性审计。 */
export function auditGlossary(
  input: GlossaryInput,
  glossary: readonly GlossaryEntry[] = GLOSSARY,
): GlossaryReport {
  const exemptions = input.exemptions ?? {};
  const issues: GlossaryIssue[] = [...checkGlossaryDoc(input.glossaryDoc, glossary)];
  const exempted: string[] = [];
  const approvedUsage: Record<string, number> = {};
  let checkedPairs = 0;
  let matchedTerms = 0;

  const source = input.messages[GLOSSARY_SOURCE_LOCALE] ?? {};
  const target = input.messages[GLOSSARY_TARGET_LOCALE] ?? {};

  for (const entry of glossary) {
    const result = auditTerm(entry, source, target, exemptions);
    issues.push(...result.issues);
    exempted.push(...result.exempted);
    matchedTerms += result.matchedTerms;
    checkedPairs += result.checkedPairs;
    approvedUsage[entry.term] = result.used;
    if (result.used === 0) {
      issues.push({
        code: "GLOSSARY_ENTRY_UNUSED",
        file: "src/lib/i18n/glossary.ts",
        key: entry.term,
        message: "该术语在中文文案里一次都没用过指定译法，规则是僵尸条目，请删除或修正译法",
      });
    }
  }

  if (matchedTerms === 0) {
    issues.push({
      code: "GLOSSARY_NO_MATCHED_KEYS",
      file: `messages/${GLOSSARY_SOURCE_LOCALE}`,
      key: "*",
      message: "没有一条英文文案命中术语表，扫描范围或匹配规则已失效",
    });
  }

  const hitExemptions = new Set(exempted);
  for (const registrationKey of Object.keys(exemptions).sort()) {
    if (!hitExemptions.has(registrationKey)) {
      issues.push({
        code: "GLOSSARY_STALE_EXEMPTION",
        file: `messages/${GLOSSARY_TARGET_LOCALE}`,
        key: registrationKey,
        message: "登记的术语豁免已不再命中任何文案，请删除该条目",
      });
    }
  }

  return { issues, matchedTerms, checkedPairs, exempted: exempted.sort(), approvedUsage };
}

/** 逐行格式化，供 CLI 与测试共用。 */
export function formatGlossaryIssues(issues: readonly GlossaryIssue[]): string[] {
  return issues.map((issue) => `[${issue.code}] ${issue.file} · ${issue.key}：${issue.message}`);
}
