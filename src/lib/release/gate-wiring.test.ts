/**
 * 门禁接线审计单测（I06 / J01）。
 * 覆盖门禁发现、聚合/CI 接线判定、豁免登记与发布检查清单引用，确保门禁不会静默失效。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSnapshot, runGateWiringCheck } from "../../../scripts/lib/gate-wiring-check.js";
import {
  auditGateWiring,
  formatGateIssues,
  parseAggregateReferences,
  parseChecklistTagVersions,
  parseChecklistWorkflowReferences,
  parseWorkflows,
} from "./gate-wiring";

const tempDirs: string[] = [];

function codes(input: Parameters<typeof auditGateWiring>[0]): string[] {
  return auditGateWiring(input).issues.map((item) => item.code);
}

function input(overrides: Partial<Parameters<typeof auditGateWiring>[0]> = {}) {
  return {
    scripts: { "check:locales": "node scripts/check-locales.js" },
    checkAll: "pnpm --silent check:locales\n",
    workflows: [
      {
        path: ".github/workflows/ci.yml",
        content:
          "name: CI\njobs:\n  lint:\n    name: Lint & Type Check\n    steps:\n      - run: pnpm check:locales\n",
      },
    ],
    releaseChecklist:
      "# 检查清单\n\n## 门禁\n\n- [ ] `CI` 全绿\n\n## 打标签\n\n```bash\ngit tag v1.2.3\n```\n",
    version: "1.2.3",
    exceptions: {},
    ...overrides,
  };
}

function writeRepo(filesToWrite: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "indiestack-gates-"));
  tempDirs.push(dir);
  for (const [relative, content] of Object.entries(filesToWrite)) {
    const absolute = path.join(dir, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content, "utf8");
  }
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("listGates() / parseAggregateReferences()", () => {
  it("只列出 check:* 门禁并排除聚合入口", () => {
    const report = auditGateWiring(
      input({
        scripts: {
          "check:all": "bash scripts/check-all.sh",
          "check:b": "node b.js",
          "check:a": "node a.js",
          test: "vitest run",
          build: "next build",
        },
        checkAll: "pnpm --silent check:a\npnpm --silent check:b\n",
        workflows: [{ path: "w.yml", content: "run: pnpm check:a && pnpm check:b" }],
      }),
    );
    expect(report.gates).toEqual(["check:a", "check:b"]);
  });

  it("解析 pnpm --silent 与 pnpm 两种调用并去重排序", () => {
    expect(
      parseAggregateReferences("pnpm --silent check:b\npnpm check:a\npnpm check:b\npnpm test\n"),
    ).toEqual(["check:a", "check:b", "test"]);
  });

  it("忽略注释外的裸脚本名", () => {
    expect(parseAggregateReferences("# check:ghost\npnpm check:real\n")).toEqual(["check:real"]);
  });
});

describe("parseWorkflows() / 检查清单解析", () => {
  it("提取工作流名与作业名并剥离引号", () => {
    const { summaries, names } = parseWorkflows([
      {
        path: "b.yml",
        content: 'name: "Secrets Scan"\njobs:\n  detect:\n    name: Detect Secrets\n',
      },
      { path: "a.yml", content: "name: CI\njobs:\n  lint:\n    name: Lint & Type Check\n" },
    ]);
    expect(summaries.map((item) => item.path)).toEqual(["a.yml", "b.yml"]);
    expect(names).toEqual(["CI", "Detect Secrets", "Lint & Type Check", "Secrets Scan"]);
  });

  it("只取「门禁」章节里反引号包裹的大写名字", () => {
    const checklist = [
      "## 门禁",
      "- [ ] 本地 `pnpm verify:build` 全绿",
      "- [ ] `CI`（`Lint & Type Check`）、`CodeQL` 全绿",
      "## 打标签",
      "- [ ] `Release` 已创建",
      "",
    ].join("\n");
    expect(parseChecklistWorkflowReferences(checklist)).toEqual([
      "CI",
      "CodeQL",
      "Lint & Type Check",
    ]);
  });

  it("读取「打标签」章节的版本号", () => {
    const checklist =
      "## 门禁\n\nv9.9.9\n\n## 打标签\n\n```bash\ngit tag v1.2.3 && git push origin v1.2.3\n```\n";
    expect(parseChecklistTagVersions(checklist)).toEqual(["1.2.3"]);
  });
});

describe("auditGateWiring() 接线判定", () => {
  it("接线完整的仓库零问题", () => {
    expect(codes(input())).toEqual([]);
  });

  it("缺失本地聚合时报 GATE_UNWIRED_LOCAL", () => {
    expect(codes(input({ checkAll: "" }))).toEqual(["GATE_UNWIRED_LOCAL"]);
  });

  it("缺失 CI 步骤时报 GATE_UNWIRED_CI", () => {
    expect(
      codes(input({ workflows: [{ path: "w.yml", content: "name: CI\njobs: {}\n" }] })),
    ).toEqual(["GATE_UNWIRED_CI"]);
  });

  it("CI 直接调用原始命令也算接线", () => {
    expect(
      codes(
        input({
          scripts: { "check:perf": "node scripts/check-perf.js" },
          checkAll: "",
          workflows: [
            { path: "w.yml", content: "name: CI\n      - run: node scripts/check-perf.js\n" },
          ],
          exceptions: { "check:perf": { local: "需要构建产物" } },
        }),
      ),
    ).toEqual([]);
  });

  it("CI 运行聚合入口时覆盖所有门禁", () => {
    expect(
      codes(
        input({
          workflows: [{ path: "w.yml", content: "name: CI\n      - run: pnpm verify:all\n" }],
        }),
      ),
    ).toEqual([]);
  });

  it("词边界不把 check:migrations 当成 check:migration-history", () => {
    const report = auditGateWiring(
      input({
        scripts: {
          "check:migrations": "node scripts/check-migrations.js",
          "check:migration-history": "node scripts/check-migration-history.js",
        },
        checkAll: "pnpm --silent check:migrations\n",
        workflows: [{ path: "w.yml", content: "name: CI\n      - run: pnpm check:migrations\n" }],
      }),
    );
    expect(report.localGates).toEqual(["check:migrations"]);
    expect(report.ciGates).toEqual(["check:migrations"]);
    expect(report.issues.map((item) => item.code)).toEqual([
      "GATE_UNWIRED_LOCAL",
      "GATE_UNWIRED_CI",
    ]);
    expect(report.issues.every((item) => item.subject === "check:migration-history")).toBe(true);
  });

  it("豁免登记可分别跳过本地或 CI 要求", () => {
    const report = auditGateWiring(
      input({
        checkAll: "",
        workflows: [{ path: "w.yml", content: "name: CI\n      - run: pnpm check:locales\n" }],
        exceptions: { "check:locales": { local: "由 verify 覆盖" } },
      }),
    );
    expect(report.issues).toEqual([]);
    expect(report.exempted).toEqual(["check:locales"]);
  });
});

describe("auditGateWiring() 豁免与聚合引用", () => {
  it("豁免表登记不存在的门禁时报 EXCEPTION_STALE", () => {
    expect(codes(input({ exceptions: { "check:ghost": { local: "无" } } }))).toEqual([
      "EXCEPTION_STALE",
    ]);
  });

  it("豁免条目既无本地也无 CI 理由时报 EXCEPTION_EMPTY", () => {
    expect(codes(input({ exceptions: { "check:locales": {} } }))).toEqual(["EXCEPTION_EMPTY"]);
  });

  it("豁免理由过期（其实已经接线）时报 EXCEPTION_STALE", () => {
    const result = codes(
      input({ exceptions: { "check:locales": { local: "已接线", ci: "已接线" } } }),
    );
    expect(result).toEqual(["EXCEPTION_STALE", "EXCEPTION_STALE", "EXCEPTION_STALE"]);
  });

  it("聚合脚本引用不存在的门禁时报 AGGREGATE_UNKNOWN_SCRIPT", () => {
    expect(
      codes(input({ checkAll: "pnpm --silent check:locales\npnpm --silent check:ghost\n" })),
    ).toEqual(["AGGREGATE_UNKNOWN_SCRIPT"]);
  });

  it("豁免为本地聚合但 check-all.sh 仍在执行时失败封闭", () => {
    const result = codes(input({ exceptions: { "check:locales": { local: "冲突" } } }));
    expect(result).toEqual(["EXCEPTION_STALE", "EXCEPTION_STALE"]);
  });
});

describe("auditGateWiring() 发布检查清单", () => {
  it("引用不存在的工作流/作业名时报 CHECKLIST_WORKFLOW_UNKNOWN", () => {
    expect(
      codes(
        input({
          releaseChecklist:
            "# 检查清单\n\n## 门禁\n\n- [ ] `CI` 与 `Ghost Scan` 全绿\n\n## 打标签\n\ngit tag v1.2.3\n",
        }),
      ),
    ).toEqual(["CHECKLIST_WORKFLOW_UNKNOWN"]);
  });

  it("打标签版本与 package.json 不一致时报 CHECKLIST_TAG_VERSION", () => {
    expect(
      codes(
        input({
          releaseChecklist:
            "# 检查清单\n\n## 门禁\n\n- [ ] `CI` 全绿\n\n## 打标签\n\ngit tag v0.9.0\n",
        }),
      ),
    ).toEqual(["CHECKLIST_TAG_VERSION"]);
  });

  it("打标签章节缺失时报 CHECKLIST_TAG_VERSION", () => {
    expect(
      codes(input({ releaseChecklist: "# 检查清单\n\n## 门禁\n\n- [ ] `CI` 全绿\n" })),
    ).toEqual(["CHECKLIST_TAG_VERSION"]);
  });

  it("多个打标签版本时报 CHECKLIST_TAG_VERSION", () => {
    expect(
      codes(
        input({
          releaseChecklist:
            "# 检查清单\n\n## 门禁\n\n- [ ] `CI` 全绿\n\n## 打标签\n\ngit tag v1.2.3\ngit tag v1.2.4\n",
        }),
      ),
    ).toEqual(["CHECKLIST_TAG_VERSION"]);
  });
});

describe("formatGateIssues()", () => {
  it("输出规则码与主体", () => {
    expect(
      formatGateIssues([{ code: "GATE_UNWIRED_CI", subject: "check:x", message: "未接线" }]),
    ).toBe("❌ [GATE_UNWIRED_CI] check:x 未接线");
  });
});

describe("真实仓库与 CLI", () => {
  it("当前仓库门禁接线通过", () => {
    const snapshot = buildSnapshot();
    const report = auditGateWiring(snapshot);
    expect(report.issues).toEqual([]);
    expect(report.gates.length).toBeGreaterThanOrEqual(19);
  });

  it("buildSnapshot 读取脚本、聚合与工作流", () => {
    const snapshot = buildSnapshot();
    expect(snapshot.scripts["check:all"]).toContain("check-all.sh");
    expect(snapshot.workflows.length).toBeGreaterThanOrEqual(8);
    expect(snapshot.releaseChecklist).toContain("打标签");
  });

  it("合规临时仓库返回 0 并打印统计", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => void logs.push(line));
    const dir = simpleRepo();
    expect(runGateWiringCheck(dir)).toBe(0);
    expect(logs.join("\n")).toContain("门禁接线审计通过");
  });

  it("缺 CI 步骤的临时仓库返回 1 并打印规则码", () => {
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: string) => void errors.push(line));
    const dir = simpleRepo({ ".github/workflows/ci.yml": "name: CI\njobs: {}\n" });
    expect(runGateWiringCheck(dir)).toBe(1);
    expect(errors.join("\n")).toContain("GATE_UNWIRED_CI");
  });

  it("快照读取失败返回 1", () => {
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: string) => void errors.push(line));
    expect(runGateWiringCheck("/definitely/not/a/repo")).toBe(1);
    expect(errors.join("\n")).toContain("无法读取门禁接线快照");
  });
});

function simpleRepo(overrides: Record<string, string> = {}): string {
  return writeRepo({
    "package.json": JSON.stringify({
      version: "1.2.3",
      scripts: {
        "check:locales": "node scripts/check-locales.js",
        // 默认豁免表要求这三个门禁真实存在；临时仓库显式登记以验证豁免分支。
        "check:bundle": "bash -c 'pnpm build'",
        "check:perf": "node scripts/check-perf.js",
        "check:migration-history": "node scripts/check-migration-history.js",
      },
    }),
    "scripts/check-all.sh": "pnpm --silent check:locales\n",
    ".github/workflows/ci.yml":
      "name: CI\njobs:\n  lint:\n    name: Lint & Type Check\n    steps:\n      - run: pnpm check:locales\n      - run: node scripts/check-perf.js\n",
    ".github/RELEASE_CHECKLIST.md":
      "# 检查清单\n\n## 门禁\n\n- [ ] `CI`（`Lint & Type Check`）全绿\n\n## 打标签\n\n```bash\ngit tag v1.2.3\n```\n",
    ...overrides,
  });
}
