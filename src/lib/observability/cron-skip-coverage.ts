/**
 * cron worker 的「跳过必须可见」契约（v0.12.0 A04）。
 *
 * 来源是一个真实 P0：`/api/cron/digest` 曾经用 `if (!isDigestHour(...)) { deferred += ...; continue; }`
 * 按用户时区跳过投递。跳过本身没有错，错在**静默**——那一轮在指标上表现为
 * `pulled=N, sent=0, failed=0` 的「成功」，看板上完全看不出除一个时区带外没人被投递。
 * PR #59 补了指标，但那是事后补救：门禁无法阻止下一条这样的分支被写进来。
 *
 * 本模块把这条教训变成静态规则：worker 路由里**每一条带条件的 `continue`** 都必须
 * 在同一个分支里留下计数证据，证据有两种：
 *
 *   1. `recordMetric("<注册在 skipMetrics 里的指标>", n, { attributes: { reason: "..." } })`
 *      —— 上报被跳过的条数，且带 `reason` 维度（没有 reason 的跳过计数无法排查）；
 *   2. 对该轮结果对象里已有的计数器做 `+=`（例如 `failed += items.length`）——
 *      这条不是「跳过」，它变成了另一个已经落表/上报的数。
 *
 * 故意只覆盖 `continue` 这一种形状：它正是那次事故的形状。其它控制流（提前 `return`、
 * 抛异常）已由 `CRON_METRIC_MISSING` 与 `CRON_REJECTION_UNOBSERVABLE` 覆盖，
 * 在这里重复判断只会让规则变成猜谜。
 *
 * 规则本体是纯函数（不读文件系统），IO 在 `scripts/lib/cron-contract-check.js`。
 */

import ts from "typescript";

/** 一条带条件的 `continue` 分支。 */
export interface SkipBranch {
  /** `continue` 所在行（1 基）。 */
  line: number;
  /** 跳过条件的源码文本，用于报错定位。 */
  condition: string;
}

export interface SkipAuditInput {
  /** 路由源码。 */
  source: string;
  /** 仓库相对路径，只用于报错与行号计算。 */
  fileName: string;
  /** 注册表里声明的跳过计数指标（必须是该 worker 的指标子集）。 */
  skipMetrics: readonly string[];
}

export interface SkipAuditResult {
  /** 路由里全部带条件的 `continue` 分支。 */
  total: number;
  /** 缺少计数证据的分支。 */
  uncounted: SkipBranch[];
  /** 上报了 skip 指标但缺 `reason` 维度的分支。 */
  reasonMissing: SkipBranch[];
}

/** 分支里出现的 `recordMetric("<skipMetric>", ...)` 调用（返回该调用的实参对象文本）。 */
function skipMetricCallArguments(
  node: ts.Node,
  skipMetrics: ReadonlySet<string>,
): { attributesText: string | null } | null {
  let found: { attributesText: string | null } | null = null;
  const visit = (current: ts.Node): void => {
    if (found) return;
    if (
      ts.isCallExpression(current) &&
      ts.isIdentifier(current.expression) &&
      current.expression.text === "recordMetric"
    ) {
      const name = current.arguments[0];
      if (ts.isStringLiteral(name) && skipMetrics.has(name.text)) {
        const options = current.arguments[2];
        found = { attributesText: options && ts.isObjectLiteralExpression(options) ? options.getText() : null };
        return;
      }
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

/** 函数体 `return { … }` 里出现的属性名——这些计数器会随响应/落表可见。 */
function returnedCounterNames(functionNode: ts.Node): Set<string> {
  const names = new Set<string>();
  const visit = (current: ts.Node): void => {
    if (ts.isReturnStatement(current) && current.expression && ts.isObjectLiteralExpression(current.expression)) {
      for (const property of current.expression.properties) {
        if (ts.isShorthandPropertyAssignment(property)) {
          names.add(property.name.text);
        } else if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name)) {
          names.add(property.name.text);
        }
      }
    }
    ts.forEachChild(current, visit);
  };
  visit(functionNode);
  return names;
}

/** 分支里是否对该轮已上报的计数器做了 `+=`。 */
function incrementsReportedCounter(
  node: ts.Node,
  counters: Set<string>,
): boolean {
  let found = false;
  const visit = (current: ts.Node): void => {
    if (found) return;
    if (
      ts.isBinaryExpression(current) &&
      current.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken &&
      ts.isIdentifier(current.left) &&
      counters.has(current.left.text)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

function nearestFunction(node: ts.Node): ts.Node | null {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current) ||
      ts.isMethodDeclaration(current)
    ) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

/** 从 `continue` 往上找同一函数内的最近 `if`；跨函数不认。 */
function nearestEnclosingIf(node: ts.Node, functionNode: ts.Node): ts.IfStatement | null {
  let current: ts.Node | undefined = node.parent;
  while (current && current !== functionNode) {
    if (ts.isIfStatement(current)) return current;
    current = current.parent;
  }
  return null;
}

/**
 * 审计一个 worker 路由里的条件跳过分支。
 *
 * 解析失败时返回 `null`：让调用方按「无法核对」失败封闭，而不是把语法错误当成没有跳过。
 */
export function auditCronSkips(input: SkipAuditInput): SkipAuditResult | null {
  const sourceFile = ts.createSourceFile(
    input.fileName,
    input.source,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TSX,
  );
  // 语法错误会以 parse diagnostics 形式出现；这里用文本长度做最小判断：
  // 只要存在解析诊断就认为无法核对。
  const diagnostics = (sourceFile as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
  if (diagnostics.length > 0) return null;

  const skipMetrics = new Set(input.skipMetrics);
  const counters = new Map<ts.Node, Set<string>>();
  const uncounted: SkipBranch[] = [];
  const reasonMissing: SkipBranch[] = [];
  let total = 0;

  const countersFor = (functionNode: ts.Node): Set<string> => {
    const cached = counters.get(functionNode);
    if (cached) return cached;
    const created = returnedCounterNames(functionNode);
    counters.set(functionNode, created);
    return created;
  };

  const visit = (node: ts.Node): void => {
    if (ts.isContinueStatement(node)) {
      const functionNode = nearestFunction(node);
      const ifStatement = functionNode ? nearestEnclosingIf(node, functionNode) : null;
      if (functionNode && ifStatement) {
        total += 1;
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        const branch = ifStatement.thenStatement;
        const skipCall = skipMetricCallArguments(branch, skipMetrics);
        if (!skipCall && incrementsReportedCounter(branch, countersFor(functionNode))) {
          // 计入响应计数器：这条不是静默跳过
        } else if (!skipCall) {
          uncounted.push({ line, condition: ifStatement.expression.getText() });
        } else if (!skipCall.attributesText?.includes("reason")) {
          reasonMissing.push({ line, condition: ifStatement.expression.getText() });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return { total, uncounted, reasonMissing };
}

/** 把审计结果转换成注册表用的问题条目（由 `cron-contract.ts` 合并进报告）。 */
export function formatSkipFindings(result: SkipAuditResult, routeFile: string): string[] {
  const lines: string[] = [];
  for (const finding of result.uncounted) {
    lines.push(`${routeFile}:${finding.line} 条件跳过未上报计数：${finding.condition}`);
  }
  for (const finding of result.reasonMissing) {
    lines.push(`${routeFile}:${finding.line} 跳过计数缺少 reason 维度：${finding.condition}`);
  }
  return lines;
}
