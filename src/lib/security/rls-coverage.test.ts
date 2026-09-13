import { describe, expect, it } from "vitest";
import { inspectRlsCoverage, type RlsCoverageIssue } from "./rls-coverage";
import type { SecuritySource } from "./security-definer-grants";

function source(fileName: string, content: string): SecuritySource {
  return { fileName, content };
}

function codes(issues: RlsCoverageIssue[]): string[] {
  return issues.map((issue) => issue.code);
}

function find(issues: RlsCoverageIssue[], code: string, table?: string): RlsCoverageIssue | undefined {
  return issues.find((issue) => issue.code === code && (table === undefined || issue.table === table));
}

const TEAMS_TABLE = `create table public.teams (id uuid primary key);
alter table public.teams enable row level security;`;

describe("inspectRlsCoverage", () => {
  it("accepts a table with RLS enabled and a bounded select policy", () => {
    const issues = inspectRlsCoverage([
      source(
        "001_x.sql",
        `${TEAMS_TABLE}
create policy "Team members can view their team" on public.teams for select
  using (id in (select team_id from public.team_members where user_id = auth.uid()));`,
      ),
    ]);

    expect(issues).toEqual([]);
  });

  it("flags a table that never enables RLS", () => {
    const issues = inspectRlsCoverage([
      source("001_x.sql", `create table public.widgets (id uuid primary key);`),
    ]);

    expect(codes(issues)).toContain("TABLE_MISSING_RLS");
    expect(find(issues, "TABLE_MISSING_RLS", "public.widgets")?.fileName).toBe("001_x.sql");
  });

  it("flags a table that enables RLS but is neither policied nor declared server-only", () => {
    const issues = inspectRlsCoverage([
      source("001_x.sql", `create table public.widgets (id uuid primary key);
alter table public.widgets enable row level security;`),
    ]);

    expect(codes(issues)).toEqual(["TABLE_UNCLASSIFIED"]);
  });

  it("accepts a declared server-only table that stays policy-free", () => {
    const issues = inspectRlsCoverage([
      source(
        "010_x.sql",
        `create table public.webhook_events (id uuid primary key, event_id text not null unique);
alter table public.webhook_events enable row level security;`,
      ),
    ]);

    expect(issues).toEqual([]);
  });

  it("flags a policy appearing on a server-only table", () => {
    const issues = inspectRlsCoverage([
      source(
        "010_x.sql",
        `create table public.webhook_events (id uuid primary key);
alter table public.webhook_events enable row level security;
create policy "anyone reads events" on public.webhook_events for select using (true);`,
      ),
    ]);

    expect(codes(issues)).toEqual(["SERVER_ONLY_TABLE_HAS_POLICY"]);
  });

  it("flags select and delete policies without a using clause", () => {
    const issues = inspectRlsCoverage([
      source(
        "002_x.sql",
        `${TEAMS_TABLE}
create policy "Team members can view members" on public.teams for select;
create policy "Team admins can remove members" on public.teams for delete;`,
      ),
    ]);

    expect(codes(issues).filter((code) => code === "POLICY_MISSING_USING")).toHaveLength(2);
  });

  it("flags insert, update and all policies without a with check clause", () => {
    const issues = inspectRlsCoverage([
      source(
        "002_x.sql",
        `${TEAMS_TABLE}
create policy "Team members can create projects" on public.teams for insert;
create policy "Team members can update projects" on public.teams for update using (true);
create policy "Users manage own rows" on public.teams for all using (true);`,
      ),
    ]);

    expect(codes(issues).filter((code) => code === "POLICY_MISSING_WITH_CHECK")).toHaveLength(3);
  });

  it("does not collapse policies whose names share a first word", () => {
    const issues = inspectRlsCoverage([
      source(
        "001_x.sql",
        `${TEAMS_TABLE}
create policy "Users can update own profile" on public.teams for update using (true);
create policy "Users can view own profile" on public.teams for select using (true);`,
      ),
    ]);

    // The update policy has no WITH CHECK. Capturing names as a single word keys both policies
    // as "teams|Users", so the later SELECT would overwrite the UPDATE and the gate would report
    // nothing — which is exactly what the pre-H03 `check:rls` did for 35 real policies.
    expect(codes(issues)).toEqual(["POLICY_MISSING_WITH_CHECK"]);
    expect(find(issues, "POLICY_MISSING_WITH_CHECK")?.policy).toBe("Users can update own profile");
  });

  it("treats a dropped policy as gone, re-flagging the table as unclassified", () => {
    const issues = inspectRlsCoverage([
      source(
        "001_x.sql",
        `${TEAMS_TABLE}
create policy "Team members can view their team" on public.teams for select using (true);`,
      ),
      source(
        "002_x.sql",
        `drop policy if exists "Team members can view their team" on public.teams;`,
      ),
    ]);

    expect(codes(issues)).toEqual(["TABLE_UNCLASSIFIED"]);
  });

  it("does not let a semicolon inside a string literal truncate the policy", () => {
    const issues = inspectRlsCoverage([
      source(
        "001_x.sql",
        `create table public.teams (id uuid primary key);
alter table public.teams enable row level security;
create policy "Team members can view their team" on public.teams for select
  using (id::text <> ';');`,
      ),
    ]);

    expect(issues).toEqual([]);
  });

  it("keeps scanning past a dollar-quoted block that contains its own semicolons", () => {
    const issues = inspectRlsCoverage([
      source(
        "001_x.sql",
        `create table public.teams (id uuid primary key);
alter table public.teams enable row level security;
do $do$ begin
  perform 1;
  perform 2;
end $do$;
create policy "Team members can view their team" on public.teams for select using (true);`,
      ),
    ]);

    expect(issues).toEqual([]);
  });

  it("re-enables RLS when a later migration disables then enables it", () => {
    const issues = inspectRlsCoverage([
      source(
        "001_x.sql",
        `${TEAMS_TABLE}
create policy "Team members can view their team" on public.teams for select using (true);`,
      ),
      source(
        "002_x.sql",
        `alter table public.teams disable row level security;
alter table public.teams enable row level security;`,
      ),
    ]);

    expect(issues).toEqual([]);
  });

  it("reports RLS as missing when a later migration disables it", () => {
    const issues = inspectRlsCoverage([
      source(
        "001_x.sql",
        `${TEAMS_TABLE}
create policy "Team members can view their team" on public.teams for select using (true);`,
      ),
      source("002_x.sql", `alter table public.teams disable row level security;`),
    ]);

    expect(codes(issues)).toEqual(["TABLE_MISSING_RLS"]);
  });

  it("ignores policies and tables outside the public schema", () => {
    const issues = inspectRlsCoverage([
      source(
        "024_x.sql",
        `create policy "Public can read avatars" on storage.objects for select using (true);`,
      ),
    ]);

    expect(issues).toEqual([]);
  });
});
