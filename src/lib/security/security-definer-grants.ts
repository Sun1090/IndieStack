/**
 * Static audit rule for `SECURITY DEFINER` execution grants.
 *
 * PostgreSQL grants EXECUTE on new functions to PUBLIC by default and Supabase's default
 * privileges add anon / authenticated / service_role on top. A `SECURITY DEFINER` function
 * therefore ends up callable through PostgREST `rpc()` for anonymous and signed-in users
 * unless the migration explicitly revokes it. This module finds those functions and requires
 * an explicit revoke — except for the two categories that legitimately need client EXECUTE:
 *
 *   - functions referenced by a row level security policy (policies are evaluated as the
 *     querying role, so revoking EXECUTE makes the policy raise `permission denied`), and
 *   - trigger functions (PostgreSQL refuses direct calls to functions returning `trigger`).
 */

export type SecurityDefinerIssueCode =
  | "SECURITY_DEFINER_MISSING_SEARCH_PATH"
  | "SECURITY_DEFINER_MISSING_EXECUTE_REVOKE"
  | "SECURITY_DEFINER_CLIENT_EXECUTE_GRANTED";

export interface SecurityDefinerIssue {
  code: SecurityDefinerIssueCode;
  function: string;
  fileName: string;
  message: string;
}

export interface SecuritySource {
  fileName: string;
  content: string;
}

const FUNCTION_PATTERN =
  /create\s+(?:or\s+replace\s+)?function\s+public\.([a-z0-9_]+)\s*\(([^)]*)\)([\s\S]*?)(?=\$\$|;)/gi;
const POLICY_PATTERN = /create\s+policy[\s\S]*?;/gi;
const TRIGGER_PATTERN = /create\s+(?:or\s+replace\s+)?trigger[\s\S]*?;/gi;
const REVOKE_PATTERN = /revoke\s+[\s\S]*?;/gi;
const GRANT_PATTERN = /grant\s+[\s\S]*?;/gi;

/** Roles that must not hold EXECUTE on a server-only SECURITY DEFINER function. */
const CLIENT_ROLES = ["public", "anon", "authenticated"] as const;

export interface SecurityDefinerFunction {
  name: string;
  signature: string;
  fileName: string;
  /** `security definer` declared in the definition header. */
  securityDefiner: boolean;
  /** `set search_path = ...` declared in the definition header. */
  pinsSearchPath: boolean;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Extract every `public.*` function definition found across the migration sources, in the
 * order the sources are given (callers pass migrations sorted by version). When the same
 * signature is declared more than once the last definition wins, mirroring `create or
 * replace` semantics at runtime.
 */
export function extractSecurityDefinerFunctions(
  sources: SecuritySource[],
): SecurityDefinerFunction[] {
  const found = new Map<string, SecurityDefinerFunction>();
  for (const source of sources) {
    FUNCTION_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = FUNCTION_PATTERN.exec(source.content)) !== null) {
      const [, name, rawArgs, header] = match;
      const signature = rawArgs.replace(/\s+/g, " ").trim();
      // `create or replace` keeps the ACL but replaces the definition, so the last
      // definition in migration order is the one that exists at runtime.
      const key = `${name}(${signature})`;
      const candidate: SecurityDefinerFunction = {
        name,
        signature,
        fileName: source.fileName,
        securityDefiner: /security\s+definer/i.test(header),
        pinsSearchPath: /set\s+search_path\s*=/i.test(header),
      };
      found.set(key, candidate);
    }
  }
  return [...found.values()];
}

/** True when the function name appears inside a `create policy ... ;` statement. */
export function isReferencedByPolicy(sources: SecuritySource[], name: string): boolean {
  const pattern = new RegExp(`\\b${escapeRegExp(name)}\\s*\\(`, "i");
  for (const source of sources) {
    POLICY_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = POLICY_PATTERN.exec(source.content)) !== null) {
      if (pattern.test(match[0])) return true;
    }
  }
  return false;
}

/** True when a trigger is created with `execute function public.<name>()`. */
export function isTriggerFunction(sources: SecuritySource[], name: string): boolean {
  const pattern = new RegExp(
    `execute\\s+(?:function|procedure)\\s+(?:public\\.)?${escapeRegExp(name)}\\s*\\(`,
    "i",
  );
  for (const source of sources) {
    TRIGGER_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = TRIGGER_PATTERN.exec(source.content)) !== null) {
      if (pattern.test(match[0])) return true;
    }
  }
  return false;
}

/** Roles listed after `from` in a `revoke ... on function ... from <roles>` statement. */
function revokedRoles(statement: string, name: string): string[] | null {
  const onFunction = new RegExp(
    `on\\s+function\\s+public\\.${escapeRegExp(name)}\\s*\\(`,
    "i",
  );
  if (!onFunction.test(statement)) return null;
  const fromMatch = /\bfrom\b([\s\S]*)$/i.exec(statement);
  if (!fromMatch) return null;
  return fromMatch[1]
    .split(",")
    .map((role) => role.replace(/["'`;]/g, "").trim().toLowerCase())
    .filter(Boolean);
}

/** Roles granted EXECUTE via `grant (execute|all) on function public.<name>(...) to <roles>`. */
function grantedRoles(statement: string, name: string): string[] {
  const onFunction = new RegExp(
    `on\\s+function\\s+public\\.${escapeRegExp(name)}\\s*\\(`,
    "i",
  );
  if (!onFunction.test(statement)) return [];
  if (!/^\s*grant\s+(?:execute|all)\b/i.test(statement)) return [];
  const toMatch = /\bto\b([\s\S]*)$/i.exec(statement);
  if (!toMatch) return [];
  return toMatch[1]
    .split(",")
    .map((role) => role.replace(/["'`;]/g, "").trim().toLowerCase())
    .filter(Boolean);
}

function collectStatements(sources: SecuritySource[], pattern: RegExp): string[] {
  const statements: string[] = [];
  for (const source of sources) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source.content)) !== null) statements.push(match[0]);
  }
  return statements;
}

/**
 * Inspect SECURITY DEFINER functions across the migration sources.
 *
 * Fails closed: a SECURITY DEFINER function that is neither policy- nor trigger-referenced
 * must carry an explicit `revoke ... on function public.<name>(...) from public, anon,
 * authenticated` (PUBLIC alone is not enough because Supabase default privileges grant the
 * client roles directly).
 */
export function inspectSecurityDefinerGrants(sources: SecuritySource[]): SecurityDefinerIssue[] {
  const issues: SecurityDefinerIssue[] = [];
  const revokes = collectStatements(sources, REVOKE_PATTERN);
  const grants = collectStatements(sources, GRANT_PATTERN);

  for (const fn of extractSecurityDefinerFunctions(sources)) {
    if (!fn.securityDefiner) continue;
    if (!fn.pinsSearchPath) {
      issues.push({
        code: "SECURITY_DEFINER_MISSING_SEARCH_PATH",
        function: fn.name,
        fileName: fn.fileName,
        message: `public.${fn.name}: SECURITY DEFINER function lacks SET search_path`,
      });
    }

    const needsClientAccess =
      isReferencedByPolicy(sources, fn.name) || isTriggerFunction(sources, fn.name);
    if (needsClientAccess) continue;

    const missing = CLIENT_ROLES.filter((role) => {
      const revoked = revokes.filter((statement) => {
        const roles = revokedRoles(statement, fn.name);
        return roles !== null && roles.includes(role);
      });
      return revoked.length === 0;
    });

    if (missing.length > 0) {
      issues.push({
        code: "SECURITY_DEFINER_MISSING_EXECUTE_REVOKE",
        function: fn.name,
        fileName: fn.fileName,
        message:
          `public.${fn.name}(${fn.signature}): server-only SECURITY DEFINER function must ` +
          `revoke EXECUTE from ${missing.join(", ")} (PostgreSQL grants EXECUTE to PUBLIC by default)`,
      });
    }

    const regranted = grants
      .flatMap((statement) => grantedRoles(statement, fn.name))
      .filter((role) => (CLIENT_ROLES as readonly string[]).includes(role));
    if (regranted.length > 0) {
      issues.push({
        code: "SECURITY_DEFINER_CLIENT_EXECUTE_GRANTED",
        function: fn.name,
        fileName: fn.fileName,
        message: `public.${fn.name}: server-only function must not GRANT EXECUTE to ${
          [...new Set(regranted)].join(", ")
        }`,
      });
    }
  }

  return issues;
}

export function formatSecurityDefinerIssues(issues: SecurityDefinerIssue[]): string {
  return issues.map((issue) => `  - [${issue.code}] ${issue.message}`).join("\n");
}
