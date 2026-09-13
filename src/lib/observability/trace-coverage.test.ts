/**
 * 请求追踪覆盖审计单测（E02）
 * 覆盖：裸 console/logger 检出、豁免校验、funnel 与 trace-id 契约、proxy 契约、空集合失败封闭。
 */
import { describe, it, expect } from "vitest";
import {
  auditTraceCoverage,
  formatTraceIssues,
  REQUIRED_TRACE_FUNNELS,
  REQUIRED_TRACE_ID_EXPORTS,
  TRACE_FUNNEL_PATH,
  TRACE_ID_PATH,
  TRACE_PROXY_PATH,
  type TraceCoverageInput,
  type TraceSource,
} from "./trace-coverage";

const FUNNEL_SOURCE = `import { getTraceId } from "@/lib/trace";
export async function logApiError(scope: string, error: unknown) { await getTraceId(); }
export async function logActionError(scope: string, error: unknown) { await getTraceId(); }
`;

const TRACE_ID_SOURCE = `export const TRACE_HEADER = "x-request-id";
export const MAX_TRACE_ID_LENGTH = 128;
export function normalizeTraceId(raw?: string | null): string | null { return raw ?? null; }
export function createTraceId(): string { return "id"; }
export function resolveTraceId(raw?: string | null): string { return raw ?? "id"; }
`;

const PROXY_SOURCE = `import { TRACE_HEADER, resolveTraceId } from "@/lib/trace-id";
export async function proxy(request: any) {
  const requestId = resolveTraceId(request.headers.get(TRACE_HEADER));
  const requestHeaders = new Headers();
  requestHeaders.set(TRACE_HEADER, requestId);
  const response = makeResponse();
  response.headers.set(TRACE_HEADER, requestId);
  redirect.headers.set(TRACE_HEADER, requestId);
  return response;
}
`;

function source(fileName: string, content: string): TraceSource {
  return { fileName, content };
}

function input(overrides: Partial<TraceCoverageInput> = {}): TraceCoverageInput {
  return {
    boundaryFiles: [source("src/lib/actions/demo.ts", 'import { logActionError } from "@/lib/api-log";\n')],
    proxy: source(TRACE_PROXY_PATH, PROXY_SOURCE),
    apiLog: source(TRACE_FUNNEL_PATH, FUNNEL_SOURCE),
    traceId: source(TRACE_ID_PATH, TRACE_ID_SOURCE),
    ...overrides,
  };
}

function codes(value: TraceCoverageInput): string[] {
  return auditTraceCoverage(value).issues.map((item) => item.code);
}

describe("auditTraceCoverage()", () => {
  it("基线仓库通过且只统计已扫描文件", () => {
    const report = auditTraceCoverage(input());
    expect(report.issues).toEqual([]);
    expect(report.scannedFiles).toEqual(["src/lib/actions/demo.ts"]);
    expect(report.tracedFiles).toEqual([]);
  });

  it("检出服务端边界里的裸 console", () => {
    const report = auditTraceCoverage(
      input({
        boundaryFiles: [
          source(
            "src/lib/actions/demo.ts",
            'export async function run() { try { await go(); } catch (error) { console.error("boom", error); } }\n',
          ),
        ],
      }),
    );
    expect(report.issues.map((item) => item.code)).toEqual(["TRACE_RAW_CONSOLE"]);
    expect(report.issues[0].message).toContain("console.error()");
    expect(report.issues[0].message).toContain("logActionError");
  });

  it("分别检出 console.warn 与 console.log", () => {
    const report = auditTraceCoverage(
      input({
        boundaryFiles: [
          source("src/lib/actions/demo.ts", 'console.warn("w");\nconsole.log("l");\n'),
        ],
      }),
    );
    expect(report.issues.map((item) => item.code)).toEqual([
      "TRACE_RAW_CONSOLE",
      "TRACE_RAW_CONSOLE",
    ]);
  });

  it("检出边界文件里直接调用 logger.error", () => {
    const report = auditTraceCoverage(
      input({
        boundaryFiles: [
          source(
            "src/lib/actions/demo.ts",
            'import { logger } from "@/lib/logger";\nlogger.error("boom", undefined, new Error("x"));\n',
          ),
        ],
      }),
    );
    expect(report.issues.map((item) => item.code)).toEqual(["TRACE_UNTRACED_ERROR_LOG"]);
    expect(report.issues[0].message).toContain("logApiError / logActionError");
  });

  it("允许边界文件使用 logger.info/warn（非错误级别）", () => {
    const report = auditTraceCoverage(
      input({
        boundaryFiles: [
          source(
            "src/lib/actions/demo.ts",
            'import { logger } from "@/lib/logger";\nlogger.info("ok");\nlogger.warn("slow");\n',
          ),
        ],
      }),
    );
    expect(report.issues).toEqual([]);
  });

  it("统计使用带 trace 入口的边界文件", () => {
    const report = auditTraceCoverage(
      input({
        boundaryFiles: [
          source(
            "src/lib/actions/demo.ts",
            'import { logActionError } from "@/lib/api-log";\nawait logActionError("boom", error);\n',
          ),
          source("src/lib/actions/plain.ts", "export const value = 1;\n"),
        ],
      }),
    );
    expect(report.tracedFiles).toEqual(["src/lib/actions/demo.ts"]);
  });

  it("空边界集合失败封闭", () => {
    const report = auditTraceCoverage(input({ boundaryFiles: [] }));
    expect(report.issues.map((item) => item.code)).toEqual(["TRACE_NO_BOUNDARY_FILES"]);
  });

  it("豁免文件跳过裸 console 检查但仍然登记", () => {
    const report = auditTraceCoverage(
      input({
        boundaryFiles: [source("src/lib/actions/demo.ts", 'console.error("boom");\n')],
        exemptions: { "src/lib/actions/demo.ts": "启动期无请求上下文" },
      }),
    );
    expect(report.issues).toEqual([]);
    expect(report.exemptedFiles).toEqual(["src/lib/actions/demo.ts"]);
  });

  it("豁免登记指向不存在文件时失败", () => {
    const report = auditTraceCoverage(
      input({ exemptions: { "src/lib/actions/ghost.ts": "理由" } }),
    );
    expect(report.issues.map((item) => item.code)).toEqual(["TRACE_STALE_EXEMPTION"]);
  });

  it("豁免理由为空时失败", () => {
    const report = auditTraceCoverage(
      input({
        boundaryFiles: [source("src/lib/actions/demo.ts", 'console.error("boom");\n')],
        exemptions: { "src/lib/actions/demo.ts": "   " },
      }),
    );
    expect(report.issues.map((item) => item.code)).toEqual(["TRACE_STALE_EXEMPTION"]);
  });

  it("豁免已不再需要时失败（防止掩盖后续漂移）", () => {
    const report = auditTraceCoverage(
      input({
        boundaryFiles: [
          source(
            "src/lib/actions/demo.ts",
            'import { logActionError } from "@/lib/api-log";\nlogActionError("x", new Error("y"));\n',
          ),
        ],
        exemptions: { "src/lib/actions/demo.ts": "曾经需要" },
      }),
    );
    expect(report.issues.map((item) => item.code)).toEqual(["TRACE_STALE_EXEMPTION"]);
  });

  it("缺少错误入口导出时报告 funnel 漂移", () => {
    for (const funnel of REQUIRED_TRACE_FUNNELS) {
      const broken = FUNNEL_SOURCE.replace(`export async function ${funnel}`, `async function ${funnel}`);
      const report = auditTraceCoverage(input({ apiLog: source(TRACE_FUNNEL_PATH, broken) }));
      expect(report.issues.map((item) => item.code)).toEqual(["TRACE_FUNNEL_DRIFT"]);
      expect(report.issues[0].message).toContain(funnel);
    }
  });

  it("错误入口不读取 getTraceId 时报告 funnel 漂移", () => {
    const report = auditTraceCoverage(
      input({ apiLog: source(TRACE_FUNNEL_PATH, FUNNEL_SOURCE.replace(/getTraceId/g, "noop")) }),
    );
    expect(report.issues.map((item) => item.code)).toEqual(["TRACE_FUNNEL_DRIFT"]);
    expect(report.issues[0].message).toContain("getTraceId");
  });

  it("trace-id 契约缺少任一导出时失败封闭", () => {
    for (const name of REQUIRED_TRACE_ID_EXPORTS) {
      const broken = TRACE_ID_SOURCE.replace(new RegExp(`^export (const|function) ${name}.*$`, "m"), "");
      const report = auditTraceCoverage(input({ traceId: source(TRACE_ID_PATH, broken) }));
      expect(report.issues.map((item) => item.code)).toEqual(["TRACE_ID_CONTRACT_DRIFT"]);
      expect(report.issues[0].message).toContain(name);
    }
  });

  it("proxy 绕过 resolveTraceId 时报告契约漂移", () => {
    const broken = PROXY_SOURCE.replace("resolveTraceId(", "crypto.randomUUID(").replace(
      /^import .*$/m,
      'import { TRACE_HEADER } from "@/lib/trace-id";',
    );
    const report = auditTraceCoverage(input({ proxy: source(TRACE_PROXY_PATH, broken) }));
    const messages = report.issues.map((item) => item.message).join("\n");
    expect(report.issues.every((item) => item.code === "TRACE_PROXY_CONTRACT_DRIFT")).toBe(true);
    expect(messages).toContain("resolveTraceId()");
    expect(messages).toContain("crypto.randomUUID()");
  });

  it("proxy 不回写响应头时报告契约漂移", () => {
    const broken = PROXY_SOURCE.replace(/\n\s*(response|redirect)\.headers\.set\(TRACE_HEADER, requestId\);/g, "");
    const report = auditTraceCoverage(input({ proxy: source(TRACE_PROXY_PATH, broken) }));
    expect(report.issues.map((item) => item.code)).toEqual(["TRACE_PROXY_CONTRACT_DRIFT"]);
    expect(report.issues[0].message).toContain("回写");
  });

  it("proxy 从错误模块引入 header 名时报告契约漂移", () => {
    const broken = PROXY_SOURCE.replace('"@/lib/trace-id"', '"next/headers"');
    const report = auditTraceCoverage(input({ proxy: source(TRACE_PROXY_PATH, broken) }));
    const messages = report.issues.map((item) => item.message).join("\n");
    expect(messages).toContain("@/lib/trace-id");
  });

  it("formatTraceIssues 渲染规则码与文件", () => {
    expect(
      formatTraceIssues([{ code: "TRACE_RAW_CONSOLE", file: "a.ts", message: "裸日志" }]),
    ).toBe("❌ [TRACE_RAW_CONSOLE] a.ts: 裸日志");
  });
});
