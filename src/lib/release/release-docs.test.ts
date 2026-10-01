import { describe, expect, it } from "vitest";
import {
  DOC_FAMILIES,
  auditReleaseDocs,
  formatReleaseDocsIssues,
  formatReleaseDocsSummary,
  versionOfDocName,
} from "./release-docs.ts";

const ALL_VERSIONS = ["0.6.0", "0.7.0", "0.8.0", "0.9.0", "0.10.0", "0.11.0"];

function docFiles(versions = ALL_VERSIONS): string[] {
  return versions.flatMap((v) => DOC_FAMILIES.map((t) => t.replace("{v}", v)));
}

function contents(versions = ALL_VERSIONS): Record<string, string> {
  const out: Record<string, string> = {
    "CHANGELOG.md": "[Unreleased]\n## [0.11.0] — 2026-09-22",
    ".github/RELEASE_CHECKLIST.md": "v0.11.0 runbook-v0.11.0 rollback-runbook-v0.11.0",
    "README.md": "pnpm verify:build production smoke rollback smoke",
    "README.zh-CN.md": "pnpm verify:build 生产冒烟 回滚 smoke",
  };
  for (const v of versions) {
    out[`docs/operations/release-runbook-v${v}.md`] = "pnpm verify:build pnpm test:e2e pnpm audit 停止条件";
    out[`docs/operations/rollback-runbook-v${v}.md`] = "不自动回滚数据库 health 前向修复迁移";
    out[`docs/operations/production-smoke-v${v}.md`] = "/api/health 租户数据隔离 回滚探针";
  }
  return out;
}

function run(overrides: Partial<Parameters<typeof auditReleaseDocs>[0]> = {}) {
  return auditReleaseDocs({
    version: "0.11.0",
    docFiles: docFiles(),
    contents: contents(),
    ...overrides,
  });
}

describe("versionOfDocName", () => {
  it("取出模板对应的版本号", () => {
    expect(versionOfDocName("production-smoke-v0.9.0.md", DOC_FAMILIES)).toBe("0.9.0");
    expect(versionOfDocName("release-runbook-v0.11.0.md", DOC_FAMILIES)).toBe("0.11.0");
  });

  it("不属于任何模板返回 null", () => {
    expect(versionOfDocName("environments.md", DOC_FAMILIES)).toBeNull();
    expect(versionOfDocName("production-smoke-vX.md", DOC_FAMILIES)).toBeNull();
  });
});

describe("auditReleaseDocs — 完整矩阵时不报错", () => {
  it("六版本 × 三族齐全", () => {
    const report = run();
    expect(report.errors).toEqual([]);
    expect(report.stats).toEqual({ version: "0.11.0", coveredVersions: 6, docFiles: 18 });
  });

  it("自述行把覆盖范围报出来", () => {
    expect(formatReleaseDocsSummary(run())).toContain("6 个版本的三族发布证据齐全，共 18 份");
  });
});

describe("auditReleaseDocs — 这次修的那个洞：历史版本的证据", () => {
  it("删掉一个历史版本的 smoke 文档 → 报错", () => {
    // 回归：原实现只看**当前**版本，于是删掉 v0.9.0 的 production smoke 照样绿——
    // 而那一份正是发布审计真正要读的证据。
    const files = docFiles().filter((f) => f !== "production-smoke-v0.9.0.md");
    const report = run({ docFiles: files, contents: contents() });
    const issues = report.errors.filter((i) => i.code === "RELEASE_DOCS_VERSION_FAMILY_MISMATCH");
    expect(issues).toHaveLength(1);
    expect(issues[0].subject).toBe("production-smoke-v<版本>.md");
    expect(issues[0].message).toContain("0.9.0");
  });

  it("多出一份孤立文档（只有 release 没有另两族）→ 报错", () => {
    const report = run({ docFiles: [...docFiles(), "release-runbook-v0.5.0.md"] });
    expect(report.errors.map((i) => i.code)).toContain("RELEASE_DOCS_VERSION_FAMILY_MISMATCH");
  });

  it("整族全缺（一个版本三份都没有）→ 不报 family mismatch（那不是「一族缺」，是「这版没文档」）", () => {
    // 三族同时少一个版本时它们**仍然自洽**，所以不该报；「每版都该有三份」是**刻意不判**的
    // 那一格（理由见模块头：0.1.0–0.5.0 本来就没有，不在这里再抄一遍理由）。
    const files = docFiles(["0.10.0", "0.11.0"]);
    const report = run({ docFiles: files });
    expect(report.errors.map((i) => i.code)).not.toContain("RELEASE_DOCS_VERSION_FAMILY_MISMATCH");
  });
});

describe("auditReleaseDocs — 缺文件与关键词", () => {
  it("当前版本缺一份文档 → 报错", () => {
    const c: Record<string, string> = { ...contents(), "CHANGELOG.md": "[Unreleased] ## [0.12.0]" };
    const report = run({ version: "0.12.0", docFiles: docFiles(), contents: c });
    expect(report.errors.map((i) => i.code)).toContain("RELEASE_DOCS_MISSING_FILE");
  });

  it("固定文档缺失 → 报错", () => {
    const c = contents();
    delete c["README.md"];
    const report = run({ contents: c });
    expect(report.errors.map((i) => i.subject)).toContain("README.md");
  });

  it("关键词缺失 → 报错并点名", () => {
    const c = contents();
    c["docs/operations/rollback-runbook-v0.11.0.md"] = "不自动回滚数据库 health";
    const report = run({ contents: c });
    const issue = report.errors.find((i) => i.code === "RELEASE_DOCS_MISSING_NEEDLE");
    expect(issue?.message).toContain("前向修复迁移");
  });

  it("内容拿不到时不再重复报关键词（文件缺失已单独报过）", () => {
    const c = contents();
    delete c["docs/operations/production-smoke-v0.11.0.md"];
    const report = run({ contents: c });
    expect(report.errors.filter((i) => i.code === "RELEASE_DOCS_MISSING_NEEDLE")).toEqual([]);
  });
});

describe("formatReleaseDocsIssues", () => {
  it("逐条打印", () => {
    const report = run({ docFiles: [...docFiles(["0.11.0"]), "release-runbook-v0.5.0.md"] });
    expect(formatReleaseDocsIssues(report.errors)).toContain("RELEASE_DOCS_VERSION_FAMILY_MISMATCH");
  });

  it("没有问题时输出空字符串", () => {
    expect(formatReleaseDocsIssues([])).toBe("");
  });
});
