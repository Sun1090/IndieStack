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
  "src/app/dashboard/team/page.tsx": {
    sites: 2,
    reason: "debt (C08-b): a failed membership read renders the 'you have no team' empty state.",
  },
  "src/components/shared/permission-gate.tsx": {
    sites: 2,
    reason:
      "justified: client component — a failed role read resolves to the least privileged role on purpose, so the gate must not pretend it can 5xx there.",
  },
  "src/app/api/analytics/route.ts": {
    sites: 1,
    reason:
      "debt (C08-b): a failed time-series read returns an empty chart that looks like unused keys.",
  },
  "src/app/dashboard/billing/page.tsx": {
    sites: 1,
    reason:
      'debt (C08-b): `currentPlan = teamInfo?.plan ?? "free"` — a failed membership read shows the wrong billing tier.',
  },
  "src/lib/actions/api-keys.ts": {
    sites: 1,
    reason:
      'debt (C08-b): a missing key and a failed read both answer the generic `databaseError`, so "not found" is never sayable here.',
  },
  "src/lib/actions/sessions.ts": {
    sites: 1,
    reason:
      "debt (C08-b): a failed session read answers `sessionNotFound` for a session that may still be valid.",
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
 * Unwrap `( … )` and `as unknown` down to the expression actually awaited.
 *
 * `as unknown as T` parses as two casts; the inner one is a stepping stone, so it has to be
 * walked through — otherwise the double-cast spelling, which is exactly how this idiom reaches
 * for a wrong type, hides from the gate.
 */
function unwrapAwait(node: ts.Expression): ts.Expression | undefined {
  let current: ts.Expression = node;
  for (;;) {
    if (ts.isParenthesizedExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isAsExpression(current)) {
      current = current.expression;
      continue;
    }
    break;
  }
  return ts.isAwaitExpression(current) ? current.expression : undefined;
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
