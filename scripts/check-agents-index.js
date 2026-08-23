/**
 * AGENTS.md 索引一致性校验
 * 确保索引表格引用的每个 agent 文件存在，且 agents/ 目录无未索引的孤儿文件
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const index = fs.readFileSync(path.join(root, "AGENTS.md"), "utf8");
const files = fs
  .readdirSync(path.join(root, "agents"))
  .filter((f) => f.endsWith(".md"));

const referenced = [...index.matchAll(/agents\/([\w-]+\.md)/g)].map((m) => m[1]);
const missingFiles = referenced.filter((f) => !files.includes(f));
const orphans = files.filter((f) => !referenced.includes(f));

let failed = false;
if (missingFiles.length) {
  console.error(`❌ 索引引用了不存在的文件: ${missingFiles.join(", ")}`);
  failed = true;
}
if (orphans.length) {
  console.error(`❌ 未被索引的 agent 文件: ${orphans.join(", ")}`);
  failed = true;
}
if (failed) process.exit(1);

console.log(`✅ Agent 索引一致：${files.length} 个文件全部正确索引`);
