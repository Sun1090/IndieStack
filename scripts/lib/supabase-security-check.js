/**
 * Supabase security audit: migrations, storage policies, admin-client boundaries,
 * SECURITY DEFINER execution grants, client-writable RLS policies and the least-privilege
 * inventory of every service-role call site.
 *
 * The pure rules live in src/lib/security/*.ts; all of them are covered by Vitest. This module
 * handles filesystem IO and process output.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectSecurityDefinerGrants } from "../../src/lib/security/security-definer-grants.ts";
import {
  extractEffectivePolicies,
  inspectClientWritePolicies,
} from "../../src/lib/security/client-write-policies.ts";
import { inspectRlsCoverage } from "../../src/lib/security/rls-coverage.ts";
import {
  ADMIN_CLIENT_INVENTORY,
  inspectAdminClientBoundary,
} from "../../src/lib/security/admin-client-boundary.ts";

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

/**
 * Table-level RLS coverage.
 *
 * Delegated to `src/lib/security/rls-coverage.ts` so both gates share one final-state model;
 * clause-level policy checks stay in `check:rls` while this audit only needs the table verdicts.
 */
const RLS_TABLE_ISSUE_CODES = new Set([
  "TABLE_MISSING_RLS",
  "TABLE_UNCLASSIFIED",
  "SERVER_ONLY_TABLE_HAS_POLICY",
]);

function checkTableRls(sources) {
  return inspectRlsCoverage(sources)
    .filter((issue) => RLS_TABLE_ISSUE_CODES.has(issue.code))
    .map((issue) => `[${issue.code}] ${issue.message}`);
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

/**
 * Test files are never part of the Next.js client bundle: a fixture that prints `"use client"`
 * or that mocks `@/lib/supabase/admin` is not a production client module.
 */
function isTestSource(file) {
  return /\.(test|spec)\.(ts|tsx)$/.test(file);
}

/** service_role must stay server-only and never be imported by a client component. */
function checkClientServiceRole(srcDir, root) {
  const issues = [];
  for (const file of collectSourceFiles(srcDir).filter((file) => !isTestSource(file))) {
    const body = fs.readFileSync(file, "utf8");
    const isClientModule = /['"]use client['"]/.test(body);
    const touchesAdmin = /supabase\/admin|createAdminClient|SUPABASE_SERVICE_ROLE_KEY/.test(body);
    if (isClientModule && touchesAdmin) {
      issues.push(`${path.relative(root, file)}: client module references service-role admin access`);
    }
  }
  return issues;
}

/**
 * Least-privilege inventory of `createAdminClient()` call sites.
 *
 * `src/lib/security/admin-client-boundary.ts` owns the rules and the committed inventory; this
 * wrapper only feeds it repository-sourced files so `check:supabase-security` fails closed when a
 * module starts using service_role without being classified.
 */
function checkAdminClientBoundary(srcDir, root) {
  const sources = collectSourceFiles(srcDir)
    .filter((file) => !isTestSource(file))
    .map((file) => ({
      fileName: path.relative(root, file).split(path.sep).join("/"),
      content: fs.readFileSync(file, "utf8"),
    }))
    .sort((left, right) => left.fileName.localeCompare(right.fileName));
  return inspectAdminClientBoundary(sources).map((issue) => `[${issue.code}] ${issue.message}`);
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
  const adminClient = { issues: checkAdminClientBoundary(srcDir, root) };
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
    ...checkTableRls(sources),
    ...storage.issues,
    ...checkClientServiceRole(srcDir, root),
    ...adminClient.issues,
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
    if (adminClient.issues.length > 0) {
      console.error(
        "  hint: classify the call site in ADMIN_CLIENT_INVENTORY (src/lib/security/admin-client-boundary.ts) " +
          "or remove the service-role dependency",
      );
    }
    return 1;
  }
  console.log(
    `✅ Supabase security audit passed: ${sources.length} migrations, ${tableCount} public tables, ` +
      `server-only service role checks, ${effectivePolicyCount} effective RLS policies, ` +
      `${ADMIN_CLIENT_INVENTORY.length} classified service-role call sites`,
  );
  return 0;
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedAsScript) {
  process.exitCode = runSupabaseSecurityCheck();
}
