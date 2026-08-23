/**
 * i18n 翻译对称性校验
 * 递归对比 messages/en 与 messages/zh-CN 的所有嵌套 key：
 * 缺失或多出的键都会导致进程退出码非 0（CI 门禁 / 本地 node scripts/check-locales.js）
 */
const fs = require("fs");
const path = require("path");

function flatten(obj, prefix = "") {
  return Object.entries(obj).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    return v && typeof v === "object" && !Array.isArray(v)
      ? flatten(v, key)
      : [key];
  });
}

function loadLocaleDir(locale) {
  const dir = path.join(__dirname, "..", "messages", locale);
  const result = {};
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const ns = path.basename(file, ".json");
    result[ns] = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
  }
  return result;
}

const en = flatten(loadLocaleDir("en"));
const zh = flatten(loadLocaleDir("zh-CN"));
const enSet = new Set(en);
const zhSet = new Set(zh);

const missingInZh = en.filter((k) => !zhSet.has(k));
const missingInEn = zh.filter((k) => !enSet.has(k));

if (missingInZh.length || missingInEn.length) {
  if (missingInZh.length)
    console.error(`❌ zh-CN 缺失 ${missingInZh.length} 个 key:\n  ` + missingInZh.join("\n  "));
  if (missingInEn.length)
    console.error(`❌ en 缺失 ${missingInEn.length} 个 key:\n  ` + missingInEn.join("\n  "));
  process.exit(1);
}

console.log(`✅ 翻译对称性校验通过：en/zh-CN 各 ${en.length} 个 key 完全一致`);
