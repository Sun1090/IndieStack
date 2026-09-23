/**
 * Error-channel integrity for Supabase query results (v0.12.0 C08).
 *
 * A Supabase query result is `{ data, error, count }`. `error` is not decoration: it is how the
 * driver reports "I did not answer your question". Two idioms delete that signal, and both are
 * invisible to `tsc` because they are *assertions about* the result rather than uses of it:
 *
 *   const { data: profile } = (await supabase.from("profiles")…single())
 *     as { data: { role: string } | null };      //  ← the asserted type has no `error`
 *
 * The cast does not just hide a warning, it asserts that no error can occur — so the code below
 * is free to treat "read failed" and "row missing" as the same fact. In `lib/auth/guards.ts` that
 * meant a database blip downgraded an admin to `member`, and in `actions/admin.ts` it answered
 * "user not found" for a query that never completed. Nothing was logged, so the user looked
 * wrong and the system looked healthy.
 *
 * This gate is deliberately narrow for its first increment: it only judges **casts applied to an
 * awaited query result**, because that is the idiom that erases the channel the type system was
 * trying to preserve. Client components that fall back to least privilege on purpose are listed
 * in `ERROR_CHANNEL_EXEMPTIONS` with a reason and a site count — an exemption whose count drifts
 * (in either direction) fails, so the debt cannot silently grow or silently rot.
 *
 * It fails closed: no sources, no parsed files, or no awaited query results at all means the
 * scanner is not reading the codebase, which must not be reported as green.
 */

import ts from "typescript";

export interface QueryErrorChannelSource {
  /** Repository-relative POSIX path, e.g. `src/lib/auth/guards.ts`. */
  file: string;
  content: string;
}

export type QueryErrorChannelCode =
  | "QUERY_ERROR_CHANNEL_CAST_AWAY"
  | "QUERY_ERROR_CHANNEL_PARSE"
  | "QUERY_ERROR_CHANNEL_EXEMPT_STALE"
  | "QUERY_ERROR_CHANNEL_NO_SOURCES"
  | "QUERY_ERROR_CHANNEL_SOURCE_EMPTY"
  | "QUERY_ERROR_CHANNEL_VACUOUS";

export interface QueryErrorChannelIssue {
  code: QueryErrorChannelCode;
  file: string;
  line: number;
  message: string;
}

/** What the gate counts as "one file" of evidence, per exemption entry. */
export interface ErrorChannelExemption {
  /** Number of violating sites the file is allowed to keep. */
  sites: number;
  reason: string;
}

/**
 * Files allowed to keep an error-erasing cast, with the reason and the **measured** site count.
 *
 * Two kinds of entry live here, and they mean different things:
 *
 *   - a *justified* entry (`permission-gate.tsx`): the code is right to resolve a failed read to
 *     least privilege, because a client component cannot 5xx. Fixing it would make it worse.
 *   - a *debt* entry (everything else): the code answers a question it did not ask — a failed read
 *     comes back as "no team", "no usage", "not an admin". Each one names where it lies, and
 *     roadmap C08-b drains them, biggest blast radius first.
 *
 * Either way the count is checked in both directions: a new error-erasing cast fails the gate, and
 * so does fixing one without lowering its number, which keeps this list from rotting into a
 * permanent waiver list.
 */
export const ERROR_CHANNEL_EXEMPTIONS: Readonly<Record<string, ErrorChannelExemption>> = {
  "src/components/shared/permission-gate.tsx": {
    sites: 2,
    reason:
      "justified: client component — a failed role read resolves to the least privileged role on purpose, so the gate must not pretend it can 5xx there.",
  },
};

const QUERY_METHODS = new Set(["from", "rpc"]);

/** Does this call expression sit on a chain rooted at `.from()` / `.rpc()`? */
function isQueryChain(node: ts.Node): boolean {
  let current: ts.Node | undefined = node;
  while (current) {
    if (
      ts.isCallExpression(current) &&
      ts.isPropertyAccessExpression(current.expression) &&
      QUERY_METHODS.has(current.expression.name.text)
    ) {
      return true;
    }
    current = ts.isCallLikeExpression(current)
      ? (current as ts.CallExpression).expression
      : ts.isPropertyAccessExpression(current)
        ? current.expression
        : undefined;
  }
  return false;
}

/**
 * Unwrap `( … )`, `as unknown` and `await` down to the expression underneath them.
 *
 * `as unknown as T` parses as two casts; the inner one is a stepping stone, so it has to be
 * walked through — otherwise the double-cast spelling, which is exactly how this idiom reaches
 * for a wrong type, hides from the gate.
 */
function unwrapExpression(node: ts.Expression): { expression: ts.Expression; awaited: boolean } {
  let current: ts.Expression = node;
  let awaited = false;
  for (;;) {
    if (ts.isParenthesizedExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isAsExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isAwaitExpression(current)) {
      awaited = true;
      current = current.expression;
      continue;
    }
    break;
  }
  return { expression: current, awaited };
}

function unwrapAwait(node: ts.Expression): ts.Expression | undefined {
  const unwrapped = unwrapExpression(node);
  return unwrapped.awaited ? unwrapped.expression : undefined;
}

/** Does the asserted type still carry an `error` member? */
function keepsErrorChannel(type: ts.TypeNode): boolean {
  return /(^|[{;,]\s*)error\s*[?]?\s*:/.test(type.getText().replace(/\s*\n\s*/g, " "));
}

export interface QueryErrorChannelStats {
  /** Awaited query results that were found and judged at all. */
  judged: number;
  /** Sites where the awaited result is cast to a type without `error`. */
  casts: { file: string; line: number }[];
  /** Files whose syntax tree is incomplete, so a clean result there means nothing. */
  unparseable: { file: string; line: number; message: string }[];
}

/** Collect the error-erasing casts in one set of sources. */
export function collectErrorChannelCasts(
  sources: readonly QueryErrorChannelSource[],
): QueryErrorChannelStats {
  const stats: QueryErrorChannelStats = { judged: 0, casts: [], unparseable: [] };

  for (const source of sources) {
    const parsed = ts.createSourceFile(source.file, source.content, ts.ScriptTarget.Latest, true);
    const lineOf = (position: number): number => parsed.text.slice(0, position).split("\n").length;

    // A file that does not parse has no cast nodes to walk — reporting it as clean would be the
    // one failure mode worse than a false positive: a gate that silently stops looking.
    // `parseDiagnostics` is a real SourceFile property that the public typings leave out.
    const diagnostics = (parsed as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] })
      .parseDiagnostics;
    for (const diagnostic of diagnostics ?? []) {
      stats.unparseable.push({
        file: source.file,
        line: lineOf(diagnostic.start ?? 0),
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
      });
    }

    const visit = (node: ts.Node): void => {
      // `x as unknown as T` parses as two nested casts; judge only the outer one, because the
      // inner `unknown` is a stepping stone and would double-count every site.
      if (ts.isAsExpression(node) && !(node.parent && ts.isAsExpression(node.parent))) {
        const awaited = unwrapAwait(node.expression);
        if (awaited && isQueryChain(awaited)) {
          stats.judged += 1;
          if (!keepsErrorChannel(node.type)) {
            stats.casts.push({ file: source.file, line: lineOf(node.getStart()) });
          }
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(parsed);
  }

  return stats;
}

/**
 * Judge the sources: report every error-erasing cast that is not covered by a matching exemption.
 */
export function inspectQueryErrorChannel(
  sources: readonly QueryErrorChannelSource[],
): QueryErrorChannelIssue[] {
  const issues: QueryErrorChannelIssue[] = [];

  if (sources.length === 0) {
    issues.push({
      code: "QUERY_ERROR_CHANNEL_NO_SOURCES",
      file: "src",
      line: 0,
      message: "没有读到任何源文件，无法判断错误通道是否被抹掉",
    });
    return issues;
  }

  const readable = sources.filter((source) => source.content.trim().length > 0);
  if (readable.length === 0) {
    issues.push({
      code: "QUERY_ERROR_CHANNEL_SOURCE_EMPTY",
      file: sources[0]?.file ?? "src",
      line: 0,
      message: "所有源文件内容为空，扫描范围被调空",
    });
    return issues;
  }

  const stats = collectErrorChannelCasts(readable);

  // Unparseable files are reported first: everything counted below is only trustworthy for the
  // files the scanner could actually read.
  for (const site of stats.unparseable.slice(0, 10)) {
    issues.push({
      code: "QUERY_ERROR_CHANNEL_PARSE",
      file: site.file,
      line: site.line,
      message: `${site.file}:${site.line} 语法树不完整（${site.message}）：本门禁无法判断该文件的错误通道`,
    });
  }

  if (stats.judged === 0) {
    issues.push({
      code: "QUERY_ERROR_CHANNEL_VACUOUS",
      file: readable[0].file,
      line: 0,
      message:
        `扫描了 ${readable.length} 个文件，一个「awaited 查询结果 + 类型断言」都没判到：` +
        "要么扫描范围变了，要么判定条件被调空",
    });
    return issues;
  }

  return issues.concat(castAwayIssues(stats.casts), staleLedgerIssues(stats.casts));
}

/** Every error-erasing cast in a file whose ledger count does not cover it. */
function castAwayIssues(
  casts: readonly { file: string; line: number }[],
): QueryErrorChannelIssue[] {
  const perFile = countByFile(casts);
  const issues: QueryErrorChannelIssue[] = [];

  for (const [file, found] of perFile) {
    const allowed = ERROR_CHANNEL_EXEMPTIONS[file];
    if (allowed && allowed.sites === found) continue;

    for (const cast of casts) {
      if (cast.file !== file) continue;
      issues.push({
        code: "QUERY_ERROR_CHANNEL_CAST_AWAY",
        file: cast.file,
        line: cast.line,
        message: allowed
          ? `${file}:${cast.line} 抹掉查询结果的 error 通道；该文件登记的台账是 ${allowed.sites} 处，实际 ${found} 处`
          : `${file}:${cast.line} 把 awaited 查询结果断言成不含 error 的类型：读失败与「没有这一行」将变得无法区分`,
      });
    }
  }

  return issues;
}

/**
 * A ledger entry that no longer matches reality must not linger: either the file was cleaned up
 * (entry stale) or its count drifted upward (also reported by `castAwayIssues`, deliberately —
 * the fix is the same either way, and an empty ledger is the goal).
 */
function staleLedgerIssues(casts: readonly { file: string }[]): QueryErrorChannelIssue[] {
  const perFile = countByFile(casts);
  const issues: QueryErrorChannelIssue[] = [];

  for (const [file, allowed] of Object.entries(ERROR_CHANNEL_EXEMPTIONS)) {
    const found = perFile.get(file) ?? 0;
    if (found === allowed.sites) continue;
    issues.push({
      code: "QUERY_ERROR_CHANNEL_EXEMPT_STALE",
      file,
      line: 0,
      message: `${file} 登记台账 ${allowed.sites} 处，实际 ${found} 处：清理后请删掉这条条目`,
    });
  }

  return issues;
}

function countByFile(sites: readonly { file: string }[]): Map<string, number> {
  const perFile = new Map<string, number>();
  for (const site of sites) {
    perFile.set(site.file, (perFile.get(site.file) ?? 0) + 1);
  }
  return perFile;
}

/* ============================================================
 * C08-c 测量：解构 awaited 查询结果时压根不取 `error`
 *
 * 这是 C08 的**邻居**而不是子集：上面那条规则判的是断言（类型上宣称不会有 error），
 * 这一条判的是解构（`const { data } = await supabase.from(...)`）——`error` 从来没被绑进
 * 作用域，所以没有任何断言可看，上面的门禁对着它一直是绿的。
 *
 * **这一版只做测量，不做门禁**（D01 口径：先量到误报，才有依据把判据收紧）。
 * 射程内有三种写法：直接一条链、`cond ? await chain : { data: [] }`、
 * `await Promise.all([chain, …])` 配数组解构。后两种原先判不到——条件那一种是清项目页时撞出来的
 * （清单因此一直报的是下界），`Promise.all` 那一种是顺手一起补的。
 * 还在射程外的两件事，报告页脚会一并打印，免得这份清单被读成「全库只有这些」：
 * - `Promise.all` 之外自造的并发 helper（`allSettled` 之类）不认；
 * - 「绑了 `error` 却从不使用」**故意没有测**：判它要做作用域分析，而全文数同名标识符会把
 *   `catch (error)` 一起数进去，得到一个只会漏报的假指标——一个只会低估的计数比没有计数更糟。
 *
 * 非字面量表名（`.from(TABLE)`）**在**射程内，只是标成 `<非字面量>`：它一直都在，早先那句
 * 「非字面量表名的链不在射程内」是写错的，一并改掉。
 * ============================================================ */

/** 一处 awaited 查询结果的解构读数。 */
export interface UnboundQueryRead {
  file: string;
  line: number;
  /** 链根上的 `.from("<表>")` / `.rpc("<函数>")` 名字，用来说清楚读的是什么。 */
  source: string;
  /** 解构里有没有绑定 `error`（含 `{ error: e }` 这种改名）。 */
  bindsError: boolean;
}

/** 沿调用链走到根上的 `.from()` / `.rpc()`，取它的字面量参数。 */
function queryChainRoot(node: ts.Node): string | undefined {
  let current: ts.Node | undefined = node;
  while (current) {
    if (
      ts.isCallExpression(current) &&
      ts.isPropertyAccessExpression(current.expression) &&
      QUERY_METHODS.has(current.expression.name.text)
    ) {
      const first = current.arguments[0];
      if (first && ts.isStringLiteral(first)) return first.text;
      return "<非字面量>";
    }
    current = ts.isCallLikeExpression(current)
      ? (current as ts.CallExpression).expression
      : ts.isPropertyAccessExpression(current)
        ? current.expression
        : undefined;
  }
  return undefined;
}

/** `{ data, error: e }` 里绑没绑 `error`，看的是**属性名**而不是本地变量名。 */
function bindsErrorChannel(pattern: ts.ObjectBindingPattern): boolean {
  return pattern.elements.some(
    (element) =>
      ts.isBindingElement(element) &&
      (element.propertyName ? element.propertyName.getText() : element.name.getText()).trim() ===
        "error",
  );
}

/** 一处解构对应的一条读取，`node` 用来定位行号。 */
interface QueryReadAnchor {
  source: string;
  bindsError: boolean;
  node: ts.Node;
}

/**
 * `Promise.all([ … ])` 里的那几条 Promise。
 *
 * 参数是**一个数组字面量**，不是可变参数——按 `node.arguments` 配对的话每个文件都只会量到第一条，
 * 那条恰好是个 `ArrayLiteralExpression`，于是链一条也不认识（这条是探针脚本抓出来的）。
 */
function promiseAllPromises(node: ts.Node): readonly ts.Expression[] | undefined {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return undefined;
  if (node.expression.name.text !== "all") return undefined;
  if (node.expression.expression.getText() !== "Promise") return undefined;
  const [only] = node.arguments;
  // 不滤掉数组字面量里的空缺位（`[a, , b]`）：滤掉之后下标就和解构那侧错一位，
  // 配出来的链就不是这条绑定读的那条，读数会变成假的。
  if (only && ts.isArrayLiteralExpression(only)) return only.elements;
  return node.arguments.length > 0 ? node.arguments : undefined;
}

/** 对象解构直接对着一条 awaited 查询链时的那条读数。 */
function readFromChain(
  pattern: ts.Node,
  expression: ts.Expression,
  awaitedByOuter: boolean,
): QueryReadAnchor[] {
  if (!ts.isObjectBindingPattern(pattern)) return [];
  const unwrapped = unwrapAwait(expression);
  const chain = unwrapped ?? (awaitedByOuter ? expression : undefined);
  if (!chain || !isQueryChain(chain)) return [];
  const source = queryChainRoot(chain);
  return source ? [{ source, bindsError: bindsErrorChannel(pattern), node: pattern }] : [];
}

/**
 * 一条 `const { … } = …` 可以对着**几条**读取，所以返回的是列表：
 * - 直接一条链：`const { data } = await supabase.from(…)`；
 * - 条件表达式：`cond ? await chain : { data: [] }`——两支各自判，没有查询的那一支不贡献站点；
 * - `await Promise.all([ … ])` + 数组解构：按下标把元素与链配对，**只判对象解构的元素**
 *   （`const [res] = await Promise.all([chain])` 里 `error` 还挂在 `res` 上，那是「绑了不用」那一档）。
 *
 * `awaitedByOuter` 只为 `await (cond ? chainA : chainB)` 这一种写法存在：`await` 落在括号外，
 * 分支自己不再 await。少了它，`await` 的要求会在这一层悄悄失效。
 */
function readsFromPattern(
  pattern: ts.Node,
  initializer: ts.Expression,
  awaitedByOuter = false,
): QueryReadAnchor[] {
  const direct = readFromChain(pattern, initializer, awaitedByOuter);
  if (direct.length > 0) return direct;

  const unwrapped = unwrapExpression(initializer);
  if (ts.isConditionalExpression(unwrapped.expression)) {
    return [
      ...readsFromPattern(pattern, unwrapped.expression.whenTrue, unwrapped.awaited),
      ...readsFromPattern(pattern, unwrapped.expression.whenFalse, unwrapped.awaited),
    ];
  }

  const elementPromises =
    ts.isArrayBindingPattern(pattern) && unwrapped.awaited
      ? promiseAllPromises(unwrapped.expression)
      : undefined;
  if (!elementPromises || !ts.isArrayBindingPattern(pattern)) return [];

  const reads: QueryReadAnchor[] = [];
  pattern.elements.forEach((element, index) => {
    const argument = elementPromises[index];
    if (!argument || !ts.isBindingElement(element)) return;
    if (!ts.isObjectBindingPattern(element.name)) return;
    // 元素上常常再盖一层 `as unknown as { data: … }`（断言里连 `error` 成员都没有）。
    // 这一族问的不是「断言说了什么」而是「`error` 有没有被绑进作用域」，所以先把断言剥掉再看链；
    // 断言那一半归 C08 的门禁管——它原先对 `Promise.all` 里的断言同样是瞎的。
    const chain = unwrapExpression(argument).expression;
    if (!isQueryChain(chain)) return;
    const source = queryChainRoot(chain);
    if (source)
      reads.push({ source, bindsError: bindsErrorChannel(element.name), node: element.name });
  });
  return reads;
}

/**
 * 收集一批源文件里所有 awaited 查询结果的解构绑定。
 *
 * 返回值带上**被跳过的文件清单**而不是一个数字：一份「全库 12 处」的报告，
 * 如果有 3 个文件根本没被读，那 12 就是假的。
 */
export function collectUnboundErrorChannels(sources: readonly QueryErrorChannelSource[]): {
  sites: UnboundQueryRead[];
  skippedUnparseable: string[];
} {
  const sites: UnboundQueryRead[] = [];
  const skippedUnparseable: string[] = [];

  for (const source of sources) {
    const parsed = ts.createSourceFile(source.file, source.content, ts.ScriptTarget.Latest, true);
    if (
      ((parsed as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [])
        .length > 0
    ) {
      // 解析不动的文件在测量里跳过，但必须出现在报告里：贡献 0 处不等于干净。
      skippedUnparseable.push(source.file);
      continue;
    }

    const visit = (node: ts.Node): void => {
      const destructures =
        ts.isVariableDeclaration(node) &&
        node.initializer !== undefined &&
        (ts.isObjectBindingPattern(node.name) || ts.isArrayBindingPattern(node.name));
      if (destructures) {
        for (const read of readsFromPattern(node.name, node.initializer)) {
          sites.push({
            file: source.file,
            line: parsed.text.slice(0, read.node.getStart()).split("\n").length,
            source: read.source,
            bindsError: read.bindsError,
          });
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(parsed);
  }

  return { sites, skippedUnparseable };
}

/** 测量报告用的分档。 */
export interface UnboundErrorChannelSummary {
  total: number;
  /** `const { data } = await …`：错误通道压根没进作用域。 */
  unbound: UnboundQueryRead[];
  /** 因为语法诊断而被跳过的**文件数**——不为 0 时整份报告不可信。 */
  skippedUnparseable: number;
}

export function summarizeUnboundErrorChannels(collected: {
  sites: readonly UnboundQueryRead[];
  skippedUnparseable: readonly string[];
}): UnboundErrorChannelSummary {
  return {
    total: collected.sites.length,
    unbound: collected.sites.filter((site) => !site.bindsError),
    skippedUnparseable: collected.skippedUnparseable.length,
  };
}
