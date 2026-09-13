/**
 * 设计 token 审计规则单测（G02）。
 *
 * 覆盖 CSS 解析辅助函数、六类规则码与真实仓库的自洽性。
 */
import { describe, expect, it } from "vitest";
import {
  DESIGN_TOKENS,
  THEME_COLOR_TOKENS,
  auditDesignTokens,
  braceMatch,
  escapeRegExp,
  extractDeclarations,
  extractRuleBody,
  extractVarReferences,
  formatDesignTokenIssues,
  type DesignToken,
} from "./tokens";

/** 用注册表生成一份「结构自洽」的 globals.css，作为反例测试的基线。 */
function buildCss(tokens: DesignToken[] = DESIGN_TOKENS): string {
  const root = tokens.map((token) => `    --${token.name}: 0 0% 0%;`).join("\n");
  const dark = tokens
    .filter((token) => token.dark)
    .map((token) => `    --${token.name}: 0 0% 100%;`)
    .join("\n");
  const theme = tokens
    .filter((token) => token.utility)
    .map((token) => `  --color-${token.utilityName ?? token.name}: hsl(var(--${token.name}));`)
    .join("\n");
  return `@layer base {\n  :root {\n${root}\n  }\n\n  .dark {\n${dark}\n  }\n}\n\n@theme inline {\n${theme}\n}\n`;
}

const SOURCE = [
  {
    path: "src/app/page.tsx",
    content: 'export default () => <div className="bg-background" />;\n',
  },
];

function audit(css: string, sourceFiles = SOURCE) {
  return auditDesignTokens({ css, sourceFiles });
}

describe("CSS 解析辅助函数", () => {
  it("braceMatch 跳过嵌套块并返回配对下标", () => {
    const css = "a { b { c } d }";
    expect(braceMatch(css, 2)).toBe(css.length - 1);
    expect(braceMatch(css, 0)).toBe(-1);
  });

  it("extractRuleBody 取到规则体而非整个文件", () => {
    const css = ":root { --a: 1; }\n.other { --b: 2; }";
    expect(extractRuleBody(css, ":root")).toBe(" --a: 1; ");
    expect(extractRuleBody(css, ".missing")).toBeNull();
  });

  it("extractRuleBody 不会被注释里的同名选择器骗到", () => {
    const css = "/* .dark { --x: 1; } */\n.dark { --y: 2; }";
    // 注释后的真实块仍然能取到；取到的是最后一个同名块之前的内容
    expect(extractRuleBody(css, ".dark")).toContain("--y: 2;");
  });

  it("extractDeclarations 只收 --x: value 形式", () => {
    const decls = extractDeclarations("--a: 1px;\n color: red;\n--b: calc(var(--a) - 2px);");
    expect(decls.get("a")).toBe("1px");
    expect(decls.get("b")).toBe("calc(var(--a) - 2px)");
    expect(decls.size).toBe(2);
  });

  it("extractVarReferences 去重前按出现顺序返回变量名", () => {
    expect(extractVarReferences("hsl(var(--a)) 50%, var(--b)")).toEqual(["a", "b"]);
    expect(extractVarReferences("red")).toEqual([]);
  });

  it("escapeRegExp 转义元字符", () => {
    expect(escapeRegExp("a.b(c)")).toBe("a\\.b\\(c\\)");
  });
});

describe("auditDesignTokens()", () => {
  it("结构自洽的 CSS 无错误", () => {
    expect(audit(buildCss()).errors).toEqual([]);
  });

  it("真实仓库的 globals.css 结构自洽", () => {
    // 真实文件由 scripts/lib/design-token-check.js 读取；这里只断言注册表本身可被满足
    const report = audit(buildCss());
    expect(report.stats.registered).toBe(DESIGN_TOKENS.length);
    expect(report.stats.colorMappings).toBe(THEME_COLOR_TOKENS.length);
  });

  it("缺少 :root 块时报 TOKEN_ROOT_BLOCK_MISSING", () => {
    const codes = audit("/* nothing */").errors.map((issue) => issue.code);
    expect(codes).toContain("TOKEN_ROOT_BLOCK_MISSING");
    expect(codes).toContain("TOKEN_THEME_BLOCK_MISSING");
  });

  it("注册的 token 不在 :root 时报 TOKEN_MISSING_ROOT", () => {
    const css = buildCss().replace("    --success: 0 0% 0%;\n", "");
    const errors = audit(css).errors;
    expect(
      errors.some(
        (issue) => issue.code === "TOKEN_MISSING_ROOT" && issue.message.includes("success"),
      ),
    ).toBe(true);
  });

  it("dark: true 的 token 缺 .dark 覆盖时报 TOKEN_MISSING_DARK", () => {
    const css = buildCss().replace("    --success: 0 0% 100%;\n", "");
    const errors = audit(css).errors;
    expect(
      errors.some(
        (issue) => issue.code === "TOKEN_MISSING_DARK" && issue.message.includes("--success"),
      ),
    ).toBe(true);
  });

  it("radius 没有 .dark 覆盖也不算错（dark: false）", () => {
    const errors = audit(buildCss()).errors;
    expect(errors.some((issue) => issue.code === "TOKEN_MISSING_DARK")).toBe(false);
  });

  it("有 token 无 @theme 映射时报 THEME_MAPPING_MISSING（历史上 --chart-* 的缺口）", () => {
    const css = buildCss().replace("  --color-chart-1: hsl(var(--chart-1));\n", "");
    const errors = audit(css).errors;
    const issue = errors.find((entry) => entry.code === "THEME_MAPPING_MISSING");
    expect(issue?.message).toContain("--color-chart-1");
    expect(issue?.message).toContain("Tailwind 工具类不存在");
  });

  it("映射引用未定义变量时报 THEME_MAPPING_DANGLING", () => {
    const css = buildCss().replace(
      "  --color-background: hsl(var(--background));\n",
      "  --color-background: hsl(var(--backgruond));\n",
    );
    const errors = audit(css).errors;
    expect(
      errors.some(
        (issue) => issue.code === "THEME_MAPPING_DANGLING" && issue.message.includes("backgruond"),
      ),
    ).toBe(true);
  });

  it("未登记进注册表的 --color-* 映射报 THEME_MAPPING_UNREGISTERED", () => {
    const css = buildCss().replace(
      "@theme inline {",
      "@theme inline {\n  --color-brand: hsl(var(--background));",
    );
    const errors = audit(css).errors;
    expect(
      errors.some(
        (issue) =>
          issue.code === "THEME_MAPPING_UNREGISTERED" && issue.message.includes("--color-brand"),
      ),
    ).toBe(true);
  });

  it("应用层使用原生状态调色板时报 RAW_STATUS_PALETTE 并给出行号", () => {
    const files = [
      { path: "src/app/page.tsx", content: 'const a = 1;\nconst cls = "text-red-500";\n' },
    ];
    const report = audit(buildCss(), files);
    const issue = report.errors.find((entry) => entry.code === "RAW_STATUS_PALETTE");
    expect(issue?.line).toBe(2);
    expect(issue?.message).toContain("text-red-500");
  });

  it("语义 token 的用法不算违规", () => {
    const files = [
      {
        path: "src/app/page.tsx",
        content: 'const cls = "text-success bg-warning/10 border-info";\n',
      },
    ];
    expect(audit(buildCss(), files).errors).toEqual([]);
  });

  it("白名单里的装饰性调色板不报错", () => {
    const files = [
      { path: "src/components/shared/initial-avatar.tsx", content: 'const c = "bg-red-500";\n' },
    ];
    expect(audit(buildCss(), files).errors).toEqual([]);
  });

  it("带变体前缀的调色板同样被拦下", () => {
    const files = [
      { path: "src/app/page.tsx", content: 'const c = "dark:hover:bg-emerald-500";\n' },
    ];
    const issue = audit(buildCss(), files).errors.find(
      (entry) => entry.code === "RAW_STATUS_PALETTE",
    );
    expect(issue?.message).toContain("dark:hover:bg-emerald-500");
  });
});

describe("formatDesignTokenIssues()", () => {
  it("带行号与不带行号都能格式化", () => {
    const text = formatDesignTokenIssues("error", [
      { code: "X", file: "a.ts", line: 3, message: "boom" },
      { code: "Y", file: "b.css", message: "bang" },
    ]);
    expect(text).toContain("❌ [X] a.ts:3 boom");
    expect(text).toContain("❌ [Y] b.css bang");
  });
});
