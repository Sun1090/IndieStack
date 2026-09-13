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
 *
 * 上游 shadcn 基元（`src/components/ui/**`）与两个共享原语自身不受约束——它们就是这些写法的
 * 唯一落脚点。门禁只管静态写法，运行时 ARIA 行为由 `form-field.test.tsx` 与各表单组件单测覆盖。
 */

export type FormFieldRuleCode = "RAW_SELECT" | "RAW_CONTROL_CLASSES" | "DIRECT_LABEL_IMPORT";

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
};

const RULE_MESSAGES: Record<FormFieldRuleCode, string> = {
  RAW_SELECT:
    "请使用 @/components/shared/native-select 的 NativeSelect，不要手写原生 <select>（样式与 disabled 态会再次漂移）",
  RAW_CONTROL_CLASSES: `表单控件外观请复用 Input / Textarea / NativeSelect，不要复制「${CONTROL_CLASS_MARKER}」这类类名长串`,
  DIRECT_LABEL_IMPORT:
    "标签请通过 @/components/shared/form-field 的 FormField / FormFieldLabel 使用，不要直接 import ui/label",
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

/** 审计单个文件；豁免文件只跳过与自身职责对应的规则。 */
function auditFile(file: FormFieldAuditFile, errors: FormFieldIssue[]): void {
  if (file.path !== NATIVE_SELECT_SOURCE) {
    collectIssues(errors, file, "RAW_SELECT");
    collectIssues(errors, file, "RAW_CONTROL_CLASSES");
  }
  if (file.path !== LABEL_PRIMITIVE_CONSUMER) {
    collectIssues(errors, file, "DIRECT_LABEL_IMPORT");
  }
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
