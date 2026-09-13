import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCronContractSnapshot,
  collectCronRouteFiles,
  readPlatformCrons,
  runCronContractCheck,
} from "../../../scripts/lib/cron-contract-check.js";
import { CRON_WORKERS, type CronWorkerContract } from "./cron-contract";

afterEach(() => {
  vi.restoreAllMocks();
});

const DIGEST = CRON_WORKERS.find((worker) => worker.id === "digest") as CronWorkerContract;

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
  recordMetric("email.backlog", 0, { unit: "count" });
  recordMetric("cron.digest.completed", 0, { unit: "ms" });
  recordMetric("cron.digest.failed", 1, {});
  return Response.json({ sent: 0 });
}
`;

const OPERATIONS_DOC = `
| cron.auth.rejected | count | worker, reason |
| email.backlog | count | 无 |
| cron.digest.completed | ms | pulled |
| cron.digest.failed | count | error_type |
| /api/cron/digest | \`0 * * * *\` | 每小时 |
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
      crons: [{ path: DIGEST.path, schedule: "*/5 * * * *" }],
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
});
