import { describe, expect, it } from "vitest";
import {
  auditComponentDocs,
  formatComponentDocIssues,
  moduleFileName,
  type ComponentDoc,
  type ComponentModule,
} from "./component-docs";
import {
  COMPONENT_DOCS,
  buildSnapshot,
  runComponentDocsCheck,
} from "../../../scripts/lib/component-docs-check.js";

const EN = "docs-site/components.md";
const ZH = "docs-site/zh-CN/components.md";

function doc(file: string, content: string | null = null, exhaustive = true): ComponentDoc {
  return { file, content, exhaustive };
}

function mod(directory: string, name: string): ComponentModule {
  return { directory, name };
}

/** 与 MODULES 对齐的最小干净快照：数量声明、两列目录列、非枚举目录各覆盖一处。 */
const MODULES: ComponentModule[] = [
  mod("ui", "button"),
  mod("ui", "tooltip"),
  mod("shared", "empty-state"),
  mod("layout", "site-header"),
  mod("dashboard", "stats-card"),
];

const TREE = [
  "```",
  "src/components/",
  "├── ui/             # Base UI (2)",
  "├── shared/         # Shared (1)",
  "├── layout/         # Layout (1)",
  "├── auth/           # Auth (0)",
  "└── dashboard/      # Dashboard",
  "```",
].join("\n");

const TABLES = [
  "| Component | Usage | Radix Base |",
  "|-----------|-------|------------|",
  "| Button | x | - |",
  "| Tooltip | y | - |",
  "",
  "| 组件 | 所在目录 | 用途 |",
  "|------|---------|------|",
  "| EmptyState | `shared/` | z |",
  "| SiteHeader | `layout/` | w |",
  "| StatsCard | `dashboard/` | v |",
].join("\n");

const CLEAN = `${TREE}\n\n${TABLES}\n`;

function codes(sources: readonly ComponentDoc[], modules = MODULES): string[] {
  return auditComponentDocs({ docs: sources, modules }).issues.map((issue) => issue.code);
}

function messages(sources: readonly ComponentDoc[], modules = MODULES): string[] {
  return auditComponentDocs({ docs: sources, modules }).issues.map((issue) => issue.message);
}

function stats(sources: readonly ComponentDoc[], modules = MODULES) {
  return auditComponentDocs({ docs: sources, modules }).stats;
}

describe("auditComponentDocs()", () => {
  it("文档与代码一致时通过，并报出所有可判定量", () => {
    const report = auditComponentDocs({ docs: [doc(EN, CLEAN), doc(ZH, CLEAN)], modules: MODULES });
    expect(report.issues).toEqual([]);
    expect(report.stats).toEqual({
      docs: 2,
      modules: 5,
      enumeratedModules: 4,
      rows: 10,
      counts: 8,
      skippedModules: 1,
    });
  });

  it("列出仓库里不存在的组件要判错", () => {
    const broken = CLEAN.replace("| Button | x | - |", "| Button | x | - |\n| SearchInput | z | - |");
    expect(codes([doc(EN, broken)])).toEqual(["COMPONENT_GHOST"]);
    expect(messages([doc(EN, broken)])[0]).toContain("search-input");
  });

  it("组件写错所在目录要判错", () => {
    const broken = CLEAN.replace(
      "| StatsCard | `dashboard/` | v |",
      "| StatsCard | `shared/` | v |",
    );
    expect(codes([doc(EN, broken)])).toEqual(["COMPONENT_WRONG_DIRECTORY"]);
    expect(messages([doc(EN, broken)])[0]).toContain("dashboard");
  });

  it("枚举目录里的每个组件都必须被列出", () => {
    const broken = CLEAN.replace("| Tooltip | y | - |\n", "");
    const issues = codes([doc(EN, broken)]);
    expect(issues).toEqual(["COMPONENT_UNDOCUMENTED"]);
    expect(messages([doc(EN, broken)])[0]).toContain("src/components/ui/tooltip.tsx");
  });

  it("数量声明与实际不符要判错", () => {
    const broken = CLEAN.replace("├── ui/             # Base UI (2)", "├── ui/             # Base UI (24)");
    expect(codes([doc(EN, broken)])).toEqual(["COMPONENT_COUNT_STALE"]);
    expect(messages([doc(EN, broken)])[0]).toContain("24");
    // 判断数不因为报错而缩水：五个目录里四处写了数量，其中一处过期。
    expect(stats([doc(EN, broken)]).counts).toBe(4);
  });

  it("写了目录行却不写数量也要判错，避免数量检查静默空转", () => {
    const broken = CLEAN.replace("├── shared/         # Shared (1)", "├── shared/         # Shared 组件");
    expect(codes([doc(EN, broken)])).toEqual(["COMPONENT_COUNT_MISSING"]);
    expect(stats([doc(EN, broken)]).counts).toBe(3);
  });

  it("没有目录列的表格里重名组件无法归属，要判错而不是猜", () => {
    const ambiguous = [
      ...MODULES,
      mod("shared", "tooltip"),
    ];
    const issues = codes([doc(EN, CLEAN)], ambiguous);
    expect(issues).toContain("COMPONENT_NAME_AMBIGUOUS");
    expect(messages([doc(EN, CLEAN)], ambiguous).join("\n")).toContain("ui、shared");
  });

  it("非枚举目录不要求被列出，但跳过数量看得见", () => {
    const broken = CLEAN.replace("| StatsCard | `dashboard/` | v |\n", "");
    expect(codes([doc(EN, broken)])).toEqual([]);
    expect(stats([doc(EN, broken)]).skippedModules).toBe(1);
  });

  it("非穷举文档不要求列全，但写出的数量必须对", () => {
    const map = [
      "| 目录 | 数量 | 内容 |",
      "|------|------|------|",
      "| `src/components/ui/` | 2 | shadcn/ui 原语 |",
      "| `src/components/shared/` | 11 | Breadcrumbs, ConfirmDialog |",
      "| `src/components/dashboard/` | 1 | StatsCard |",
    ].join("\n");
    expect(codes([doc("CLAUDE.md", map, false)])).toEqual(["COMPONENT_COUNT_STALE"]);
    expect(messages([doc("CLAUDE.md", map, false)])[0]).toContain("shared");
    expect(stats([doc("CLAUDE.md", map, false)]).counts).toBe(2);
  });

  it("散文里提一句路径不是数量断言", () => {
    const prose = "- shadcn/ui 组件在 `src/components/ui/` —— 通用无应用逻辑\n";
    expect(codes([doc("CLAUDE.md", prose, false)])).toEqual([]);
    expect(stats([doc("CLAUDE.md", prose, false)]).counts).toBe(0);
  });

  it("一份坏文档不会掩盖另一份的判定", () => {
    const broken = CLEAN.replace("| Button | x | - |", "| Button | x | - |\n| PageLoader | x | - |");
    const issues = codes([doc(EN, null), doc(ZH, broken)]);
    expect(issues).toEqual(["COMPONENT_DOC_MISSING", "COMPONENT_GHOST"]);
    expect(messages([doc(EN, null), doc(ZH, broken)])[1]).toContain(ZH);
  });

  it("两半文档各算各的：同一处错误报两次", () => {
    const broken = CLEAN.replace("| Button | x | - |", "| Button | x | - |\n| PageLoader | x | - |");
    expect(codes([doc(EN, broken), doc(ZH, broken)])).toEqual([
      "COMPONENT_GHOST",
      "COMPONENT_GHOST",
    ]);
  });
});

describe("moduleFileName()", () => {
  it("按文件名而不是具名导出对齐", () => {
    expect(moduleFileName("DropdownMenu")).toBe("dropdown-menu");
    expect(moduleFileName("ScrollArea")).toBe("scroll-area");
    expect(moduleFileName("Kbd")).toBe("kbd");
    expect(moduleFileName("QRCode")).toBe("qr-code");
  });
});

describe("formatComponentDocIssues()", () => {
  it("输出带上规则码与定位", () => {
    const broken = CLEAN.replace("| Button | x | - |", "| PageLoader | x | - |");
    const text = formatComponentDocIssues(auditComponentDocs({ docs: [doc(EN, broken)], modules: MODULES }).issues);
    expect(text).toContain("[COMPONENT_GHOST] docs-site/components.md:");
    expect(text).toContain("page-loader");
  });
});

describe("真实仓库快照", () => {
  it("读到五份文档与全部组件模块", () => {
    const snapshot = buildSnapshot();
    expect(snapshot.docs.map((entry: { file: string }) => entry.file)).toEqual(
      COMPONENT_DOCS.map((entry: { file: string }) => entry.file),
    );
    expect(
      snapshot.docs.every((entry: { content: string | null }) => entry.content !== null),
    ).toBe(true);
    const ui = snapshot.modules.filter(
      (entry: { directory: string }) => entry.directory === "ui",
    );
    expect(ui.length).toBeGreaterThanOrEqual(30);
    expect(
      snapshot.modules.some((entry: { name: string }) => entry.name.endsWith(".test")),
    ).toBe(false);
  });

  it("通过，并且确实读到了可判定的量（不是无事可做的绿）", () => {
    const report = auditComponentDocs(buildSnapshot());
    expect(report.issues.map((issue) => issue.message).join("\n")).toBe("");
    // 地板值，不是等号：15 是接线时现量的「文档里共有几处数量断言」，而断言数是会长出来的——多一个
    // 目录就多两处（中英两半各一处）。钉成等号等于要求每个改组件文档的 PR 回来改这个测试里的魔数，
    // 忘了不会挡住任何错误，只会在合并后的 main 上红成一场不存在的回归。地板防的是另一件事：解析
    // 停摆时读数是 0，而「一处都没读到」和「文档本来就没写数量」在输出里长得一样。精确读数交给
    // `pnpm check:component-docs` 现量。
    expect(report.stats.counts).toBeGreaterThanOrEqual(15);
    expect(report.stats.enumeratedModules).toBeGreaterThanOrEqual(62);
    expect(report.stats.rows).toBeGreaterThanOrEqual(160);
    expect(report.stats.docs).toBe(5);
  });

  it("CLI 在真实仓库上退出 0", () => {
    expect(runComponentDocsCheck()).toBe(0);
  });
});
