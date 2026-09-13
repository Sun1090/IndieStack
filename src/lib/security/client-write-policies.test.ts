import { describe, expect, it } from "vitest";
import {
  extractEffectivePolicies,
  inspectClientWritePolicies,
  type ClientWriteIssue,
} from "./client-write-policies";
import type { SecuritySource } from "./security-definer-grants";

function source(fileName: string, content: string): SecuritySource {
  return { fileName, content };
}

function codes(issues: ClientWriteIssue[]): string[] {
  return issues.map((issue) => issue.code);
}

/** The pre-029 shape: a role-only INSERT check on the audit table. */
const LEGACY_AUDIT_INSERT_POLICY = `create policy "Audit logs insertable by authenticated users"
  on public.audit_logs for insert
  with check (auth.role() = 'authenticated');`;

describe("extractEffectivePolicies", () => {
  it("parses quoted names, schema-qualified tables, command and roles", () => {
    const [policy] = extractEffectivePolicies([
      source(
        "001_x.sql",
        `create policy "Anyone can submit contact messages"
  on public.contact_messages
  for insert
  to anon, authenticated
  with check (
    char_length(name) between 1 and 100
    and email ~* '^[^@]+@[^@]+$'
  );`,
      ),
    ]);

    expect(policy.name).toBe("Anyone can submit contact messages");
    expect(policy.table).toBe("public.contact_messages");
    expect(policy.command).toBe("insert");
    expect(policy.roles).toEqual(["anon", "authenticated"]);
    expect(policy.withCheck).toContain("char_length(name)");
  });

  it("defaults the policy to all roles and the ALL command when clauses are omitted", () => {
    const [policy] = extractEffectivePolicies([
      source("001_x.sql", `create policy "open" on public.projects using (true);`),
    ]);

    expect(policy.command).toBe("all");
    expect(policy.roles).toEqual(["public"]);
    expect(policy.withCheck).toBeNull();
  });

  it("does not truncate a statement that contains a dollar-quoted block", () => {
    const policies = extractEffectivePolicies([
      source(
        "001_x.sql",
        `do $do$
begin
  perform 1;
end
$do$;

create policy "Users can create own API keys"
  on public.api_keys for insert
  with check (auth.uid() = user_id);`,
      ),
    ]);

    expect(policies).toHaveLength(1);
    expect(policies[0].table).toBe("public.api_keys");
    expect(policies[0].withCheck).toBe("auth.uid() = user_id");
  });

  it("drops earlier definitions when a later migration removes the policy", () => {
    const policies = extractEffectivePolicies([
      source("002_legacy.sql", LEGACY_AUDIT_INSERT_POLICY),
      source(
        "029_lockdown.sql",
        `drop policy if exists "Audit logs insertable by authenticated users" on public.audit_logs;`,
      ),
    ]);

    expect(policies).toHaveLength(0);
  });

  it("keeps unrelated policies when only one is dropped", () => {
    const policies = extractEffectivePolicies([
      source("001_x.sql", LEGACY_AUDIT_INSERT_POLICY),
      source(
        "002_y.sql",
        `create policy "Audit logs viewable by super_admin"
  on public.audit_logs for select
  using (auth.role() = 'authenticated');`,
      ),
      source(
        "029_lockdown.sql",
        `drop policy if exists "Audit logs insertable by authenticated users" on public.audit_logs;`,
      ),
    ]);

    expect(policies.map((policy) => policy.name)).toEqual(["Audit logs viewable by super_admin"]);
  });
});

describe("inspectClientWritePolicies", () => {
  it("flags the legacy audit_logs INSERT policy as a forgery primitive", () => {
    const issues = inspectClientWritePolicies([source("002_rbac_audit.sql", LEGACY_AUDIT_INSERT_POLICY)]);

    expect(codes(issues)).toEqual(["SERVER_ONLY_TABLE_CLIENT_WRITE_POLICY"]);
    expect(issues[0].table).toBe("public.audit_logs");
    expect(issues[0].message).toContain("Audit logs insertable by authenticated users");
  });

  it("flags UPDATE and DELETE policies on a server-only table too", () => {
    const issues = inspectClientWritePolicies([
      source(
        "002_x.sql",
        `create policy "audit update" on public.audit_logs for update to authenticated using (true);
create policy "audit delete" on public.audit_logs for delete to authenticated using (true);`,
      ),
    ]);

    expect(codes(issues)).toEqual([
      "SERVER_ONLY_TABLE_CLIENT_WRITE_POLICY",
      "SERVER_ONLY_TABLE_CLIENT_WRITE_POLICY",
    ]);
  });

  it("allows a super_admin SELECT policy on a server-only table", () => {
    const issues = inspectClientWritePolicies([
      source(
        "002_x.sql",
        `create policy "Audit logs viewable by super_admin"
  on public.audit_logs for select
  using (auth.uid() in (select id from public.profiles where role = 'super_admin'));`,
      ),
    ]);

    expect(issues).toEqual([]);
  });

  it("passes once a later migration drops the policy", () => {
    const issues = inspectClientWritePolicies([
      source("002_rbac_audit.sql", LEGACY_AUDIT_INSERT_POLICY),
      source(
        "029_audit_logs_write_lockdown.sql",
        `drop policy if exists "Audit logs insertable by authenticated users" on public.audit_logs;
revoke insert, update, delete, truncate on public.audit_logs from anon, authenticated;`,
      ),
    ]);

    expect(issues).toEqual([]);
  });

  it("flags an INSERT policy with no WITH CHECK clause", () => {
    const issues = inspectClientWritePolicies([
      source(
        "001_x.sql",
        `create policy "Users can create own notifications"
  on public.notifications for insert to authenticated;`,
      ),
    ]);

    expect(codes(issues)).toEqual(["INSERT_POLICY_MISSING_WITH_CHECK"]);
  });

  it("flags an INSERT policy whose check is literally true", () => {
    const issues = inspectClientWritePolicies([
      source(
        "001_x.sql",
        `create policy "open insert" on public.projects for insert to authenticated with check (true);`,
      ),
    ]);

    expect(codes(issues)).toEqual(["INSERT_POLICY_TRIVIAL_WITH_CHECK"]);
  });

  it("accepts an ownership-scoped INSERT policy", () => {
    const issues = inspectClientWritePolicies([
      source(
        "001_x.sql",
        `create policy "users_insert_own" on public.marketing_subscriptions for insert
  with check (auth.uid() = user_id);`,
      ),
    ]);

    expect(issues).toEqual([]);
  });

  it("ignores INSERT policies that only target service_role", () => {
    const issues = inspectClientWritePolicies([
      source(
        "001_x.sql",
        `create policy "service insert" on public.audit_logs for insert to service_role
  with check (auth.role() = 'service_role');`,
      ),
    ]);

    expect(issues).toEqual([]);
  });
});
