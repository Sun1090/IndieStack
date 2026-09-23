/**
 * `pnpm check:fields` 门禁行为单测（G03）
 * 保证规则模块与脚本能读真实仓库、排除上游基元/测试文件，并对三类回退写法返回退出码 1。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSnapshot, runFormFieldCheck } from "../../../scripts/lib/form-field-check.js";
import {
  auditFormFields,
  CONTROL_CLASS_MARKER,
  formatFormFieldIssues,
  LABEL_PRIMITIVE_CONSUMER,
  NATIVE_SELECT_SOURCE,
} from "./form-field-rules";

const tempDirs: string[] = [];

function writeTree(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "indiestack-fields-"));
  tempDirs.push(dir);
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(dir, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, "utf8");
  }
  return dir;
}

function repo(overrides: Record<string, string | null> = {}): string {
  const files: Record<string, string | null> = {
    "src/app/page.tsx": 'const field = <input className="border" />;\n',
    ...overrides,
  };
  const entries: Record<string, string> = {};
  for (const [key, value] of Object.entries(files)) if (value !== null) entries[key] = value;
  return writeTree(entries);
}

afterEach(() => {
  vi.restoreAllMocks();
  while (tempDirs.length > 0) fs.rmSync(tempDirs.pop() as string, { recursive: true, force: true });
});

describe("auditFormFields()", () => {
  it("无回退写法时通过并统计扫描文件数", () => {
    const report = auditFormFields({
      sourceFiles: [
        { path: "src/app/page.tsx", content: "export default 1;\n" },
        { path: "src/components/forms/a.tsx", content: "export default 2;\n" },
      ],
    });
    expect(report.errors).toEqual([]);
    expect(report.stats.scannedFiles).toBe(2);
  });

  it("命中原生 select、复制控件类名与直接 label import 时给出规则码与行号", () => {
    const report = auditFormFields({
      sourceFiles: [
        {
          path: "src/app/bad.tsx",
          content: [
            'import { Label } from "@/components/ui/label";',
            'const classes = "bg-background border-input bg-background px-3 py-2 text-sm";',
            "export function Bad() { return <select><option /></select>; }",
          ].join("\n"),
        },
      ],
    });

    expect(report.errors.map((issue) => issue.code)).toEqual([
      "RAW_SELECT",
      "RAW_CONTROL_CLASSES",
      "DIRECT_LABEL_IMPORT",
    ]);
    expect(report.errors.map((issue) => issue.line)).toEqual([3, 2, 1]);
    expect(report.errors.every((issue) => issue.file === "src/app/bad.tsx")).toBe(true);
  });

  it("NativeSelect 自身豁免原始 select 与复制类名，但不豁免 label 直引", () => {
    const source = `<select className="${CONTROL_CLASS_MARKER}" />
import { Label } from "@/components/ui/label";`;
    const report = auditFormFields({
      sourceFiles: [{ path: NATIVE_SELECT_SOURCE, content: source }],
    });
    expect(report.errors.map((issue) => issue.code)).toEqual(["DIRECT_LABEL_IMPORT"]);
  });

  it("FormField 自身允许直引 label，但其它规则仍参与审计", () => {
    const source = [
      'import { Label } from "@/components/ui/label";',
      "const bad = <select />;",
    ].join("\n");
    const report = auditFormFields({
      sourceFiles: [{ path: LABEL_PRIMITIVE_CONSUMER, content: source }],
    });
    expect(report.errors.map((issue) => issue.code)).toEqual(["RAW_SELECT"]);
  });

  it("格式化问题包含规则码、路径、行号与修复提示", () => {
    const text = formatFormFieldIssues([
      {
        code: "RAW_SELECT",
        file: "src/app/page.tsx",
        line: 7,
        message: "使用 NativeSelect",
      },
    ]);
    expect(text).toContain("[RAW_SELECT] src/app/page.tsx:7");
    expect(text).toContain("使用 NativeSelect");
  });
});

describe("buildSnapshot()", () => {
  it("读取真实仓库：应用层文件非空，排除 ui 基元与测试文件", () => {
    const snapshot = buildSnapshot();
    expect(snapshot.sourceFiles.length).toBeGreaterThan(100);
    expect(
      snapshot.sourceFiles.some((file: { path: string }) =>
        file.path.startsWith("src/components/ui/"),
      ),
    ).toBe(false);
    expect(
      snapshot.sourceFiles.some((file: { path: string }) => file.path.endsWith(".test.tsx")),
    ).toBe(false);
    expect(
      snapshot.sourceFiles.some((file: { path: string }) => file.path === "src/app/page.tsx"),
    ).toBe(true);
  });
});

describe("runFormFieldCheck()", () => {
  it("合规仓库返回 0 并打印扫描统计", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => void logs.push(line));
    expect(runFormFieldCheck(repo())).toBe(0);
    expect(logs.join("\n")).toContain("共享表单字段校验通过");
  });

  it("存在回退写法时返回 1 并打印规则码", () => {
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: string) => void errors.push(line));
    const dir = repo({ "src/app/bad.tsx": "export const bad = <select />;\n" });
    expect(runFormFieldCheck(dir)).toBe(1);
    expect(errors.join("\n")).toContain("RAW_SELECT");
  });

  it("漏写 method 的表单让门禁返回 1，并点名是哪个文件哪一行", () => {
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: string) => void errors.push(line));
    const dir = repo({
      "src/app/leaky/page.tsx": 'export const f = <form onSubmit={go}><input name="a" /></form>;\n',
    });
    expect(runFormFieldCheck(dir)).toBe(1);
    expect(errors.join("\n")).toContain("[FORM_NATIVE_GET] src/app/leaky/page.tsx:1");
  });
});

describe("<form> 的 method（FORM_NATIVE_GET）", () => {
  const audit = (content: string) =>
    auditFormFields({ sourceFiles: [{ path: "src/app/f.tsx", content }] }).errors;

  /** 只留这条规则的命中，压成 `[文件, 行号]`：同一份真实文件可能还有别的规则的存量。 */
  const formOnly = (issues: readonly { code: string; file: string; line: number }[]) =>
    issues
      .filter((issue) => issue.code === "FORM_NATIVE_GET")
      .map((issue) => [issue.file, issue.line]);

  it("没写 method 就是原生 GET：给出规则码、行号与「没有 method 属性」的理由", () => {
    const issues = audit("const a = 1;\nexport const f = <form onSubmit={go} />;\n");
    expect(issues.map((issue) => [issue.code, issue.line])).toEqual([["FORM_NATIVE_GET", 2]]);
    expect(issues[0]?.message).toContain("没有 method 属性");
  });

  it('method="post" 通过，大小写与 JSX 字面量写法都认', () => {
    expect(audit('export const f = <form method="post" onSubmit={go} />;')).toEqual([]);
    expect(audit('export const f = <form method="POST" onSubmit={go} />;')).toEqual([]);
    expect(audit('export const f = <form method={"post"} onSubmit={go} />;')).toEqual([]);
  });

  it('写成 method="get" 照样判：显式 GET 与漏写是同一件事', () => {
    const issues = audit('export const f = <form method="get" onSubmit={go} />;');
    expect(issues.map((issue) => issue.code)).toEqual(["FORM_NATIVE_GET"]);
    expect(issues[0]?.message).toContain('method="get"');
  });

  it("属性排在 onSubmit 的箭头函数之后也算：扫描按 `{}` 深度找标签结尾", () => {
    // 按第一个 `>` 截断的话，`a > b` 会把标签正文切成半截，method 就被「读不见」了。
    const content =
      "export const f = (\n" +
      '  <form onSubmit={(e) => { if (1 > 0) e.preventDefault(); }} method="post">\n' +
      "    <input />\n" +
      "  </form>\n" +
      ");\n";
    expect(audit(content)).toEqual([]);
  });

  it("同文件里两个表单只漏一个时，只报漏的那一个", () => {
    const content =
      'export const ok = <form method="post" onSubmit={a} />;\n' +
      "export const bad = <form onSubmit={b} />;\n";
    const issues = audit(content);
    expect(issues.map((issue) => [issue.code, issue.line])).toEqual([["FORM_NATIVE_GET", 2]]);
  });

  it("读不到标签结尾（文件被截断）时失败封闭，而不是安静算干净", () => {
    const issues = audit("export const f = <form onSubmit={b}\n");
    expect(issues.map((issue) => issue.code)).toEqual(["FORM_NATIVE_GET"]);
    expect(issues[0]?.message).toContain("读不到");
  });

  it("真实仓库：计数证明这条规则打得到东西，且当前没有违规", () => {
    const snapshot = buildSnapshot();
    const withForms = snapshot.sourceFiles.filter((file: { content: string }) =>
      /<\s*form(?=[\s>/])/.test(file.content),
    );
    expect(withForms.length).toBeGreaterThan(10);
    const report = auditFormFields(snapshot);
    expect(formOnly(report.errors)).toEqual([]);
  });

  it("把真实文件里的 method=\"post\" 删掉，规则立刻报出来（防止判据自己失焦）", () => {
    const target = buildSnapshot().sourceFiles.find((file: { content: string }) =>
      /<\s*form[^>]*method="post"/.test(file.content),
    );
    expect(target).toBeDefined();
    const original = String((target as { content: string }).content);
    const erased = original.replace(/(<\s*form[^>]*?)\s+method="post"/, "$1");
    expect(erased).not.toBe(original);
    const codesFor = (content: string) =>
      formOnly(auditFormFields({ sourceFiles: [{ path: "probe.tsx", content }] }).errors);
    expect(codesFor(original)).toEqual([]);
    expect(codesFor(erased)).toEqual([["probe.tsx", expect.any(Number)]]);
  });
});
