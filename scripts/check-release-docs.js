#!/usr/bin/env node
/**
 * 发布文档门禁：按 package.json 的当前版本解析对应发布产物，避免每次发版手工改脚本。
 * 只校验“文件存在 + 关键命令/字段存在”，结构正确性由 pnpm check:changelog 负责。
 */
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const { version } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const runbook = `docs/operations/release-runbook-v${version}.md`;
const rollback = `docs/operations/rollback-runbook-v${version}.md`;
const smoke = `docs/operations/production-smoke-v${version}.md`;
const required = [
  ".github/RELEASE_CHECKLIST.md",
  runbook,
  rollback,
  smoke,
  "CHANGELOG.md",
  "README.md",
  "README.zh-CN.md",
];
const missing = required.filter((file) => !fs.existsSync(path.join(root, file)));
if (missing.length) { console.error(`Missing release docs: ${missing.join(", ")}`); process.exit(1); }
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const checks = [
  ["release runbook", read(runbook), ["pnpm verify:build", "pnpm test:e2e", "pnpm audit", "停止条件"]],
  ["rollback runbook", read(rollback), ["不自动回滚数据库", "health", "前向修复迁移"]],
  ["smoke matrix", read(smoke), ["/api/health", "租户数据隔离", "回滚探针"]],
  ["changelog", read("CHANGELOG.md"), ["[Unreleased]", `[${version}]`]],
  ["release checklist", read(".github/RELEASE_CHECKLIST.md"), [`v${version}`, runbook, rollback, smoke]],
  ["readme", read("README.md"), ["pnpm verify:build", "production smoke", "rollback", smoke]],
  ["readme zh", read("README.zh-CN.md"), ["pnpm verify:build", "生产冒烟", "回滚", smoke]],
];
const failures = checks.flatMap(([name, text, needles]) => needles.filter((needle) => !text.includes(needle)).map((needle) => `${name}: missing ${needle}`));
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log(`✅ release documentation checks passed (v${version}, ${required.length} artifacts)`);
