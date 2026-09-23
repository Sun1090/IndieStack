/**
 * 进度台账自检单测。
 * 五条判定各钉一次，外加「子标题不算条目」与 CLI 读临时目录两例。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runProgressLedgerCheck } from "../../../scripts/lib/progress-ledger-check.js";
import {
  auditProgressLedger,
  formatLedgerIssues,
  parseLedgerEntries,
} from "./progress-ledger";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

function entry(date: string, title: string, extra = "") {
  return `## ${date} — ${title}\n\n- 里程碑 / 版本：v0.12.0。\n- 状态：DONE。\n${extra}\n`;
}

function codes(markdown: string): string[] {
  return auditProgressLedger(markdown).issues.map((item) => item.code);
}

describe("parseLedgerEntries()", () => {
  it("### 子标题属于所属条目，不会被当成新条目", () => {
    const markdown = `${entry("2026-09-22", "第一条")}\n### 补记\n\n- 里程碑 / 版本：写在子标题里。\n- 状态：PARTIAL。\n${entry("2026-09-23", "第二条")}`;
    const entries = parseLedgerEntries(markdown);
    expect(entries.map((item) => item.heading)).toEqual([
      "2026-09-22 — 第一条",
      "2026-09-23 — 第二条",
    ]);
    expect(entries[0].body).toContain("### 补记");
  });

  it("条目正文切到下一条标题为止", () => {
    const entries = parseLedgerEntries(`${entry("2026-09-22", "A")}${entry("2026-09-23", "B")}`);
    expect(entries[0].body).not.toContain("— B");
    expect(entries[1].body).toContain("- 状态：DONE");
  });
});

describe("auditProgressLedger()", () => {
  it("正常台账不报任何问题", () => {
    expect(codes(`${entry("2026-09-22", "A")}${entry("2026-09-23", "B")}`)).toEqual([]);
    const report = auditProgressLedger(`${entry("2026-09-22", "A")}${entry("2026-09-23", "B")}`);
    expect(report.entries).toHaveLength(2);
    expect(report.issues).toEqual([]);
  });

  it("空台账或解析不出条目时失败封闭", () => {
    expect(codes("")).toEqual(["ledger-empty"]);
    expect(codes("# 只有大标题\n\n没有条目\n")).toEqual(["ledger-empty"]);
    expect(auditProgressLedger("").entries).toHaveLength(0);
  });

  it("缺日期的标题单独报一类", () => {
    const markdown = "## 没有日期的标题\n\n- 里程碑 / 版本：x\n- 状态：DONE\n";
    expect(codes(markdown)).toContain("heading-undated");
  });

  it("日期倒序报 date-out-of-order（末尾追加约定的直接推论）", () => {
    expect(codes(`${entry("2026-09-23", "新")}${entry("2026-09-22", "旧")}`)).toContain("date-out-of-order");
    expect(codes(`${entry("2026-09-22", "旧")}${entry("2026-09-23", "新")}`)).toEqual([]);
  });

  it("日期倒序的失败信息把两种成因的处置动作都写出来", () => {
    const report = auditProgressLedger(`${entry("2026-09-23", "新")}${entry("2026-09-22", "旧")}`);
    const message =
      report.issues.find((item) => item.code === "date-out-of-order")?.message ?? "";
    // 成因一：条目插错了位置。
    expect(message).toContain("追加在文件末尾");
    // 成因二：解决 docs/progress.md 冲突时两块都留，内容没丢但顺序坏了——这一步只在台账里写过，
    // 看到红灯的人手上没有它，所以它必须在信息里；删掉下面两条断言之外的任何东西都不算修好。
    expect(message).toContain("按日期稳定排序");
    expect(message).toContain("不要删掉其中一条");
  });

  it("同日多条不算倒序", () => {
    expect(codes(`${entry("2026-09-23", "A")}${entry("2026-09-23", "B")}`)).toEqual([]);
  });

  it("标题重复报 duplicate-heading，并指出与哪一行重复", () => {
    const markdown = `${entry("2026-09-22", "同一件事")}${entry("2026-09-22", "同一件事")}`;
    const report = auditProgressLedger(markdown);
    const duplicate = report.issues.find((item) => item.code === "duplicate-heading");
    expect(duplicate?.message).toContain("第 1 行");
    expect(codes(markdown)).toEqual(["duplicate-heading"]);
  });

  it("不同日期写同一件事不算重复", () => {
    expect(codes(`${entry("2026-09-22", "同一件事")}${entry("2026-09-23", "同一件事")}`)).toEqual([]);
  });

  it("缺必填字段报 missing-field，且指明缺哪个", () => {
    const noStatus = "## 2026-09-22 — A\n\n- 里程碑 / 版本：x\n";
    expect(codes(noStatus)).toEqual(["missing-field"]);
    expect(auditProgressLedger(noStatus).issues[0].message).toContain("- 状态：");
    const noMilestone = "## 2026-09-22 — A\n\n- 状态：DONE\n";
    expect(auditProgressLedger(noMilestone).issues[0].message).toContain("- 里程碑：");
  });

  it("字段判断锚定行首的 `- 名称：`，正文里提一句不算有", () => {
    const markdown = "## 2026-09-22 — A\n\n状态：随便写在正文里。\n- 里程碑 / 版本：x\n";
    expect(codes(markdown)).toEqual(["missing-field"]);
  });

  it("formatLedgerIssues 输出带 code 与位置", () => {
    const report = auditProgressLedger(`${entry("2026-09-23", "A")}${entry("2026-09-22", "B")}`);
    const text = formatLedgerIssues(report.issues);
    expect(text).toContain("[date-out-of-order]");
    expect(text).toContain("第 ");
  });
});

describe("runProgressLedgerCheck() — CLI", () => {
  it("临时目录里坏台账返回 1、好台账返回 0、缺文件返回 1", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-"));
    tempDirs.push(root);
    fs.mkdirSync(path.join(root, "docs"), { recursive: true });
    const file = path.join(root, "docs/progress.md");

    fs.writeFileSync(file, `${entry("2026-09-22", "A")}${entry("2026-09-23", "B")}`);
    expect(runProgressLedgerCheck(root)).toBe(0);

    fs.writeFileSync(file, `${entry("2026-09-23", "A")}${entry("2026-09-22", "B")}`);
    expect(runProgressLedgerCheck(root)).toBe(1);

    fs.rmSync(file);
    expect(runProgressLedgerCheck(root)).toBe(1);
  });

  it("本仓库当前的台账自检通过", () => {
    expect(runProgressLedgerCheck(process.cwd())).toBe(0);
  });
});
