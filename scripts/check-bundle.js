#!/usr/bin/env node
/**
 * Bundle 体积基线检查
 * 用法: pnpm build 2>&1 | node scripts/check-bundle.js
 * 从构建输出解析 "First Load JS shared by all"，与 .bundle-baseline 比较：
 * - 超过基线 +5% 时失败（防止依赖引入悄悄膨胀首屏）
 */
const fs = require("fs");
const path = require("path");

const BASELINE_FILE = path.join(__dirname, "..", ".bundle-baseline");
const TOLERANCE = 1.05;

// 从 stdin 读取构建输出
let output = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (output += chunk));
process.stdin.on("end", () => {
  const match = output.match(/First Load JS shared by all\s+(\d+(?:\.\d+)?)\s*kB/);
  if (!match) {
    console.error("❌ 未能在构建输出中找到 First Load JS 信息");
    process.exit(1);
  }

  const current = Number(match[1]);
  let baseline = null;
  if (fs.existsSync(BASELINE_FILE)) {
    baseline = Number(fs.readFileSync(BASELINE_FILE, "utf8").trim());
  }

  if (!baseline) {
    fs.writeFileSync(BASELINE_FILE, String(current));
    console.log(`✅ 已建立 bundle 基线: ${current} kB`);
    return;
  }

  console.log(`Bundle: 当前 ${current} kB / 基线 ${baseline} kB`);
  if (current > baseline * TOLERANCE) {
    console.error(
      `❌ 首屏共享 JS 超过基线 ${Math.round((TOLERANCE - 1) * 100)}%：` +
        `如为有意变更，请更新 .bundle-baseline 文件`
    );
    process.exit(1);
  }
  console.log("✅ Bundle 体积在基线范围内");
});
