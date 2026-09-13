import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildTraceCoverageSnapshot,
  collectTraceBoundaryFiles,
  runTraceCoverageCheck,
} from "../../../scripts/lib/trace-coverage-check.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const TRACED_ACTION = `
import { logActionError } from "@/lib/api-log";

export async function doThing() {
  try {
    return await work();
  } catch (error) {
    logActionError("actions.doThing", error);
    throw error;
  }
}
`;

const PROXY_CONTRACT = `
import { TRACE_HEADER, resolveTraceId } from "@/lib/trace-id";

export function proxy(request) {
  const traceId = resolveTraceId(request.headers.get(TRACE_HEADER));
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(TRACE_HEADER, traceId);
  const response = next({ request: { headers: requestHeaders } });
  response.headers.set(TRACE_HEADER, traceId);
  if (response.status === 302) {
    const redirect = Response.redirect("/login");
    redirect.headers.set(TRACE_HEADER, traceId);
    return redirect;
  }
  return response;
}
`;

const API_LOG_CONTRACT = `
import { getTraceId } from "@/lib/trace";

export function logApiError(scope, error) {
  console.error(scope, error, getTraceId());
}

export function logActionError(scope, error) {
  console.error(scope, error, getTraceId());
}
`;

const TRACE_ID_CONTRACT = `
export const TRACE_HEADER = "x-request-id";
export const MAX_TRACE_ID_LENGTH = 128;
export function normalizeTraceId(value) { return value; }
export function createTraceId() { return "id"; }
export function resolveTraceId(value) { return normalizeTraceId(value) ?? createTraceId(); }
`;

/** 写入一个最小但契约完整的临时仓库，便于验证 IO 层的收集与退出码。 */
function writeFixtureRepository({ actionContent = TRACED_ACTION, withContracts = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "trace-coverage-"));
  const write = (relativePath: string, content: string): void => {
    const absolute = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content, "utf8");
  };
  write("src/lib/actions/things.ts", actionContent);
  write("src/lib/actions/things.test.ts", 'console.error("test file must be ignored");\n');
  write("src/app/api/health/route.ts", "export function GET() { return new Response('ok'); }\n");
  write("src/app/api/nested/deep/route.ts", "export function POST() { return new Response('ok'); }\n");
  write("src/app/api/health/handler.ts", "export function helper() { return 1; }\n");
  if (withContracts) {
    write("src/proxy.ts", PROXY_CONTRACT);
    write("src/lib/api-log.ts", API_LOG_CONTRACT);
    write("src/lib/trace-id.ts", TRACE_ID_CONTRACT);
  }
  return root;
}

describe("collectTraceBoundaryFiles()", () => {
  it("collects route handlers at any depth and skips test files", () => {
    const root = writeFixtureRepository();
    const names = collectTraceBoundaryFiles(root).map((file) => file.fileName);
    expect(names).toEqual([
      "src/app/api/health/route.ts",
      "src/app/api/nested/deep/route.ts",
      "src/lib/actions/things.ts",
    ]);
  });

  it("ignores non-route files under the api tree", () => {
    const root = writeFixtureRepository();
    const names = collectTraceBoundaryFiles(root).map((file) => file.fileName);
    expect(names).not.toContain("src/app/api/health/handler.ts");
  });
});

describe("runTraceCoverageCheck()", () => {
  it("passes against the committed repository", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(runTraceCoverageCheck()).toBe(0);
    const output = log.mock.calls.flat().join(" ");
    expect(output).toContain("请求追踪覆盖校验通过");
    expect(output).toMatch(/\d+ 个服务端边界/);
  });

  it("fails when a boundary file still logs through raw console", () => {
    const root = writeFixtureRepository({
      actionContent: 'export function bad() { console.warn("raw"); }\n',
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(runTraceCoverageCheck(root)).toBe(1);
    const output = error.mock.calls.flat().join("\n");
    expect(output).toContain("[TRACE_RAW_CONSOLE]");
    expect(output).toContain("src/lib/actions/things.ts");
  });

  it("fails closed when a contract file is missing", () => {
    const root = writeFixtureRepository({ withContracts: false });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(runTraceCoverageCheck(root)).toBe(1);
    expect(error.mock.calls.flat().join("\n")).toContain("契约文件缺失");
  });

  it("reports the number of boundaries that use the traced funnels", () => {
    const root = writeFixtureRepository();
    const report = buildTraceCoverageSnapshot(root);
    expect(report.boundaryFiles.map((file) => file.fileName)).toContain(
      "src/lib/actions/things.ts",
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(runTraceCoverageCheck(root)).toBe(0);
    expect(log.mock.calls.flat().join(" ")).toContain("1 个使用带 trace 的错误入口");
  });
});
