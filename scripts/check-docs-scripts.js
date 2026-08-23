#!/usr/bin/env node
/**
 * docs-site scripts.md 与 package.json 同步校验
 * 确保文档中记录的 pnpm 命令都真实存在（防止文档漂移）
 */
const fs = require("fs");
const path = require("path");

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
const scriptNames = new Set(Object.keys(pkg.scripts));

let failed = false;
for (const locale of ["en", "zh-CN"]) {
  const docPath = path.join(__dirname, "..", "docs-site", locale, "scripts.md");
  if (!fs.existsSync(docPath)) continue;
  const doc = fs.readFileSync(docPath, "utf8");
  // 抓取文档中的 pnpm <name> 命令（排除 pnpm install/build 等通用词由白名单处理）
  const commands = [...doc.matchAll(/`pnpm\s+([a-z:.-]+)`/g)].map((m) => m[1]);
  // pnpm 内置命令白名单（非 package.json scripts）
  const builtin = new Set(["install", "add", "remove", "update", "dev"]);
  for (const cmd of new Set(commands)) {
    if (!builtin.has(cmd) && !scriptNames.has(cmd)) {
      console.error(`❌ ${locale}/scripts.md 引用了不存在的脚本: pnpm ${cmd}`);
      failed = true;
    }
  }
}

if (failed) process.exit(1);
console.log("✅ docs-site scripts 文档与 package.json 同步");
