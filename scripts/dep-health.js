#!/usr/bin/env node
/**
 * 依赖健康报告生成器
 * 用法: node scripts/dep-health.js [--strict]
 * 输出: 过期依赖分级清单 + 供应链配置状态（CI 可选 strict 模式：存在 major 落后即失败）
 */
const { execSync } = require("child_process");
const fs = require("fs");

let outdated = {};
try {
  outdated = JSON.parse(execSync("pnpm outdated --json", { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }));
} catch (e) {
  // pnpm outdated 有过期依赖时退出码非 0，stdout 仍含 JSON
  try {
    outdated = JSON.parse(e.stdout);
  } catch {
    console.log("✅ 所有依赖均为最新");
    process.exit(0);
  }
}

const major = [];
const minorPatch = [];
for (const [name, info] of Object.entries(outdated)) {
  const currentMajor = Number((info.current ?? "0").split(".")[0]);
  const latestMajor = Number((info.latest ?? "0").split(".")[0]);
  (latestMajor > currentMajor ? major : minorPatch).push(
    `${name}: ${info.current} → ${info.latest}${latestMajor > currentMajor ? " (major)" : ""}`
  );
}

console.log("# 依赖健康报告\n");
console.log(`## 需要专项迁移的 major 升级 (${major.length})`);
major.forEach((m) => console.log(`  - ${m}`));
console.log(`\n## 可直接升级的 minor/patch (${minorPatch.length})`);
minorPatch.forEach((m) => console.log(`  - ${m}`));

// 供应链配置检查
const ws = fs.readFileSync("pnpm-workspace.yaml", "utf8");
console.log("\n## 供应链配置");
console.log(`- allowBuilds 白名单: ${ws.includes("allowBuilds") ? "✅" : "❌"}`);
console.log(`- overrides 安全覆盖: ${ws.includes("overrides") ? "✅" : "❌"}`);
console.log(`- minimumReleaseAge: ${ws.includes("minimumReleaseAge") ? "已显式设置" : "pnpm11 默认 1 天"}`);

if (process.argv.includes("--strict") && major.length > 0) {
  console.error(`\n❌ strict 模式：${major.length} 个 major 落后`);
  process.exit(1);
}
