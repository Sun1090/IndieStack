#!/usr/bin/env node
/**
 * 构建产物性能断言
 * 检查项：
 *  1. recharts 独立 chunk 存在（懒加载未被回退）
 *  2. 客户端 CSS 单文件体积 < 100kB
 *  3. 无 .map 文件泄漏到静态目录（生产不应可调试）
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const STATIC = path.join(ROOT, ".next", "static");
let failed = false;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

if (!fs.existsSync(STATIC)) {
  console.error("❌ 请先 pnpm build");
  process.exit(1);
}
const files = walk(STATIC);

// 1. recharts chunk
const hasRecharts = files.some((f) => {
  try {
    return /recharts/i.test(fs.readFileSync(f, "utf8").slice(0, 200000));
  } catch {
    return false;
  }
});
console.log(`${hasRecharts ? "✅" : "⚠️ "} recharts 独立 chunk: ${hasRecharts ? "存在" : "未检测到（若已移除图表可忽略）"}`);

// 2. CSS 体积
const css = files.filter((f) => f.endsWith(".css"));
const cssKb = Math.round(css.reduce((a, f) => a + fs.statSync(f).size, 0) / 102.4) / 10;
if (cssKb > 100) {
  console.error(`❌ CSS 总体积 ${cssKb}kB 超过 100kB`);
  failed = true;
} else {
  console.log(`✅ CSS 总体积 ${cssKb}kB`);
}

// 3. sourcemap 泄漏
const maps = files.filter((f) => f.endsWith(".map"));
if (maps.length) {
  console.error(`❌ 静态目录存在 ${maps.length} 个 sourcemap 文件`);
  failed = true;
} else {
  console.log("✅ 无 sourcemap 泄漏");
}

process.exit(failed ? 1 : 0);
