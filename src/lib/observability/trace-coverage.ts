/**
 * 请求链路追踪覆盖审计（E02）。
 *
 * 背景：`x-request-id` 由 middleware 生成很容易，难的是「不会随时间漂移」——
 * 新增一个 Server Action 时顺手 `console.error`、新写一个 Route Handler 时直接
 * `logger.error`，日志就会悄悄丢掉请求关联，而这类退化没有任何门禁能发现。
 *
 * 本模块把 E02 的约定固化为可执行规则：
 *
 *   - 服务端边界（Route Handler 与 Server Action）不得使用裸 `console.*`；
 *   - 服务端边界不得直接调用 `logger.error`，错误必须经 `logApiError` /
 *     `logActionError` 这两个带 trace-id 的入口；
 *   - `src/lib/api-log.ts` 必须同时导出两个入口并读取 `getTraceId`；
 *   - `src/lib/trace-id.ts` 必须保留 header 名、归一化、生成与解析四个契约；
 *   - `src/proxy.ts` 必须用 `resolveTraceId` 解析上游 ID、注入请求头并回写响应头，
 *     且不得绕过契约直接使用 `crypto.randomUUID`；
 *   - 空边界集合失败封闭，避免 glob 写错时被当成「零问题」；
 *   - 登记豁免的文件必须真的还需要豁免，过期登记同样失败。
 *
 * 规则只判断「日志是否走了带 trace 的通道」，不判断日志文案质量。
 */

import ts from "typescript";

export interface TraceSource {
  /** 仓库相对 POSIX 路径。 */
  fileName: string;
  content: string;
}

export type TraceIssueCode =
  | "TRACE_RAW_CONSOLE"
  | "TRACE_UNTRACED_ERROR_LOG"
  | "TRACE_FUNNEL_DRIFT"
  | "TRACE_ID_CONTRACT_DRIFT"
  | "TRACE_PROXY_CONTRACT_DRIFT"
  | "TRACE_STALE_EXEMPTION"
  | "TRACE_NO_BOUNDARY_FILES";

export interface TraceIssue {
  code: TraceIssueCode;
  file: string;
  message: string;
}

export interface TraceCoverageInput {
  /** Route Handler 与 Server Action 源码。 */
  boundaryFiles: readonly TraceSource[];
  proxy: TraceSource;
  apiLog: TraceSource;
  traceId: TraceSource;
  /** 允许继续使用裸日志的边界文件（仓库相对路径）→ 理由。 */
  exemptions?: Readonly<Record<string, string>>;
}

export interface TraceCoverageReport {
  issues: TraceIssue[];
  /** 实际参与扫描的边界文件（排序后）。 */
  scannedFiles: string[];
  /** 使用带 trace 入口的边界文件（排序后）。 */
  tracedFiles: string[];
  exemptedFiles: string[];
}

export const TRACE_FUNNEL_PATH = "src/lib/api-log.ts";
export const TRACE_ID_PATH = "src/lib/trace-id.ts";
export const TRACE_PROXY_PATH = "src/proxy.ts";

/** 服务端边界的扫描范围（IO 层按这些 glob 收集文件）。 */
export const TRACE_BOUNDARY_GLOBS = ["src/app/api/**/route.ts", "src/lib/actions/*.ts"] as const;

/** 收集边界文件时必须排除的测试文件（glob 会命中同目录的 `*.test.ts`）。 */
export const TRACE_BOUNDARY_TEST_SUFFIX = ".test.ts";

/** 允许使用裸日志的边界文件。空表表示「所有边界都必须走带 trace 的入口」。 */
export const TRACE_EXEMPT_BOUNDARY_FILES: Readonly<Record<string, string>> = {};

/** `src/lib/trace-id.ts` 必须保留的导出名。 */
export const REQUIRED_TRACE_ID_EXPORTS = [
  "TRACE_HEADER",
  "MAX_TRACE_ID_LENGTH",
  "normalizeTraceId",
  "createTraceId",
  "resolveTraceId",
] as const;

/** `src/lib/api-log.ts` 必须提供的两个带 trace 入口。 */
export const REQUIRED_TRACE_FUNNELS = ["logApiError", "logActionError"] as const;

const TRACE_AWARE_CALLS = new Set<string>(REQUIRED_TRACE_FUNNELS);

function issue(code: TraceIssueCode, file: string, message: string): TraceIssue {
  return { code, file, message };
}

function parse(source: TraceSource): ts.SourceFile {
  return ts.createSourceFile(
    source.fileName,
    source.content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

/** 收集 `console.<level>()` / `logger.error()` 形式的调用位置。 */
function collectCalls(sourceFile: ts.SourceFile, target: "console" | "logger"): string[] {
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const { expression, name } = node.expression;
      if (ts.isIdentifier(expression) && expression.text === target) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        found.push(`${name.text}@${line + 1}:${character + 1}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/** 文件是否使用了带 trace 的错误入口。 */
function usesTraceFunnel(sourceFile: ts.SourceFile): boolean {
  let used = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      TRACE_AWARE_CALLS.has(node.expression.text)
    ) {
      used = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return used;
}

/** 源码里是否出现对某个具名导出的声明（`export function x` / `export const x`）。 */
function declaresExport(content: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`export\\s+(?:async\\s+)?(?:function|const|let|class)\\s+${escaped}\\b`).test(content);
}

function auditBoundaryFiles(
  files: readonly TraceSource[],
  exemptions: Readonly<Record<string, string>>,
  issues: TraceIssue[],
  tracedFiles: string[],
  exemptedFiles: string[],
): void {
  for (const file of files) {
    const exempted = file.fileName in exemptions;
    if (exempted) exemptedFiles.push(file.fileName);

    const sourceFile = parse(file);
    const consoleCalls = collectCalls(sourceFile, "console");
    const loggerErrors = collectCalls(sourceFile, "logger");
    const traced = usesTraceFunnel(sourceFile);
    if (traced) tracedFiles.push(file.fileName);

    if (exempted) continue;

    for (const call of consoleCalls) {
      issues.push(
        issue(
          "TRACE_RAW_CONSOLE",
          file.fileName,
          `服务端边界不得使用裸 console.${call.split("@")[0]}()，请改用 logApiError / logActionError（或登记豁免理由）`,
        ),
      );
    }

    for (const call of loggerErrors) {
      if (!call.startsWith("error@")) continue;
      issues.push(
        issue(
          "TRACE_UNTRACED_ERROR_LOG",
          file.fileName,
          "服务端边界不得直接调用 logger.error()，它不会附带 trace-id；请改用 logApiError / logActionError",
        ),
      );
    }
  }
}

function auditExemptions(
  files: readonly TraceSource[],
  exemptions: Readonly<Record<string, string>>,
  issues: TraceIssue[],
): void {
  const byName = new Map(files.map((file) => [file.fileName, file]));
  for (const [fileName, reason] of Object.entries(exemptions)) {
    const file = byName.get(fileName);
    if (!file) {
      issues.push(
        issue(
          "TRACE_STALE_EXEMPTION",
          fileName,
          "豁免登记指向的边界文件不存在（可能已改名或删除），请更新豁免表",
        ),
      );
      continue;
    }
    if (!reason || reason.trim().length === 0) {
      issues.push(issue("TRACE_STALE_EXEMPTION", fileName, "豁免登记必须写明理由"));
      continue;
    }
    const sourceFile = parse(file);
    const hasRawLog = collectCalls(sourceFile, "console").length > 0;
    if (!hasRawLog) {
      issues.push(
        issue(
          "TRACE_STALE_EXEMPTION",
          fileName,
          "该文件已不再使用裸 console，请删除豁免登记以免掩盖后续漂移",
        ),
      );
    }
  }
}

function auditFunnel(source: TraceSource, issues: TraceIssue[]): void {
  for (const funnel of REQUIRED_TRACE_FUNNELS) {
    if (!declaresExport(source.content, funnel)) {
      issues.push(
        issue("TRACE_FUNNEL_DRIFT", source.fileName, `必须导出带 trace 的错误入口 ${funnel}()`),
      );
    }
  }
  if (!/getTraceId\b/.test(source.content)) {
    issues.push(
      issue("TRACE_FUNNEL_DRIFT", source.fileName, "错误入口必须读取 getTraceId() 以附带 trace-id"),
    );
  }
}

function auditTraceIdContract(source: TraceSource, issues: TraceIssue[]): void {
  for (const name of REQUIRED_TRACE_ID_EXPORTS) {
    if (!declaresExport(source.content, name)) {
      issues.push(
        issue("TRACE_ID_CONTRACT_DRIFT", source.fileName, `trace-id 契约缺少导出 ${name}`),
      );
    }
  }
}

function auditProxy(source: TraceSource, issues: TraceIssue[]): void {
  const content = source.content;
  if (!/resolveTraceId\s*\(/.test(content)) {
    issues.push(
      issue(
        "TRACE_PROXY_CONTRACT_DRIFT",
        source.fileName,
        "proxy 必须用 resolveTraceId() 归一化上游 x-request-id 或生成新 ID",
      ),
    );
  }
  if (/crypto\.randomUUID\s*\(/.test(content)) {
    issues.push(
      issue(
        "TRACE_PROXY_CONTRACT_DRIFT",
        source.fileName,
        "proxy 不得绕过契约直接调用 crypto.randomUUID()，请使用 resolveTraceId()",
      ),
    );
  }
  if (!/from\s+"@\/lib\/trace-id"/.test(content)) {
    issues.push(
      issue(
        "TRACE_PROXY_CONTRACT_DRIFT",
        source.fileName,
        "proxy 必须从 @/lib/trace-id 引入 header 名与解析函数（避免 middleware 引入 next/headers）",
      ),
    );
  }
  if (!/requestHeaders\.set\(\s*TRACE_HEADER\s*,/.test(content)) {
    issues.push(
      issue("TRACE_PROXY_CONTRACT_DRIFT", source.fileName, "proxy 必须把 trace-id 注入下游请求头"),
    );
  }
  // 至少两处响应头回写：正常放行 + 重定向分支；
  const responseWrites = content.match(/\.headers\.set\(\s*TRACE_HEADER\s*,/g) ?? [];
  if (responseWrites.length < 2) {
    issues.push(
      issue(
        "TRACE_PROXY_CONTRACT_DRIFT",
        source.fileName,
        `proxy 必须把 trace-id 回写到响应头（放行与重定向至少各一处），当前只有 ${responseWrites.length} 处`,
      ),
    );
  }
}

/** 审计请求追踪覆盖；返回按文件排序的确定性报告。 */
export function auditTraceCoverage(input: TraceCoverageInput): TraceCoverageReport {
  const issues: TraceIssue[] = [];
  const exemptions = input.exemptions ?? {};
  const boundaryFiles = [...input.boundaryFiles].sort((left, right) =>
    left.fileName.localeCompare(right.fileName),
  );

  if (boundaryFiles.length === 0) {
    issues.push(
      issue(
        "TRACE_NO_BOUNDARY_FILES",
        TRACE_BOUNDARY_GLOBS.join(", "),
        "未发现任何 Route Handler 或 Server Action，扫描范围可能已漂移；请检查 glob",
      ),
    );
  }

  const tracedFiles: string[] = [];
  const exemptedFiles: string[] = [];
  auditBoundaryFiles(boundaryFiles, exemptions, issues, tracedFiles, exemptedFiles);
  auditExemptions(boundaryFiles, exemptions, issues);
  auditFunnel(input.apiLog, issues);
  auditTraceIdContract(input.traceId, issues);
  auditProxy(input.proxy, issues);

  const report: TraceCoverageReport = {
    issues,
    scannedFiles: boundaryFiles.map((file) => file.fileName),
    tracedFiles: [...new Set(tracedFiles)].sort(),
    exemptedFiles: [...new Set(exemptedFiles)].sort(),
  };
  return report;
}

/** 把 issue 渲染成 CLI 输出；保持与其它门禁一致的 `❌ [CODE] file: message` 形态。 */
export function formatTraceIssues(issues: readonly TraceIssue[]): string {
  return issues.map((item) => `❌ [${item.code}] ${item.file}: ${item.message}`).join("\n");
}
