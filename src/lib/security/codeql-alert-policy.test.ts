import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  actionMajorMatches,
  auditCodeqlAlertPolicy,
  CODEQL_CONTRACT,
  formatCodeqlIssues,
  isWeeklyCron,
  parseCodeqlWorkflow,
  pathCovers,
  type CodeqlContract,
  type CodeqlPolicyReport,
} from "./codeql-alert-policy";

const REPO_ROOT = process.cwd();
const SAMPLE_PATH = ".github/workflows/codeql.yml";
const TRIAGE_PATH = "docs/operations/codeql-alert-triage.md";

/** 与仓库真实工作流同构的最小样本：任何“合法”用例都从它派生。 */
const VALID_WORKFLOW = `name: CodeQL

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]
  schedule:
    - cron: "0 6 * * 1"

permissions:
  contents: read

concurrency:
  group: codeql-\${{ github.ref }}
  cancel-in-progress: \${{ github.event_name == 'pull_request' }}

jobs:
  analyze:
    name: Analyze (javascript-typescript)
    runs-on: ubuntu-latest
    timeout-minutes: 30
    permissions:
      security-events: write
      contents: read
    steps:
      - uses: actions/checkout@v7
      - uses: github/codeql-action/init@v4
        with:
          languages: javascript-typescript
          queries: security-extended
      - uses: github/codeql-action/analyze@v4
        with:
          category: "/language:javascript-typescript"
`;

/** 覆盖契约要求的全部章节与事实（套件名、阈值、SLA、dismissal 理由）的 runbook 样本。 */
const VALID_DOC = `# CodeQL 告警分诊 Runbook

## 适用范围

- 覆盖 GitHub Code scanning 下由 CodeQL 产生的全部告警。

## 严重度与阻断阈值

- 阻断阈值 7.0；查询套件 security-extended。

## 分诊流程

- 从告警首次出现到完成分诊 5 个工作日内必须有结论。

## Dismissal 规则

- 仅允许 false positive / won't fix / used in tests。

## 零回归的判定

- 相对基线分支没有新增未处置告警。

## 外部依赖

- 读取真实告警需要 GitHub code scanning 权限。
`;

function audit(
  workflowContent: string | null = VALID_WORKFLOW,
  options: { doc?: string | null; contract?: CodeqlContract; path?: string } = {},
): CodeqlPolicyReport {
  // `null` 表示工作流文件不存在；省略则使用契约样本。
  const workflow =
    workflowContent === null
      ? undefined
      : { path: options.path ?? SAMPLE_PATH, content: workflowContent };
  // `doc: null` 与省略 `doc` 不同：前者表示「runbook 不存在」，后者表示「用契约样本」。
  const docContent = options.doc === undefined ? VALID_DOC : options.doc;
  return auditCodeqlAlertPolicy({
    workflow,
    triageDoc: docContent === null ? undefined : { path: TRIAGE_PATH, content: docContent },
    contract: options.contract,
  });
}

function codes(report: CodeqlPolicyReport): string[] {
  return report.issues.map((issue) => issue.code);
}

/** 断言报告里出现了某条规则码，且附带的 detail 匹配片段。 */
function expectIssue(report: CodeqlPolicyReport, code: string, detail?: string): void {
  const issue = report.issues.find((item) => item.code === code);
  expect(issue, `expected issue ${code} in ${codes(report).join(", ")}`).toBeDefined();
  if (detail !== undefined) expect(issue?.detail).toContain(detail);
}

describe("parseCodeqlWorkflow", () => {
  it("识别 push / pull_request / schedule 三种触发", () => {
    expect(parseCodeqlWorkflow(VALID_WORKFLOW).triggers).toEqual([
      "push",
      "pull_request",
      "schedule",
    ]);
  });

  it("读出 push 与 pull_request 的分支覆盖", () => {
    const facts = parseCodeqlWorkflow(VALID_WORKFLOW);
    expect(facts.pushBranches).toEqual(["main", "develop"]);
    expect(facts.pullRequestBranches).toEqual(["main"]);
  });

  it("读出含空格的 cron 表达式", () => {
    expect(parseCodeqlWorkflow(VALID_WORKFLOW).crons).toEqual(["0 6 * * 1"]);
  });

  it("读出 init / analyze 的 action 引用", () => {
    const facts = parseCodeqlWorkflow(VALID_WORKFLOW);
    expect(facts.initRef).toBe("github/codeql-action/init@v4");
    expect(facts.analyzeRef).toBe("github/codeql-action/analyze@v4");
  });

  it("读出语言、查询套件、category 与权限", () => {
    const facts = parseCodeqlWorkflow(VALID_WORKFLOW);
    expect(facts.languages).toEqual(["javascript-typescript"]);
    expect(facts.querySuite).toBe("security-extended");
    expect(facts.category).toBe("/language:javascript-typescript");
    expect(facts.hasSecurityEventsWrite).toBe(true);
    expect(facts.analyzeJob?.hasTimeout).toBe(true);
  });

  it("块列表形式的 paths 与 paths-ignore 也能解析", () => {
    const content = VALID_WORKFLOW.replace(
      "    branches: [main, develop]\n",
      '    branches: [main, develop]\n    paths:\n      - "src/**"\n      - scripts\n    paths-ignore:\n      - "**/*.md"\n',
    );
    const facts = parseCodeqlWorkflow(content);
    expect(facts.pathIncludes).toEqual(["src/**", "scripts"]);
    expect(facts.pathIgnores).toEqual(["**/*.md"]);
  });

  it("空内容时失败封闭，不产生假事实", () => {
    const facts = parseCodeqlWorkflow("");
    expect(facts.triggers).toEqual([]);
    expect(facts.analyzeJob).toBeUndefined();
    expect(facts.crons).toEqual([]);
  });
});

describe("isWeeklyCron", () => {
  it("每周一次的表达式通过", () => {
    expect(isWeeklyCron("0 6 * * 1", 1)).toBe(true);
    expect(isWeeklyCron("30 2 * * 1", 1)).toBe(true);
  });

  it("退化成每日扫描时失败", () => {
    expect(isWeeklyCron("0 6 * * *", 1)).toBe(false);
  });

  it("星期不匹配时失败", () => {
    expect(isWeeklyCron("0 6 * * 3", 1)).toBe(false);
  });

  it("限定月份或日期时失败", () => {
    expect(isWeeklyCron("0 6 1 * 1", 1)).toBe(false);
    expect(isWeeklyCron("0 6 * 3 1", 1)).toBe(false);
  });

  it("字段数不足时失败", () => {
    expect(isWeeklyCron("0 6 * *", 1)).toBe(false);
    expect(isWeeklyCron("", 1)).toBe(false);
  });
});

describe("pathCovers", () => {
  it("等价写法都覆盖前缀", () => {
    expect(pathCovers("src", "src")).toBe(true);
    expect(pathCovers("src/**", "src")).toBe(true);
    expect(pathCovers("src/", "src")).toBe(true);
    expect(pathCovers("src/lib", "src")).toBe(true);
  });

  it("无关路径不覆盖前缀", () => {
    expect(pathCovers("scripts", "src")).toBe(false);
    expect(pathCovers("srcx", "src")).toBe(false);
  });
});

describe("actionMajorMatches", () => {
  it("固定到契约 major 时通过", () => {
    expect(actionMajorMatches("github/codeql-action/init@v4", CODEQL_CONTRACT)).toBe(true);
    expect(actionMajorMatches("github/codeql-action/analyze@v4", CODEQL_CONTRACT)).toBe(true);
  });

  it("允许更细的补丁固定", () => {
    expect(actionMajorMatches("github/codeql-action/init@v4.1.2", CODEQL_CONTRACT)).toBe(true);
  });

  it("跨 major 或换仓库时失败", () => {
    expect(actionMajorMatches("github/codeql-action/init@v3", CODEQL_CONTRACT)).toBe(false);
    expect(actionMajorMatches("github/codeql-action/init@v41", CODEQL_CONTRACT)).toBe(false);
    expect(actionMajorMatches("evil/codeql-action/init@v4", CODEQL_CONTRACT)).toBe(false);
    expect(actionMajorMatches("", CODEQL_CONTRACT)).toBe(false);
  });
});

describe("auditCodeqlAlertPolicy", () => {
  it("契约样本零问题，并给出稳定的断言条数", () => {
    const report = audit();
    expect(report.issues).toEqual([]);
    expect(report.checks).toBe(21);
  });

  it("工作流缺失或为空时失败封闭", () => {
    expectIssue(audit(null), "CODEQL_WORKFLOW_MISSING");
    expectIssue(audit("   \n"), "CODEQL_SOURCE_EMPTY");
  });

  it("缺少 analyze 作业时报错", () => {
    const report = audit(VALID_WORKFLOW.replace(/jobs:[\s\S]*$/, "jobs:\n"));
    expectIssue(report, "CODEQL_ANALYZE_JOB_MISSING");
  });

  it("缺少 init 步骤时报错", () => {
    const report = audit(
      VALID_WORKFLOW.replace(
        /      - uses: github\/codeql-action\/init@v4\n        with:\n          languages: javascript-typescript\n          queries: security-extended\n/,
        "",
      ),
    );
    expectIssue(report, "CODEQL_INIT_MISSING");
  });

  it("缺少 analyze 步骤时报错", () => {
    const report = audit(
      VALID_WORKFLOW.replace(
        /      - uses: github\/codeql-action\/analyze@v4\n        with:\n          category: "\/language:javascript-typescript"\n/,
        "",
      ),
    );
    expectIssue(report, "CODEQL_ANALYZE_JOB_MISSING", "analyze 步骤缺失");
  });

  it("init 固定在旧 major 时报漂移", () => {
    const report = audit(VALID_WORKFLOW.replace("codeql-action/init@v4", "codeql-action/init@v3"));
    expectIssue(report, "CODEQL_ACTION_MAJOR_DRIFT", "init");
    expectIssue(report, "CODEQL_ACTION_MAJOR_MISMATCH");
  });

  it("init 与 analyze 版本不一致时报错", () => {
    const report = audit(
      VALID_WORKFLOW.replace("codeql-action/analyze@v4", "codeql-action/analyze@v4.2.0"),
    );
    expectIssue(report, "CODEQL_ACTION_MAJOR_MISMATCH");
    expect(codes(report)).not.toContain("CODEQL_ACTION_MAJOR_DRIFT");
  });

  it("语言不再覆盖契约时报错", () => {
    const report = audit(
      VALID_WORKFLOW.replace("languages: javascript-typescript", "languages: csharp"),
    );
    expectIssue(report, "CODEQL_LANGUAGE_DRIFT", "javascript-typescript");
  });

  it("查询套件被换掉时报错", () => {
    const report = audit(
      VALID_WORKFLOW.replace("queries: security-extended", "queries: security-and-quality"),
    );
    expectIssue(report, "CODEQL_QUERY_SUITE_WEAKENED", "security-extended");
  });

  it("缺 security-events: write 时报错", () => {
    const report = audit(VALID_WORKFLOW.replace("      security-events: write\n", ""));
    expectIssue(report, "CODEQL_PERMISSION_MISSING");
  });

  it("SARIF category 漂移时报错", () => {
    const report = audit(
      VALID_WORKFLOW.replace(
        'category: "/language:javascript-typescript"',
        'category: "/language:typescript"',
      ),
    );
    expectIssue(report, "CODEQL_CATEGORY_DRIFT");
  });

  it("analyze 作业缺 timeout 时报错", () => {
    const report = audit(VALID_WORKFLOW.replace("    timeout-minutes: 30\n", ""));
    expectIssue(report, "CODEQL_TIMEOUT_MISSING");
  });

  it("上传被关闭时报错", () => {
    const report = audit(
      VALID_WORKFLOW.replace(
        '          category: "/language:javascript-typescript"\n',
        '          category: "/language:javascript-typescript"\n          upload: false\n',
      ),
    );
    expectIssue(report, "CODEQL_UPLOAD_DISABLED");
  });

  it("schedule 触发被删除时报错", () => {
    const report = audit(VALID_WORKFLOW.replace('  schedule:\n    - cron: "0 6 * * 1"\n', ""));
    expectIssue(report, "CODEQL_SCHEDULE_MISSING");
  });

  it("定时扫描退化成每日时报错", () => {
    const report = audit(VALID_WORKFLOW.replace('cron: "0 6 * * 1"', 'cron: "0 6 * * *"'));
    expectIssue(report, "CODEQL_SCHEDULE_CADENCE_DRIFT");
  });

  it("push 分支覆盖缩水时报错", () => {
    const report = audit(VALID_WORKFLOW.replace("branches: [main, develop]", "branches: [main]"));
    expectIssue(report, "CODEQL_BRANCH_COVERAGE_DRIFT", "develop");
  });

  it("pull_request 分支覆盖漂移时报错", () => {
    const report = audit(
      VALID_WORKFLOW.replace(
        "  pull_request:\n    branches: [main]\n",
        "  pull_request:\n    branches: [develop]\n",
      ),
    );
    expectIssue(report, "CODEQL_BRANCH_COVERAGE_DRIFT", "pull_request");
  });

  it("未登记的 paths-ignore 会排除源码时报错", () => {
    const report = audit(
      VALID_WORKFLOW.replace(
        "  pull_request:\n    branches: [main]\n",
        '  pull_request:\n    branches: [main]\n    paths-ignore:\n      - "src/legacy/**"\n',
      ),
    );
    expectIssue(report, "CODEQL_PATH_IGNORE_UNREGISTERED", "src/legacy/**");
  });

  it("paths 白名单漏掉源码前缀时报错", () => {
    const report = audit(
      VALID_WORKFLOW.replace(
        "  push:\n    branches: [main, develop]\n",
        '  push:\n    branches: [main, develop]\n    paths:\n      - "src/**"\n',
      ),
    );
    const missing = report.issues.filter((issue) => issue.code === "CODEQL_PATHS_MISSING_SOURCE");
    expect(missing.map((issue) => issue.detail)).toEqual([
      expect.stringContaining("scripts"),
      expect.stringContaining("e2e"),
      expect.stringContaining("supabase"),
    ]);
  });

  it("paths 覆盖全部源码前缀时通过", () => {
    const report = audit(
      VALID_WORKFLOW.replace(
        "  push:\n    branches: [main, develop]\n",
        '  push:\n    branches: [main, develop]\n    paths:\n      - "src/**"\n      - "scripts/**"\n      - "e2e/**"\n      - "supabase/**"\n',
      ),
    );
    expect(report.issues).toEqual([]);
  });

  it("缺少处置 runbook 时报错", () => {
    const report = audit(VALID_WORKFLOW, { doc: null });
    expectIssue(report, "CODEQL_TRIAGE_DOC_MISSING");
  });

  it("runbook 为空时报错", () => {
    const report = audit(VALID_WORKFLOW, { doc: "  \n" });
    expectIssue(report, "CODEQL_TRIAGE_DOC_MISSING", "为空");
  });

  it("runbook 缺必备章节时报错", () => {
    const report = audit(VALID_WORKFLOW, { doc: VALID_DOC.replace("## 分诊流程", "## 随便写写") });
    expectIssue(report, "CODEQL_TRIAGE_SECTION_MISSING", "分诊流程");
  });

  it("runbook 缺阻断阈值、SLA 或 dismissal 理由时报错", () => {
    const missingSla = audit(VALID_WORKFLOW, { doc: VALID_DOC.replace(/5 个工作日/g, "尽快") });
    expectIssue(missingSla, "CODEQL_TRIAGE_FACT_MISSING", "分诊 SLA");

    const missingReason = audit(VALID_WORKFLOW, { doc: VALID_DOC.replace("won't fix", "忽略") });
    expectIssue(missingReason, "CODEQL_TRIAGE_FACT_MISSING", "won't fix");

    const missingSuite = audit(VALID_WORKFLOW, {
      doc: VALID_DOC.replace("security-extended", "默认套件"),
    });
    expectIssue(missingSuite, "CODEQL_TRIAGE_FACT_MISSING", "查询套件");
  });

  it("契约可注入：换星期与阈值后按新契约判定", () => {
    const contract: CodeqlContract = { ...CODEQL_CONTRACT, scheduleWeekday: 5 };
    expect(audit(VALID_WORKFLOW, { contract }).issues.map((issue) => issue.code)).toContain(
      "CODEQL_SCHEDULE_CADENCE_DRIFT",
    );
    const friday = VALID_WORKFLOW.replace('cron: "0 6 * * 1"', 'cron: "0 6 * * 5"');
    expect(audit(friday, { contract }).issues).toEqual([]);
  });

  it("formatCodeqlIssues 保留规则码与路径", () => {
    const report = audit(null);
    const text = formatCodeqlIssues(report.issues);
    expect(text).toContain("[CODEQL_WORKFLOW_MISSING]");
    expect(text).toContain(SAMPLE_PATH);
  });

  it("仓库真实工作流与 runbook 满足全部契约", () => {
    const workflow = fs.readFileSync(path.join(REPO_ROOT, SAMPLE_PATH), "utf8");
    const doc = fs.readFileSync(path.join(REPO_ROOT, TRIAGE_PATH), "utf8");
    const report = audit(workflow, { doc });
    expect(formatCodeqlIssues(report.issues)).toBe("");
  });
});
