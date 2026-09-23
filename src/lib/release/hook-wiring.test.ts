/**
 * Git 钩子层自检单测。
 * 覆盖六类判定（shebang、source 目标、pnpm 脚本、二进制、文件操作数、安装入口）
 * 与「解析器不误伤」的阴性用例，最后用临时目录验证 CLI 读到的真实快照。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildSnapshot, runHookWiringCheck } from "../../../scripts/lib/hook-wiring-check.js";
import { auditHookWiring, formatHookIssues } from "./hook-wiring";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

function codes(input: Parameters<typeof auditHookWiring>[0]): string[] {
  return auditHookWiring(input).issues.map((item) => item.code);
}

function input(overrides: Partial<Parameters<typeof auditHookWiring>[0]> = {}) {
  return {
    hooks: [{ name: "pre-push", content: "#!/bin/sh\npnpm verify:build\n" }],
    scripts: { "verify:build": "pnpm verify && pnpm build", prepare: "sh scripts/install-hooks.sh" },
    bins: ["eslint", "prettier"],
    fileExists: (repoPath: string) => repoPath === "scripts/install-hooks.sh",
    ...overrides,
  };
}

describe("auditHookWiring() — 安装入口", () => {
  it("没有 prepare 时失败封闭：钩子目录再正确也不会被执行", () => {
    expect(codes(input({ scripts: { "verify:build": "pnpm verify" } }))).toContain("hooks-not-installed");
  });

  it("prepare 指向的脚本不存在时也报错", () => {
    const issue = auditHookWiring(
      input({
        scripts: { prepare: "sh scripts/install-hooks.sh", "verify:build": "pnpm verify" },
        fileExists: () => false,
      }),
    ).issues.find((item) => item.code === "hooks-not-installed");
    expect(issue?.message).toContain("scripts/install-hooks.sh");
  });

  it("prepare 里装的脚本名字不含 hook 时不算安装入口", () => {
    expect(
      codes(input({ scripts: { prepare: "sh scripts/setup-deps.sh", "verify:build": "pnpm verify" } })),
    ).toContain("hooks-not-installed");
  });

  it("钩子目录为空时不要求安装入口", () => {
    expect(codes(input({ hooks: [], scripts: { "verify:build": "pnpm verify" } }))).toEqual([]);
  });
});

describe("auditHookWiring() — 单个钩子", () => {
  it("缺 shebang 的钩子报 missing-shebang", () => {
    const withShebang = codes(input({ hooks: [{ name: "pre-push", content: "pnpm verify:build\n" }] }));
    expect(withShebang).toContain("missing-shebang");
  });

  it("source 了不存在的 husky 运行时时报 missing-sourced-file", () => {
    const hooks = [
      { name: "commit-msg", content: '#!/bin/sh\n. "$(dirname -- "$0")/_/husky.sh"\nnpx --no -- commitlint --edit "$1"\n' },
    ];
    const report = auditHookWiring(input({ hooks, bins: ["commitlint"] }));
    expect(report.issues.map((item) => item.code)).toContain("missing-sourced-file");
    expect(report.issues.find((item) => item.code === "missing-sourced-file")?.message).toContain(
      ".husky/_/husky.sh",
    );
  });

  it("husky 运行时存在时同一行不再报错", () => {
    const hooks = [
      { name: "commit-msg", content: '#!/bin/sh\n. "$(dirname -- "$0")/_/husky.sh"\npnpm verify:build\n' },
    ];
    expect(
      codes(
        input({
          hooks,
          fileExists: (repoPath) => repoPath === "scripts/install-hooks.sh" || repoPath === ".husky/_/husky.sh",
        }),
      ),
    ).toEqual([]);
  });
});

describe("auditHookWiring() — 命令解析", () => {
  it("pnpm 脚本不存在时报 unknown-pnpm-script，存在时通过", () => {
    const hooks = [{ name: "pre-push", content: "#!/bin/sh\npnpm verify:buld\n" }];
    expect(codes(input({ hooks }))).toContain("unknown-pnpm-script");
    expect(codes(input())).toEqual([]);
  });

  it("带标志与 run 前缀的写法都能解析出脚本名", () => {
    const hooks = [
      { name: "pre-push", content: "#!/bin/sh\npnpm --silent check:hooks\npnpm run lint\n" },
    ];
    const report = auditHookWiring(input({ hooks }));
    expect(report.issues.map((item) => item.message)).toEqual([
      expect.stringContaining("check:hooks"),
      expect.stringContaining("lint"),
    ]);
    expect(report.checkedCommands).toBe(2);
  });

  it("pnpm 自带的子命令不当成脚本", () => {
    const hooks = [{ name: "pre-push", content: "#!/bin/sh\npnpm install --frozen-lockfile\npnpm add -D foo\n" }];
    expect(codes(input({ hooks }))).toEqual([]);
  });

  it("未安装的二进制报 missing-binary，装好的与系统命令放行", () => {
    const hooks = [{ name: "pre-push", content: "#!/bin/sh\nnpx --no -- commitlint --edit \"$1\"\n" }];
    expect(codes(input({ hooks }))).toContain("missing-binary");
    expect(
      codes(input({ hooks: [{ name: "pre-push", content: "#!/bin/sh\npnpm exec eslint .\n" }] })),
    ).toEqual([]);
    expect(
      codes(input({ hooks: [{ name: "pre-push", content: "#!/bin/sh\ngit status --short\n" }] })),
    ).toEqual([]);
  });

  it("钩子调用的脚本文件不存在时报 missing-file-operand", () => {
    const hooks = [{ name: "pre-push", content: "#!/bin/sh\nnode scripts/check-commit-msg.js \"$1\"\n" }];
    expect(codes(input({ hooks }))).toContain("missing-file-operand");
    expect(
      codes(
        input({
          hooks,
          fileExists: (repoPath) => repoPath === "scripts/install-hooks.sh" || repoPath === "scripts/check-commit-msg.js",
        }),
      ),
    ).toEqual([]);
  });

  it("注释与空行不参与解析，`$` 展开的路径不下结论", () => {
    const hooks = [
      {
        name: "pre-push",
        content: '#!/bin/sh\n# pnpm verify:build 只是注释里提了一句\n\npnpm verify:build\nsh "$SOME_ENV/bin/x.sh"\n',
      },
    ];
    const report = auditHookWiring(input({ hooks }));
    expect(report.issues).toEqual([]);
    expect(report.checkedCommands).toBe(1);
  });
});

describe("auditHookWiring() — 汇总", () => {
  it("按名字排序报告所有钩子", () => {
    const report = auditHookWiring(
      input({
        hooks: [
          { name: "pre-push", content: "#!/bin/sh\n" },
          { name: "commit-msg", content: "pnpm verify:build\n" },
        ],
      }),
    );
    expect(report.hookNames).toEqual(["commit-msg", "pre-push"]);
    expect(codes(input({ hooks: [{ name: "commit-msg", content: "pnpm verify:build\n" }] }))).toEqual([
      "missing-shebang",
    ]);
    expect(report.issues.length).toBeGreaterThan(0);
  });

  it("formatHookIssues 输出稳定排序且包含 code 与 subject", () => {
    const report = auditHookWiring(input({ hooks: [{ name: "pre-push", content: "pnpm nope\n" }] }));
    const text = formatHookIssues(report.issues);
    expect(text).toContain("[unknown-pnpm-script]");
    expect(text.split("\n")[0]).toContain(".husky/pre-push");
  });
});

describe("runHookWiringCheck() — CLI", () => {
  it("读临时目录里的钩子目录：坏钩子返回 1，好钩子返回 0", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hook-check-"));
    tempDirs.push(root);
    fs.mkdirSync(path.join(root, ".husky"), { recursive: true });
    fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
    fs.mkdirSync(path.join(root, "node_modules/.bin"), { recursive: true });
    fs.writeFileSync(path.join(root, "scripts/install-hooks.sh"), "#!/bin/sh\n");
    const pkg = (extra: Record<string, string>) =>
      JSON.stringify({ scripts: { "verify:build": "pnpm verify && pnpm build", ...extra } });

    fs.writeFileSync(path.join(root, "package.json"), pkg({ prepare: "sh scripts/install-hooks.sh" }));
    fs.writeFileSync(path.join(root, ".husky/pre-push"), "#!/bin/sh\npnpm verify:build\n");
    expect(runHookWiringCheck(root)).toBe(0);
    expect(buildSnapshot(root).hooks.map((hook) => hook.name)).toEqual(["pre-push"]);

    fs.writeFileSync(path.join(root, ".husky/pre-push"), "pnpm verify:nope\n");
    expect(runHookWiringCheck(root)).toBe(1);

    fs.writeFileSync(path.join(root, ".husky/pre-push"), "#!/bin/sh\npnpm exec some-missing-tool\n");
    expect(runHookWiringCheck(root)).toBe(1);
  });

  it("node_modules 不存在时直接报错，而不是把二进制检查全判失败", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hook-check-nobin-"));
    tempDirs.push(root);
    fs.mkdirSync(path.join(root, ".husky"), { recursive: true });
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts: { prepare: "sh scripts/install-hooks.sh" } }));
    fs.writeFileSync(path.join(root, ".husky/pre-push"), "#!/bin/sh\ntrue\n");
    expect(runHookWiringCheck(root)).toBe(1);
  });

  it("本仓库当前的钩子层自检通过", () => {
    expect(runHookWiringCheck(process.cwd())).toBe(0);
  });
});
