import { describe, expect, it } from "vitest";
import {
  EXCLUDED_DOC_PATTERNS,
  EXTERNAL_CLIS,
  PNPM_BUILTINS,
  auditDocCommands,
  extractCommands,
  formatDocCommandIssues,
  formatDocCommandSummary,
  selectScopedDocs,
} from "./doc-commands.ts";

const DEPS = { vitest: "^3", next: "^16" };

const PNPM_BUILTINS_SAMPLE = "pnpm install\npnpm audit\npnpm deploy\npnpm peers\npnpm catalog";

const SCRIPTS = {
  dev: "next dev",
  build: "next build",
  "verify:build": "node scripts/verify-build.js",
  "check:all": "bash scripts/check-all.sh",
};

const BINARIES = new Set(["vitest", "playwright", "next"]);

function run(
  contents: Record<string, string>,
  options: { files?: string[]; binaries?: ReadonlySet<string> | null } = {},
) {
  return auditDocCommands({
    files: options.files ?? Object.keys(contents),
    contents,
    scripts: SCRIPTS,
    dependencies: DEPS,
    binaries: options.binaries === undefined ? BINARIES : options.binaries,
  });
}

describe("selectScopedDocs()", () => {
  const files = [
    "AGENTS.md",
    "CHANGELOG.md",
    "CLAUDE.md",
    "README.md",
    "README.zh-CN.md",
    "docs/architecture/01-overview.md",
    "docs/operations/environments.md",
    "docs/operations/release-audit-template.md",
    "docs/operations/release-exit-report-v0.6.0.md",
    "docs/progress.md",
    "docs/roadmap-0.12.0.md",
    "docs/testing.md",
    "docs-site/auth-flow.md",
    "docs-site/quickstart.md",
    "docs-site/zh-CN/auth-flow.md",
    "docs-site/zh-CN/quickstart.md",
    "e2e/support/bearer.ts",
  ];

  it("受审范围是全部 markdown：根级 + docs-site/ + docs/，只排除记录与计划", () => {
    expect(selectScopedDocs(files).scoped).toEqual([
      "AGENTS.md",
      "CLAUDE.md",
      "README.md",
      "README.zh-CN.md",
      "docs-site/auth-flow.md",
      "docs-site/quickstart.md",
      "docs-site/zh-CN/auth-flow.md",
      "docs-site/zh-CN/quickstart.md",
      "docs/architecture/01-overview.md",
      "docs/operations/environments.md",
      "docs/testing.md",
    ]);
  });

  it("每份被排除的文件都带着理由", () => {
    const selection = selectScopedDocs(files);
    expect(selection.exclusions.map((entry) => entry.file).sort()).toEqual([
      "CHANGELOG.md",
      "docs/operations/release-audit-template.md",
      "docs/operations/release-exit-report-v0.6.0.md",
      "docs/progress.md",
      "docs/roadmap-0.12.0.md",
    ]);
    for (const entry of selection.exclusions) expect(entry.reason.trim()).not.toBe("");
  });

  it("非 markdown 文件不进受审范围", () => {
    expect(selectScopedDocs(files).scoped).not.toContain("e2e/support/bearer.ts");
  });

  it("排除项一个文件都没命中时报 STALE（失效的排除项仍留在配置里最危险）", () => {
    const selection = selectScopedDocs(["README.md"], { "docs/roadmap-*.md": "计划" });
    expect(selection.unusedExclusions).toEqual(["docs/roadmap-*.md"]);
  });

  it("仓库自带的排除项今天全部命中（配置没有腐化）", () => {
    expect(selectScopedDocs(files).unusedExclusions).toEqual([]);
    expect(Object.keys(EXCLUDED_DOC_PATTERNS).length).toBeGreaterThan(0);
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
    expect(report.stats).toEqual({
      files: 1,
      commands: 5,
      resolved: 5,
      excluded: 0,
      binariesRead: true,
    });
  });

  it("脚本名写错 → 报错并点名文件、行号、命令", () => {
    const report = run({ "README.md": "第一行\npnpm verifiy:build" });
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].code).toBe("DOC_COMMAND_UNKNOWN");
    expect(report.errors[0].line).toBe(2);
    expect(report.errors[0].command).toBe("verifiy:build");
  });

  it("`pnpm exec <x>` 与 `pnpm <x>` 问的是同一个问题：这个二进制在不在", () => {
    // 第一版把 exec 也丢给 scripts/builtins，于是 `pnpm exec vitest` 被报成不存在的命令，
    // 而 vitest 明明在 devDependencies 里——**问错问题的门禁只会教人加豁免**。
    // 第二版只修了 exec 这一种写法，漏掉了事实：pnpm 对**未知命令**一律当 shell 命令执行，
    // 并把 node_modules/.bin 放进 PATH。所以 `pnpm vitest run …`、`pnpm playwright test`
    // 这类完全能跑的命令也被报成「不存在」——实测在 docs/ 上一次报出 6 条假红。
    expect(run({ "README.md": "pnpm exec vitest\npnpm vitest run src" }).errors).toEqual([]);
    expect(run({ "README.md": "pnpm vitest run src" }).errors).toEqual([]);
  });

  it("二进制不在 .bin 里仍然报红（判据放宽的是依据，不是结论）", () => {
    const bad = run({ "README.md": "pnpm exec playwright test" }, { binaries: new Set(["vitest"]) });
    expect(bad.errors).toHaveLength(1);
    expect(bad.errors[0].message).toContain("node_modules/.bin");
  });

  it("读不到 .bin 时退回依赖名判定，并在读数与报错里说出来", () => {
    // 「没装依赖」与「一个二进制都没有」的处置完全不同（先 pnpm install vs 补依赖），
    // 所以退化路径必须自报，而不是安静地按更弱的证据报绿。
    const report = run({ "README.md": "pnpm exec playwright test\npnpm dev" }, { binaries: null });
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].message).toContain("本次没读到 node_modules/.bin");
    expect(report.stats.binariesRead).toBe(false);
    expect(formatDocCommandSummary(report)).toContain("没读到 node_modules/.bin");
  });

  it("外部 CLI 显式登记后放行，且登记表必须写明理由", () => {
    expect(run({ "docs/testing.md": "pnpm exec supabase start" }).errors).toEqual([]);
    expect(EXTERNAL_CLIS.supabase).not.toBe("");
    const bad = run({ "docs/testing.md": "pnpm exec supabase start" }, { binaries: new Set() });
    // 默认登记表仍然放行——它登记的就是「装在门禁够不到的地方」。
    expect(bad.errors).toEqual([]);
  });

  it("没登记的外部命令不会被当成外部 CLI 放行", () => {
    expect(run({ "README.md": "pnpm exec some-other-cli" }).errors).toHaveLength(1);
  });

  it("内建命令表里有的放行（install/audit/deploy/peers/catalog）", () => {
    for (const name of ["install", "exec", "audit", "deploy", "peers", "catalog"]) {
      expect(PNPM_BUILTINS.has(name)).toBe(true);
    }
    expect(run({ "README.md": PNPM_BUILTINS_SAMPLE }).errors).toEqual([]);
  });

  it("读不到内容的文件不参与统计（而不是当成 0 条命令）", () => {
    const report = run(
      { "README.md": "pnpm dev" },
      { files: ["README.md", "docs-site/quickstart.md"] },
    );
    expect(report.stats.files).toBe(2);
    expect(report.stats.commands).toBe(1);
  });

  it("排除项没有理由、或已经失效，都会让门禁变红", () => {
    const noReason = auditDocCommands({
      files: ["README.md"],
      contents: { "README.md": "pnpm dev" },
      scripts: SCRIPTS,
      binaries: BINARIES,
      exclusions: { exclusions: [{ file: "docs/progress.md", pattern: "docs/progress.md", reason: " " }], unusedExclusions: [] },
    });
    expect(noReason.errors.map((error) => error.code)).toEqual(["DOC_EXCLUSION_REASON_MISSING"]);

    const stale = auditDocCommands({
      files: ["README.md"],
      contents: { "README.md": "pnpm dev" },
      scripts: SCRIPTS,
      binaries: BINARIES,
      exclusions: { exclusions: [], unusedExclusions: ["docs/roadmap-*.md"] },
    });
    expect(stale.errors.map((error) => error.code)).toEqual(["DOC_EXCLUSION_STALE"]);
  });

  it("一份受审文档都没读到时报红（量不到东西必须出声）", () => {
    expect(run({}, { files: [] }).errors.map((e) => e.code)).toEqual([
      "DOC_COMMANDS_NOTHING_SCANNED",
    ]);
  });
});

describe("格式化", () => {
  it("自述行把分母报出来", () => {
    expect(formatDocCommandSummary(run({ "README.md": "pnpm dev\npnpm build" }))).toContain(
      "2 条命令 / 1 份受审文档",
    );
  });

  it("问题逐条打印，并照抄文档里的写法（exec 不能被吃掉）", () => {
    expect(formatDocCommandIssues(run({ "README.md": "pnpm nope" }).errors)).toContain(
      "DOC_COMMAND_UNKNOWN",
    );
    // 报错里写 `pnpm playwright` 而文档里写的是 `pnpm exec playwright`：人会照着报错去搜。
    expect(formatDocCommandIssues(run({ "README.md": "pnpm exec playwright test" }, { binaries: null }).errors)).toContain(
      "`pnpm exec playwright`",
    );
  });

  it("没有问题时输出空字符串", () => {
    expect(formatDocCommandIssues([])).toBe("");
  });
});