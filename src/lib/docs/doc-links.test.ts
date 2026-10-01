import { describe, expect, it } from "vitest";
import {
  auditDocLinks,
  extractLinks,
  formatDocLinkIssues,
  formatDocLinkSummary,
  linkCandidates,
  resolveRepoPath,
} from "./doc-links.ts";

const FILES = ["docs-site/quickstart.md", "docs/README.md", "README.md"];

function run(opts: {
  contents: Record<string, string>;
  exists?: (p: string) => boolean;
  files?: string[];
}) {
  const files = opts.files ?? Object.keys(opts.contents);
  const known = new Set(files);
  return auditDocLinks({
    files,
    contents: opts.contents,
    // 候选存在性：x 存在，或 x.md 存在（模拟真实文件系统）
    exists:
      opts.exists ??
      ((p: string) => known.has(p) || known.has(`${p}.md`) || known.has(`${p}/index.md`)),
  });
}

describe("extractLinks", () => {
  it("抽出内部链接并记录行号", () => {
    expect(extractLinks("a\n见 [x](./b.md)。")).toEqual([{ target: "./b.md", line: 2 }]);
  });

  it("跳过外部链接与纯锚点", () => {
    const links = extractLinks(
      ["[a](https://x.dev)", "[b](mailto:a@b.c)", "[c](#section)", "[d](./e.md)"].join("\n"),
    );
    expect(links).toEqual([{ target: "./e.md", line: 4 }]);
  });

  it("链接标题里带括号也能抽出来（常见于带 title 的写法）", () => {
    expect(extractLinks('[x](./a.md "标题")')[0].target).toBe("./a.md");
  });
});

describe("resolveRepoPath", () => {
  it("同目录相对路径", () => {
    expect(resolveRepoPath("docs-site/quickstart.md", "./architecture")).toBe(
      "docs-site/architecture",
    );
  });

  it("上跳相对路径", () => {
    expect(resolveRepoPath("docs-site/zh-CN/configuration.md", "../../README.md")).toBe(
      "README.md",
    );
  });

  it("`/x` 是站点根 URL，映射到 docs-site —— 按文件系统根去查会全灭", () => {
    expect(resolveRepoPath("docs-site/introduction.md", "/quickstart")).toBe(
      "docs-site/quickstart",
    );
  });

  it("站点根可注入", () => {
    expect(resolveRepoPath("a/b.md", "/x", "site")).toBe("site/x");
  });

  it("丢掉锚点与查询串", () => {
    expect(resolveRepoPath("a/b.md", "./c.md#sec")).toBe("a/c.md");
  });
});

describe("linkCandidates", () => {
  it("原样、+.md、+/index.md 三种都试", () => {
    expect(linkCandidates("docs-site/storage")).toEqual([
      "docs-site/storage",
      "docs-site/storage.md",
      "docs-site/storage/index.md",
    ]);
  });

  it("已经带 .md 就不补 .md（否则会造出 README.md.md 这种不存在的候选）", () => {
    expect(linkCandidates("README.md")).toEqual(["README.md"]);
  });
});

describe("auditDocLinks", () => {
  it("可达的链接不报错", () => {
    const report = run({
      contents: {
        "docs-site/quickstart.md": "见 [架构](./architecture) 与 [测试](/testing)",
        "docs-site/architecture.md": "x",
        "docs-site/testing.md": "x",
      },
    });
    expect(report.errors).toEqual([]);
    expect(report.stats).toEqual({ files: 3, internalLinks: 2, broken: 0 });
  });

  it("断链报错并点名文件、行号与试过的候选", () => {
    const report = run({
      contents: {
        "docs-site/quickstart.md": "见 [没了](./nope)",
        "docs-site/architecture.md": "x",
        "docs-site/testing.md": "x",
      },
    });
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].code).toBe("DOC_LINK_BROKEN");
    expect(report.errors[0].file).toBe("docs-site/quickstart.md");
    expect(report.errors[0].line).toBe(1);
    expect(report.errors[0].message).toContain("docs-site/nope.md");
  });

  it("**省略 .md 的写法不算断链**（真实假红陷阱）", () => {
    // 回归：手工量的时候只试「原样拼接」，于是把每一条文档链接都报成断链——
    // 得到「28 条断链」，而那 28 条的目标文件全部存在。
    const report = run({
      contents: {
        "docs-site/quickstart.md": "[存储](./storage)",
        "docs-site/storage.md": "x",
      },
    });
    expect(report.errors).toEqual([]);
  });

  it("**站点根 URL 不算断链**（第二个真实假红陷阱）", () => {
    const report = run({
      contents: {
        "docs-site/introduction.md": "[快速开始](/quickstart)",
        "docs-site/quickstart.md": "x",
      },
    });
    expect(report.errors).toEqual([]);
  });

  it("指向目录的 index.md 也算可达", () => {
    const report = run({
      contents: {
        "docs-site/quickstart.md": "[子页](./guide)",
        "docs-site/guide/index.md": "x",
      },
    });
    expect(report.errors).toEqual([]);
  });

  it("一个文件都没扫到时报红（量不到东西必须出声）", () => {
    const report = run({ contents: {}, files: [] });
    expect(report.errors.map((e) => e.code)).toEqual(["DOC_LINKS_NOTHING_SCANNED"]);
  });
});

describe("格式化", () => {
  it("自述行把分母报出来", () => {
    const report = run({
      contents: { "docs-site/quickstart.md": "[x](./architecture)", "docs-site/architecture.md": "y" },
    });
    expect(formatDocLinkSummary(report)).toContain("1 条内部链接 / 2 个 markdown 文件");
  });

  it("问题逐条打印", () => {
    const report = run({
      contents: { "docs-site/quickstart.md": "[x](./nope)" },
    });
    expect(formatDocLinkIssues(report.errors)).toContain("DOC_LINK_BROKEN");
  });

  it("没有问题时输出空字符串", () => {
    expect(formatDocLinkIssues([])).toBe("");
  });
});