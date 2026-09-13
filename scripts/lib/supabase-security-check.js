/**
 * Supabase security audit: migrations, storage policies, admin-client boundaries,
 * SECURITY DEFINER execution grants and client-writable RLS policies.
 *
 * The pure rules live in src/lib/security/security-definer-grants.ts and
 * src/lib/security/client-write-policies.ts; both are covered by Vitest. This module handles
 * filesystem IO and process output.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectSecurityDefinerGrants } from "../../src/lib/security/security-definer-grants.ts";
import {
  extractEffectivePolicies,
  inspectClientWritePolicies,
} from "../../src/lib/security/client-write-policies.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const DEFAULT_MIGRATION_DIR = path.join(REPO_ROOT, "supabase", "migrations");
export const DEFAULT_SRC_DIR = path.join(REPO_ROOT, "src");

function readMigrationSources(migrationDir) {
  return fs
    .readdirSync(migrationDir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => ({
      fileName: file,
      content: fs.readFileSync(path.join(migrationDir, file), "utf8"),
    }));
}

function collectSourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

/** Realtime subscriptions configured in the browser must be backed by a publication migration. */
function checkRealtimePublication(srcDir, sql) {
  const subscribed = collectSourceFiles(srcDir).some((file) => {
    const body = fs.readFileSync(file, "utf8");
    return /postgres_changes/.test(body) && /table:\s*["\']notifications["\']/.test(body);
  });
  if (!subscribed) return [];
  if (/alter\s+publication\s+supabase_realtime\s+add\s+table\s+public\.notifications/i.test(sql)) {
    return [];
  }
  return [
    "public.notifications: postgres_changes subscription exists but supabase_realtime publication migration is missing",
  ];
}

/** Every application table must enable RLS in a versioned migration. */
function checkTableRls(sql) {
  const issues = [];
  const tables = [...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z_][\w]*)/gi)].map(
    (match) => match[1],
  );
  for (const table of new Set(tables)) {
    const enabled = new RegExp(
      `alter\\s+table[\\s\\S]*?public\\.${table}[\\s\\S]*?enable\\s+row\\s+level\\s+security`,
      "i",
    ).test(sql);
    if (!enabled) issues.push(`public.${table}: RLS is not enabled in migrations`);
  }
  return issues;
}

const STORAGE_POLICY_RULES = [
  [
    "Public can read avatars",
    /create\s+policy\s+"Public can read avatars"[\s\S]*?on\s+storage\.objects\s+for\s+select[\s\S]*?bucket_id\s*=\s*'avatars'/i,
  ],
  [
    "Users can upload own avatars",
    /create\s+policy\s+"Users can upload own avatars"[\s\S]*?on\s+storage\.objects\s+for\s+insert[\s\S]*?bucket_id\s*=\s*'avatars'[\s\S]*?storage\.foldername\(name\)[^;]*?auth\.uid\(\)/i,
  ],
  [
    "Users can update own avatars",
    /create\s+policy\s+"Users can update own avatars"[\s\S]*?on\s+storage\.objects\s+for\s+update[\s\S]*?using[\s\S]*?bucket_id\s*=\s*'avatars'[\s\S]*?storage\.foldername\(name\)[^;]*?auth\.uid\(\)[\s\S]*?with\s+check[\s\S]*?bucket_id\s*=\s*'avatars'/i,
  ],
  [
    "Users can delete own avatars",
    /create\s+policy\s+"Users can delete own avatars"[\s\S]*?on\s+storage\.objects\s+for\s+delete[\s\S]*?using[\s\S]*?bucket_id\s*=\s*'avatars'[\s\S]*?storage\.foldername\(name\)[^;]*?auth\.uid\(\)/i,
  ],
];

/** The avatars bucket and its tenant-scoped storage policies must be versioned. */
function checkStoragePolicies(srcDir, sql) {
  const issues = [];
  const warnings = [];
  const entryPoint = path.join(srcDir, "lib", "storage", "index.ts");
  const usesStorage =
    fs.existsSync(entryPoint) &&
    /storage\.from\(["\']avatars["\']\)/.test(fs.readFileSync(entryPoint, "utf8"));
  if (!usesStorage) return { issues, warnings };

  if (!/create\s+policy[\s\S]*?on\s+storage\.objects/i.test(sql)) {
    issues.push(
      "storage.objects: no versioned RLS policy found for the avatars bucket used by the application",
    );
  }
  if (!/insert\s+into\s+storage\.buckets[\s\S]*?avatars/i.test(sql)) {
    warnings.push(
      "storage.buckets: avatars bucket is not created by a migration; provisioning is external and must be documented",
    );
  }
  for (const [name, pattern] of STORAGE_POLICY_RULES) {
    if (!pattern.test(sql)) {
      issues.push(`storage.objects: policy "${name}" is missing or not tenant-scoped`);
    }
  }
  return { issues, warnings };
}

/** service_role must stay server-only and never be imported by a client component. */
function checkClientServiceRole(srcDir, root) {
  const issues = [];
  for (const file of collectSourceFiles(srcDir)) {
    const body = fs.readFileSync(file, "utf8");
    const isClientModule = /['"]use client['"]/.test(body);
    const touchesAdmin = /supabase\/admin|createAdminClient|SUPABASE_SERVICE_ROLE_KEY/.test(body);
    if (isClientModule && touchesAdmin) {
      issues.push(`${path.relative(root, file)}: client module references service-role admin access`);
    }
  }
  return issues;
}

/** Run the static audit and return a process exit code without terminating the caller. */
export function runSupabaseSecurityCheck(options = {}) {
  const root = options.root ?? REPO_ROOT;
  const migrationDir = options.migrationDir ?? DEFAULT_MIGRATION_DIR;
  const srcDir = options.srcDir ?? DEFAULT_SRC_DIR;

  const sources = readMigrationSources(migrationDir);
  const sql = sources.map((source) => source.content).join("\n");
  const definerIssues = inspectSecurityDefinerGrants(sources);
  const writeIssues = inspectClientWritePolicies(sources);
  const storage = checkStoragePolicies(srcDir, sql);
  const effectivePolicyCount = extractEffectivePolicies(sources).length;
  const tableCount = new Set(
    [...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z_][\w]*)/gi)].map(
      (match) => match[1],
    ),
  ).size;

  const issues = [
    ...checkRealtimePublication(srcDir, sql),
    ...definerIssues.map((issue) => `[${issue.code}] ${issue.fileName}: ${issue.message}`),
    ...writeIssues.map((issue) => `[${issue.code}] ${issue.fileName}: ${issue.message}`),
    ...checkTableRls(sql),
    ...storage.issues,
    ...checkClientServiceRole(srcDir, root),
  ];

  if (storage.warnings.length) {
    console.warn(`⚠️ Supabase security audit warnings (${storage.warnings.length}):`);
    for (const item of storage.warnings) console.warn(`  - ${item}`);
  }
  if (issues.length) {
    console.error(`❌ Supabase security audit found ${issues.length} issue(s):`);
    for (const item of issues) console.error(`  - ${item}`);
    if (definerIssues.length > 0) {
      console.error("  hint: add a forward migration revoking EXECUTE from public, anon, authenticated");
    }
    if (writeIssues.length > 0) {
      console.error(
        "  hint: add a forward migration dropping the client write policy (service_role bypasses RLS)",
      );
    }
    return 1;
  }
  console.log(
    `✅ Supabase security audit passed: ${sources.length} migrations, ${tableCount} public tables, ` +
      `server-only service role checks, ${effectivePolicyCount} effective RLS policies`,
  );
  return 0;
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedAsScript) {
  process.exitCode = runSupabaseSecurityCheck();
}
