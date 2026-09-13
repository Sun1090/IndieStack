/**
 * Static RLS coverage audit across every `public` table in the migrations.
 *
 * `check:rls` originally reduced the migrations with a regex that captured the policy name as
 * `"?([\w-]+)"?`, i.e. a single word. Every policy in this repo is named with spaces
 * (`"Users can view own profile"`), so the name silently collapsed to `Users` and policies on
 * the same table overwrote each other in the final-state map. The gate still passed while
 * validating only one policy per table. This module replaces that reduction with the quoted
 * name handling from `client-write-policies.ts` and adds the "whole table" rules:
 *
 *   - every table created in `public` must reach a final state with RLS enabled;
 *   - `select` / `delete` policies must pin the visible rows with `using`;
 *   - `insert` / `update` / `all` policies must pin the accepted rows with `with check`
 *     (PostgreSQL defaults a missing `WITH CHECK` to `true`);
 *   - every table must be *classified*: either it carries at least one effective policy, or it
 *     is declared server-only below. A new table that nobody classified fails closed instead of
 *     shipping an accidental deny-all (or an accidental wide-open policy);
 *   - a declared server-only table must stay policy-free — a policy appearing on one is a
 *     deliberate access widening and must be reviewed here.
 */

import {
  extractEffectivePolicies,
  splitSqlStatements,
  type PolicyCommand,
  type PolicyStatement,
} from "./client-write-policies.ts";
import type { SecuritySource } from "./security-definer-grants";

export type RlsCoverageIssueCode =
  | "TABLE_MISSING_RLS"
  | "POLICY_MISSING_USING"
  | "POLICY_MISSING_WITH_CHECK"
  | "TABLE_UNCLASSIFIED"
  | "SERVER_ONLY_TABLE_HAS_POLICY";

export interface RlsCoverageIssue {
  code: RlsCoverageIssueCode;
  table: string;
  policy?: string;
  fileName?: string;
  message: string;
}

/**
 * Tables that must stay readable only through the service-role admin client.
 *
 * RLS is enabled and **no** policy exists, so PostgREST returns zero rows and rejects writes for
 * `anon` / `authenticated`; `service_role` has `BYPASSRLS` and never needs a policy. The value is
 * the reason the table is intentionally deny-all, mirroring `SERVER_ONLY_WRITE_TABLES`.
 */
export const SERVER_ONLY_TABLES: Record<string, string> = {
  "public.email_worker_runs": "邮件 digest worker 的运行记录，只由 cron 路由写入与读取",
  "public.mfa_recovery_codes": "MFA 恢复码哈希，只允许服务端校验与轮换，客户端读写都会泄露第二因子",
  "public.push_delivery_attempts": "Push 投递重试队列，只由 push-retry worker 处理",
  "public.webhook_events": "支付 webhook 事件日志，只由 webhook 路由写入与后台读取",
};

const CREATE_TABLE =
  /^create\s+table\s+(?:if\s+not\s+exists\s+)?(?:(?:public)\s*\.\s*)?"?([a-z_][a-z0-9_]*)"?/i;
const ALTER_TABLE_RLS =
  /^alter\s+table\s+(?:if\s+exists\s+)?(?:(?:public)\s*\.\s*)?"?([a-z_][a-z0-9_]*)"?[\s\S]*?\b(disable|enable)\s+row\s+level\s+security/i;

/** Commands whose policy needs `with check` to bound the rows a client may write. */
const NEEDS_WITH_CHECK = new Set<PolicyCommand>(["insert", "update", "all"]);
/** Commands whose policy needs `using` to bound the rows a client may see or remove. */
const NEEDS_USING = new Set<PolicyCommand>(["select", "delete"]);

interface TableState {
  table: string;
  rlsEnabled: boolean;
  /** Migration file that created the table, for issue attribution. */
  fileName: string;
}

function qualify(name: string): string {
  return `public.${name.toLowerCase()}`;
}

function collectTables(sources: SecuritySource[]): Map<string, TableState> {
  const tables = new Map<string, TableState>();

  for (const source of sources) {
    for (const statement of splitSqlStatements(source.content)) {
      const created = CREATE_TABLE.exec(statement);
      if (created) {
        const table = qualify(created[1]);
        if (!tables.has(table)) tables.set(table, { table, rlsEnabled: false, fileName: source.fileName });
      }

      const altered = ALTER_TABLE_RLS.exec(statement);
      if (altered) {
        const state = tables.get(qualify(altered[1]));
        if (state) state.rlsEnabled = altered[2].toLowerCase() === "enable";
      }
    }
  }

  return tables;
}

function missingClauseIssues(policy: PolicyStatement): RlsCoverageIssue[] {
  const issues: RlsCoverageIssue[] = [];

  if (NEEDS_USING.has(policy.command) && policy.using === null) {
    issues.push({
      code: "POLICY_MISSING_USING",
      table: policy.table,
      policy: policy.name,
      fileName: policy.fileName,
      message:
        `${policy.table}: ${policy.command.toUpperCase()} policy "${policy.name}" has no USING ` +
        `clause for ${policy.roles.join(", ")}, so every row is matched`,
    });
  }

  if (NEEDS_WITH_CHECK.has(policy.command) && policy.withCheck === null) {
    issues.push({
      code: "POLICY_MISSING_WITH_CHECK",
      table: policy.table,
      policy: policy.name,
      fileName: policy.fileName,
      message:
        `${policy.table}: ${policy.command.toUpperCase()} policy "${policy.name}" has no ` +
        `WITH CHECK clause for ${policy.roles.join(", ")}, and PostgreSQL defaults it to true`,
    });
  }

  return issues;
}

function classifyTables(
  tables: Map<string, TableState>,
  policies: PolicyStatement[],
): RlsCoverageIssue[] {
  const issues: RlsCoverageIssue[] = [];
  const withPolicies = new Set(policies.map((policy) => policy.table));

  for (const state of tables.values()) {
    if (!state.rlsEnabled) {
      issues.push({
        code: "TABLE_MISSING_RLS",
        table: state.table,
        fileName: state.fileName,
        message: `${state.table}: created in ${state.fileName} but RLS is never enabled`,
      });
      continue;
    }

    const reason = SERVER_ONLY_TABLES[state.table];
    if (reason && withPolicies.has(state.table)) {
      issues.push({
        code: "SERVER_ONLY_TABLE_HAS_POLICY",
        table: state.table,
        message:
          `${state.table}: declared server-only (${reason}) but an effective RLS policy exists — ` +
          `the table is reachable through PostgREST again`,
      });
      continue;
    }

    if (!reason && !withPolicies.has(state.table)) {
      issues.push({
        code: "TABLE_UNCLASSIFIED",
        table: state.table,
        message:
          `${state.table}: RLS is enabled but no policy exists and the table is not declared ` +
          `server-only, so anon/authenticated silently read nothing`,
      });
    }
  }

  return issues;
}

/** Inspect every `public` table derived from the ordered migration sources. */
export function inspectRlsCoverage(sources: SecuritySource[]): RlsCoverageIssue[] {
  const tables = collectTables(sources);
  const policies = extractEffectivePolicies(sources).filter((policy) =>
    policy.table.startsWith("public."),
  );

  return [
    ...classifyTables(tables, policies),
    ...policies.flatMap((policy) => missingClauseIssues(policy)),
  ];
}

export function formatRlsCoverageIssues(issues: RlsCoverageIssue[]): string {
  return issues.map((issue) => `  - [${issue.code}] ${issue.message}`).join("\n");
}
