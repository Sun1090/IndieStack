import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { SecuritySource } from "./security-definer-grants";
import {
  collectStoragePolicies,
  collectVersionedBuckets,
  discoverStorageBuckets,
  inspectStoragePolicies,
  type StorageBucketModel,
  type StoragePolicyIssue,
} from "./storage-policies";

const REPO_ROOT = path.resolve(__dirname, "../../..");

function source(fileName: string, content: string): SecuritySource {
  return { fileName, content };
}

/** Migration shaped like the committed `024_storage_avatars_policies.sql`. */
const AVATARS_MIGRATION = `insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = excluded.public;

create policy "Public can read avatars"
on storage.objects for select
to public
using (bucket_id = 'avatars');

create policy "Users can upload own avatars"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create policy "Users can update own avatars"
on storage.objects for update
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create policy "Users can delete own avatars"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);`;

const AVATARS_SOURCE = `admin.storage.from("avatars").upload(key, body, { contentType });`;

function inspect(migrations: string, appContent = AVATARS_SOURCE) {
  return inspectStoragePolicies({
    migrations: [source("024_storage_avatars_policies.sql", migrations)],
    appSources: [source("src/lib/storage/index.ts", appContent)],
  });
}

function codes(issues: StoragePolicyIssue[]): string[] {
  return issues.map((issue) => issue.code);
}

function find(
  issues: StoragePolicyIssue[],
  code: string,
  bucket?: string,
): StoragePolicyIssue | undefined {
  return issues.find(
    (issue) => issue.code === code && (bucket === undefined || issue.bucket === bucket),
  );
}

describe("discoverStorageBuckets", () => {
  it("collects every bucket named by storage.from across files, deduped and sorted", () => {
    expect(
      discoverStorageBuckets([
        source("a.ts", `client.storage.from('zeta').remove(['k']);`),
        source("b.ts", 'admin.storage.from("avatars").upload(k, b);'),
        source("c.ts", "admin.storage.from(`zeta`).getPublicUrl(k);"),
      ]),
    ).toEqual(["avatars", "zeta"]);
  });

  it("ignores table reads, object properties and unrelated from() calls", () => {
    expect(
      discoverStorageBuckets([
        source(
          "a.ts",
          `admin.from("profiles").select("*");
const driver = { from: (bucket: string) => ({ upload: () => bucket }) };
readFile.from("avatars");
other.storage.for("avatars");`,
        ),
      ]),
    ).toEqual([]);
  });

  it("finds buckets through admin, supabase and optional-chained receivers", () => {
    expect(
      discoverStorageBuckets([
        source(
          "a.ts",
          `createAdminClient().storage.from("avatars");
supabase?.storage.from("avatars");
client.storage
  .from("covers")
  .upload(k, b);`,
        ),
      ]),
    ).toEqual(["avatars", "covers"]);
  });
});

describe("collectVersionedBuckets", () => {
  it("reads the bucket id from insert into storage.buckets values", () => {
    expect(collectVersionedBuckets([source("024.sql", AVATARS_MIGRATION)])).toEqual(["avatars"]);
  });

  it("ignores bucket-shaped literals in unrelated statements", () => {
    expect(
      collectVersionedBuckets([
        source("001.sql", `insert into public.projects (cover_url) values ('avatars/k.png');`),
      ]),
    ).toEqual([]);
  });
});

describe("collectStoragePolicies", () => {
  it("keeps client-facing storage.objects policies and drops server-only ones", () => {
    const policies = collectStoragePolicies([
      source(
        "024.sql",
        `${AVATARS_MIGRATION}
create policy "Service role only" on storage.objects for select to service_role using (true);`,
      ),
    ]);
    expect(policies.map((policy) => policy.name)).toEqual([
      "Public can read avatars",
      "Users can upload own avatars",
      "Users can update own avatars",
      "Users can delete own avatars",
    ]);
  });
});

describe("inspectStoragePolicies", () => {
  it("accepts the committed avatars bucket shape", () => {
    const audit = inspect(AVATARS_MIGRATION);
    expect(audit.issues).toEqual([]);
    expect(audit.warnings).toEqual([]);
  });

  it("fails closed for a bucket referenced by code but not declared in the inventory", () => {
    const audit = inspect(AVATARS_MIGRATION, `admin.storage.from("covers").upload(k, b);`);
    expect(codes(audit.issues)).toContain("STORAGE_BUCKET_UNDECLARED");
    expect(find(audit.issues, "STORAGE_BUCKET_UNDECLARED", "covers")?.message).toContain("covers");
  });

  it("fails closed for a bucket that only a policy references", () => {
    const audit = inspect(`${AVATARS_MIGRATION}
create policy "Everyone reads attachments" on storage.objects for select
to public using (bucket_id = 'project-attachments');`);
    expect(codes(audit.issues)).toContain("STORAGE_BUCKET_UNDECLARED");
    expect(codes(audit.issues)).toContain("STORAGE_BUCKET_UNVERSIONED");
  });

  it("flags a declared bucket that no migration creates", () => {
    const audit = inspect(`create policy "Public can read avatars"
on storage.objects for select to public using (bucket_id = 'avatars');`);
    expect(codes(audit.issues)).toContain("STORAGE_BUCKET_UNVERSIONED");
    expect(find(audit.issues, "STORAGE_BUCKET_UNVERSIONED", "avatars")?.message).toContain(
      "no migration",
    );
  });

  it("flags a declared bucket with no effective policy", () => {
    const audit = inspect(`insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true);`);
    expect(codes(audit.issues)).toContain("STORAGE_BUCKET_UNPOLICED");
  });

  it("flags a public-read bucket whose client SELECT was dropped by a later migration", () => {
    const audit = inspect(`${AVATARS_MIGRATION}
drop policy "Public can read avatars" on storage.objects;`);
    expect(codes(audit.issues)).not.toContain("STORAGE_BUCKET_UNPOLICED");
    expect(codes(audit.issues)).toContain("STORAGE_PUBLIC_BUCKET_UNREADABLE");
  });

  it("flags an insert policy that pins the bucket but not the caller's folder", () => {
    const audit = inspect(AVATARS_MIGRATION.replace(
      `with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);`,
      `with check (bucket_id = 'avatars');`,
    ));
    expect(codes(audit.issues)).toContain("STORAGE_WRITE_POLICY_UNSCOPED");
    expect(find(audit.issues, "STORAGE_WRITE_POLICY_UNSCOPED")?.policy).toBe(
      "Users can upload own avatars",
    );
  });

  it("flags a write policy with no WITH CHECK at all", () => {
    const audit = inspect(`${AVATARS_MIGRATION}
create policy "Anyone uploads" on storage.objects for insert to authenticated
using (bucket_id = 'avatars');`);
    expect(codes(audit.issues)).toContain("STORAGE_WRITE_POLICY_UNSCOPED");
    expect(find(audit.issues, "STORAGE_WRITE_POLICY_UNSCOPED")?.message).toContain("WITH CHECK");
  });

  it("flags a delete policy whose USING ignores the tenant boundary", () => {
    const audit = inspect(AVATARS_MIGRATION.replace(
      `create policy "Users can delete own avatars"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);`,
      `create policy "Users can delete own avatars"
on storage.objects for delete
to authenticated
using (bucket_id = 'avatars');`,
    ));
    expect(find(audit.issues, "STORAGE_WRITE_POLICY_UNSCOPED")?.policy).toBe(
      "Users can delete own avatars",
    );
  });

  it("flags a SELECT policy that reaches across every bucket", () => {
    const audit = inspect(`insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true);
create policy "Public can read objects" on storage.objects for select
to public using (true);`);
    expect(codes(audit.issues)).toContain("STORAGE_READ_POLICY_UNSCOPED");
  });

  it("flags a private bucket that a client read policy exposes", () => {
    const inventory: Record<string, StorageBucketModel> = {
      avatars: {
        read: "public",
        tenantScopedWrites: true,
        reason: "fixture",
      },
      invoices: {
        read: "private",
        tenantScopedWrites: true,
        reason: "fixture",
      },
    };
    const audit = inspectStoragePolicies({
      migrations: [
        source(
          "024.sql",
          `${AVATARS_MIGRATION}
insert into storage.buckets (id, name, public) values ('invoices', 'invoices', false);
create policy "Owners read invoices" on storage.objects for select to authenticated
using (bucket_id = 'invoices' and (storage.foldername(name))[1] = (select auth.uid()::text));`,
        ),
      ],
      appSources: [source("src/a.ts", `admin.storage.from("avatars");`)],
      inventory,
    });
    expect(codes(audit.issues)).toContain("STORAGE_PRIVATE_BUCKET_PUBLIC_READ");
    expect(find(audit.issues, "STORAGE_PRIVATE_BUCKET_PUBLIC_READ", "invoices")?.policy).toBe(
      "Owners read invoices",
    );
  });

  it("warns when an inventory entry is no longer referenced by code", () => {
    const audit = inspect(AVATARS_MIGRATION, `admin.from("profiles").select("*");`);
    expect(audit.warnings).toHaveLength(1);
    expect(audit.warnings[0]).toContain("avatars");
  });

  it("accepts an update policy bounded by WITH CHECK only", () => {
    const audit = inspect(`${AVATARS_MIGRATION}
create policy "Owners rename" on storage.objects for update to authenticated
using (bucket_id = 'avatars')
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);`);
    expect(codes(audit.issues)).toEqual([]);
  });
});

describe("storage audit against the committed repository", () => {
  function readSources(dir: string): SecuritySource[] {
    return fs
      .readdirSync(dir, { withFileTypes: true, recursive: true })
      .filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name))
      .filter((entry) => !/\.(test|spec)\.(ts|tsx)$/.test(entry.name))
      .map((entry) =>
        source(
          path.relative(REPO_ROOT, path.join(entry.parentPath, entry.name)),
          fs.readFileSync(path.join(entry.parentPath, entry.name), "utf8"),
        ),
      );
  }

  it("passes for every bucket the application and its migrations reference", () => {
    const migrationDir = path.join(REPO_ROOT, "supabase", "migrations");
    const audit = inspectStoragePolicies({
      migrations: fs
        .readdirSync(migrationDir)
        .filter((file) => file.endsWith(".sql"))
        .sort()
        .map((file) => source(file, fs.readFileSync(path.join(migrationDir, file), "utf8"))),
      appSources: readSources(path.join(REPO_ROOT, "src")),
    });

    expect(audit.issues).toEqual([]);
    expect(audit.warnings).toEqual([]);
  });
});
