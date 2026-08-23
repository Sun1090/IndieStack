#!/usr/bin/env node
/**
 * Bundle 体积基线检查（Turbopack 版）
 * 用法: pnpm check:bundle （先自动执行 next build）
 * 统计 .next/static 下客户端 chunks 总大小，与 .bundle-baseline 比较：
 * - 超过基线 +5% 时失败（防止依赖引入悄悄膨胀客户端包）
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const STATIC_DIR = path.join(ROOT, ".next", "static");
const BASELINE_FILE = path.join(ROOT, ".bundle-baseline");
const TOLERANCE = 1.05;

function dirSize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += dirSize(full);
    else total += fs.statSync(full).size;
  }
  return total;
}

if (!fs.existsSync(STATIC_DIR)) {
  console.error("❌ 未找到 .next/static，请先执行 pnpm build");
  process.exit(1);
}

const currentKb = Math.round((dirSize(STATIC_DIR) / 1024) * 10) / 10;

let baseline = null;
if (fs.existsSync(BASELINE_FILE)) {
  baseline = Number(fs.readFileSync(BASELINE_FILE, "utf8").trim());
}

if (!baseline || Number.isNaN(baseline)) {
  fs.writeFileSync(BASELINE_FILE, String(currentKb));
  console.log(`✅ 已建立 bundle 基线: ${currentKb} kB（客户端静态资源总量）`);
  process.exit(0);
}

console.log(`Bundle: 当前 ${currentKb} kB / 基线 ${baseline} kB`);
if (currentKb > baseline * TOLERANCE) {
  console.error(
    `❌ 客户端资源超过基线 ${Math.round((TOLERANCE - 1) * 100)}%。` +
      `如为有意变更（新功能/升级），请同步更新 .bundle-baseline 文件。`
  );
  process.exit(1);
}
console.log("✅ Bundle 体积在基线范围内");
