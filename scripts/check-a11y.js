#!/usr/bin/env node
/**
 * a11y 静态审计
 * 检查项：
 *  1. 图标按钮（仅含 svg/图标无文本）是否有 aria-label 或 sr-only 文本
 *  2. <img> 必须有 alt（项目应使用 next/image，同样要求 alt）
 */
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "src");
let issues = [];

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (/\.tsx$/.test(e.name)) audit(full);
  }
}

function lineOf(content, idx) {
  return content.slice(0, idx).split("\n").length;
}

function audit(file) {
  const s = fs.readFileSync(file, "utf8");
  // 跳过测试文件
  if (file.includes(".test.")) return;

  // Button 仅含图标组件（Lucide/GithubIcon）且无 aria-label / sr-only → 报告
  const btnRe = /<Button\b[^>]*>([\s\S]*?)<\/Button>/g;
  let m;
  while ((m = btnRe.exec(s))) {
    const inner = m[1];
    const tag = m[0];
    if (!/[A-Za-z\u4e00-\u9fa5]{2,}/.test(inner.replace(/className=\{?["'][^"']*["']\}?/g, ""))) {
      const hasIconOnly =
        /<(Github)?Icon|Loader2|[A-Z][a-zA-Z]+ className/.test(inner) && !/>[^<]+</.test(inner.replace(/<svg[\s\S]*?<\/svg>/g, ""));
      const hasLabel = /aria-label|sr-only/.test(tag);
      if (hasIconOnly && !hasLabel && !tag.includes("aria-label")) {
        issues.push(`${file}:${lineOf(s, m.index)} 图标按钮缺少 aria-label`);
      }
    }
  }

  // <img> 无 alt
  const imgRe = /<img\b(?![^>]*\balt=)[^>]*>/g;
  while ((m = imgRe.exec(s))) {
    issues.push(`${file}:${lineOf(s, m.index)} <img> 缺少 alt`);
  }
}

walk(SRC);

if (issues.length) {
  console.error(`❌ a11y 审计发现 ${issues.length} 个问题:`);
  issues.forEach((i) => console.error("  - " + i));
  process.exit(1);
}
console.log("✅ a11y 静态审计通过：无未标注的图标按钮，无缺 alt 的图片");
