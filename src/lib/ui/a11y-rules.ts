/**
 * 无障碍静态门禁（D10）。
 *
 * 背景：`scripts/check-a11y.js` 的图标按钮规则在结构上**永远不可能命中**——外层 `if` 要求
 * children 里不存在任何 2 个以上字母的连续串，而内层判定又要求组件名（`MoreHorizontal`、
 * `<svg`）存在，两者互斥。它每次都打印「✅ 无未标注的图标按钮」，而仓库里实际有 3 个
 * `size="icon"` 且没有任何可访问名称的按钮。一个永远不会失败的门禁比没有门禁更糟，
 * 因为它凭空制造信心。这里把规则重写成可判定、可单测、并且**能被证明会失败**的纯函数。
 *
 * 判定口径（保守优先：误报逼人加豁免，漏报才会 shipped bug）：
 *   1. 只看 `<Button>` / `<button>` 的 children；
 *   2. children 去掉自闭合图标（`<MoreHorizontal />`、`<svg/>`、`<img/>`）与透传容器
 *      （`Link`/`a`/`span`/`div`/`p` 只剥标签保留内容）后**什么都不剩**，才算纯图标按钮；
 *      因此 `{t("apiKeys.create")}` 这类插值算「有文本」，不报。
 *   3. 有 `aria-label` / `aria-labelledby` / `title`（外层标签或任意后代），或含 `.sr-only`
 *      文本，都算已有可访问名称。
 *
 * `src/components/ui/**` 是 shadcn 上游基元，写法跟随上游版本，不在受审范围内（与状态门禁一致）。
 */

export type A11yRuleCode = "ICON_BUTTON_UNLABELED" | "IMG_MISSING_ALT" | "A11Y_NO_FILES";

export interface A11yIssue {
  code: A11yRuleCode;
  /** 仓库相对路径。 */
  file: string;
  /** 1 起算的行号。 */
  line: number;
  message: string;
}

export interface A11yAuditFile {
  path: string;
  content: string;
}

export interface A11yAuditReport {
  errors: A11yIssue[];
  stats: {
    scannedFiles: number;
    buttons: number;
    iconOnlyButtons: number;
    images: number;
  };
}

/** 可访问名称属性：出现在按钮开标签或任意后代的属性里即认为已标注。 */
export const ACCESSIBLE_NAME_ATTR = /\b(aria-label|aria-labelledby|title)=/;

/** 视觉隐藏文本：`sr-only` 也算可访问名称。 */
export const SR_ONLY_CLASS = /\bsr-only\b/;

/** 透传容器：`asChild` 场景下图标被包在里面，需要剥掉标签保留内部内容再判空。 */
export const PASS_THROUGH_TAGS = ["Link", "a", "span", "div", "p"] as const;

/**
 * 开标签属性串：允许双引号、单引号与一层花括号表达式，
 * 这样 `variant={key === "free" ? "outline" : "default"}`、
 * `className={cn("data-[state=open]:bg-accent", className)}` 都不会把标签截断在 `>` 上。
 */
const ATTRS = String.raw`(?:[^<>"']|"[^"]*"|'[^']*'|\{(?:[^{}]|\{[^{}]*\})*\})*`;

/** 自闭合图标：大写开头的组件、`svg`、`img`。 */
const SELF_CLOSING_ICON = new RegExp(String.raw`<[A-Z][A-Za-z0-9.]*\b${ATTRS}/>`, "g");
const SELF_CLOSING_MEDIA = new RegExp(String.raw`<(?:svg|img)\b${ATTRS}\/>`, "g");
const BUTTON_RE = new RegExp(String.raw`<(Button|button)\b(${ATTRS})>([\s\S]*?)<\/\1\s*>`, "g");
const IMG_RE = new RegExp(String.raw`<img\b((?:${ATTRS})*)>`, "g");

function hasAlt(attrs: string): boolean {
  return /\balt=/.test(attrs);
}

/** 剥掉自闭合图标，返回剩余 children 与被剥掉的图标数。 */
export function stripIcons(children: string): { rest: string; icons: number } {
  let icons = 0;
  let rest = children.replace(SELF_CLOSING_ICON, () => {
    icons += 1;
    return " ";
  });
  rest = rest.replace(SELF_CLOSING_MEDIA, () => {
    icons += 1;
    return " ";
  });
  // 成对写法（多行 svg / 带 path 的图标）整体视为一个图标
  const paired = rest.match(/<(?:svg|img)\b[\s\S]*?<\/(?:svg|img)\s*>/g);
  if (paired) {
    icons += paired.length;
    for (const block of paired) rest = rest.replace(block, " ");
  }
  return { rest, icons };
}

/** 剥掉透传容器标签（保留内部内容）与任何自闭合标签。 */
export function unwrapContainers(children: string): string {
  const tag = PASS_THROUGH_TAGS.join("|");
  return children.replace(new RegExp(String.raw`<\/?(?:${tag})\b[^>]*>`, "g"), " ");
}

/** 纯图标按钮：children 里除了图标什么都不剩。 */
export function isIconOnly(children: string): boolean {
  const { rest, icons } = stripIcons(children);
  if (icons === 0) return false;
  return unwrapContainers(rest).replace(/\s+/g, "") === "";
}

/** 按钮是否已经带上可访问名称。 */
export function hasAccessibleName(openingAttrs: string, children: string): boolean {
  return (
    ACCESSIBLE_NAME_ATTR.test(openingAttrs) ||
    ACCESSIBLE_NAME_ATTR.test(children) ||
    SR_ONLY_CLASS.test(children)
  );
}

function lineAt(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function auditButtons(fileName: string, source: string): { issues: A11yIssue[]; buttons: number; iconOnly: number } {
  const issues: A11yIssue[] = [];
  let buttons = 0;
  let iconOnly = 0;
  for (const match of source.matchAll(BUTTON_RE)) {
    buttons += 1;
    const [, tag, attrs, children] = match;
    if (!isIconOnly(children)) continue;
    iconOnly += 1;
    if (hasAccessibleName(attrs ?? "", children)) continue;
    issues.push({
      code: "ICON_BUTTON_UNLABELED",
      file: fileName,
      line: lineAt(source, match.index ?? 0),
      message: `<${tag}> 只有图标却没有可访问名称，屏幕阅读器只会念出「按钮」；补 aria-label 或 sr-only 文本`,
    });
  }
  return { issues, buttons, iconOnly };
}

function auditImages(fileName: string, source: string): { issues: A11yIssue[]; images: number } {
  const issues: A11yIssue[] = [];
  let images = 0;
  for (const match of source.matchAll(IMG_RE)) {
    images += 1;
    if (hasAlt(match[1] ?? "")) continue;
    issues.push({
      code: "IMG_MISSING_ALT",
      file: fileName,
      line: lineAt(source, match.index ?? 0),
      message: "<img> 缺少 alt 属性；装饰性图片请显式写 alt=\"\"",
    });
  }
  return { issues, images };
}

/** 审计入口：输入已读好的源文件，输出问题与计数器（计数器用于证明门禁真的扫到了东西）。 */
export function auditA11y(files: readonly A11yAuditFile[]): A11yAuditReport {
  const errors: A11yIssue[] = [];
  let buttons = 0;
  let iconOnlyButtons = 0;
  let images = 0;
  for (const file of files) {
    const b = auditButtons(file.path, file.content);
    const i = auditImages(file.path, file.content);
    buttons += b.buttons;
    iconOnlyButtons += b.iconOnly;
    images += i.images;
    errors.push(...b.issues, ...i.issues);
  }
  if (files.length === 0) {
    errors.push({
      code: "A11Y_NO_FILES",
      file: "src",
      line: 0,
      message: "一个受审文件都没扫到，扫描范围或排除规则已失效",
    });
  }
  return { errors, stats: { scannedFiles: files.length, buttons, iconOnlyButtons, images } };
}

/** 把问题渲染成逐行文本（IO 层与报错信息共用）。 */
export function formatA11yIssues(issues: readonly A11yIssue[]): string {
  return issues.map((i) => `[${i.code}] ${i.file}:${i.line} ${i.message}`).join("\n");
}
