import { describe, expect, it } from "vitest";
import {
  DIRECTION_EXCLUDED_PREFIXES,
  DIRECTION_RULES,
  auditDirection,
  findPhysicalClasses,
  formatDirectionIssues,
  isAuditedFile,
  stringLiterals,
} from "./direction";

const file = (fileName: string, classes: string) => ({
  fileName,
  content: `export const x = () => <div className="${classes}" />;\n`,
});

describe("方向审计的扫描范围", () => {
  it("只审应用层 tsx/jsx", () => {
    expect(isAuditedFile("src/app/page.tsx")).toBe(true);
    expect(isAuditedFile("src/components/shared/confirm-dialog.tsx")).toBe(true);
    expect(isAuditedFile("src/app/page.test.tsx")).toBe(false);
    expect(isAuditedFile("src/app/route.ts")).toBe(false);
    expect(isAuditedFile("src/app/globals.css")).toBe(false);
    expect(isAuditedFile("src\\\\components\\\\dashboard\\\\x.tsx")).toBe(true);
  });

  it("shadcn 基元按设计排除，且排除项是显式登记的", () => {
    expect(isAuditedFile("src/components/ui/button.tsx")).toBe(false);
    expect([...DIRECTION_EXCLUDED_PREFIXES]).toEqual(["src/components/ui/"]);
  });

  it("一个受审文件都没有时失败封闭", () => {
    const report = auditDirection({ files: [file("src/components/ui/button.tsx", "mr-2")] });
    expect(report.checkedFiles).toBe(0);
    expect(report.issues.map((issue) => issue.code)).toEqual(["DIRECTION_NO_FILES"]);
  });
});

describe("物理方向类识别", () => {
  it("六类物理写法各自命中并给出逻辑替代", () => {
    const cases: [string, string][] = [
      ["ml-2", "MARGIN_EDGE"],
      ["-mr-2", "MARGIN_EDGE"],
      ["pl-4", "PADDING_EDGE"],
      ["pr-0", "PADDING_EDGE"],
      ["left-0", "INSET_EDGE"],
      ["right-[calc(100%-4px)]", "INSET_EDGE"],
      ["text-left", "TEXT_EDGE"],
      ["text-right", "TEXT_EDGE"],
      ["rounded-tl-md", "ROUNDED_EDGE"],
      ["rounded-r", "ROUNDED_EDGE"],
      ["border-l", "BORDER_EDGE"],
      ["border-r-2", "BORDER_EDGE"],
    ];
    for (const [className, code] of cases) {
      const findings = findPhysicalClasses(className);
      expect(findings.map((finding) => finding.code), className).toEqual([code]);
    }
    for (const code of new Set(DIRECTION_RULES.map((rule) => rule.code))) {
      expect(cases.some(([, c]) => c === code), code).toBe(true);
    }
  });

  it("逻辑方向与方向无关的类不误报", () => {
    for (const className of [
      "ms-2 me-2 ps-4 pe-0 start-0 end-0 text-start text-end rounded-ss-md rounded-e border-s border-e",
      "space-x-2 space-y-4 px-3 mx-auto py-1 my-2 top-0 bottom-4",
      "rounded-sm rounded-lg border-border text-foreground",
      "-translate-x-full translate-x-1/2 origin-left",
    ]) {
      expect(findPhysicalClasses(className), className).toEqual([]);
    }
  });

  it("变体前缀不影响判定", () => {
    expect(findPhysicalClasses("sm:mr-2").map((finding) => finding.className)).toEqual(["sm:mr-2"]);
    expect(findPhysicalClasses("dark:group-hover:pl-4").length).toBe(1);
  });

  it("注释与 JSX 文本里的类名不算违规，字符串字面量里则算", () => {
    const source = [
      "// 左边距用 ml- 表示，别照抄到组件里",
      "/* rounded-tl 的替代是 rounded-ss */",
      "export const x = () => <p>text-right 只是界面文字</p>;",
    ].join("\n");
    expect(auditDirection({ files: [{ fileName: "src/app/page.tsx", content: source }] }).issues).toEqual([]);

    // 类名只可能出现在字符串字面量里，因此那里的一律按类名判定（已知取舍：
    // 想在代码字符串里写「text-right」这种散文，得连门禁一起绕，实际不该这么写）
    const quoted = 'const doc = "text-right";';
    const report = auditDirection({ files: [{ fileName: "src/app/page.tsx", content: quoted }] });
    expect(report.issues.map((issue) => issue.key)).toEqual(["TEXT_EDGE"]);
    expect(stringLiterals('const a = "one"; const b = `two ${x} three`;').length).toBe(2);
  });

  it("跨行模板串里的类名同样命中", () => {
    const content =
      "export const C = () => <div className={`p-4\n  mr-2\n  ${open ? 'pt-0' : ''}`} />;\n";
    const report = auditDirection({ files: [{ fileName: "src/app/x/page.tsx", content }] });
    expect(report.issues.map((issue) => issue.key)).toEqual(["MARGIN_EDGE"]);
    expect(report.issues[0].message).toContain("mr-2");
  });

  it("模板串里的类名同样命中", () => {
    const report = auditDirection({
      files: [{ fileName: "src/app/x/page.tsx", content: "const c = `p-4 ${open ? 'mr-2' : ''}`;" }],
    });
    expect(report.issues.map((issue) => issue.key)).toEqual(["MARGIN_EDGE"]);
  });
});

describe("审计报告", () => {
  it("违规带文件名、规则码与替代建议", () => {
    const report = auditDirection({ files: [file("src/app/dashboard/page.tsx", "flex mr-2 items-center")] });
    expect(report.checkedFiles).toBe(1);
    expect(report.physicalClasses).toBe(1);
    const [issue] = report.issues;
    expect(issue.code).toBe("DIRECTION_PHYSICAL_UTILITY");
    expect(issue.file).toBe("src/app/dashboard/page.tsx");
    expect(issue.key).toBe("MARGIN_EDGE");
    expect(issue.message).toContain("me-");
    expect(formatDirectionIssues([issue])[0]).toMatch(/^\[DIRECTION_PHYSICAL_UTILITY\] src\/app\/dashboard\/page\.tsx/);
  });

  it("多个文件各自独立计数，排除目录不参与", () => {
    const report = auditDirection({
      files: [
        file("src/app/a/page.tsx", "ml-2 mr-2"),
        file("src/components/ui/card.tsx", "pl-4 pr-4 left-0"),
        file("src/app/b/page.tsx", "ps-4 pe-4"),
      ],
    });
    expect(report.checkedFiles).toBe(2);
    expect(report.physicalClasses).toBe(2);
  });
});
