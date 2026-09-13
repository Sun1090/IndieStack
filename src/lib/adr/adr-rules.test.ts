/**
 * ADR 治理门禁单测（I04）。
 * 覆盖纯函数规则、真实仓库快照与 CLI 退出码，确保索引/状态不会再次漂移。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSnapshot, runAdrCheck } from "../../../scripts/lib/adr-check.js";
import { auditAdrRepository, formatAdrIssues, parseAdrStatus } from "./adr-rules";

const tempDirs: string[] = [];

function adr(
  number: number,
  title: string,
  options: { status?: string; date?: string; sections?: string[]; extra?: string } = {},
): string {
  const status = options.status ?? "已接受";
  const date = options.date ?? "2026-09-01";
  const sections = options.sections ?? ["背景", "决策", "理由", "影响"];
  const body = sections.map((section) => `## ${section}\n\n${section}内容。\n`).join("\n");
  return `# ADR-${String(number).padStart(3, "0")}: ${title}\n\n状态: ${status}\n日期: ${date}\n\n${body}${options.extra ?? ""}`;
}

function index(rows: Array<[number, string, string]>): string {
  return `# ADR 索引\n\n| 编号 | 决策 | 状态 |\n|---|---|---|\n${rows
    .map(
      ([number, title, status]) =>
        `| [ADR-${String(number).padStart(3, "0")}](adr-${String(number).padStart(3, "0")}-${title
          .toLowerCase()
          .replaceAll(" ", "-")}.md) | ${title} | ${status} |`,
    )
    .join("\n")}\n`;
}

function files(...documents: Array<{ number: number; title: string; content: string }>) {
  return documents.map((document) => ({
    path: `docs/adr/adr-${String(document.number).padStart(3, "0")}-${document.title
      .toLowerCase()
      .replaceAll(" ", "-")}.md`,
    content: document.content,
  }));
}

function codes(input: Parameters<typeof auditAdrRepository>[0]): string[] {
  return auditAdrRepository(input).errors.map((item) => item.code);
}

function writeRepo(filesToWrite: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "indiestack-adr-"));
  tempDirs.push(dir);
  for (const [relative, content] of Object.entries(filesToWrite)) {
    const absolute = path.join(dir, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content, "utf8");
  }
  return dir;
}

function simpleRepo(overrides: Record<string, string> = {}): string {
  const title = "Test decision";
  return writeRepo({
    "docs/adr/README.md": index([[1, title, "已接受"]]),
    "docs/adr/adr-001-test-decision.md": adr(1, title),
    ...overrides,
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("parseAdrStatus()", () => {
  it("识别三种合法状态", () => {
    expect(parseAdrStatus("提议")?.kind).toBe("proposed");
    expect(parseAdrStatus("已接受")?.kind).toBe("accepted");
    expect(parseAdrStatus("已接受（渐进落地）")?.kind).toBe("accepted");
    expect(parseAdrStatus("已废弃（被 ADR-013 取代）")).toMatchObject({
      kind: "superseded",
      supersededBy: "ADR-013",
    });
  });

  it("拒绝英文 accepted、缺编号等非规范状态", () => {
    expect(parseAdrStatus("accepted")).toBeNull();
    expect(parseAdrStatus("已废弃")).toBeNull();
    expect(parseAdrStatus("已废弃（被 ADR-13 取代）")).toBeNull();
  });
});

describe("auditAdrRepository() 通过用例", () => {
  it("合法的单篇 ADR 与索引通过", () => {
    const title = "Test decision";
    const report = auditAdrRepository({
      files: files({ number: 1, title, content: adr(1, title) }),
      indexMarkdown: index([[1, title, "已接受"]]),
      today: "2026-09-13",
    });
    expect(report.errors).toEqual([]);
    expect(report.stats).toEqual({
      documents: 1,
      indexed: 1,
      accepted: 1,
      proposed: 0,
      superseded: 0,
    });
  });

  it("合法的取代链通过（后继正文显式引用前项）", () => {
    const firstTitle = "Old decision";
    const secondTitle = "New decision";
    const report = auditAdrRepository({
      files: files(
        {
          number: 1,
          title: firstTitle,
          content: adr(1, firstTitle, { status: "已废弃（被 ADR-002 取代）" }),
        },
        {
          number: 2,
          title: secondTitle,
          content: adr(2, secondTitle, { extra: "\n取代 ADR-001。\n" }),
        },
      ),
      indexMarkdown: index([
        [1, firstTitle, "已废弃（被 ADR-002 取代）"],
        [2, secondTitle, "已接受"],
      ]),
      today: "2026-09-13",
    });
    expect(report.errors).toEqual([]);
    expect(report.stats.superseded).toBe(1);
  });

  it("后果可以替代影响章节", () => {
    const title = "Consequence style";
    const report = auditAdrRepository({
      files: files({
        number: 1,
        title,
        content: adr(1, title, { sections: ["背景", "决策", "理由", "后果"] }),
      }),
      indexMarkdown: index([[1, title, "已接受"]]),
      today: "2026-09-13",
    });
    expect(report.errors).toEqual([]);
  });
});

describe("auditAdrRepository() 文件结构规则", () => {
  it("文件名不符合 kebab-case 约定", () => {
    expect(
      codes({
        files: [{ path: "docs/adr/ADR-001-Bad.md", content: adr(1, "Bad") }],
        indexMarkdown: index([]),
      }),
    ).toContain("FILE_NAME");
  });

  it("标题编号与文件名不一致", () => {
    const result = auditAdrRepository({
      files: files({ number: 1, title: "Title", content: adr(2, "Title") }),
      indexMarkdown: index([]),
      today: "2026-09-13",
    });
    expect(result.errors.map((item) => item.code)).toContain("HEADING_NUMBER");
  });

  it("缺少状态、日期或必要章节均报错", () => {
    expect(
      codes({
        files: [
          {
            path: "docs/adr/adr-001-title.md",
            content: "# ADR-001: Title\n日期: 2026-09-01\n\n## 背景\n\n## 决策\n\n## 影响\n",
          },
        ],
        indexMarkdown: index([]),
      }),
    ).toContain("STATUS_MISSING");
    expect(
      codes({
        files: [
          {
            path: "docs/adr/adr-001-title.md",
            content: "# ADR-001: Title\n状态: 已接受\n\n## 背景\n\n## 决策\n\n## 影响\n",
          },
        ],
        indexMarkdown: index([]),
      }),
    ).toContain("DATE_MISSING");
    expect(
      codes({
        files: files({
          number: 1,
          title: "Title",
          content: adr(1, "Title", { sections: ["决策"] }),
        }),
        indexMarkdown: index([]),
      }),
    ).toContain("SECTION_MISSING");
  });

  it("非法日期与未来日期分别报错", () => {
    expect(
      codes({
        files: files({
          number: 1,
          title: "Title",
          content: adr(1, "Title", { date: "2026-02-30" }),
        }),
        indexMarkdown: index([]),
      }),
    ).toContain("DATE_INVALID");
    expect(
      codes({
        files: files({
          number: 1,
          title: "Title",
          content: adr(1, "Title", { date: "2026-09-14" }),
        }),
        indexMarkdown: index([]),
        today: "2026-09-13",
      }),
    ).toContain("DATE_FUTURE");
  });
});

describe("auditAdrRepository() 索引与编号规则", () => {
  it("缺少索引、索引孤儿与重复条目均报错", () => {
    const title = "Title";
    const bad = auditAdrRepository({
      files: files({ number: 1, title, content: adr(1, title) }),
      indexMarkdown: index([
        [1, title, "已接受"],
        [1, title, "已接受"],
        [2, "Missing", "已接受"],
      ]),
      today: "2026-09-13",
    });
    const found = bad.errors.map((item) => item.code);
    expect(found).toContain("INDEX_DUPLICATE");
    expect(found).toContain("INDEX_ORPHAN");
  });

  it("索引标题与状态必须逐字匹配正文", () => {
    const title = "Title";
    const result = auditAdrRepository({
      files: files({ number: 1, title, content: adr(1, title) }),
      indexMarkdown: index([[1, "Other title", "提议"]]),
      today: "2026-09-13",
    });
    const found = result.errors.map((item) => item.code);
    expect(found).toContain("INDEX_TITLE");
    expect(found).toContain("INDEX_STATUS");
  });

  it("索引降序与非法索引状态报错", () => {
    const first = `# ADR 索引\n\n| [ADR-002](adr-002-b.md) | B | 已接受 |\n| [ADR-001](adr-001-a.md) | A | accepted |\n`;
    const result = auditAdrRepository({ files: [], indexMarkdown: first, today: "2026-09-13" });
    const found = result.errors.map((item) => item.code);
    expect(found).toContain("INDEX_STATUS_INVALID");
    expect(found).toContain("INDEX_ORDER");
  });

  it("编号重复与缺号报错", () => {
    const title = "Title";
    const result = auditAdrRepository({
      files: [
        { path: "docs/adr/adr-001-title.md", content: adr(1, title) },
        { path: "docs/adr/adr-001-other.md", content: adr(1, title) },
        { path: "docs/adr/adr-003-third.md", content: adr(3, title) },
      ],
      indexMarkdown: index([]),
      today: "2026-09-13",
    });
    const found = result.errors.map((item) => item.code);
    expect(found).toContain("NUMBER_DUPLICATE");
    expect(found).toContain("NUMBER_GAP");
  });
});

describe("auditAdrRepository() 取代关系规则", () => {
  it("指向不存在的后继 ADR 报错", () => {
    const title = "Title";
    expect(
      codes({
        files: files({
          number: 1,
          title,
          content: adr(1, title, { status: "已废弃（被 ADR-099 取代）" }),
        }),
        indexMarkdown: index([[1, title, "已废弃（被 ADR-099 取代）"]]),
        today: "2026-09-13",
      }),
    ).toContain("SUPERSEDE_TARGET");
  });

  it("后继正文未引用被取代项报错", () => {
    const firstTitle = "Old";
    const secondTitle = "New";
    expect(
      codes({
        files: files(
          {
            number: 1,
            title: firstTitle,
            content: adr(1, firstTitle, { status: "已废弃（被 ADR-002 取代）" }),
          },
          { number: 2, title: secondTitle, content: adr(2, secondTitle) },
        ),
        indexMarkdown: index([
          [1, firstTitle, "已废弃（被 ADR-002 取代）"],
          [2, secondTitle, "已接受"],
        ]),
        today: "2026-09-13",
      }),
    ).toContain("SUPERSEDE_REFERENCE");
  });
});

describe("formatAdrIssues()", () => {
  it("输出规则码、文件与行号", () => {
    const text = formatAdrIssues([
      { code: "INDEX_MISSING", file: "docs/adr/README.md", line: 4, message: "缺失" },
    ]);
    expect(text).toBe("❌ [INDEX_MISSING] docs/adr/README.md:4 缺失");
  });
});

describe("真实仓库与 CLI", () => {
  it("当前仓库 ADR 快照通过新规则", () => {
    const snapshot = buildSnapshot();
    const report = auditAdrRepository({ ...snapshot, today: "2026-09-13" });
    expect(report.errors).toEqual([]);
    expect(report.stats.documents).toBeGreaterThanOrEqual(13);
  });

  it("buildSnapshot 读取全部 ADR 文件与 README", () => {
    const snapshot = buildSnapshot();
    expect(snapshot.files.length).toBeGreaterThanOrEqual(13);
    expect(snapshot.files.every((file: { path: string }) => file.path.endsWith(".md"))).toBe(true);
    expect(snapshot.indexMarkdown).toContain("# 架构决策记录");
  });

  it("合规临时仓库返回 0 并打印统计", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => void logs.push(line));
    expect(runAdrCheck(simpleRepo())).toBe(0);
    expect(logs.join("\n")).toContain("ADR 治理通过");
  });

  it("非法临时仓库返回 1 并打印规则码", () => {
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: string) => void errors.push(line));
    const dir = simpleRepo({
      "docs/adr/README.md": "# ADR 索引\n\n| 编号 | 决策 | 状态 |\n|---|---|---|\n",
    });
    expect(runAdrCheck(dir)).toBe(1);
    expect(errors.join("\n")).toContain("INDEX_MISSING");
  });

  it("快照读取失败返回 1", () => {
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: string) => void errors.push(line));
    expect(runAdrCheck("/definitely/not/a/repo")).toBe(1);
    expect(errors.join("\n")).toContain("无法读取 ADR 快照");
  });
});
