#!/usr/bin/env node
/**
 * 构建产物性能断言
 * 检查项：
 *  1. 图表组件仍在自己的懒加载 chunk 里，不在落地页初始 payload 里（懒加载未被回退）
 *  2. 客户端 CSS 单文件体积 < 100kB
 *  3. 无 sourcemap 泄漏到静态目录（三种形态都算，见下）
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const STATIC = path.join(ROOT, ".next", "static");
const BUILD_MANIFEST = path.join(ROOT, ".next", "build-manifest.json");
let failed = false;

/** 读一个产物文件的文本；读不出字节（woff2 / 图片）返回 null，与「没有标记」区别开。 */
function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

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

// 1. 图表 chunk 仍在懒加载
//
// **判据换过一次，因为原来那个判据永远不可能命中。**
// 原实现是「任一产物的**前 200 kB** 里正则找 `recharts`」。实测（Turbopack 生产构建）：
// `.next/static` 的 63 个文件里 `recharts` **一个都不出现**——而 recharts 确实被打进了产物
// （`src/components/charts/area-chart.tsx` 经 `next/dynamic` 懒加载）。原因是 Turbopack 的
// 生产产物里**不内嵌模块路径字符串**，所以「包名」在客户端产物里**结构性地不可搜**。
// 于是这一格长期在报「未检测到」，而它被命名为「recharts 独立 chunk 存在（懒加载未被回退）」——
// 一条永远显示「没找到」、却又顶着「防懒加载回退」名字的检查，比没有检查更糟：
// 它制造的是**它自己都不信的覆盖率**。
//
// 现在用**导出符号** `AreaChart` 作标记：实测它能扛过压缩（`recharts` 扛不过），
// 并且只出现在**那两个**图表 chunk 里（`0w5ujw4kdknj_.js` 360.6kB、`2hvrh58g01j8o.js` 15.2kB），
// 741 kB 那个 faker 死 chunk 里没有。
//
// **判的不再是「找不找得到」，而是它该不在的地方在不在**：落地页初始 payload
// （`build-manifest.json` 的 `rootMainFiles`，落地页真正会请求的那 6 个文件，合计 430.6kB）
// 里**不得出现**这个符号。有人把 `next/dynamic` 改回静态 import，recharts 就会被拉进
// 落地页初始 payload，这一格立刻红。
//
// **两处刻意的「宁可红」**：
// ① **一个文件都没命中标记 → 报红**，不报「未检测到」。标记消失的成因是压缩器或工具链变了，
//   不是「图表被删了」——这时候这一格**量不到任何东西**，沉默地绿比红危险得多
//   （同一条纪律见 #178 的 mock 记号、以及 #179 的「按名字判而不是按值判」）。
// ② **不再只读前 200 kB**：实测 61 个 js 里有 4 个超过 200 kB（最大 724 kB），
//   原来的窗口对其中 4 个文件的大半内容是瞎的。
const CHART_MARKER = "AreaChart";
const chartChunks = files.filter((f) => (readText(f) || "").includes(CHART_MARKER));
if (chartChunks.length === 0) {
  console.error(
    `❌ 产物里一处都找不到图表标记 \`${CHART_MARKER}\`：这一格量不到任何东西。` +
      `多半是压缩器/工具链改名了（构建产物里原本就没有 \`recharts\` 这个包名字符串），` +
      `请更新 scripts/check-perf.js 里的 CHART_MARKER，而不是把它当成「图表已移除」。`
  );
  failed = true;
} else if (!fs.existsSync(BUILD_MANIFEST)) {
  console.error("❌ 缺 .next/build-manifest.json，无法判断落地页初始 payload；先重新 pnpm build");
  failed = true;
} else {
  const mainFiles = JSON.parse(fs.readFileSync(BUILD_MANIFEST, "utf8")).rootMainFiles || [];
  const inlined = mainFiles
    .map((rel) => path.join(ROOT, ".next", rel.split("?")[0]))
    .filter((f) => (readText(f) || "").includes(CHART_MARKER));
  const landingKb = Math.round(
    mainFiles.reduce((sum, rel) => {
      const f = path.join(ROOT, ".next", rel.split("?")[0]);
      return sum + (fs.existsSync(f) ? fs.statSync(f).size : 0);
    }, 0) / 1024
  );
  if (inlined.length) {
    for (const f of inlined) {
      console.error(
        `❌ 图表代码进了落地页初始 payload（懒加载回退）：${path.relative(ROOT, f)}`
      );
    }
    failed = true;
  } else {
    const names = chartChunks.map((f) => path.relative(STATIC, f)).join("、");
    console.log(
      `✅ 图表仍在懒加载 chunk 里：${names}（落地页初始 payload ${landingKb}kB / ` +
        `${mainFiles.length} 个文件，其中不含图表）`
    );
  }
}

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
    const text = readText(file);
    if (text === null) continue; // 二进制（woff2 / 图片）：读不出字节就当作没有标记
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
