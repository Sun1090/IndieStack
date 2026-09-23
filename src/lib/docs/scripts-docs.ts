/**
 * docs-site 记录的 pnpm 命令必须真的存在。
 *
 * 这一半曾经整体失明：入口按 `docs-site/en/scripts.md` 找英文文档，而本仓库的英文文档在
 * `docs-site/scripts.md`（只有中文在 `zh-CN/` 子目录），读不到就 `continue`——于是它实际只判过
 * zh-CN，却每轮打印「文档与 package.json 同步」。修法有两层，第二层才是重点：路径要对着，
 * 而且**文件读不到必须失败关闭**，因为「静默跳过一半」正是让这件事长期没人发现的机制。
 */

export type ScriptsDocsIssueCode = "SCRIPTS_DOC_MISSING" | "SCRIPTS_DOC_UNKNOWN_COMMAND";

export interface ScriptsDocsIssue {
  code: ScriptsDocsIssueCode;
  message: string;
}

export interface ScriptsDocsDoc {
  /** 报告里使用的仓库相对路径。 */
  file: string;
  /** `null` 表示这份文档没读到——与「读到了但没有问题」必须区分开。 */
  content: string | null;
}

/** pnpm 自身的子命令，不是 `package.json` 里的脚本。 */
export const PNPM_BUILTINS: ReadonlySet<string> = new Set([
  "install",
  "add",
  "remove",
  "update",
  "dev",
]);

/** 文档里引用命令的写法：行内代码 `` `pnpm <name>` ``。 */
const DOCUMENTED_COMMAND = /`pnpm\s+([a-z:.-]+)`/g;

/** 文档中出现过的命令名，去重并排序，保证报告稳定。 */
export function extractDocumentedCommands(content: string): string[] {
  return [...new Set([...content.matchAll(DOCUMENTED_COMMAND)].map((match) => match[1]))].sort();
}

/** 逐份文档判定：读不到即失败关闭，读到了才比对脚本清单。 */
export function auditScriptsDocs(
  docs: readonly ScriptsDocsDoc[],
  scriptNames: ReadonlySet<string>,
): ScriptsDocsIssue[] {
  const issues: ScriptsDocsIssue[] = [];

  for (const doc of docs) {
    if (doc.content === null) {
      issues.push({
        code: "SCRIPTS_DOC_MISSING",
        message: `${doc.file} 读不到：这一半文档没有接受校验，不等于它通过了`,
      });
      continue;
    }
    for (const command of extractDocumentedCommands(doc.content)) {
      if (PNPM_BUILTINS.has(command) || scriptNames.has(command)) continue;
      issues.push({
        code: "SCRIPTS_DOC_UNKNOWN_COMMAND",
        message: `${doc.file} 引用了不存在的脚本: pnpm ${command}`,
      });
    }
  }

  return issues;
}
