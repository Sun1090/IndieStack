import { describe, expect, it } from "vitest";
import {
  allLinkTargets,
  auditAgentsIndex,
  formatAgentsIndexIssues,
  idOf,
  parseIndexRows,
} from "./agents-index.ts";

const FILES = ["01-code-writer.md", "02-code-reviewer.md", "09-ui-ux.md"];

function index(rows: string[], extra = ""): string {
  return [
    "# Agents",
    "",
    "| ID | Agent | Responsibility | File |",
    "|---|---|---|---|",
    ...rows,
    "",
    "## When to Use Which",
    "",
    "| Need | Agent |",
    "|---|---|",
    ...(extra ? [extra] : []),
    "",
  ].join("\n");
}

const ROW_01 = "| 01 | Code Writer | Write code | [agents/01-code-writer.md](./agents/01-code-writer.md) |";
const ROW_02 = "| 02 | Code Reviewer | Review | [agents/02-code-reviewer.md](./agents/02-code-reviewer.md) |";
const ROW_09 = "| 09 | UI/UX | Design UI | [agents/09-ui-ux.md](./agents/09-ui-ux.md) |";

describe("idOf", () => {
  it("取文件名的数字前缀", () => {
    expect(idOf("09-ui-ux.md")).toBe("09");
  });

  it("不符合命名返回 null", () => {
    expect(idOf("notes.md")).toBeNull();
    expect(idOf("9-ui.md")).toBeNull();
  });
});

describe("parseIndexRows", () => {
  it("只解析索引表形状的行，忽略用法指南表的行", () => {
    const rows = parseIndexRows(index([ROW_01, ROW_09]));
    expect(rows.map((r) => r.file)).toEqual(["01-code-writer.md", "09-ui-ux.md"]);
  });

  it("记录行号", () => {
    expect(parseIndexRows(index([ROW_01]))[0].line).toBe(5);
  });
});

describe("allLinkTargets", () => {
  it("表内表外的链接都算（坏链接在哪都该报）", () => {
    const targets = allLinkTargets(index([ROW_01], "| Design | [09](./agents/09-ui-ux.md) |"));
    expect(targets).toContain("01-code-writer.md");
    expect(targets).toContain("09-ui-ux.md");
  });
});

describe("auditAgentsIndex — 一致时不报错", () => {
  it("每个文件都在表里", () => {
    expect(auditAgentsIndex({ indexContent: index([ROW_01, ROW_02, ROW_09]), agentFiles: FILES })).toEqual([]);
  });

  it("表里可以只有一部分 agent（其余的会各自报缺行）", () => {
    const issues = auditAgentsIndex({ indexContent: index([ROW_01, ROW_02]), agentFiles: FILES });
    expect(issues.map((i) => i.code)).toEqual(["AGENTS_TABLE_MISSING_ROW"]);
  });
});

describe("auditAgentsIndex — 这次修的那个洞", () => {
  it("只从索引表删掉一行、另一处引用还在 → 报错", () => {
    // 回归：原文用全文正则搜 agents/xxx.md，而同一个 agent 在「When to Use Which」里
    // 还有一处引用，于是只删索引表那一行时门禁照样绿。
    const content = index(
      [ROW_01, ROW_02],
      "| Design UI | [09 UI/UX](./agents/09-ui-ux.md) |",
    );
    const issues = auditAgentsIndex({ indexContent: content, agentFiles: FILES });
    expect(issues.map((i) => i.code)).toEqual(["AGENTS_TABLE_MISSING_ROW"]);
  });

  it("索引表整个不见了 → 报错（表没了，上面所有判据都会空转）", () => {
    const issues = auditAgentsIndex({ indexContent: "# Agents\n\n没有表。\n", agentFiles: FILES });
    expect(issues.map((i) => i.code)).toContain("AGENTS_TABLE_MISSING");
  });
});

describe("auditAgentsIndex — 编号与文件名", () => {
  it("编号写错但链接对 → 报错（全文搜索永远查不出这个）", () => {
    const wrong = "| 99 | UI/UX | Design | [agents/09-ui-ux.md](./agents/09-ui-ux.md) |";
    const issues = auditAgentsIndex({ indexContent: index([ROW_01, ROW_02, wrong]), agentFiles: FILES });
    expect(issues.map((i) => i.code)).toEqual(["AGENTS_ID_MISMATCH"]);
  });

  it("同一行重复出现 → 报错并指出首次行号", () => {
    const issues = auditAgentsIndex({
      indexContent: index([ROW_01, ROW_02, ROW_09, ROW_01]),
      agentFiles: FILES,
    });
    expect(issues[0].code).toBe("AGENTS_DUPLICATE_ROW");
    expect(issues[0].message).toContain("首次出现在第 5 行");
  });
});

describe("auditAgentsIndex — 坏链接", () => {
  it("表外指向不存在文件 → 报错", () => {
    const issues = auditAgentsIndex({
      indexContent: index([ROW_01, ROW_02, ROW_09], "| X | [Y](./agents/99-nope.md) |"),
      agentFiles: FILES,
    });
    expect(issues.map((i) => i.code)).toEqual(["AGENTS_LINK_TARGET_MISSING"]);
  });

  it("表里指向不存在文件 → 报 UNKNOWN_ROW 而不是静默", () => {
    const bogus = "| 98 | X | Y | [agents/98-x.md](./agents/98-x.md) |";
    const issues = auditAgentsIndex({ indexContent: index([ROW_01, ROW_02, bogus]), agentFiles: FILES });
    expect(issues.map((i) => i.code)).toContain("AGENTS_TABLE_UNKNOWN_ROW");
  });
});

describe("formatAgentsIndexIssues", () => {
  it("带行号打印", () => {
    const issues = auditAgentsIndex({
      indexContent: index([ROW_01, ROW_02, "| 99 | X | Y | [agents/09-ui-ux.md](./agents/09-ui-ux.md) |"]),
      agentFiles: FILES,
    });
    expect(formatAgentsIndexIssues(issues)).toContain("第 7 行");
  });

  it("没有问题时输出空字符串", () => {
    expect(formatAgentsIndexIssues([])).toBe("");
  });
});
