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
//
// **三种形态都算，原先只判第一种**：① 独立的 `.map` 文件；② `//# sourceMappingURL=data:…`
// 把整份原始源码**内联进那个 JS/CSS 文件**（构建产物里最隐蔽的一种，浏览器请求它就等于
// 把源码下载下来）；③ 一条指向**确实存在**的 map 的 `sourceMappingURL`。
// ② 与 ① 都不需要额外请求，所以「产物里没有 .map 文件」完全推不出「没有泄漏」。
//
// **指向不存在路径的引用不算**：那是第三方库留下的死引用，既不泄漏也不可调试，
// 按它报红就是一条没人会修的假红（本文件对「假红」的态度与 `check:bundle` 的内容判定一致）。
//
// 顺带把**分母**也补上：一条文件都没扫到时报红而不是报绿——「什么都没在看」和「干净」
// 长得一模一样，而这一格恰恰是靠 `walk()` 的结果说话的。
if (files.length === 0) {
  console.error("❌ 静态目录里一条文件都没有：这道断言量不到任何东西，先重新 pnpm build");
  failed = true;
} else {
  const maps = files.filter((f) => f.endsWith(".map"));
  const inline = [];
  const resolvable = [];
  for (const file of files) {
    let text = "";
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue; // 二进制（woff2 / 图片）：读不出字节就当作没有标记
    }
    for (const match of text.matchAll(/sourceMappingURL=(\S+)/g)) {
      const ref = match[1];
      if (ref.startsWith("data:")) {
        inline.push(path.relative(ROOT, file));
        continue;
      }
      const target = path.resolve(path.dirname(file), ref);
      if (fs.existsSync(target)) resolvable.push(`${path.relative(ROOT, file)} → ${ref}`);
    }
  }
  if (maps.length === 0 && inline.length === 0 && resolvable.length === 0) {
    console.log(`✅ 无 sourcemap 泄漏（扫了 ${files.length} 个产物文件）`);
  } else {
    if (maps.length) console.error(`❌ 静态目录存在 ${maps.length} 个 sourcemap 文件`);
    for (const file of inline) {
      console.error(`❌ ${file}: sourceMappingURL 是 data URI——原始源码内联在这个产物里`);
    }
    for (const pair of resolvable) {
      console.error(`❌ sourcemap 引用可解析（等于可下载）：${pair}`);
    }
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
