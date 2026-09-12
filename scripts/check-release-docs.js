#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const required = [
  ".github/RELEASE_CHECKLIST.md",
  "docs/operations/release-runbook-v0.6.0.md",
  "docs/operations/rollback-runbook-v0.6.0.md",
  "docs/operations/production-smoke-v0.6.0.md",
  "CHANGELOG.md",
  "README.md",
  "README.zh-CN.md",
];
const missing = required.filter((file) => !fs.existsSync(path.join(root, file)));
if (missing.length) { console.error(`Missing release docs: ${missing.join(", ")}`); process.exit(1); }
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const checks = [
  ["release runbook", read("docs/operations/release-runbook-v0.6.0.md"), ["pnpm verify:build", "pnpm test:e2e", "pnpm audit", "停止条件"]],
  ["rollback runbook", read("docs/operations/rollback-runbook-v0.6.0.md"), ["不自动回滚数据库", "health", "前向修复迁移"]],
  ["smoke matrix", read("docs/operations/production-smoke-v0.6.0.md"), ["/api/health", "租户数据隔离", "回滚探针"]],
  ["changelog", read("CHANGELOG.md"), ["[Unreleased]", "v0.6.0"]],
  ["readme", read("README.md"), ["pnpm verify:build", "production smoke", "rollback"]],
  ["readme zh", read("README.zh-CN.md"), ["pnpm verify:build", "生产冒烟", "回滚"]],
];
const failures = checks.flatMap(([name, text, needles]) => needles.filter((needle) => !text.includes(needle)).map((needle) => `${name}: missing ${needle}`));
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log(`✅ release documentation checks passed (${required.length} artifacts)`);
