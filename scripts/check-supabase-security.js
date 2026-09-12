#!/usr/bin/env node
/** Static Supabase security audit: migrations, storage policies, and admin-client boundaries. */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const migrationDir = path.join(root, "supabase", "migrations");
const srcDir = path.join(root, "src");
const migrations = fs.readdirSync(migrationDir).filter((f) => f.endsWith(".sql")).sort();
const issues = [];
const warnings = [];
const sql = migrations.map((f) => fs.readFileSync(path.join(migrationDir, f), "utf8")).join("\n");

// SECURITY DEFINER functions must pin search_path to prevent object shadowing.
for (const [file, body] of migrations.map((f) => [f, fs.readFileSync(path.join(migrationDir, f), "utf8")])) {
  const defs = body.match(/create\s+(?:or\s+replace\s+)?function[\s\S]*?(?=\$\$|;)/gi) || [];
  for (const def of defs) {
    if (/security\s+definer/i.test(def) && !/set\s+search_path\s*=\s*['"]?['"]?/i.test(def)) {
      issues.push(`${file}: SECURITY DEFINER function lacks SET search_path`);
    }
  }
}

// Every application table must be protected, including tables added by later migrations.
const tables = [...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z_][\w]*)/gi)].map((m) => m[1]);
for (const table of new Set(tables)) {
  const tableSql = sql.slice(sql.toLowerCase().indexOf(`create table public.${table}`));
  if (!new RegExp(`alter\\s+table[\\s\\S]*?public\\.${table}[\\s\\S]*?enable\\s+row\\s+level\\s+security`, "i").test(sql)) {
    issues.push(`public.${table}: RLS is not enabled in migrations`);
  }
}

// The application uses the Supabase Storage avatars bucket; its policies must be versioned.
const usesSupabaseStorage = fs.existsSync(path.join(srcDir, "lib", "storage", "index.ts")) &&
  /storage\.from\(["']avatars["']\)/.test(fs.readFileSync(path.join(srcDir, "lib", "storage", "index.ts"), "utf8"));
const hasStoragePolicy = /create\s+policy[\s\S]*?on\s+storage\.objects/i.test(sql);
if (usesSupabaseStorage && !hasStoragePolicy) {
  issues.push("storage.objects: no versioned RLS policy found for the avatars bucket used by the application");
}
if (usesSupabaseStorage && !/insert\s+into\s+storage\.buckets[\s\S]*?avatars/i.test(sql)) {
  warnings.push("storage.buckets: avatars bucket is not created by a migration; provisioning is external and must be documented");
}
if (usesSupabaseStorage) {
  const requiredStoragePolicies = [
    ["Public can read avatars", /create\s+policy\s+"Public can read avatars"[\s\S]*?on\s+storage\.objects\s+for\s+select[\s\S]*?bucket_id\s*=\s*'avatars'/i],
    ["Users can upload own avatars", /create\s+policy\s+"Users can upload own avatars"[\s\S]*?on\s+storage\.objects\s+for\s+insert[\s\S]*?bucket_id\s*=\s*'avatars'[\s\S]*?storage\.foldername\(name\)[^;]*?auth\.uid\(\)/i],
    ["Users can update own avatars", /create\s+policy\s+"Users can update own avatars"[\s\S]*?on\s+storage\.objects\s+for\s+update[\s\S]*?using[\s\S]*?bucket_id\s*=\s*'avatars'[\s\S]*?storage\.foldername\(name\)[^;]*?auth\.uid\(\)[\s\S]*?with\s+check[\s\S]*?bucket_id\s*=\s*'avatars'/i],
    ["Users can delete own avatars", /create\s+policy\s+"Users can delete own avatars"[\s\S]*?on\s+storage\.objects\s+for\s+delete[\s\S]*?using[\s\S]*?bucket_id\s*=\s*'avatars'[\s\S]*?storage\.foldername\(name\)[^;]*?auth\.uid\(\)/i],
  ];
  for (const [name, pattern] of requiredStoragePolicies) {
    if (!pattern.test(sql)) issues.push(`storage.objects: policy "${name}" is missing or not tenant-scoped`);
  }
}

// service_role must remain server-only and must not be imported by client components.
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}
for (const file of walk(srcDir)) {
  const body = fs.readFileSync(file, "utf8");
  if (/['"]use client['"]/.test(body) && /supabase\/admin|createAdminClient|SUPABASE_SERVICE_ROLE_KEY/.test(body)) {
    issues.push(`${path.relative(root, file)}: client module references service-role admin access`);
  }
}

if (warnings.length) {
  console.warn(`⚠️ Supabase security audit warnings (${warnings.length}):`);
  warnings.forEach((item) => console.warn(`  - ${item}`));
}
if (issues.length) {
  console.error(`❌ Supabase security audit found ${issues.length} issue(s):`);
  issues.forEach((item) => console.error(`  - ${item}`));
  process.exit(1);
}
console.log(`✅ Supabase security audit passed: ${migrations.length} migrations, ${new Set(tables).size} public tables, server-only service role checks`);
