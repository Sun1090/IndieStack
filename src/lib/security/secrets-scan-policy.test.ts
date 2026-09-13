import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  actionRefMatches,
  auditSecretsScanPolicy,
  collectSensitiveEnv,
  configReference,
  formatSecretsScanIssues,
  parseGitleaksAllowlists,
  parseSecretsScanWorkflow,
  SECRETS_SCAN_CONTRACT,
  type SecretsScanContract,
  type SecretsScanPolicyReport,
} from "./secrets-scan-policy";

const REPO_ROOT = process.cwd();
const WORKFLOW_PATH = SECRETS_SCAN_CONTRACT.path;
const RUNBOOK_PATH = SECRETS_SCAN_CONTRACT.runbookPath;

/** 与仓库真实工作流同构的最小样本：任何“合法”用例都从它派生。 */
const VALID_WORKFLOW = `name: Secrets Scan

on:
  push:
    branches: [main, develop]
  pull_request:

permissions:
  contents: read

concurrency:
  group: secrets-scan-\${{ github.ref }}
  cancel-in-progress: \${{ github.event_name == 'pull_request' }}

jobs:
  gitleaks:
    name: Detect Secrets
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - uses: gitleaks/gitleaks-action@v3
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
`;

const VALID_RUNBOOK = `# Secrets 泄漏响应 Runbook

## 适用范围
覆盖 gitleaks 与生产凭据。

## 立即响应
发现后 **10 分钟** 内建立 incident。

## 影响范围判定
确认提交、分支与凭据权限。

## 处置与验证
在 **24 小时** 内完成轮换，并保留 \`fetch-depth: 0\` 全历史扫描。

## 历史记录处理
轮换凭据，不依赖改写共享分支历史。

## Allowlist 规则
只允许 false positive 与 used in tests。

## 外部依赖
真实历史扫描与凭据管理需要外部权限。
`;

function audit(
  workflowContent: string | null = VALID_WORKFLOW,
  options: {
    config?: string | null;
    runbook?: string | null;
    contract?: SecretsScanContract;
    path?: string;
  } = {},
): SecretsScanPolicyReport {
  const workflow =
    workflowContent === null
      ? undefined
      : { path: options.path ?? WORKFLOW_PATH, content: workflowContent };
  const configContent = options.config === undefined ? null : options.config;
  const runbookContent = options.runbook === undefined ? VALID_RUNBOOK : options.runbook;
  return auditSecretsScanPolicy({
    workflow,
    config: configContent === null ? undefined : { path: ".gitleaks.toml", content: configContent },
    runbook: runbookContent === null ? undefined : { path: RUNBOOK_PATH, content: runbookContent },
    contract: options.contract,
  });
}

function codes(report: SecretsScanPolicyReport): string[] {
  return report.issues.map((issue) => issue.code);
}

function expectIssue(report: SecretsScanPolicyReport, code: string, detail?: string): void {
  const issue = report.issues.find((item) => item.code === code);
  expect(issue, `expected issue ${code} in ${codes(report).join(", ")}`).toBeDefined();
  if (detail !== undefined) expect(issue?.detail).toContain(detail);
}

function replaceOnce(content: string, from: string, to: string): string {
  const index = content.indexOf(from);
  expect(index, `fixture should contain ${from}`).toBeGreaterThanOrEqual(0);
  return content.slice(0, index) + to + content.slice(index + from.length);
}

describe("parseSecretsScanWorkflow", () => {
  it("识别 push / pull_request 两种触发", () => {
    expect(parseSecretsScanWorkflow(VALID_WORKFLOW).triggers).toEqual(["push", "pull_request"]);
  });

  it("读出 push 分支覆盖", () => {
    expect(parseSecretsScanWorkflow(VALID_WORKFLOW).pushBranches).toEqual(["main", "develop"]);
  });

  it("读出 gitleaks action 引用", () => {
    expect(parseSecretsScanWorkflow(VALID_WORKFLOW).actionRef).toBe("gitleaks/gitleaks-action@v3");
  });

  it("读出 checkout fetch-depth", () => {
    expect(parseSecretsScanWorkflow(VALID_WORKFLOW).fetchDepth).toBe("0");
  });

  it("读出敏感 env 与只读权限", () => {
    const facts = parseSecretsScanWorkflow(VALID_WORKFLOW);
    expect(facts.sensitiveEnv).toEqual([
      { key: "GITHUB_TOKEN", value: "${{ secrets.GITHUB_TOKEN }}" },
    ]);
    expect(facts.hasContentsRead).toBe(true);
    expect(facts.writeScopes).toEqual([]);
  });

  it("块列表形式的分支同样可以解析", () => {
    const content = replaceOnce(
      VALID_WORKFLOW,
      "    branches: [main, develop]\n",
      "    branches:\n      - main\n      - develop\n",
    );
    expect(parseSecretsScanWorkflow(content).pushBranches).toEqual(["main", "develop"]);
  });

  it("空内容时失败封闭，不产生假事实", () => {
    const facts = parseSecretsScanWorkflow("");
    expect(facts.triggers).toEqual([]);
    expect(facts.scanJob).toBeUndefined();
    expect(facts.actionRef).toBe("");
    expect(facts.fetchDepth).toBe("");
  });
});

describe("actionRefMatches", () => {
  it("固定到契约 major 时通过", () => {
    expect(actionRefMatches("gitleaks/gitleaks-action@v3", SECRETS_SCAN_CONTRACT)).toBe(true);
  });

  it("允许更细的补丁固定", () => {
    expect(actionRefMatches("gitleaks/gitleaks-action@v3.2.1", SECRETS_SCAN_CONTRACT)).toBe(true);
  });

  it("跨 major 或换仓库时失败", () => {
    expect(actionRefMatches("gitleaks/gitleaks-action@v2", SECRETS_SCAN_CONTRACT)).toBe(false);
    expect(actionRefMatches("gitleaks/gitleaks-action@v31", SECRETS_SCAN_CONTRACT)).toBe(false);
    expect(actionRefMatches("evil/gitleaks-action@v3", SECRETS_SCAN_CONTRACT)).toBe(false);
    expect(actionRefMatches("", SECRETS_SCAN_CONTRACT)).toBe(false);
  });
});

describe("collectSensitiveEnv", () => {
  it("返回引用 secrets 的敏感键", () => {
    expect(collectSensitiveEnv("        GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}\n")).toEqual([
      { key: "GITHUB_TOKEN", value: "${{ secrets.GITHUB_TOKEN }}" },
    ]);
  });

  it("返回字面量值，交给策略层判失败", () => {
    expect(collectSensitiveEnv("          GITLEAKS_LICENSE: abc123\n")).toEqual([
      { key: "GITLEAKS_LICENSE", value: "abc123" },
    ]);
  });

  it("忽略非敏感键与小写键", () => {
    expect(
      collectSensitiveEnv("          GITLEAKS_CONFIG: .gitleaks.toml\n          path: src\n"),
    ).toEqual([]);
  });
});

describe("configReference", () => {
  it("识别 GITLEAKS_CONFIG 环境变量", () => {
    expect(configReference("        GITLEAKS_CONFIG: .gitleaks.toml\n")).toBe(".gitleaks.toml");
  });

  it("识别 --config 参数", () => {
    expect(configReference("run: gitleaks detect --config=.gitleaks.toml")).toBe(".gitleaks.toml");
    expect(configReference("run: gitleaks detect --config .gitleaks.toml")).toBe(".gitleaks.toml");
  });

  it("识别 action config 输入", () => {
    expect(configReference("        config: .gitleaks.toml\n")).toBe(".gitleaks.toml");
  });

  it("没有引用时返回空串", () => {
    expect(configReference("        GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}\n")).toBe("");
  });
});

describe("parseGitleaksAllowlists", () => {
  it("解析单个 allowlist 段的字符串数组", () => {
    expect(
      parseGitleaksAllowlists(
        '[allowlist]\npaths = ["src/generated/**"]\nregexes = ["test-token"]\n',
      ),
    ).toEqual([
      { key: "paths", value: "src/generated/**" },
      { key: "regexes", value: "test-token" },
    ]);
  });

  it("解析多个 [[allowlists]] 段", () => {
    expect(
      parseGitleaksAllowlists(
        '[[allowlists]]\npaths = ["a"]\n\n[[allowlists]]\ncommits = ["deadbeef"]\n',
      ),
    ).toEqual([
      { key: "paths", value: "a" },
      { key: "commits", value: "deadbeef" },
    ]);
  });

  it("解析跨行数组", () => {
    expect(
      parseGitleaksAllowlists('[allowlist]\npaths = [\n  "src/**",\n  "docs/**"\n]\n'),
    ).toEqual([
      { key: "paths", value: "src/**" },
      { key: "paths", value: "docs/**" },
    ]);
  });

  it("忽略未知键与 allowlist 外的内容", () => {
    expect(
      parseGitleaksAllowlists(
        'title = "x"\npaths = ["outside"]\n[allowlist]\nunknown = ["ignored"]\nstopwords = ["dummy"]\n',
      ),
    ).toEqual([{ key: "stopwords", value: "dummy" }]);
  });
});

describe("auditSecretsScanPolicy", () => {
  it("契约样本零问题，并给出稳定的断言条数", () => {
    const report = audit();
    expect(report.issues).toEqual([]);
    expect(report.checks).toBe(20);
  });

  it("工作流缺失或为空时失败封闭", () => {
    expectIssue(audit(null), "SECRETS_WORKFLOW_MISSING");
    expectIssue(audit("   \n"), "SECRETS_SOURCE_EMPTY");
  });

  it("缺少 gitleaks 作业时报错", () => {
    expectIssue(audit(VALID_WORKFLOW.replace(/jobs:[\s\S]*$/, "jobs:\n")), "SECRETS_JOB_MISSING");
  });

  it("缺少扫描 action 时报错", () => {
    expectIssue(
      audit(replaceOnce(VALID_WORKFLOW, "      - uses: gitleaks/gitleaks-action@v3\n", "")),
      "SECRETS_ACTION_MISSING",
    );
  });

  it("action major 漂移时报错", () => {
    expectIssue(
      audit(
        replaceOnce(VALID_WORKFLOW, "gitleaks/gitleaks-action@v3", "gitleaks/gitleaks-action@v2"),
      ),
      "SECRETS_ACTION_MAJOR_DRIFT",
    );
  });

  it("fetch-depth 缺失或不是 0 时报错", () => {
    const withoutDepth = replaceOnce(
      VALID_WORKFLOW,
      "        with:\n          fetch-depth: 0\n",
      "",
    );
    expectIssue(audit(withoutDepth), "SECRETS_FETCH_DEPTH_DRIFT", "当前为 (未设置)");
    expectIssue(
      audit(replaceOnce(VALID_WORKFLOW, "fetch-depth: 0", "fetch-depth: 1")),
      "SECRETS_FETCH_DEPTH_DRIFT",
    );
  });

  it("扫描作业缺少 timeout-minutes 时报错", () => {
    expectIssue(
      audit(replaceOnce(VALID_WORKFLOW, "    timeout-minutes: 10\n", "")),
      "SECRETS_JOB_TIMEOUT_MISSING",
    );
  });

  it("缺少 contents: read 时报错", () => {
    expectIssue(
      audit(replaceOnce(VALID_WORKFLOW, "permissions:\n  contents: read\n", "")),
      "SECRETS_PERMISSION_MISSING",
    );
  });

  it("出现任何 write 权限时报错", () => {
    const report = audit(
      replaceOnce(
        VALID_WORKFLOW,
        "permissions:\n  contents: read\n",
        "permissions:\n  contents: read\n  security-events: write\n",
      ),
    );
    expectIssue(report, "SECRETS_WRITE_PERMISSION", "security-events");
  });

  it("缺少 push 触发时报错", () => {
    expectIssue(
      audit(replaceOnce(VALID_WORKFLOW, "  push:\n    branches: [main, develop]\n", "")),
      "SECRETS_TRIGGER_DRIFT",
      "保留 push",
    );
  });

  it("push 分支覆盖不完整时报错", () => {
    expectIssue(
      audit(replaceOnce(VALID_WORKFLOW, "branches: [main, develop]", "branches: [main]")),
      "SECRETS_TRIGGER_DRIFT",
      "develop",
    );
  });

  it("缺少 pull_request 触发时报错", () => {
    expectIssue(
      audit(replaceOnce(VALID_WORKFLOW, "  pull_request:\n", "")),
      "SECRETS_TRIGGER_DRIFT",
      "pull_request",
    );
  });

  it("没有接线 GITHUB_TOKEN 时报错", () => {
    expectIssue(
      audit(
        replaceOnce(
          VALID_WORKFLOW,
          "        env:\n          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}\n",
          "",
        ),
      ),
      "SECRETS_TOKEN_UNWIRED",
    );
  });

  it("敏感 env 使用字面量时报错", () => {
    expectIssue(
      audit(replaceOnce(VALID_WORKFLOW, "${{ secrets.GITHUB_TOKEN }}", "ghp_literal")),
      "SECRETS_ENV_LITERAL",
    );
  });

  it("自定义 config 路径漂移时报错", () => {
    const content = replaceOnce(
      VALID_WORKFLOW,
      "        env:\n",
      "        env:\n          GITLEAKS_CONFIG: ci/other.toml\n",
    );
    expectIssue(audit(content), "SECRETS_CONFIG_REFERENCE_DRIFT", "ci/other.toml");
  });

  it("allowlist 条目未登记时报错", () => {
    expectIssue(
      audit(VALID_WORKFLOW, {
        config: '[allowlist]\npaths = ["src/**"]\nregexes = ["fake-token"]\n',
      }),
      "SECRETS_ALLOWLIST_UNREGISTERED",
    );
  });

  it("没有 .gitleaks.toml 时跳过 allowlist 规则", () => {
    const report = audit(VALID_WORKFLOW, { config: null });
    expect(codes(report)).not.toContain("SECRETS_ALLOWLIST_UNREGISTERED");
  });

  it("runbook 缺失或为空时报错", () => {
    expectIssue(audit(VALID_WORKFLOW, { runbook: null }), "SECRETS_RUNBOOK_MISSING");
    expectIssue(audit(VALID_WORKFLOW, { runbook: "  \n" }), "SECRETS_RUNBOOK_MISSING");
  });

  it("runbook 缺少必备章节时报错", () => {
    const runbook = VALID_RUNBOOK.replace("## 外部依赖", "## 其他");
    expectIssue(audit(VALID_WORKFLOW, { runbook }), "SECRETS_RUNBOOK_SECTION_MISSING");
  });

  it.each([
    ["首次响应时限", "10 分钟", "时限"],
    ["轮换时限", "24 小时", "时限"],
    ["全历史扫描事实", "fetch-depth: 0", "全历史扫描"],
    ["allowlist 理由", "false positive", "allowlist 理由"],
    ["allowlist 测试理由", "used in tests", "allowlist 理由"],
  ])("runbook 缺少 %s 时失败", (_label, token, detail) => {
    const runbook = replaceOnce(VALID_RUNBOOK, token, "");
    expectIssue(audit(VALID_WORKFLOW, { runbook }), "SECRETS_RUNBOOK_FACT_MISSING", detail);
  });

  it("契约可注入，分支与 action major 漂移能按新契约判定", () => {
    const contract: SecretsScanContract = {
      ...SECRETS_SCAN_CONTRACT,
      actionMajor: "v4",
      pushBranches: ["release"],
    };
    const report = audit(VALID_WORKFLOW, { contract });
    expect(codes(report)).toContain("SECRETS_ACTION_MAJOR_DRIFT");
    expect(codes(report)).toContain("SECRETS_TRIGGER_DRIFT");
  });

  it("formatSecretsScanIssues 带规则码输出", () => {
    const text = formatSecretsScanIssues([
      { code: "SECRETS_SOURCE_EMPTY", path: "x.yml", detail: "为空" },
    ]);
    expect(text).toContain("[SECRETS_SOURCE_EMPTY]");
    expect(text).toContain("x.yml 为空");
  });

  it("真实工作流与 runbook 满足契约", () => {
    const workflow = fs.readFileSync(path.join(REPO_ROOT, WORKFLOW_PATH), "utf8");
    const runbook = fs.readFileSync(path.join(REPO_ROOT, RUNBOOK_PATH), "utf8");
    const report = auditSecretsScanPolicy({
      workflow: { path: WORKFLOW_PATH, content: workflow },
      runbook: { path: RUNBOOK_PATH, content: runbook },
    });
    expect(report.issues).toEqual([]);
  });
});
