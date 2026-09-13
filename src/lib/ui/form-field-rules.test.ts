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
});
