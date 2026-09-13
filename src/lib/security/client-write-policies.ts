/**
 * Static audit rule for client-writable RLS policies.
 *
 * Supabase exposes every `public` table through PostgREST, so an RLS policy is the only thing
 * standing between a signed-in browser session and a direct row write. Two shapes are almost
 * always a bug:
 *
 *   - a write policy on a table that only the server is supposed to own (service_role has
 *     BYPASSRLS, so it never needs a policy at all) — `audit_logs` was reachable this way and
 *     let any signed-in user forge audit rows attributed to another user, and
 *   - a permissive INSERT whose `with check` is missing or literally `true`, which accepts an
 *     arbitrary payload for the whole role.
 *
 * The rule is evaluated against the *effective* policy set, i.e. `drop policy` statements in
 * later migrations remove earlier definitions, mirroring what the database ends up with.
 */

import type { SecuritySource } from "./security-definer-grants";

export type ClientWriteIssueCode =
  | "SERVER_ONLY_TABLE_CLIENT_WRITE_POLICY"
  | "INSERT_POLICY_MISSING_WITH_CHECK"
  | "INSERT_POLICY_TRIVIAL_WITH_CHECK";

export interface ClientWriteIssue {
  code: ClientWriteIssueCode;
  table: string;
  policy: string;
  fileName: string;
  message: string;
}

export type PolicyCommand = "select" | "insert" | "update" | "delete" | "all";

export interface PolicyStatement {
  name: string;
  /** Qualified table name, e.g. `public.audit_logs`. */
  table: string;
  command: PolicyCommand;
  /** Roles named after `to`; `public` when the clause is omitted (policy applies to everyone). */
  roles: string[];
  /** Expression of the `using (...)` clause, or null when the policy omits it. */
  using: string | null;
  withCheck: string | null;
  fileName: string;
}

/**
 * Tables written exclusively by the server through the service-role admin client. Any
 * anon / authenticated write policy on these tables is a forgery primitive, so the rule fails
 * closed instead of trying to grade the predicate.
 */
export const SERVER_ONLY_WRITE_TABLES: Record<string, string> = {
  "public.audit_logs": "审计日志只允许服务端（service_role）追加，客户端写入策略会被明文伪造",
};

const CLIENT_ROLES = new Set(["public", "anon", "authenticated"]);

const CREATE_POLICY =
  /create\s+policy\s+(?:"([^"]+)"|'([^']+)'|([a-z0-9_]+))\s+on\s+([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)/gi;
const DROP_POLICY =
  /drop\s+policy\s+(?:if\s+exists\s+)?(?:"([^"]+)"|'([^']+)'|([a-z0-9_]+))\s+on\s+([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)/gi;

interface PolicyEvent {
  index: number;
  kind: "create" | "drop";
  statement: string;
}

function normalizeIdentifier(value: string): string {
  return value.replace(/["'`;]/g, "").trim().toLowerCase();
}

/** Index just past the single-quoted literal that opens at `start` (handles `''` escapes). */
function skipStringLiteral(source: string, start: number): number {
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === "'" && source[index + 1] === "'") {
      index += 2;
      continue;
    }
    if (source[index] === "'") return index + 1;
    index += 1;
  }
  return index;
}

/** Index of the newline that ends the `--` comment starting at `start`. */
function skipLineComment(source: string, start: number): number {
  let index = start;
  while (index < source.length && source[index] !== "\n") index += 1;
  return index;
}

/** The `$tag$` delimiter opening at `index`, or null when it is not a dollar quote. */
function dollarTagAt(source: string, index: number): string | null {
  return /^\$[a-z_]*\$/i.exec(source.slice(index))?.[0] ?? null;
}

/**
 * Find the terminating semicolon of the statement starting at `start`, skipping over string
 * literals, `--` comments, dollar-quoted blocks and nested parentheses. Migrations embed
 * `$do$ ... $do$` blocks that contain their own semicolons, so splitting on `;` is unsafe.
 */
function statementEnd(source: string, start: number): number {
  let index = start;
  let depth = 0;
  let dollarTag: string | null = null;

  while (index < source.length) {
    if (dollarTag) {
      if (source.startsWith(dollarTag, index)) {
        index += dollarTag.length;
        dollarTag = null;
      } else {
        index += 1;
      }
      continue;
    }

    const char = source[index];
    if (char === "'") {
      index = skipStringLiteral(source, index);
      continue;
    }
    if (char === "-" && source[index + 1] === "-") {
      index = skipLineComment(source, index);
      continue;
    }
    const tag = char === "$" ? dollarTagAt(source, index) : null;
    if (tag) {
      dollarTag = tag;
      index += tag.length;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (char === ";" && depth === 0) return index;
    index += 1;
  }
  return source.length;
}

/**
 * Split a migration into complete statements.
 *
 * `statementEnd` already skips string literals, `--` comments, dollar-quoted blocks and
 * nested parentheses, so `;` inside a `$do$ ... $do$` body cannot truncate a statement.
 */
export function splitSqlStatements(content: string): string[] {
  const statements: string[] = [];
  let index = 0;

  while (index < content.length) {
    const char = content[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === "-" && content[index + 1] === "-") {
      index = skipLineComment(content, index);
      continue;
    }
    if (char === "/" && content[index + 1] === "*") {
      const close = content.indexOf("*/", index + 2);
      index = close === -1 ? content.length : close + 2;
      continue;
    }
    const end = statementEnd(content, index);
    const statement = content.slice(index, end).trim();
    if (statement) statements.push(statement);
    index = end + 1;
  }

  return statements;
}

/** Read the parenthesised group that opens at `openIndex`, returning its inner text. */
function readParenGroup(text: string, openIndex: number): string | null {
  if (text[openIndex] !== "(") return null;
  let depth = 0;
  for (let index = openIndex; index < text.length; index += 1) {
    const char = text[index];
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return text.slice(openIndex + 1, index);
    }
  }
  return null;
}

/** Extract the expression of the first `using (...)` or `with check (...)` clause. */
function readClause(statement: string, keyword: RegExp): string | null {
  keyword.lastIndex = 0;
  const match = keyword.exec(statement);
  if (!match) return null;
  const openIndex = statement.indexOf("(", match.index);
  if (openIndex === -1) return null;
  return readParenGroup(statement, openIndex);
}

const WITH_CHECK = /\bwith\s+check\b/gi;
const USING = /\busing\b/gi;
const FOR_COMMAND = /\bfor\s+(select|insert|update|delete|all)\b/i;

/** `using` must be read before `with check` so a predicate mentioning `using` cannot match. */
function readUsingClause(statement: string): string | null {
  WITH_CHECK.lastIndex = 0;
  const withCheckIndex = WITH_CHECK.exec(statement)?.index ?? statement.length;
  return readClause(statement.slice(0, withCheckIndex), USING);
}

function policyColumns(match: RegExpExecArray): { name: string; table: string } {
  return {
    name: match[1] ?? match[2] ?? match[3] ?? "",
    table: `${normalizeIdentifier(match[4])}.${normalizeIdentifier(match[5])}`,
  };
}

function parseCreatePolicy(statement: string, fileName: string): PolicyStatement | null {
  CREATE_POLICY.lastIndex = 0;
  const match = CREATE_POLICY.exec(statement);
  if (!match) return null;
  const { name, table } = policyColumns(match);

  const forMatch = FOR_COMMAND.exec(statement);
  const command = (forMatch?.[1].toLowerCase() ?? "all") as PolicyCommand;
  const rolesStart = forMatch ? forMatch.index + forMatch[0].length : match.index + match[0].length;
  const roleMatch = /\bto\b([\s\S]*?)(?=\busing\b|\bwith\s+check\b|$)/i.exec(
    statement.slice(rolesStart),
  );
  const roles = roleMatch
    ? roleMatch[1].split(",").map(normalizeIdentifier).filter(Boolean)
    : ["public"];

  return {
    name,
    table,
    command,
    roles: roles.length > 0 ? roles : ["public"],
    using: readUsingClause(statement),
    withCheck: readClause(statement, WITH_CHECK),
    fileName,
  };
}

function parseDropPolicy(statement: string): { name: string; table: string } | null {
  DROP_POLICY.lastIndex = 0;
  const match = DROP_POLICY.exec(statement);
  return match ? policyColumns(match) : null;
}

function collectPolicyEvents(content: string): PolicyEvent[] {
  const events: PolicyEvent[] = [];
  for (const [kind, pattern] of [
    ["create", CREATE_POLICY],
    ["drop", DROP_POLICY],
  ] as const) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      const end = statementEnd(content, match.index);
      events.push({ index: match.index, kind, statement: content.slice(match.index, end + 1) });
    }
  }
  return events.sort((left, right) => left.index - right.index);
}

/**
 * Reduce the migration sources to the policies that exist after the last migration runs.
 * Sources must be ordered by version; a `drop policy` removes the matching earlier definition.
 */
export function extractEffectivePolicies(sources: SecuritySource[]): PolicyStatement[] {
  const byKey = new Map<string, PolicyStatement>();
  for (const source of sources) {
    for (const event of collectPolicyEvents(source.content)) {
      if (event.kind === "drop") {
        const dropped = parseDropPolicy(event.statement);
        if (dropped) byKey.delete(`${dropped.table}\u0000${dropped.name}`);
        continue;
      }
      const parsed = parseCreatePolicy(event.statement, source.fileName);
      if (parsed) byKey.set(`${parsed.table}\u0000${parsed.name}`, parsed);
    }
  }
  return [...byKey.values()];
}

function isClientFacing(policy: PolicyStatement): boolean {
  return policy.roles.some((role) => CLIENT_ROLES.has(role));
}

function isTrivialCheck(expression: string | null): boolean {
  return expression !== null && /^\s*\(*\s*true\s*\)*\s*$/i.test(expression);
}

/**
 * Inspect the effective RLS policy set.
 *
 * Fails closed when a server-only table still carries a client-facing write policy, when an
 * INSERT policy omits `with check` (PostgreSQL defaults it to `true`), or when that check is
 * literally `true`.
 */
export function inspectClientWritePolicies(sources: SecuritySource[]): ClientWriteIssue[] {
  const issues: ClientWriteIssue[] = [];

  for (const policy of extractEffectivePolicies(sources)) {
    const reason = SERVER_ONLY_WRITE_TABLES[policy.table];
    if (reason && policy.command !== "select" && isClientFacing(policy)) {
      issues.push({
        code: "SERVER_ONLY_TABLE_CLIENT_WRITE_POLICY",
        table: policy.table,
        policy: policy.name,
        fileName: policy.fileName,
        message:
          `${policy.table}: policy "${policy.name}" grants ${policy.command.toUpperCase()} to ` +
          `${policy.roles.join(", ")} but the table is server-only — ${reason}`,
      });
      continue;
    }

    if (policy.command !== "insert" || !isClientFacing(policy)) continue;

    if (policy.withCheck === null) {
      issues.push({
        code: "INSERT_POLICY_MISSING_WITH_CHECK",
        table: policy.table,
        policy: policy.name,
        fileName: policy.fileName,
        message:
          `${policy.table}: INSERT policy "${policy.name}" has no WITH CHECK clause, so ` +
          `PostgreSQL accepts any row for ${policy.roles.join(", ")}`,
      });
      continue;
    }
    if (isTrivialCheck(policy.withCheck)) {
      issues.push({
        code: "INSERT_POLICY_TRIVIAL_WITH_CHECK",
        table: policy.table,
        policy: policy.name,
        fileName: policy.fileName,
        message:
          `${policy.table}: INSERT policy "${policy.name}" uses WITH CHECK (true), so ` +
          `PostgreSQL accepts any row for ${policy.roles.join(", ")}`,
      });
    }
  }

  return issues;
}

export function formatClientWriteIssues(issues: ClientWriteIssue[]): string {
  return issues.map((issue) => `  - [${issue.code}] ${issue.message}`).join("\n");
}
