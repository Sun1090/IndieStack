import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runSupabaseSecurityCheck } from "../../../scripts/lib/supabase-security-check.js";
import {
  extractSecurityDefinerFunctions,
  inspectSecurityDefinerGrants,
  isReferencedByPolicy,
  isTriggerFunction,
  type SecuritySource,
} from "./security-definer-grants";

function source(fileName: string, content: string): SecuritySource {
  return { fileName, content };
}

function cleanupFunction(name: string, extra = ""): string {
  return `create or replace function public.${name}()
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  delete from public.audit_logs where created_at < now() - interval '90 days';
end;
$$;
${extra}`;
}

function codes(issues: ReturnType<typeof inspectSecurityDefinerGrants>): string[] {
  return issues.map((issue) => issue.code);
}

describe("extractSecurityDefinerFunctions", () => {
  it("captures the function name, signature and header flags", () => {
    const [fn] = extractSecurityDefinerFunctions([
      source(
        "001_x.sql",
        `create or replace function public.log_audit_action(
  p_action text,
  p_entity_id text default null
)
returns bigint
language plpgsql
security definer set search_path = ''
as $$
begin
  return 1;
end;
$$;
`,
      ),
    ]);
    expect(fn).toMatchObject({
      name: "log_audit_action",
      signature: "p_action text, p_entity_id text default null",
      securityDefiner: true,
      pinsSearchPath: true,
    });
  });

  it("drops the security definer flag when a later migration replaces the function", () => {
    const functions = extractSecurityDefinerFunctions([
      source(
        "001_x.sql",
        `create function public.f()
returns int
language sql
security definer set search_path = ''
as $$ select 1 $$;
`,
      ),
      source(
        "002_x.sql",
        `create or replace function public.f()
returns int
language sql
as $$ select 2 $$;
`,
      ),
    ]);
    expect(functions).toHaveLength(1);
    expect(functions[0].securityDefiner).toBe(false);
  });
});

describe("isReferencedByPolicy / isTriggerFunction", () => {
  it("detects a function used inside a row level security policy", () => {
    const sources = [
      source(
        "003_x.sql",
        `create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (get_profile_role(auth.uid()) = role);
`,
      ),
    ];
    expect(isReferencedByPolicy(sources, "get_profile_role")).toBe(true);
    expect(isReferencedByPolicy(sources, "cleanup_old_notifications")).toBe(false);
  });

  it("detects trigger functions declared with and without OR REPLACE", () => {
    const sources = [
      source(
        "001_x.sql",
        `create trigger set_updated_at on public.profiles
  before update on public.profiles
  for each row execute function public.handle_updated_at();

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
`,
      ),
    ];
    expect(isTriggerFunction(sources, "handle_new_user")).toBe(true);
    expect(isTriggerFunction(sources, "handle_updated_at")).toBe(true);
    expect(isTriggerFunction(sources, "cleanup_old_notifications")).toBe(false);
  });
});

describe("inspectSecurityDefinerGrants", () => {
  it("requires an explicit revoke for a server-only SECURITY DEFINER function", () => {
    const issues = inspectSecurityDefinerGrants([source("003_x.sql", cleanupFunction("cleanup_x"))]);
    expect(codes(issues)).toEqual(["SECURITY_DEFINER_MISSING_EXECUTE_REVOKE"]);
    expect(issues[0].message).toContain("public, anon, authenticated");
  });

  it("passes once PUBLIC, anon and authenticated are all revoked", () => {
    const issues = inspectSecurityDefinerGrants([
      source("003_x.sql", cleanupFunction("cleanup_x")),
      source(
        "028_x.sql",
        "revoke all on function public.cleanup_x() from public, anon, authenticated;\n" +
          "grant execute on function public.cleanup_x() to service_role;\n",
      ),
    ]);
    expect(issues).toEqual([]);
  });

  it("still fails when only PUBLIC is revoked", () => {
    const issues = inspectSecurityDefinerGrants([
      source("003_x.sql", cleanupFunction("cleanup_x")),
      source("028_x.sql", "revoke all on function public.cleanup_x() from public;\n"),
    ]);
    expect(codes(issues)).toEqual(["SECURITY_DEFINER_MISSING_EXECUTE_REVOKE"]);
    expect(issues[0].message).toContain("anon, authenticated");
  });

  it("flags a revoke that names an unrelated function", () => {
    const issues = inspectSecurityDefinerGrants([
      source("003_x.sql", cleanupFunction("cleanup_x")),
      source("028_x.sql", "revoke all on function public.cleanup_other() from public, anon, authenticated;\n"),
    ]);
    expect(codes(issues)).toEqual(["SECURITY_DEFINER_MISSING_EXECUTE_REVOKE"]);
  });

  it("exempts functions referenced by an RLS policy", () => {
    const issues = inspectSecurityDefinerGrants([
      source(
        "003_x.sql",
        `create policy "p" on public.profiles for update
  using (auth.uid() = id)
  with check (is_team_admin(get_team_owner_id(id)));
`,
      ),
      source(
        "003_y.sql",
        `create or replace function public.is_team_admin(p_team_id uuid)
returns boolean
language sql
security definer set search_path = ''
as $$ select true $$;

create or replace function public.get_team_owner_id(p_team_id uuid)
returns uuid
language sql
security definer set search_path = ''
as $$ select p_team_id $$;
`,
      ),
    ]);
    expect(issues).toEqual([]);
  });

  it("exempts trigger functions", () => {
    const issues = inspectSecurityDefinerGrants([
      source(
        "001_x.sql",
        `create or replace function public.handle_updated_at()
returns trigger
language plpgsql
security definer set search_path = ''
as $$ begin return new; end; $$;

create trigger set_updated_at on public.profiles
  before update on public.profiles
  for each row execute function public.handle_updated_at();
`,
      ),
    ]);
    expect(issues).toEqual([]);
  });

  it("flags a SECURITY DEFINER function that does not pin search_path", () => {
    const issues = inspectSecurityDefinerGrants([
      source(
        "003_x.sql",
        `create or replace function public.cleanup_x()
returns void
language plpgsql
security definer
as $$ begin end; $$;
revoke all on function public.cleanup_x() from public, anon, authenticated;
`,
      ),
    ]);
    expect(codes(issues)).toEqual(["SECURITY_DEFINER_MISSING_SEARCH_PATH"]);
  });

  it("flags a later GRANT EXECUTE that re-opens a server-only function", () => {
    const issues = inspectSecurityDefinerGrants([
      source("003_x.sql", cleanupFunction("cleanup_x")),
      source(
        "028_x.sql",
        `revoke all on function public.cleanup_x() from public, anon, authenticated;
grant execute on function public.cleanup_x() to authenticated;
`,
      ),
    ]);
    expect(codes(issues)).toEqual(["SECURITY_DEFINER_CLIENT_EXECUTE_GRANTED"]);
  });

  it("accepts the committed migrations without findings", () => {
    const migrationDir = path.join(process.cwd(), "supabase", "migrations");
    const sources = fs
      .readdirSync(migrationDir)
      .filter((file) => file.endsWith(".sql"))
      .sort()
      .map((file) => source(file, fs.readFileSync(path.join(migrationDir, file), "utf8")));
    expect(inspectSecurityDefinerGrants(sources)).toEqual([]);
  });
});

describe("runSupabaseSecurityCheck", () => {
  it("passes against the committed repository", () => {
    expect(runSupabaseSecurityCheck()).toBe(0);
  });
});
