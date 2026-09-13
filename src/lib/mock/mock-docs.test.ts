/**
 * Mock 文档一致性单测（I07）。
 * 覆盖表名/端点抽取、事实锚点、旧表述回流与 CLI 退出码，确保文档不会静默漂移。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSnapshot, runMockDocsCheck } from "../../../scripts/lib/mock-docs-check.js";
import {
  auditMockDocs,
  extractClientTables,
  extractDocumentedEndpoints,
  extractDocumentedTables,
  extractE2eEndpoints,
  formatMockDocIssues,
  REQUIRED_DOC_FACTS,
  STALE_DOC_CLAIMS,
} from "./mock-docs";

const tempDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

function codes(input: Parameters<typeof auditMockDocs>[0]): string[] {
  return auditMockDocs(input).issues.map((item) => item.code);
}

/** 合规文档：登记全部传入表与端点，并覆盖所有事实锚点。 */
function compliantDoc(
  tables: string[] = ["profiles"],
  endpoints: string[] = ["/api/e2e/mock-reset"],
) {
  const facts = REQUIRED_DOC_FACTS.map((fact) => `- \`${fact.phrase}\``).join("\n");
  const tableRows = tables.map((name) => `| \`${name}\` | rows |`).join("\n");
  const endpointRows = endpoints.map((endpoint) => `- \`${endpoint}\``).join("\n");
  return [
    "# Mock 开发指南",
    "",
    facts,
    "",
    "| Table | Returns |",
    "| ----- | ------- |",
    tableRows,
    "",
    "## E2E 端点",
    "",
    endpointRows,
    "",
  ].join("\n");
}

const MOCK_SOURCE = ["switch (this.table) {", '  case "profiles":', "    return rows;", "}"].join(
  "\n",
);

describe("extractClientTables", () => {
  it("抽取表名并去重排序", () => {
    const source = ['case "teams":', 'case "profiles":', 'case "teams":'].join("\n");
    expect(extractClientTables(source)).toEqual(["profiles", "teams"]);
  });

  it("忽略非表名的字符串分支", () => {
    const source = ['case "/ok":', 'case "Upper":', 'case "profiles":'].join("\n");
    expect(extractClientTables(source)).toEqual(["profiles"]);
  });

  it("没有字符串分支时返回空数组", () => {
    expect(extractClientTables("const x = 1;")).toEqual([]);
  });
});

describe("extractE2eEndpoints", () => {
  it("把 route.ts 路径归一化为端点并排序", () => {
    expect(
      extractE2eEndpoints([
        "src/app/api/e2e/webhook-events/route.ts",
        "src/app/api/e2e/mock-reset/route.ts",
      ]),
    ).toEqual(["/api/e2e/mock-reset", "/api/e2e/webhook-events"]);
  });

  it("忽略不符合 e2e 布局的路径", () => {
    expect(
      extractE2eEndpoints([
        "src/app/api/health/route.ts",
        "src/app/api/e2e/nested/deep/route.ts",
        "docs/e2e/mock/route.ts",
      ]),
    ).toEqual([]);
  });
});

describe("extractDocumentedTables", () => {
  it("只认表名清单表格的首列行内代码", () => {
    const markdown = [
      "| Table | Returns |",
      "| ----- | ------- |",
      "| `profiles` | rows |",
      "| 10 random profiles | nope |",
    ].join("\n");
    expect(extractDocumentedTables(markdown)).toEqual(["profiles"]);
  });

  it("支持中文表名表头", () => {
    const markdown = ["| 表名 | 返回数据 |", "| --- | --- |", "| `teams` | 团队 |"].join("\n");
    expect(extractDocumentedTables(markdown)).toEqual(["teams"]);
  });

  it("忽略表头不含 table/表名的表格", () => {
    const markdown = ["| 生成函数 | 说明 |", "| --- | --- |", "| `profiles` | 资料 |"].join("\n");
    expect(extractDocumentedTables(markdown)).toEqual([]);
  });

  it("缺少分隔行时不算表名清单", () => {
    const markdown = ["| Table | Returns |", "| `profiles` | rows |"].join("\n");
    expect(extractDocumentedTables(markdown)).toEqual([]);
  });

  it("表格结束后停止收集", () => {
    const markdown = [
      "| Table | Returns |",
      "| --- | --- |",
      "| `profiles` | rows |",
      "",
      "| `teams` | rows |",
    ].join("\n");
    expect(extractDocumentedTables(markdown)).toEqual(["profiles"]);
  });
});

describe("extractDocumentedEndpoints", () => {
  it("抽取并去重文档中引用的 e2e 端点", () => {
    const markdown = "`/api/e2e/mock-reset` 与 `/api/e2e/push-queue`，再次 `/api/e2e/mock-reset`";
    expect(extractDocumentedEndpoints(markdown)).toEqual([
      "/api/e2e/mock-reset",
      "/api/e2e/push-queue",
    ]);
  });
});

describe("auditMockDocs", () => {
  it("合规输入没有告警", () => {
    const report = auditMockDocs({
      mockIndexSource: MOCK_SOURCE,
      e2eRoutePaths: ["src/app/api/e2e/mock-reset/route.ts"],
      documents: [{ path: "docs-site/mock.md", content: compliantDoc() }],
    });
    expect(report.issues).toEqual([]);
    expect(report.tables).toEqual(["profiles"]);
    expect(report.endpoints).toEqual(["/api/e2e/mock-reset"]);
  });

  it("客户端新增表未登记时失败", () => {
    expect(
      codes({
        mockIndexSource: 'case "profiles":\ncase "teams":',
        e2eRoutePaths: ["src/app/api/e2e/mock-reset/route.ts"],
        documents: [{ path: "docs-site/mock.md", content: compliantDoc(["profiles"]) }],
      }),
    ).toContain("MOCK_TABLE_UNDOCUMENTED");
  });

  it("文档登记已删除的表时失败", () => {
    expect(
      codes({
        mockIndexSource: MOCK_SOURCE,
        e2eRoutePaths: ["src/app/api/e2e/mock-reset/route.ts"],
        documents: [
          { path: "docs-site/mock.md", content: compliantDoc(["profiles", "legacy_table"]) },
        ],
      }),
    ).toContain("MOCK_TABLE_UNKNOWN");
  });

  it("端点未登记时失败", () => {
    expect(
      codes({
        mockIndexSource: MOCK_SOURCE,
        e2eRoutePaths: [
          "src/app/api/e2e/mock-reset/route.ts",
          "src/app/api/e2e/push-queue/route.ts",
        ],
        documents: [{ path: "docs-site/mock.md", content: compliantDoc() }],
      }),
    ).toContain("MOCK_ENDPOINT_UNDOCUMENTED");
  });

  it("文档引用已删除端点时失败", () => {
    expect(
      codes({
        mockIndexSource: MOCK_SOURCE,
        e2eRoutePaths: ["src/app/api/e2e/mock-reset/route.ts"],
        documents: [
          {
            path: "docs-site/mock.md",
            content: `${compliantDoc()}\n\`/api/e2e/removed\`\n`,
          },
        ],
      }),
    ).toContain("MOCK_ENDPOINT_UNKNOWN");
  });

  it("缺少事实锚点时失败", () => {
    const doc = compliantDoc().replace("NODE_ENV", "");
    expect(
      codes({
        mockIndexSource: MOCK_SOURCE,
        e2eRoutePaths: ["src/app/api/e2e/mock-reset/route.ts"],
        documents: [{ path: "docs-site/mock.md", content: doc }],
      }),
    ).toContain("MOCK_REQUIRED_FACT_MISSING");
  });

  it("旧表述回流时失败", () => {
    const doc = `${compliantDoc()}\nMock data is cached per request.\n`;
    expect(
      codes({
        mockIndexSource: MOCK_SOURCE,
        e2eRoutePaths: ["src/app/api/e2e/mock-reset/route.ts"],
        documents: [{ path: "docs-site/mock.md", content: doc }],
      }),
    ).toContain("MOCK_STALE_CLAIM");
  });

  it("没有文档时失败封闭", () => {
    expect(
      codes({
        mockIndexSource: MOCK_SOURCE,
        e2eRoutePaths: ["src/app/api/e2e/mock-reset/route.ts"],
        documents: [],
      }),
    ).toContain("MOCK_DOC_SOURCE_EMPTY");
  });

  it("抽不到表名或端点时失败封闭", () => {
    const empty = codes({
      mockIndexSource: "const x = 1;",
      e2eRoutePaths: ["src/app/api/health/route.ts"],
      documents: [{ path: "docs-site/mock.md", content: compliantDoc() }],
    });
    expect(empty.filter((code) => code === "MOCK_DOC_SOURCE_EMPTY")).toHaveLength(2);
  });

  it("每份文档独立校验", () => {
    const report = auditMockDocs({
      mockIndexSource: MOCK_SOURCE,
      e2eRoutePaths: ["src/app/api/e2e/mock-reset/route.ts"],
      documents: [
        { path: "docs-site/mock.md", content: compliantDoc() },
        { path: "docs/architecture/13-mock-system.md", content: "# 空文档" },
      ],
    });
    expect(
      report.issues.every((item) => item.document === "docs/architecture/13-mock-system.md"),
    ).toBe(true);
    expect(report.issues.length).toBeGreaterThan(0);
  });

  it("旧表述清单里的说法都被覆盖", () => {
    for (const claim of STALE_DOC_CLAIMS) {
      const report = auditMockDocs({
        mockIndexSource: MOCK_SOURCE,
        e2eRoutePaths: ["src/app/api/e2e/mock-reset/route.ts"],
        documents: [{ path: "docs-site/mock.md", content: `${compliantDoc()}\n${claim.phrase}\n` }],
      });
      expect(report.issues.map((item) => item.code)).toContain("MOCK_STALE_CLAIM");
    }
  });
});

describe("formatMockDocIssues", () => {
  it("输出规则码与文档路径", () => {
    const text = formatMockDocIssues([
      { code: "MOCK_TABLE_UNKNOWN", document: "docs-site/mock.md", detail: "表 legacy 已删除" },
    ]);
    expect(text).toBe("❌ [MOCK_TABLE_UNKNOWN] docs-site/mock.md 表 legacy 已删除");
  });
});

describe("真实仓库与 CLI", () => {
  it("当前仓库的 Mock 文档与实现一致", () => {
    const report = auditMockDocs(buildSnapshot());
    expect(report.issues).toEqual([]);
    expect(report.tables.length).toBeGreaterThanOrEqual(18);
    expect(report.endpoints.length).toBeGreaterThanOrEqual(9);
  });

  it("buildSnapshot 读取三份文档与全部 E2E 路由", () => {
    const snapshot = buildSnapshot();
    expect(snapshot.documents.map((item) => item.path)).toEqual([
      "docs-site/mock.md",
      "docs-site/zh-CN/mock.md",
      "docs/architecture/13-mock-system.md",
    ]);
    expect(snapshot.e2eRoutePaths).toContain("src/app/api/e2e/mock-reset/route.ts");
  });

  it("合规临时仓库返回 0 并打印统计", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => void logs.push(line));
    expect(runMockDocsCheck(writeRepo())).toBe(0);
    expect(logs.join("\n")).toContain("Mock 文档一致性通过");
  });

  it("文档漂移的临时仓库返回 1 并打印规则码", () => {
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: string) => void errors.push(line));
    const dir = writeRepo({
      "docs-site/mock.md": compliantDoc(["profiles", "teams"]),
      "docs-site/zh-CN/mock.md": compliantDoc(["profiles", "teams"]),
    });
    expect(runMockDocsCheck(dir)).toBe(1);
    expect(errors.join("\n")).toContain("MOCK_TABLE_UNKNOWN");
  });

  it("快照读取失败返回 1", () => {
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: string) => void errors.push(line));
    expect(runMockDocsCheck("/definitely/not/a/repo")).toBe(1);
    expect(errors.join("\n")).toContain("无法读取 Mock 文档快照");
  });
});

function writeRepo(overrides: Record<string, string> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "indiestack-mockdocs-"));
  tempDirs.push(dir);
  const files: Record<string, string> = {
    "src/lib/mock/index.ts": MOCK_SOURCE,
    "src/app/api/e2e/mock-reset/route.ts": "export {};",
    "src/app/api/e2e/push-queue/route.ts": "export {};",
    "docs-site/mock.md": compliantDoc(["profiles"], ["/api/e2e/mock-reset", "/api/e2e/push-queue"]),
    "docs-site/zh-CN/mock.md": compliantDoc(
      ["profiles"],
      ["/api/e2e/mock-reset", "/api/e2e/push-queue"],
    ),
    "docs/architecture/13-mock-system.md": compliantDoc(
      ["profiles"],
      ["/api/e2e/mock-reset", "/api/e2e/push-queue"],
    ),
    ...overrides,
  };
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(dir, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return dir;
}
