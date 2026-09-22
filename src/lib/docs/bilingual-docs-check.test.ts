/**
 * 双语调度事实门禁的 IO 层测试（D02）。
 * 覆盖：目录遍历与跳过、真实仓库通过、漂移退出码、缺失目录失败封闭。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  collectBilingualDocs,
  runBilingualDocsCheck,
} from "../../../scripts/lib/bilingual-docs-check.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function writeRepo(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bilingual-docs-"));
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(root, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content, "utf8");
  }
  return root;
}

describe("collectBilingualDocs()", () => {
  it("递归收集 Markdown，跳过构建产物与依赖", () => {
    const root = writeRepo({
      "docs-site/email.md": "a",
      "docs-site/zh-CN/email.md": "b",
      "docs-site/v0.1.0.md": "c",
      "docs-site/zh-CN/v0.1.0.md": "d",
      "docs-site/node_modules/dep.md": "e",
      "docs-site/.vitepress/dist/x.md": "f",
      "docs-site/public/raw.md": "g",
      "docs-site/README.txt": "h",
    });
    expect(collectBilingualDocs(root).map((doc) => doc.path)).toEqual([
      "docs-site/email.md",
      "docs-site/v0.1.0.md",
      "docs-site/zh-CN/email.md",
      "docs-site/zh-CN/v0.1.0.md",
    ]);
  });

  it("docs-site 缺失时返回空集合，由规则报零配对", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bilingual-docs-empty-"));
    expect(collectBilingualDocs(root)).toEqual([]);
  });
});

describe("runBilingualDocsCheck()", () => {
  it("真实仓库通过并报告核对面", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(runBilingualDocsCheck()).toBe(0);
    const output = log.mock.calls.flat().join(" ");
    expect(output).toContain("双语调度事实一致");
    expect(output).toMatch(/\d+ 对文档/);
    expect(output).toMatch(/\d+ 个 cron 表达式/);
  });

  it("临时仓库里只改一种语言时失败并给出规则码", () => {
    const root = writeRepo({
      "docs-site/email.md": "调度 `0 9 * * *`，每天 09:00 UTC",
      "docs-site/zh-CN/email.md": "调度 `0 5 * * *`，每天 09:00 UTC",
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(runBilingualDocsCheck(root)).toBe(1);
    const output = error.mock.calls.flat().join("\n");
    expect(output).toContain("[DOC_CRON_MISMATCH] docs-site/email.md");
    expect(output).toContain("多出 0 5 * * *");
  });

  it("缺少中文配对时失败而不是静默跳过", () => {
    const root = writeRepo({ "docs-site/web-push.md": "每天 22:00 UTC" });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(runBilingualDocsCheck(root)).toBe(1);
    const output = error.mock.calls.flat().join("\n");
    expect(output).toContain("[DOC_PAIR_MISSING] docs-site/web-push.md");
  });

  it("没有 docs-site 目录时按失败封闭处理", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bilingual-docs-none-"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(runBilingualDocsCheck(root)).toBe(1);
    expect(error.mock.calls.flat().join("\n")).toContain("[DOC_NO_PAIRS] docs-site");
  });
});
