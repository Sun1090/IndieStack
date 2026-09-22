import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCronContractSnapshot,
  collectCronDocs,
  collectCronRouteFiles,
  collectExternalSchedules,
  readPlatformCrons,
  runCronContractCheck,
} from "../../../scripts/lib/cron-contract-check.js";
import { CRON_WORKERS, type CronWorkerContract } from "./cron-contract";

afterEach(() => {
  vi.restoreAllMocks();
});

const DIGEST = CRON_WORKERS.find((worker) => worker.id === "digest") as CronWorkerContract;

// fixture 的指标行由注册表生成：往 `CRON_WORKERS` 加指标不应该让这条 IO 测试变红。
const DIGEST_ROUTE = `
import { recordMetric } from "@/lib/metrics";
import { checkCronAuth } from "@/lib/cron-auth";
import { recordCronRejected } from "@/lib/cron-metrics";

export async function POST() {
  const auth = checkCronAuth(new Headers(), process.env.CRON_SECRET);
  if (auth !== "authorized") {
    recordCronRejected("digest", auth);
    return new Response("Unauthorized", { status: 401 });
  }
${DIGEST.metrics.map((metric) => `  recordMetric("${metric}", 0, { unit: "count" });`).join("\n")}
  return Response.json({ sent: 0 });
}
`;

const OPERATIONS_DOC = `
| cron.auth.rejected | count | worker, reason |
${DIGEST.metrics.map((metric) => `| ${metric} | count | 无 |`).join("\n")}
| /api/cron/digest | \`0 9 * * *\` | 每天 09:00 UTC |
`;

/** 写入一个最小但契约完整的临时仓库，便于验证 IO 层的收集与退出码。 */
function writeFixtureRepository({
  routeContent = DIGEST_ROUTE,
  crons = [{ path: DIGEST.path, schedule: DIGEST.schedule }],
  doc = OPERATIONS_DOC,
}: { routeContent?: string; crons?: { path: string; schedule: string }[]; doc?: string } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cron-contract-"));
  const write = (relativePath: string, content: string): void => {
    const absolute = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content, "utf8");
  };
  write(DIGEST.routeFile, routeContent);
  write(`${path.dirname(DIGEST.routeFile)}/route.test.ts`, 'console.warn("not a route");\n');
  write("vercel.json", `${JSON.stringify({ crons }, null, 2)}\n`);
  write("docs/operations/sentry-alerts.md", doc);
  return root;
}

const FIXTURE_OPTIONS = { workers: [DIGEST], excludedSchedules: {} };

describe("collectCronRouteFiles()", () => {
  it("只收集 route.ts，忽略同目录测试文件", () => {
    const root = writeFixtureRepository();
    expect(collectCronRouteFiles(root)).toEqual([DIGEST.routeFile]);
  });

  it("目录缺失时返回空数组而不是抛错", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cron-contract-empty-"));
    expect(collectCronRouteFiles(root)).toEqual([]);
  });
});

describe("readPlatformCrons()", () => {
  it("读取 vercel.json 的调度，忽略残缺条目", () => {
    const root = writeFixtureRepository({
      crons: [
        { path: DIGEST.path, schedule: DIGEST.schedule },
        { path: "/api/broken" } as { path: string; schedule: string },
      ],
    });
    expect(readPlatformCrons(root)).toEqual([{ path: DIGEST.path, schedule: DIGEST.schedule }]);
  });

  it("缺少 vercel.json 时返回空数组，由规则报「未调度」", () => {
    const root = writeFixtureRepository();
    fs.rmSync(path.join(root, "vercel.json"));
    expect(readPlatformCrons(root)).toEqual([]);
  });
});

describe("buildCronContractSnapshot()", () => {
  it("读取路由源码与运维文档", () => {
    const root = writeFixtureRepository();
    const snapshot = buildCronContractSnapshot(root, FIXTURE_OPTIONS);
    expect(snapshot.routeFiles).toEqual([DIGEST.routeFile]);
    expect((snapshot.sources as Record<string, string>)[DIGEST.routeFile]).toContain(
      "recordCronRejected",
    );
    expect(snapshot.operationsDoc).toContain("cron.auth.rejected");
  });
});

describe("D01 的文档收集", () => {
  it("读真实文档与 workflow schedule，不读构建产物", () => {
    const docs = collectCronDocs();
    expect(docs.map((entry) => entry.path)).toContain("docs-site/email.md");
    expect(docs.some((entry) => entry.path.startsWith("docs/"))).toBe(true);
    expect(docs.some((entry) => entry.path.includes(".vitepress"))).toBe(false);
    expect(docs.some((entry) => entry.path.includes("/dist/"))).toBe(false);
    expect(collectExternalSchedules()).toContain("17 2 * * *");
    // 成功日志必须自报核对面积：不打印篇数就等于「没读文档也算通过」。
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(runCronContractCheck()).toBe(0);
    const output = log.mock.calls.flat().join(" ");
    log.mockRestore();
    expect(output).toMatch(/(\d+) 篇文档里的调度事实都能在仓库里找到对应/);
    expect(Number(/(\d+) 篇文档/.exec(output)?.[1])).toBeGreaterThan(0);
  });
});

describe("runCronContractCheck()", () => {
  it("真实仓库通过：调度、指标与文档一致", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(runCronContractCheck()).toBe(0);
    const output = log.mock.calls.flat().join(" ");
    expect(output).toContain("cron 调度与指标契约通过");
    expect(output).toContain("/api/cron/digest");
    expect(output).toMatch(/\d+ 个指标/);
  });

  it("fixture 仓库通过时报告 worker、指标与豁免数量", () => {
    const root = writeFixtureRepository();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(runCronContractCheck(root, FIXTURE_OPTIONS)).toBe(0);
    expect(log.mock.calls.flat().join(" ")).toContain("1 个 worker（/api/cron/digest）");
  });

  it("vercel.json 少了调度时失败并给出规则码", () => {
    const root = writeFixtureRepository({ crons: [] });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(runCronContractCheck(root, FIXTURE_OPTIONS)).toBe(1);
    const output = error.mock.calls.flat().join("\n");
    expect(output).toContain("[CRON_SCHEDULE_MISSING] digest");
  });

  it("路由丢了拒绝指标时失败", () => {
    const root = writeFixtureRepository({
      routeContent: DIGEST_ROUTE.replace(
        '    recordCronRejected("digest", auth);\n',
        "",
      ),
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(runCronContractCheck(root, FIXTURE_OPTIONS)).toBe(1);
    expect(error.mock.calls.flat().join("\n")).toContain("[CRON_REJECTION_UNOBSERVABLE] digest");
  });

  it("vercel.json 表达式与注册表漂移时失败", () => {
    const root = writeFixtureRepository({
      crons: [{ path: DIGEST.path, schedule: "0 10 * * *" }],
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(runCronContractCheck(root, FIXTURE_OPTIONS)).toBe(1);
    expect(error.mock.calls.flat().join("\n")).toContain("[CRON_SCHEDULE_DRIFT] digest");
  });

  it("出现未注册的 cron 路由时失败", () => {
    const root = writeFixtureRepository();
    const extra = path.join(root, "src/app/api/cron/unknown/route.ts");
    fs.mkdirSync(path.dirname(extra), { recursive: true });
    fs.writeFileSync(extra, "export function GET() { return new Response('ok'); }\n", "utf8");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(runCronContractCheck(root, FIXTURE_OPTIONS)).toBe(1);
    expect(error.mock.calls.flat().join("\n")).toContain("[CRON_ROUTE_UNDECLARED]");
  });

  it("运维文档缺指标时失败", () => {
    const root = writeFixtureRepository({
      doc: OPERATIONS_DOC.replace("| email.backlog | count | 无 |", ""),
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(runCronContractCheck(root, FIXTURE_OPTIONS)).toBe(1);
    expect(error.mock.calls.flat().join("\n")).toContain("[CRON_METRIC_UNDOCUMENTED] email.backlog");
  });

  it("路由里有未计数的条件跳过时失败（A04）", () => {
    const root = writeFixtureRepository({
      routeContent: `${DIGEST_ROUTE}\nfunction skip(items: { email: string | null }[]) {\n  for (const item of items) {\n    if (!item.email) continue;\n  }\n  return 0;\n}\n`,
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(runCronContractCheck(root, FIXTURE_OPTIONS)).toBe(1);
    expect(error.mock.calls.flat().join("\n")).toContain("[CRON_SKIP_UNCOUNTED] digest");
  });

  it("成功日志自核对了多少处条件跳过（A04）", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(runCronContractCheck()).toBe(0);
    const output = log.mock.calls.flat().join(" ");
    const skipped = Number(output.match(/(\d+) 处条件跳过均有计数证据/)?.[1] ?? "0");
    // digest 路由里的两处按用户条件跳过（无邮箱 / 偏好全关）都必须被核对到
    expect(skipped).toBeGreaterThanOrEqual(2);
  });
});
