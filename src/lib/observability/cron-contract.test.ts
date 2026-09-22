import { describe, expect, it } from "vitest";
import {
  auditCronContract,
  CRON_REJECTED_METRIC,
  CRON_WORKERS,
  exportsMethod,
  isValidCronSchedule,
  isValidVercelHobbyCronSchedule,
  countCronRunsPerDay,
  type CronContractInput,
  type CronContractIssueCode,
  type CronWorkerContract,
} from "./cron-contract";

const WORKER: CronWorkerContract = {
  id: "digest",
  path: "/api/cron/digest",
  routeFile: "src/app/api/cron/digest/route.ts",
  methods: ["POST"],
  schedule: "0 9 * * *",
  metrics: ["email.backlog", "cron.digest.completed", "cron.digest.failed"],
  skipMetrics: [],
  cadence: "每天 09:00 UTC",
};

const ROUTE_SOURCE = `
import { recordMetric } from "@/lib/metrics";
import { recordCronRejected } from "@/lib/cron-metrics";

export async function POST() {
  recordMetric("email.backlog", 1, { unit: "count" });
  recordMetric("cron.digest.completed", 1, { unit: "ms" });
  recordMetric("cron.digest.failed", 1, {});
  recordCronRejected("digest", "invalid_credentials");
}
`;

const DOC = `
| ${CRON_REJECTED_METRIC} | count | worker, reason |
| email.backlog | count | 无 |
| cron.digest.completed | ms | pulled |
| cron.digest.failed | count | error_type |
| /api/cron/digest | \`0 9 * * *\` | 每天 09:00 UTC |
`;

function baseInput(overrides: Partial<CronContractInput> = {}): CronContractInput {
  return {
    workers: [WORKER],
    routeFiles: [WORKER.routeFile],
    sources: { [WORKER.routeFile]: ROUTE_SOURCE },
    platformCrons: [{ path: WORKER.path, schedule: WORKER.schedule }],
    operationsDoc: DOC,
    excludedSchedules: {},
    ...overrides,
  };
}

function codes(input: CronContractInput): CronContractIssueCode[] {
  return auditCronContract(input).issues.map((issue) => issue.code);
}

describe("isValidCronSchedule", () => {
  it("接受仓库真实使用的 5 字段表达式", () => {
    for (const expression of [
      "* * * * *",
      "0 9 * * *",
      "0 22 * * *",
      "0 2 * * *",
      "0 4 * * *",
      "30 9-17 * * 1-5",
      "0,30 0 * * 0",
      "0 0 1 1 *",
      "0 0 * * 7",
    ]) {
      expect(isValidCronSchedule(expression), expression).toBe(true);
    }
  });

  it("拒绝字段越界、字段数不符与扩展语法", () => {
    for (const expression of [
      "",
      "0 * * *",
      "0 * * * * *",
      "60 * * * *",
      "0 24 * * *",
      "0 0 0 * *",
      "0 0 32 * *",
      "0 0 * 13 *",
      "0 0 * * 8",
      "*/0 * * * *",
      "*/60 * * * *",
      "5/5 * * * *",
      "0-5-9 * * * *",
      "@hourly",
      "0 0 ? * *",
      "0 0 * * MON",
      "0 0 L * *",
    ]) {
      expect(isValidCronSchedule(expression), expression).toBe(false);
    }
  });
});

describe("isValidVercelHobbyCronSchedule", () => {
  it("接受每天一次的 Vercel Hobby cron 表达式", () => {
    for (const expression of ["0 2 * * *", "0 4 * * *", "0 9 * * *", "0 22 * * *", "17 2 * * *"]) {
      expect(isValidVercelHobbyCronSchedule(expression), expression).toBe(true);
    }
  });

  it("拒绝同一天会多次运行的表达式", () => {
    for (const expression of ["0 * * * *", "*/15 * * * *", "0,30 0 * * *", "0 0-2 * * *", "5/5 * * * *"]) {
      expect(isValidVercelHobbyCronSchedule(expression), expression).toBe(false);
    }
  });

  it("拒绝会跳过部分天导致漏跑的 cron 选择字段", () => {
    for (const expression of ["0 0 * * 1", "0 0 * * 1-5", "0 0 1 * *", "0 0 * 1 *", "0 0 L * *"]) {
      expect(isValidVercelHobbyCronSchedule(expression), expression).toBe(false);
    }
  });
});

describe("countCronRunsPerDay", () => {
  it("报告分/时字段的每日触发次数", () => {
    expect(countCronRunsPerDay("0 2 * * *")).toBe(1);
    expect(countCronRunsPerDay("0 * * * *")).toBe(24);
    expect(countCronRunsPerDay("*/15 * * * *")).toBe(96);
    expect(countCronRunsPerDay("0,30 0 * * *")).toBe(2);
  });

  it("拒绝超过 Vercel Hobby 每日一次的调度表达式", () => {
    const issues = auditCronContract(
      baseInput({ workers: [{ ...WORKER, schedule: "0 * * * *" }], platformCrons: [{ path: WORKER.path, schedule: "0 * * * *" }] }),
    ).issues;

    expect(issues.map((issue) => issue.code)).toContain("CRON_SCHEDULE_PLATFORM_UNSUPPORTED");
    expect(issues.some((issue) => issue.code === "CRON_SCHEDULE_PLATFORM_UNSUPPORTED" && issue.message.includes("24"))).toBe(true);
  });
});

describe("exportsMethod", () => {
  it("识别同步与 async 导出，且不误判相邻方法名", () => {
    expect(exportsMethod("export function GET() {}", "GET")).toBe(true);
    expect(exportsMethod("export async function POST() {}", "POST")).toBe(true);
    expect(exportsMethod("export function GET_ALL() {}", "GET")).toBe(false);
    expect(exportsMethod("function GET() {}", "GET")).toBe(false);
  });
});

describe("auditCronContract", () => {
  it("注册表、平台调度、指标与文档一致时不报问题", () => {
    const report = auditCronContract(baseInput());
    expect(report.issues).toEqual([]);
    expect(report.workers).toEqual(["digest"]);
    expect(report.workerPaths).toEqual(["/api/cron/digest"]);
    expect(report.metrics).toContain(CRON_REJECTED_METRIC);
  });

  it("注册表为空时失败封闭", () => {
    expect(codes(baseInput({ workers: [] }))).toContain("CRON_NO_WORKERS");
  });

  it("发现未注册的 cron 路由文件", () => {
    const extra = "src/app/api/cron/orphan/route.ts";
    const issues = auditCronContract(
      baseInput({ routeFiles: [WORKER.routeFile, extra], sources: { [WORKER.routeFile]: ROUTE_SOURCE, [extra]: "" } }),
    ).issues;
    expect(issues).toEqual([
      expect.objectContaining({ code: "CRON_ROUTE_UNDECLARED", subject: extra }),
    ]);
  });

  it("注册的 route 文件缺失时同时暴露方法、指标与拒绝指标缺失", () => {
    const issues = auditCronContract(baseInput({ routeFiles: [], sources: {} })).issues;
    expect(issues.map((issue) => issue.code)).toEqual([
      "CRON_ROUTE_MISSING",
      "CRON_METHOD_MISSING",
      "CRON_METRIC_MISSING",
      "CRON_METRIC_MISSING",
      "CRON_METRIC_MISSING",
      "CRON_REJECTION_UNOBSERVABLE",
    ]);
  });

  it("路由未导出注册的方法时报 405 风险", () => {
    const source = ROUTE_SOURCE.replace("export async function POST", "async function POST");
    expect(codes(baseInput({ sources: { [WORKER.routeFile]: source } }))).toContain(
      "CRON_METHOD_MISSING",
    );
  });

  it("未登记到 vercel.json 的 worker 视为未被调度", () => {
    expect(codes(baseInput({ platformCrons: [] }))).toContain("CRON_SCHEDULE_MISSING");
  });

  it("vercel.json 与注册表表达式不一致时报漂移", () => {
    const issues = auditCronContract(
      baseInput({ platformCrons: [{ path: WORKER.path, schedule: "0 10 * * *" }] }),
    ).issues;
    expect(issues).toEqual([
      expect.objectContaining({ code: "CRON_SCHEDULE_DRIFT", subject: "digest" }),
    ]);
  });

  it("表达式非法时在注册表与平台两侧都报错", () => {
    const issues = auditCronContract(
      baseInput({
        workers: [{ ...WORKER, schedule: "0 25 * * *" }],
        platformCrons: [{ path: WORKER.path, schedule: "0 25 * * *" }],
      }),
    ).issues;
    expect(issues.filter((issue) => issue.code === "CRON_SCHEDULE_INVALID")).toHaveLength(2);
    expect(issues.filter((issue) => issue.code === "CRON_DOC_SCHEDULE_MISSING")).toHaveLength(1);
  });

  it("同一路径被重复调度时报重复", () => {
    const schedule = WORKER.schedule;
    expect(
      codes(
        baseInput({
          platformCrons: [
            { path: WORKER.path, schedule },
            { path: WORKER.path, schedule },
          ],
        }),
      ),
    ).toContain("CRON_SCHEDULE_DUPLICATE");
  });

  it("平台调度了未注册路径时报孤儿，豁免路径除外", () => {
    const scheduled = [
      { path: WORKER.path, schedule: WORKER.schedule },
      { path: "/api/cron/unknown", schedule: "0 0 * * *" },
    ];
    const orphanIssues = auditCronContract(baseInput({ platformCrons: scheduled })).issues.filter(
      (issue) => issue.code === "CRON_SCHEDULE_ORPHAN",
    );
    expect(orphanIssues).toEqual([
      expect.objectContaining({ subject: "/api/cron/unknown" }),
    ]);
    expect(
      codes(
        baseInput({
          platformCrons: scheduled,
          excludedSchedules: { "/api/cron/unknown": "外部调度器托管" },
        }),
      ),
    ).not.toContain("CRON_SCHEDULE_ORPHAN");
  });

  it("豁免必须带理由且仍然真实存在", () => {
    expect(
      codes(baseInput({ excludedSchedules: { "/api/health": "  " } })),
    ).toContain("CRON_STALE_EXEMPTION");
    expect(
      codes(baseInput({ excludedSchedules: { "/api/health": "保活" } })),
    ).toContain("CRON_STALE_EXEMPTION");
    const kept = baseInput({
      platformCrons: [
        { path: WORKER.path, schedule: WORKER.schedule },
        { path: "/api/health", schedule: "0 2 * * *" },
      ],
      excludedSchedules: { "/api/health": "保活" },
    });
    expect(codes(kept)).not.toContain("CRON_STALE_EXEMPTION");
    expect(auditCronContract(kept).exemptedPaths).toEqual(["/api/health"]);
  });

  it("指标未上报或未登记文档时分别报错", () => {
    const source = ROUTE_SOURCE.replace('recordMetric("email.backlog", 1, { unit: "count" });', "");
    expect(codes(baseInput({ sources: { [WORKER.routeFile]: source } }))).toContain(
      "CRON_METRIC_MISSING",
    );

    const doc = DOC.replace("| email.backlog | count | 无 |", "");
    expect(codes(baseInput({ operationsDoc: doc }))).toContain("CRON_METRIC_UNDOCUMENTED");
  });

  it("401 分支未上报拒绝指标时报警", () => {
    const source = ROUTE_SOURCE.replace('recordCronRejected("digest", "invalid_credentials");', "");
    expect(codes(baseInput({ sources: { [WORKER.routeFile]: source } }))).toContain(
      "CRON_REJECTION_UNOBSERVABLE",
    );
  });

  it("拒绝指标名也要登记在告警文档", () => {
    const doc = DOC.replace(`| ${CRON_REJECTED_METRIC} | count | worker, reason |`, "");
    const issues = auditCronContract(baseInput({ operationsDoc: doc })).issues;
    expect(issues).toEqual([
      expect.objectContaining({ code: "CRON_METRIC_UNDOCUMENTED", subject: CRON_REJECTED_METRIC }),
    ]);
  });

  it("调度未登记在运维文档时报文档漂移", () => {
    expect(codes(baseInput({ operationsDoc: "没有任何契约" }))).toContain(
      "CRON_DOC_SCHEDULE_MISSING",
    );
  });

  it("仓库注册表本身合法（与 vercel.json 的核对由 IO 门禁完成）", () => {
    expect(CRON_WORKERS.length).toBeGreaterThan(0);
    for (const worker of CRON_WORKERS) {
      expect(isValidCronSchedule(worker.schedule), worker.id).toBe(true);
    }
  });
});

/** 把一段函数体拼进基础路由源码，用于造出带条件跳过的 worker。 */
function sourceWith(body: string): string {
  return `${ROUTE_SOURCE}\nasync function runLoop(items: { email: string | null }[]) {\n  let sent = 0;\n${body}\n  return { sent };\n}\n`;
}

describe("条件跳过必须计数（A04）", () => {
  const skipWorker: CronWorkerContract = {
    ...WORKER,
    metrics: [...WORKER.metrics, "cron.digest.skipped"],
    skipMetrics: ["cron.digest.skipped"],
  };
  const skipDoc = `${DOC}\n| cron.digest.skipped | count | reason |\n`;

  it("带条件的 continue 没有任何计数证据时报 CRON_SKIP_UNCOUNTED", () => {
    const issues = auditCronContract(
      baseInput({
        workers: [skipWorker],
        operationsDoc: skipDoc,
        sources: {
          [WORKER.routeFile]: sourceWith("  for (const item of items) {\n    if (!item.email) continue;\n    sent += 1;\n  }"),
        },
      }),
    ).issues;
    expect(issues.map((issue) => issue.code)).toContain("CRON_SKIP_UNCOUNTED");
    expect(issues.find((issue) => issue.code === "CRON_SKIP_UNCOUNTED")?.message).toContain("!item.email");
  });

  it("分支上报登记的 skip 指标（带 reason）即通过", () => {
    const report = auditCronContract(
      baseInput({
        workers: [skipWorker],
        operationsDoc: skipDoc,
        sources: {
          [WORKER.routeFile]: sourceWith(
            "  for (const item of items) {\n    if (!item.email) {\n      recordMetric(\"cron.digest.skipped\", 1, { unit: \"count\", attributes: { reason: \"no_email\" } });\n      continue;\n    }\n    sent += 1;\n  }",
          ),
        },
      }),
    );
    expect(report.issues).toEqual([]);
    expect(report.skipBranches).toBe(1);
  });

  it("skip 指标没有登记进该 worker 的 metrics 时报 CRON_SKIP_METRIC_UNDECLARED", () => {
    const issues = auditCronContract(
      baseInput({
        workers: [{ ...WORKER, skipMetrics: ["cron.digest.skipped"] }],
        operationsDoc: skipDoc,
      }),
    ).issues;
    expect(issues.map((issue) => issue.code)).toContain("CRON_SKIP_METRIC_UNDECLARED");
  });

  it("源码无法解析时按失败封闭报 CRON_SKIP_UNPARSEABLE", () => {
    const issues = auditCronContract(
      baseInput({ workers: [skipWorker], operationsDoc: skipDoc, sources: { [WORKER.routeFile]: "async function broken( {" } }),
    ).issues;
    expect(issues.map((issue) => issue.code)).toContain("CRON_SKIP_UNPARSEABLE");
  });

  it("条件跳过的条数进入报告，供成功日志自证核对过多少条", () => {
    const report = auditCronContract(
      baseInput({
        workers: [skipWorker],
        operationsDoc: skipDoc,
        sources: {
          [WORKER.routeFile]: sourceWith(
            "  for (const item of items) {\n    if (!item.email) {\n      recordMetric(\"cron.digest.skipped\", 1, { unit: \"count\", attributes: { reason: \"no_email\" } });\n      continue;\n    }\n    if (!item.email) {\n      recordMetric(\"cron.digest.skipped\", 1, { unit: \"count\", attributes: { reason: \"no_email\" } });\n      continue;\n    }\n    sent += 1;\n  }",
          ),
        },
      }),
    );
    expect(report.skipBranches).toBe(2);
  });

  it("真实注册表里每个 worker 的 skipMetrics 都是 metrics 的子集", () => {
    for (const worker of CRON_WORKERS) {
      for (const metric of worker.skipMetrics) {
        expect(worker.metrics, `${worker.id} 的 ${metric}`).toContain(metric);
      }
    }
  });
});
