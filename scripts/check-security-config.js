#!/usr/bin/env node
/**
 * Read-only repository security/configuration guardrails.
 * Fails on committed secret files, readable local env files, public exposure of
 * server-only variables, missing workflow least-privilege permissions, and
 * dependency audit findings at high severity or above.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const issues = [];
const serverOnly = [
  "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_DB_URL", "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET", "OSS_ACCESS_KEY_SECRET", "ALIYUN_ACCESS_KEY_SECRET",
  "SENTRY_AUTH_TOKEN", "VERCEL_TOKEN", "GITHUB_TOKEN", "CRON_SECRET",
];

function trackedFiles() {
  try { return execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).trim().split("\n").filter(Boolean); }
  catch { return []; }
}
const tracked = trackedFiles();
for (const file of tracked) {
  if (/^\.env(?:\.|$)/.test(file) && file !== ".env.example") issues.push(`${file}: environment file is tracked`);
  if (/(^|\/)(id_rsa|.*\.pem|.*\.key)$/.test(file)) issues.push(`${file}: private-key-like file is tracked`);
}

for (const file of [".env.local", ".env.development", ".env.production"]) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) continue;
  const mode = fs.statSync(full).mode & 0o777;
  if ((mode & 0o077) !== 0) issues.push(`${file}: permissions ${mode.toString(8)} are broader than 0600`);
  const content = fs.readFileSync(full, "utf8");
  for (const name of serverOnly) if (new RegExp(`^${name}=`, "m").test(content) && file === ".env.development") {
    issues.push(`${file}: contains server-only secret ${name}; keep secrets out of shared development env files`);
  }
}

const sourceFiles = [];
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".next", "coverage", ".git"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full); else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) sourceFiles.push(full);
  }
}
walk(path.join(root, "src"));
for (const file of sourceFiles) {
  const content = fs.readFileSync(file, "utf8");
  if (!content.includes("use client")) continue;
  for (const name of serverOnly) if (content.includes(`process.env.${name}`)) issues.push(`${path.relative(root, file)}: client module references server-only ${name}`);
}

const workflowDir = path.join(root, ".github", "workflows");
for (const file of fs.readdirSync(workflowDir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))) {
  const content = fs.readFileSync(path.join(workflowDir, file), "utf8");
  if (!/^permissions:\s*\n/m.test(content) && !/^  permissions:\s*\n/m.test(content)) issues.push(`.github/workflows/${file}: missing explicit permissions block`);
}

try {
  const raw = execFileSync("pnpm", ["audit", "--json"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const audit = JSON.parse(raw);
  const v = audit.metadata?.vulnerabilities || {};
  if ((v.high || 0) + (v.critical || 0) > 0) issues.push(`pnpm audit: ${v.critical || 0} critical, ${v.high || 0} high vulnerabilities`);
} catch (error) {
  try {
    const audit = JSON.parse(error.stdout || "{}");
    const v = audit.metadata?.vulnerabilities || {};
    if ((v.high || 0) + (v.critical || 0) > 0) issues.push(`pnpm audit: ${v.critical || 0} critical, ${v.high || 0} high vulnerabilities`);
  } catch { issues.push("pnpm audit: command failed or returned invalid JSON"); }
}

if (issues.length) {
  console.error(`❌ security/config check failed (${issues.length}):`);
  for (const issue of issues) console.error(`  - ${issue}`);
  process.exit(1);
}
console.log("✅ security/config checks passed");
