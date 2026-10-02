import { describe, expect, it } from "vitest";
import {
  PNPM_BUILTINS,
  SCOPED_DOCS,
  auditDocCommands,
  extractCommands,
  formatDocCommandIssues,
  formatDocCommandSummary,
} from "./doc-commands.ts";

const DEPS = { vitest: "^3", next: "^16" };

const PNPM_BUILTINS_SAMPLE = "pnpm install\npnpm audit\npnpm deploy\npnpm peers\npnpm catalog";

const SCRIPTS = {
  dev: "next dev",
  build: "next build",
  "verify:build": "node scripts/verify-build.js",
  "check:all": "bash scripts/check-all.sh",
};

function run(contents: Record<string, string>, files = Object.keys(contents)) {
  return auditDocCommands({ files, contents, scripts: SCRIPTS, dependencies: DEPS });
}

describe("SCOPED_DOCS", () => {
  it("受审范围刻意只有四份入门文档，不含 docs/", () => {
    expect([...SCOPED_DOCS]).toEqual([
      "README.md",
      "README.zh-CN.md",
      "docs-site/quickstart.md",
      "docs-site/zh-CN/quickstart.md",
    ]);
  });
});

describe("extractCommands", () => {
  it("抽出 pnpm 与 pnpm run 两种写法", () => {
    expect(extractCommands("跑 `pnpm dev` 再 `pnpm run build`")).toEqual([
      { command: "dev", line: 1, viaExec: false },
      { command: "build", line: 1, viaExec: false },
    ]);
  });

  it("记录行号", () => {
    expect(extractCommands("a\nb\npnpm test:all")[0].line).toBe(3);
  });

  it("不会把散文里的 pnpm 当成命令（后面没有命令词就不匹配）", () => {
    expect(extractCommands("我们用 pnpm 管理依赖")).toEqual([]);
  });
});

describe("auditDocCommands", () => {
  it("脚本与内建命令都不报错", () => {
    const report = run({
      "README.md": "pnpm install\npnpm dev\npnpm audit\npnpm exec vitest\npnpm deploy",
    });
    expect(report.errors).toEqual([]);
    expect(report.stats).toEqual({ files: 1, commands: 5, resolved: 5 });
  });

  it("脚本名写错 → 报错并点名文件、行号、命令", () => {
    const report = run({ "README.md": "第一行\npnpm verifiy:build" });
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].code).toBe("DOC_COMMAND_UNKNOWN");
    expect(report.errors[0].line).toBe(2);
    expect(report.errors[0].command).toBe("verifiy:build");
  });

  it("`pnpm exec <x>` 按依赖判定，不按 scripts 判定", () => {
    // 第一版把 exec 也丢给 scripts/builtins，于是 `pnpm exec vitest` 被报成不存在的命令，
    // 而 vitest 明明在 devDependencies 里——**问错问题的门禁只会教人加豁免**。
    expect(run({ "README.md": "pnpm exec vitest" }).errors).toEqual([]);
    const bad = run({ "README.md": "pnpm exec not-a-dep" });
    expect(bad.errors[0].message).toContain("devDependencies");
  });

  it("内建命令表里有的放行（install/audit/deploy/peers/catalog）", () => {
    for (const name of ["install", "exec", "audit", "deploy", "peers", "catalog"]) {
      expect(PNPM_BUILTINS.has(name)).toBe(true);
    }
    expect(run({ "README.md": PNPM_BUILTINS_SAMPLE }).errors).toEqual([]);
  });

  it("读不到内容的文件不参与统计（而不是当成 0 条命令）", () => {
    const report = run({ "README.md": "pnpm dev" }, ["README.md", "docs-site/quickstart.md"]);
    expect(report.stats.files).toBe(2);
    expect(report.stats.commands).toBe(1);
  });

  it("一份受审文档都没读到时报红（量不到东西必须出声）", () => {
    expect(run({}, []).errors.map((e) => e.code)).toEqual(["DOC_COMMANDS_NOTHING_SCANNED"]);
  });
});

describe("格式化", () => {
  it("自述行把分母报出来", () => {
    expect(formatDocCommandSummary(run({ "README.md": "pnpm dev\npnpm build" }))).toContain(
      "2 条 pnpm 命令 / 1 份文档",
    );
  });

  it("问题逐条打印", () => {
    expect(formatDocCommandIssues(run({ "README.md": "pnpm nope" }).errors)).toContain(
      "DOC_COMMAND_UNKNOWN",
    );
  });

  it("没有问题时输出空字符串", () => {
    expect(formatDocCommandIssues([])).toBe("");
  });
});