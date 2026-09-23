/**
 * 共享表单字段门禁（G03）。
 *
 * 背景：G03 之前，「标签 + 控件 + 描述 + 错误」这套四件套在 15 个表单里各写一遍：
 * `<Label htmlFor>` 与 `<Input id>` 靠人工对齐、原生 `<select>` 各自复制一长串 Tailwind 类名，
 * 副本之间还已经漂移（邀请成员表单的下拉就漏了 `disabled:` 变体）。现在统一走
 * `src/components/shared/form-field.tsx`（DOM 与 ARIA 接线）与 `native-select.tsx`（控件样式）。
 *
 * 本模块把这些约定变成可执行的纯函数审计，防止旧写法回潮：
 *   1. 应用层不得直接写原生 `<select>`（走 NativeSelect，样式与 disabled 态才有单一来源）；
 *   2. 应用层不得复制表单控件类名长串（走 Input / Textarea / NativeSelect）；
 *   3. 应用层不得直接 `import` `ui/label`（走 FormField / FormFieldLabel，id 由 FormField 注入，
 *      label 与控件不可能再指错）。
 *   4. 应用层的 `<form onSubmit=…>` 必须写 `method="post"`。这条来自一次实测：JS 只接管的表单在
 *      hydration 之前是一次**原生提交**（`<form>` 的默认 method 就是 GET），把带 `name` 的字段值
 *      原样序列化进 URL——浏览器历史、Referer、服务端访问日志都会留下这份数据。E2E 里拖慢脚本
 *      复现过一次：`/contact` 变成 `/contact?name=…&message=…`，而当时那条用例的「成功标志」
 *      （输入框被清空）照样绿。`method="post"` 不影响正常工作的那条路（React 依旧 preventDefault）；
 *      改完复测：那次原生提交变成对同一路由的 POST，服务端按普通页面渲染回来（实测 200、字段不回显），
 *      值不再进 URL。注意它**没有**把这条路堵成错误页，所以用例的判据也得一起换（见
 *      `e2e/support/hydrated.ts` 的 `actUntilServerAction`）。仓库里唯一的无 JS 表单
 *      （`src/lib/marketing-action-page.ts`）本来就是 `method="post"` 写的。
 *
 * 上游 shadcn 基元（`src/components/ui/**`）与两个共享原语自身不受约束——它们就是这些写法的
 * 唯一落脚点。门禁只管静态写法，运行时 ARIA 行为由 `form-field.test.tsx` 与各表单组件单测覆盖。
 */

export type FormFieldRuleCode =
  | "RAW_SELECT"
  | "RAW_CONTROL_CLASSES"
  | "DIRECT_LABEL_IMPORT"
  | "FORM_NATIVE_GET";

export interface FormFieldIssue {
  code: FormFieldRuleCode;
  /** 仓库相对路径。 */
  file: string;
  /** 1 起算的行号。 */
  line: number;
  message: string;
}

export interface FormFieldAuditFile {
  path: string;
  content: string;
}

export interface FormFieldAuditInput {
  sourceFiles: readonly FormFieldAuditFile[];
}

export interface FormFieldAuditReport {
  errors: FormFieldIssue[];
  stats: { scannedFiles: number };
}

/** 允许直接 import `ui/label` 的唯一应用层文件（它就是 label 的接线层）。 */
export const LABEL_PRIMITIVE_CONSUMER = "src/components/shared/form-field.tsx";

/** 允许出现原生 `<select>` 的唯一应用层文件（它本身就是包装器）。 */
export const NATIVE_SELECT_SOURCE = "src/components/shared/native-select.tsx";

/** Input / Textarea / Select / NativeSelect 类名的公共前缀；复制粘贴控件样式时必然带过来。 */
export const CONTROL_CLASS_MARKER = "border-input bg-background px-3 py-2 text-sm";

const RULE_PATTERNS: Record<FormFieldRuleCode, () => RegExp> = {
  RAW_SELECT: () => /<\s*select(?=[\s>/])/g,
  RAW_CONTROL_CLASSES: () => new RegExp(CONTROL_CLASS_MARKER, "g"),
  DIRECT_LABEL_IMPORT: () => /from\s+"@\/components\/ui\/label"/g,
  // 只用来定位候选：命中 `<form` 不等于违规，还得看这个开始标签自己声明了什么。
  FORM_NATIVE_GET: () => /<\s*form(?=[\s>/])/g,
};

const RULE_MESSAGES: Record<FormFieldRuleCode, string> = {
  RAW_SELECT:
    "请使用 @/components/shared/native-select 的 NativeSelect，不要手写原生 <select>（样式与 disabled 态会再次漂移）",
  RAW_CONTROL_CLASSES: `表单控件外观请复用 Input / Textarea / NativeSelect，不要复制「${CONTROL_CLASS_MARKER}」这类类名长串`,
  DIRECT_LABEL_IMPORT:
    "标签请通过 @/components/shared/form-field 的 FormField / FormFieldLabel 使用，不要直接 import ui/label",
  FORM_NATIVE_GET:
    '客户端接管的 <form> 必须写 method="post"：默认是 GET，hydration 之前的一次点击会由浏览器原生提交，把带 name 的字段值全部塞进 URL',
};

/** 计算字符下标所在行（1 起算）。 */
function lineOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (content[i] === "\n") line += 1;
  }
  return line;
}

/** 逐个匹配并把命中位置记成问题项；每次新建 RegExp，避免共享 lastIndex 状态。 */
function collectIssues(
  errors: FormFieldIssue[],
  file: FormFieldAuditFile,
  code: FormFieldRuleCode,
): void {
  const pattern = RULE_PATTERNS[code]();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(file.content)) !== null) {
    errors.push({
      code,
      file: file.path,
      line: lineOf(file.content, match.index),
      message: RULE_MESSAGES[code],
    });
  }
}

/** `<form` 开始标签的正文：从标签名之后扫到第一个「不在 `{}` 里」的 `>`。 */
function openingTagOf(content: string, afterName: number): string | null {
  let depth = 0;
  for (let index = afterName; index < content.length; index += 1) {
    const char = content[index];
    if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    else if (char === ">" && depth === 0) return content.slice(afterName, index);
  }
  return null;
}

/** 开始标签正文里的 `method` 值；没有这个属性时返回 null。 */
function methodAttributeOf(tag: string): string | null {
  const match = /(^|\s)method=(?:"([^"]*)"|'([^']*)'|\{\s*"([^"]*)"\s*\})/.exec(tag);
  if (!match) return null;
  return match[2] ?? match[3] ?? match[4] ?? "";
}

/**
 * 逐个 `<form` 检查它自己声明的 `method`。
 * 必须按开始标签扫，而不是按整份文件找一次 `method="post"`：一个文件里可以有几个表单，
 * 只要有一个漏声明，那个表单就还是原生 GET。
 */
function collectFormMethodIssues(errors: FormFieldIssue[], file: FormFieldAuditFile): void {
  const pattern = RULE_PATTERNS.FORM_NATIVE_GET();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(file.content)) !== null) {
    const tag = openingTagOf(file.content, match.index + match[0].length);
    const method = tag === null ? null : methodAttributeOf(tag);
    if (method !== null && method.toLowerCase() === "post") continue;
    const reason =
      tag === null
        ? "读不到这个 <form> 开始标签的结尾，按未声明处理"
        : method === null
          ? "没有 method 属性，浏览器按 GET 提交"
          : `method="${method}" 仍会把字段值写进 URL`;
    errors.push({
      code: "FORM_NATIVE_GET",
      file: file.path,
      line: lineOf(file.content, match.index),
      message: `${RULE_MESSAGES.FORM_NATIVE_GET}（${reason}）`,
    });
  }
}

/** 审计单个文件；豁免文件只跳过与自身职责对应的规则。 */
function auditFile(file: FormFieldAuditFile, errors: FormFieldIssue[]): void {
  if (file.path !== NATIVE_SELECT_SOURCE) {
    collectIssues(errors, file, "RAW_SELECT");
    collectIssues(errors, file, "RAW_CONTROL_CLASSES");
  }
  if (file.path !== LABEL_PRIMITIVE_CONSUMER) {
    collectIssues(errors, file, "DIRECT_LABEL_IMPORT");
  }
  collectFormMethodIssues(errors, file);
}

/** 审计应用层表单字段写法；`file` 一律用仓库相对路径，便于 CI annotation 与单测断言。 */
export function auditFormFields(input: FormFieldAuditInput): FormFieldAuditReport {
  const errors: FormFieldIssue[] = [];
  for (const file of input.sourceFiles) auditFile(file, errors);
  return { errors, stats: { scannedFiles: input.sourceFiles.length } };
}

/** 把问题列表格式化成多行文本（供 CLI 与单测断言）。 */
export function formatFormFieldIssues(issues: readonly FormFieldIssue[]): string {
  return issues
    .map((issue) => `❌ [${issue.code}] ${issue.file}:${issue.line} ${issue.message}`)
    .join("\n");
}
