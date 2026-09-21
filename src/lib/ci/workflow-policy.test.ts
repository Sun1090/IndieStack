import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  auditWorkflowPolicy,
  CI_TOPOLOGY,
  formatWorkflowIssues,
  isPinnedAction,
  parseJobs,
  parseTriggers,
  parseWorkflow,
  type CiTopologyContract,
  type WorkflowPolicyReport,
} from "./workflow-policy";

const REPO_ROOT = process.cwd();
const SAMPLE_PATH = ".github/workflows/sample.yml";
const DEFAULT_SCRIPTS = {
  "check:docs": "node scripts/check-docs-scripts.js",
  "test:coverage": "vitest run --coverage",
};

function sampleTopology(overrides: Partial<CiTopologyContract> = {}): CiTopologyContract {
  return {
    path: SAMPLE_PATH,
    staticJob: "static-checks",
    unitTestJob: "unit-tests",
    expensiveJobs: [],
    browserCachePath: "~/.cache/ms-playwright",
    lockfileToken: "hashFiles('pnpm-lock.yaml')",
    ...overrides,
  };
}

function audit(
  content: string,
  options: {
    scripts?: Record<string, string>;
    topology?: CiTopologyContract;
    path?: string;
  } = {},
): WorkflowPolicyReport {
  const path = options.path ?? SAMPLE_PATH;
  return auditWorkflowPolicy({
    workflows: [{ path, content }],
    scripts: options.scripts ?? DEFAULT_SCRIPTS,
    topology: options.topology ?? sampleTopology({ path }),
  });
}

function codes(report: WorkflowPolicyReport): string[] {
  return report.issues.map((issue) => issue.code);
}

const STATIC_JOB = `  static-checks:
    name: Static Checks
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v7
      - run: pnpm check:docs
`;

const UNIT_JOB = `  unit-tests:
    name: Unit Tests
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v7
      - run: pnpm test:coverage
`;

function sampleWorkflow(jobs: string, extra = ""): string {
  return `name: Sample

on:
  pull_request:

permissions:
  contents: read
${extra}
concurrency:
  group: sample-\${{ github.ref }}
  cancel-in-progress: true

jobs:
${jobs}`;
}

const VALID_WORKFLOW = sampleWorkflow(STATIC_JOB + UNIT_JOB);

describe("parseTriggers", () => {
  it("parses block, inline list, single-value, and missing trigger forms", () => {
    expect(parseTriggers(["on:", "  push:", "  pull_request:", "    branches: [main]"])).toEqual([
      "push",
      "pull_request",
    ]);
    expect(parseTriggers(["on: [push, pull_request]"])).toEqual(["push", "pull_request"]);
    expect(parseTriggers(["on: workflow_dispatch"])).toEqual(["workflow_dispatch"]);
    expect(parseTriggers(["name: x"])).toEqual([]);
  });

  it("stops the trigger block at the next top-level key and skips blank lines", () => {
    const lines = [
      "on:",
      "  schedule:",
      "",
      "    - cron: '0 6 * * 1'",
      "permissions:",
      "  contents: read",
    ];
    expect(parseTriggers(lines)).toEqual(["schedule"]);
  });
});

describe("parseJobs", () => {
  it("returns nothing without a jobs block and stops at the next top-level key", () => {
    expect(parseJobs(["name: x"])).toEqual([]);
    const lines = [
      "jobs:",
      "  a:",
      "    runs-on: ubuntu-latest",
      "permissions:",
      "  contents: read",
    ];
    const jobs = parseJobs(lines);
    expect(jobs.map((job) => job.id)).toEqual(["a"]);
  });

  it("captures job names, needs in every supported form, and hygiene flags", () => {
    const lines = [
      "jobs:",
      "  full:",
      "    name: Full",
      "    runs-on: ubuntu-latest",
      "    timeout-minutes: 5",
      "    needs: [one, two]",
      "  scalar:",
      "    needs: one",
      "  block:",
      "    needs:",
      "      - one",
      "      - two",
      "  empty:",
      "    needs:",
    ];
    const jobs = parseJobs(lines);
    expect(jobs.map((job) => job.id)).toEqual(["full", "scalar", "block", "empty"]);
    expect(jobs[0]).toMatchObject({
      name: "Full",
      needs: ["one", "two"],
      hasRunsOn: true,
      hasTimeout: true,
      line: 2,
    });
    expect(jobs[1].needs).toEqual(["one"]);
    expect(jobs[2].needs).toEqual(["one", "two"]);
    expect(jobs[3].needs).toEqual([]);
    expect(jobs[1].hasRunsOn).toBe(false);
  });

  it("falls back to the job id when no name is declared", () => {
    const jobs = parseJobs(["jobs:", "  bare:", "    runs-on: ubuntu-latest"]);
    expect(jobs[0].name).toBe("bare");
  });
});

describe("isPinnedAction", () => {
  it("accepts semver tags, full SHAs, and local actions", () => {
    expect(isPinnedAction("actions/checkout@v7")).toBe(true);
    expect(isPinnedAction("actions/cache@v6.1.0")).toBe(true);
    expect(isPinnedAction(`actions/checkout@${"a".repeat(40)}`)).toBe(true);
    expect(isPinnedAction("./.github/actions/setup")).toBe(true);
  });

  it("rejects drifting and malformed references", () => {
    expect(isPinnedAction("actions/checkout@main")).toBe(false);
    expect(isPinnedAction("actions/checkout@master")).toBe(false);
    expect(isPinnedAction("actions/checkout@HEAD")).toBe(false);
    expect(isPinnedAction("actions/checkout@latest")).toBe(false);
    expect(isPinnedAction("actions/checkout")).toBe(false);
    expect(isPinnedAction("@v1")).toBe(false);
  });
});

describe("auditWorkflowPolicy", () => {
  it("accepts a workflow that satisfies every rule", () => {
    const report = audit(VALID_WORKFLOW);
    expect(report.issues).toEqual([]);
    expect(report).toMatchObject({ workflows: 1, jobs: 2, actions: 2 });
  });

  it("fails closed on empty input or an unparseable workflow", () => {
    const empty = auditWorkflowPolicy({ workflows: [], scripts: DEFAULT_SCRIPTS });
    expect(codes(empty)).toContain("WORKFLOW_SOURCE_EMPTY");

    expect(codes(audit(""))).toContain("WORKFLOW_SOURCE_EMPTY");
    expect(codes(audit("name: NoJobs\non: push\n"))).toContain("WORKFLOW_MISSING_JOBS");
  });

  it("requires runs-on and timeout-minutes on every job", () => {
    const workflow = sampleWorkflow("  bare:\n    steps:\n      - run: pnpm check:docs\n");
    const reportCodes = codes(audit(workflow));
    expect(reportCodes).toContain("JOB_MISSING_RUNS_ON");
    expect(reportCodes).toContain("JOB_MISSING_TIMEOUT");
  });

  it("rejects unpinned action references", () => {
    const workflow = sampleWorkflow("", "").replace(
      "jobs:",
      "jobs:\n  x:\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n    steps:\n      - uses: actions/checkout@main\n",
    );
    expect(codes(audit(workflow))).toContain("ACTION_UNPINNED");
  });

  it("rejects needs that reference an undeclared job", () => {
    const jobs =
      STATIC_JOB +
      UNIT_JOB +
      "  extra:\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n    needs: [nope]\n";
    expect(codes(audit(sampleWorkflow(jobs)))).toContain("NEEDS_UNKNOWN_JOB");
  });

  it("requires pull_request workflows to cancel superseded runs", () => {
    const withoutConcurrency = `name: Sample

on:
  pull_request:

permissions:
  contents: read

jobs:
${STATIC_JOB}${UNIT_JOB}`;
    expect(codes(audit(withoutConcurrency))).toContain("CONCURRENCY_MISSING");

    const neverCancels = VALID_WORKFLOW.replace(
      "cancel-in-progress: true",
      "cancel-in-progress: false",
    );
    expect(codes(audit(neverCancels))).toContain("CONCURRENCY_NOT_CANCELLING");
  });

  it("skips the concurrency requirement for non-PR workflows", () => {
    const pushOnly = `name: Release

on:
  push:
    tags: ["v*"]

permissions:
  contents: write

jobs:
${STATIC_JOB}${UNIT_JOB}`;
    const reportCodes = codes(audit(pushOnly));
    expect(reportCodes).not.toContain("CONCURRENCY_MISSING");
    expect(reportCodes).not.toContain("CONCURRENCY_NOT_CANCELLING");
  });

  it("forbids pull_request_target triggers", () => {
    const workflow = VALID_WORKFLOW.replace("  pull_request:", "  pull_request_target:");
    expect(codes(audit(workflow))).toContain("PULL_REQUEST_TARGET_FORBIDDEN");
  });

  it("rejects colon-namespaced pnpm scripts that do not exist", () => {
    const workflow = VALID_WORKFLOW.replace("pnpm check:docs", "pnpm check:tpyo").replace(
      "pnpm test:coverage",
      "pnpm install --frozen-lockfile && pnpm build",
    );
    const report = audit(workflow);
    expect(codes(report)).toContain("SCRIPT_UNKNOWN");
    expect(report.issues.filter((issue) => issue.code === "SCRIPT_UNKNOWN")).toHaveLength(1);
  });
});

describe("health check URL contract", () => {
  const HEALTH_WORKFLOW =
    'name: Post-deploy health check\n\non:\n  workflow_dispatch:\n    inputs:\n      health_url:\n        required: false\n        type: string\n  schedule:\n    - cron: "17 3 * * *"\n\npermissions:\n  contents: read\n\njobs:\n  health:\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n    env:\n      HEALTHCHECK_URL: ${{ github.event.inputs.health_url || vars.HEALTHCHECK_URL }}\n    steps:\n      - uses: actions/checkout@v7\n      - run: node scripts/check-health.js "$HEALTHCHECK_URL"';

  function auditHealthWorkflow(content: string): WorkflowPolicyReport {
    return audit(content, {
      path: ".github/workflows/health-check.yml",
      topology: sampleTopology({ path: SAMPLE_PATH }),
    });
  }

  it("accepts the shared normalizer as the health URL contract", () => {
    const report = auditHealthWorkflow(HEALTH_WORKFLOW);
    expect(
      report.issues.filter((issue) => issue.code === "HEALTHCHECK_URL_NOT_NORMALIZED"),
    ).toHaveLength(0);
  });

  it.each([
    [
      "does not read vars.HEALTHCHECK_URL",
      HEALTH_WORKFLOW.replace("vars.HEALTHCHECK_URL", "vars.OTHER_URL"),
    ],
    [
      "does not use the shared check-health parser",
      HEALTH_WORKFLOW.replace(
        '      - run: node scripts/check-health.js "$HEALTHCHECK_URL"',
        "run: node -e 'console.log(process.env.HEALTHCHECK_URL)'",
      ),
    ],
  ])("rejects a workflow that %s", (_, content) => {
    const report = auditHealthWorkflow(content);
    expect(codes(report)).toContain("HEALTHCHECK_URL_NOT_NORMALIZED");
    expect(
      report.issues.filter((issue) => issue.code === "HEALTHCHECK_URL_NOT_NORMALIZED"),
    ).toEqual([expect.objectContaining({ job: "health" })]);
  });
});

describe("ci.yml topology contract", () => {
  const expensive = ["build", "e2e"];

  function topology(): CiTopologyContract {
    return sampleTopology({ expensiveJobs: expensive });
  }

  const expensiveJobs = `  build:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    needs: [static-checks]
  e2e:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    needs: [static-checks]
    steps:
      - uses: actions/cache@v6
        with:
          path: ~/.cache/ms-playwright
          key: playwright-\${{ runner.os }}-\${{ hashFiles('pnpm-lock.yaml') }}
          restore-keys: |
            playwright-\${{ runner.os }}-
`;

  it("accepts the expected parallel topology", () => {
    const report = audit(sampleWorkflow(STATIC_JOB + UNIT_JOB + expensiveJobs), {
      topology: topology(),
    });
    expect(report.issues).toEqual([]);
  });

  it("flags a missing ci.yml entirely", () => {
    const report = auditWorkflowPolicy({
      workflows: [{ path: ".github/workflows/other.yml", content: VALID_WORKFLOW }],
      scripts: DEFAULT_SCRIPTS,
      topology: topology(),
    });
    expect(codes(report)).toContain("CI_TOPOLOGY_DRIFT");
  });

  it("flags missing static and unit jobs", () => {
    const report = audit(sampleWorkflow(UNIT_JOB), { topology: topology() });
    expect(report.issues[0]).toMatchObject({ code: "CI_TOPOLOGY_DRIFT", job: "static-checks" });
  });

  it("flags prerequisites that would serialize the pipeline", () => {
    const serialized = STATIC_JOB.replace(
      "    runs-on: ubuntu-latest",
      "    needs: [unit-tests]\n    runs-on: ubuntu-latest",
    );
    const unitDepends = UNIT_JOB.replace(
      "    runs-on: ubuntu-latest",
      "    needs: [static-checks]\n    runs-on: ubuntu-latest",
    );
    const report = audit(sampleWorkflow(serialized + unitDepends + expensiveJobs), {
      topology: topology(),
    });
    const drift = report.issues.filter((issue) => issue.code === "CI_TOPOLOGY_DRIFT");
    expect(drift.length).toBeGreaterThanOrEqual(2);
  });

  it("flags coverage tests left inside the static job", () => {
    const staticWithCoverage = `${STATIC_JOB}      - run: pnpm test:coverage\n`;
    const report = audit(sampleWorkflow(staticWithCoverage + UNIT_JOB), { topology: topology() });
    expect(codes(report)).toContain("CI_TOPOLOGY_DRIFT");
  });

  it("flags a unit test job that skips coverage", () => {
    const lazyUnit = UNIT_JOB.replace("pnpm test:coverage", "pnpm lint");
    const report = audit(sampleWorkflow(STATIC_JOB + lazyUnit), { topology: topology() });
    expect(codes(report)).toContain("CI_TOPOLOGY_DRIFT");
  });

  it("recognises coverage inside a run block scalar and does not leak across jobs", () => {
    const blockUnit = UNIT_JOB.replace(
      "      - run: pnpm test:coverage\n",
      "      - run: |\n          pnpm test:coverage\n",
    );
    const clean = audit(sampleWorkflow(STATIC_JOB + blockUnit + expensiveJobs), {
      topology: topology(),
    });
    expect(clean.issues).toHaveLength(0);

    const blockStatic = STATIC_JOB.replace(
      "      - run: pnpm check:docs\n",
      "      - run: |\n          pnpm check:docs\n          pnpm test:coverage\n",
    );
    const drifted = audit(sampleWorkflow(blockStatic + UNIT_JOB), { topology: topology() });
    expect(
      drifted.issues.filter(
        (issue) => issue.code === "CI_TOPOLOGY_DRIFT" && issue.job === "static-checks",
      ),
    ).toHaveLength(1);
  });

  it("keeps a neighbouring job's coverage run out of the static job", () => {
    // 静态门禁的 run 行紧跟单元测试作业的 run 行时，旧的跨行正则会把后者误判进来。
    const trailingStatic = `${STATIC_JOB}  unit-tests:\n    name: Unit Tests\n    runs-on: ubuntu-latest\n    timeout-minutes: 20\n    steps:\n      - run: pnpm test:coverage\n`;
    const report = audit(sampleWorkflow(trailingStatic), { topology: topology() });
    expect(
      report.issues.filter(
        (issue) => issue.code === "CI_TOPOLOGY_DRIFT" && issue.job === "static-checks",
      ),
    ).toHaveLength(0);
  });

  it("flags missing expensive jobs and wrong needs", () => {
    const missing = audit(sampleWorkflow(STATIC_JOB + UNIT_JOB), { topology: topology() });
    expect(
      missing.issues.filter((issue) => issue.code === "CI_TOPOLOGY_DRIFT" && issue.job === "build"),
    ).toHaveLength(1);

    const wrongNeeds = expensiveJobs.replaceAll("needs: [static-checks]", "needs: [unit-tests]");
    const report = audit(sampleWorkflow(STATIC_JOB + UNIT_JOB + wrongNeeds), {
      topology: topology(),
    });
    expect(
      report.issues.filter((issue) => issue.code === "CI_TOPOLOGY_DRIFT" && issue.job === "build"),
    ).toHaveLength(1);
  });

  it("requires a lockfile-keyed Playwright browser cache", () => {
    const variants = [
      expensiveJobs.replace(
        "      - uses: actions/cache@v6\n        with:\n          path: ~/.cache/ms-playwright\n          key: playwright-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }}\n          restore-keys: |\n            playwright-${{ runner.os }}-\n",
        "",
      ),
      expensiveJobs.replace("actions/cache@v6", "actions/upload-artifact@v7"),
      expensiveJobs.replace("~/.cache/ms-playwright", "/tmp/browsers"),
      expensiveJobs.replace("hashFiles('pnpm-lock.yaml')", "github.sha"),
      expensiveJobs.replace(
        "          restore-keys: |\n            playwright-${{ runner.os }}-\n",
        "",
      ),
    ];
    for (const variant of variants) {
      const report = audit(sampleWorkflow(STATIC_JOB + UNIT_JOB + variant), {
        topology: topology(),
      });
      expect(codes(report)).toContain("CI_TOPOLOGY_DRIFT");
    }
  });
});

describe("repository workflows", () => {
  const workflowDir = path.join(REPO_ROOT, ".github/workflows");
  const documents = fs
    .readdirSync(workflowDir)
    .filter((name) => /\.ya?ml$/.test(name))
    .sort()
    .map((name) => ({
      path: `.github/workflows/${name}`,
      content: fs.readFileSync(path.join(workflowDir, name), "utf8"),
    }));
  const scripts = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"))
    .scripts as Record<string, string>;

  it("keeps every tracked workflow pinned, bounded, and wired to real scripts", () => {
    const report = auditWorkflowPolicy({ workflows: documents, scripts });
    expect(formatWorkflowIssues(report.issues)).toBe("");
    expect(report.workflows).toBe(documents.length);
  });

  it("keeps ci.yml's parallel and cache contract explicit", () => {
    const ci = documents.find((document) => document.path === CI_TOPOLOGY.path);
    expect(ci).toBeDefined();
    const parsed = parseWorkflow(ci!);
    expect(parsed.triggers).toEqual(expect.arrayContaining(["push", "pull_request"]));
    expect(parsed.hasConcurrency).toBe(true);
    expect(parsed.concurrencyBody).toContain(
      "cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
    );
    const ids = parsed.jobs.map((job) => job.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        CI_TOPOLOGY.staticJob,
        CI_TOPOLOGY.unitTestJob,
        "build",
        "build-docs",
        "e2e",
      ]),
    );
  });
});
