/**
 * 书写方向审计（D08）
 *
 * 项目当前只有 `en` 与 `zh-CN` 两个 locale，都是 LTR，所以「支持 RTL」不是本期目标；
 * 但**新增代码不该再把自己钉死在物理方向上**：`mr-2` 在阿拉伯语界面里会把图标挤到错误的一侧，
 * 而 `me-2`（margin-inline-end）在 LTR 下渲染结果与 `mr-2` **完全一致**，零成本换取未来的可能。
 * 因此本门禁要求应用层代码只用逻辑方向类，并把 `src/components/ui/**`（shadcn 基元，
 * 升级时会被上游覆盖）排除在改写范围外。
 *
 * 匹配只看**字符串字面量内部**的类名 token：整文件扫 `ml-` 会把注释与散文里的
 * 「用 ml- 表示左边距」当成违规。Tailwind v4 的 `space-x-*` 本身就是 `margin-inline-start`，
 * 属于逻辑方向，因此不在禁止之列。
 */

/** 一条被禁止的物理方向写法，以及它的逻辑替代。 */
export interface DirectionRule {
  code: string;
  /** 只用于类名 token 的开头；调用方保证匹配位置在字符串字面量里。 */
  pattern: RegExp;
  replacement: string;
}

export const DIRECTION_RULES: readonly DirectionRule[] = [
  { code: "MARGIN_EDGE", pattern: /^ml-/, replacement: "ms-" },
  { code: "MARGIN_EDGE", pattern: /^mr-/, replacement: "me-" },
  { code: "PADDING_EDGE", pattern: /^pl-/, replacement: "ps-" },
  { code: "PADDING_EDGE", pattern: /^pr-/, replacement: "pe-" },
  { code: "INSET_EDGE", pattern: /^left-/, replacement: "start-" },
  { code: "INSET_EDGE", pattern: /^right-/, replacement: "end-" },
  { code: "TEXT_EDGE", pattern: /^text-left$/, replacement: "text-start" },
  { code: "TEXT_EDGE", pattern: /^text-right$/, replacement: "text-end" },
  { code: "ROUNDED_EDGE", pattern: /^rounded-(tl|tr|bl|br|l|r)(-|$)/, replacement: "rounded-ss/se/es/ee/s/e" },
  { code: "BORDER_EDGE", pattern: /^border-(l|r)(-|$)/, replacement: "border-s/border-e" },
];

/** 受审文件：应用层 tsx/jsx，排除 shadcn 基元与测试。 */
export const DIRECTION_EXCLUDED_PREFIXES = ["src/components/ui/"] as const;
const TEST_FILE = /\.(test|spec)\.[jt]sx?$/;

export function isAuditedFile(fileName: string): boolean {
  const normalized = fileName.replace(/\\/g, "/");
  if (!/\.(tsx|jsx)$/.test(normalized) || TEST_FILE.test(normalized)) return false;
  return !DIRECTION_EXCLUDED_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export interface DirectionFinding {
  code: string;
  file: string;
  className: string;
  replacement: string;
}

/**
 * 抽出源码里的字符串字面量内容（模板串按整段取，插值留在段内不影响类名匹配）。
 *
 * 先剥掉注释：`// 左边距写 ml-` 是在**谈论**类名而不是在使用它，
 * 不剥掉就会把文档注释当成违规。
 */
export function stringLiterals(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:\w])\/\/[^\n]*/g, "$1");
  const out: string[] = [];
  const re = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*?)`/g;
  for (const match of code.matchAll(re)) out.push(match[1] ?? match[2] ?? match[3] ?? "");
  return out;
}

/** 在一段文案里找出所有被禁止的类名 token。 */
export function findPhysicalClasses(text: string): DirectionFinding[] {
  const findings: DirectionFinding[] = [];
  // 模板串插值会把类名夹在 `${` / `}` 与引号之间，先按非类名字符切开
  for (const token of text.split(/[\s,;"'`(){}]+/)) {
    if (!token) continue;
    // 变体前缀（`sm:`、`hover:`、`dark:group-hover:`）保留，只判断最后一段
    const last = token.includes(":") ? token.slice(token.lastIndexOf(":") + 1) : token;
    const bare = last.replace(/^-/, "");
    for (const rule of DIRECTION_RULES) {
      if (!rule.pattern.test(bare)) continue;
      findings.push({ code: rule.code, file: "", className: token, replacement: rule.replacement });
      break;
    }
  }
  return findings;
}

export interface DirectionInput {
  /** `{ fileName, content }`，fileName 用仓库相对路径。 */
  files: ReadonlyArray<{ fileName: string; content: string }>;
}

export type DirectionIssueCode = "DIRECTION_PHYSICAL_UTILITY" | "DIRECTION_NO_FILES";

export interface DirectionIssue {
  code: DirectionIssueCode;
  file: string;
  key: string;
  message: string;
}

export interface DirectionReport {
  issues: DirectionIssue[];
  checkedFiles: number;
  /** 命中的物理方向类名数量。 */
  physicalClasses: number;
}

/** 执行方向审计。 */
export function auditDirection(input: DirectionInput): DirectionReport {
  const audited = input.files.filter((file) => isAuditedFile(file.fileName));
  const issues: DirectionIssue[] = [];
  let physicalClasses = 0;

  for (const file of audited) {
    for (const literal of stringLiterals(file.content)) {
      for (const finding of findPhysicalClasses(literal)) {
        physicalClasses += 1;
        issues.push({
          code: "DIRECTION_PHYSICAL_UTILITY",
          file: file.fileName,
          key: finding.code,
          message: `物理方向类 ${finding.className} 应改用逻辑方向 ${finding.replacement}（LTR 下渲染结果一致，RTL 下才正确）`,
        });
      }
    }
  }

  if (!audited.length) {
    issues.push({
      code: "DIRECTION_NO_FILES",
      file: "src",
      key: "*",
      message: "一个受审文件都没扫到，扫描范围或排除规则已失效",
    });
  }

  return { issues, checkedFiles: audited.length, physicalClasses };
}

/** 逐行格式化，供 CLI 与测试共用。 */
export function formatDirectionIssues(issues: readonly DirectionIssue[]): string[] {
  return issues.map((issue) => `[${issue.code}] ${issue.file} · ${issue.key}：${issue.message}`);
}
