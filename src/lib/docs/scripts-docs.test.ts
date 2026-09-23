/**
 * `check:docs` 规则的单测。
 *
 * 关键约束：读不到文档必须报，而不是当成通过——历史上正是 `continue` 让英文那一半
 * 长期没被校验过还打印「同步」。
 */
import { describe, expect, it } from "vitest";
import {
  auditScriptsDocs,
  extractDocumentedCommands,
  type ScriptsDocsDoc,
} from "./scripts-docs";

const NAMES = new Set(["check:docs", "verify:build", "lint"]);

function doc(file: string, content: string | null): ScriptsDocsDoc {
  return { file, content };
}

function codes(docs: ScriptsDocsDoc[]): string[] {
  return auditScriptsDocs(docs, NAMES).map((issue) => issue.code);
}

describe("extractDocumentedCommands", () => {
  it("去重并排序文档里出现的命令", () => {
    expect(extractDocumentedCommands("`pnpm lint` 与 `pnpm lint`，还有 `pnpm check:docs`")).toEqual([
      "check:docs",
      "lint",
    ]);
  });

  it("只认行内代码里的 pnpm 命令", () => {
    expect(extractDocumentedCommands("运行 pnpm lint（没有反引号）")).toEqual([]);
  });
});

describe("auditScriptsDocs", () => {
  it("已知脚本与 pnpm 内置子命令都放行", () => {
    const content = "`pnpm lint` · `pnpm verify:build` · `pnpm install` · `pnpm dev`";
    expect(codes([doc("docs-site/scripts.md", content)])).toEqual([]);
  });

  it("未知脚本报错并点名文件与命令", () => {
    const issues = auditScriptsDocs([doc("docs-site/zh-CN/scripts.md", "`pnpm no-such-script`")], NAMES);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("SCRIPTS_DOC_UNKNOWN_COMMAND");
    expect(issues[0].message).toContain("no-such-script");
    expect(issues[0].message).toContain("zh-CN");
  });

  it("文档读不到时失败关闭，而不是报绿", () => {
    expect(codes([doc("docs-site/scripts.md", null)])).toEqual(["SCRIPTS_DOC_MISSING"]);
  });

  it("一份坏文档不会掩盖另一份的判定", () => {
    const docs = [doc("docs-site/scripts.md", null), doc("docs-site/zh-CN/scripts.md", "`pnpm nope`")];
    expect(codes(docs)).toEqual(["SCRIPTS_DOC_MISSING", "SCRIPTS_DOC_UNKNOWN_COMMAND"]);
  });

  it("空文档集合不判任何东西也不报错（判定范围由 IO 侧保证非空）", () => {
    expect(auditScriptsDocs([], NAMES)).toEqual([]);
  });
});
