#!/usr/bin/env node
/**
 * Supabase RLS 迁移静态检查（按迁移顺序模拟最终数据库状态）
 * 规则：最终态下，所有 UPDATE / INSERT / ALL 策略必须带 WITH CHECK，
 *       SELECT / DELETE 策略必须带 USING。
 */
const fs = require("fs");
const path = require("path");

const dir = path.join(__dirname, "..", "supabase", "migrations");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

/** 最终策略状态: key = `${table}|${name}` → { cmd, sql } */
const policies = new Map();

for (const file of files) {
  const sql = fs.readFileSync(path.join(dir, file), "utf8");

  // 处理 drop（含 if exists），从最终状态移除
  for (const m of sql.matchAll(/drop\s+policy\s+(?:if\s+exists\s+)?"?([\w-]+)"?\s+on\s+([\w.]+)/gi)) {
    policies.delete(`${m[2].replace(/^public\./, "")}|${m[1]}`);
  }

  // 记录 create
  for (const p of sql.matchAll(/CREATE\s+POLICY\s+"?([\w-]+)"?[\s\S]*?on\s+([\w.]+)[^;]*;/gi)) {
    const name = p[1];
    const table = p[2].replace(/^public\./, "");
    const stmt = p[0];
    const cmd = (stmt.match(/\bFOR\s+(SELECT|INSERT|UPDATE|DELETE|ALL)\b/i) ?? [])[1]?.toUpperCase() ?? "ALL";
    policies.set(`${table}|${name}`, { cmd, stmt });
  }
}

const issues = [];
for (const [key, { cmd, stmt }] of policies) {
  const [table, name] = key.split("|");
  if ((cmd === "UPDATE" || cmd === "INSERT" || cmd === "ALL") && !/\bWITH\s+CHECK\b/i.test(stmt)) {
    issues.push(`表 ${table} 策略 "${name}" (${cmd}) 最终态缺少 WITH CHECK`);
  }
  if ((cmd === "SELECT" || cmd === "DELETE") && !/\bUSING\b/i.test(stmt)) {
    issues.push(`表 ${table} 策略 "${name}" (${cmd}) 最终态缺少 USING`);
  }
}

if (issues.length) {
  console.error(`❌ RLS 检查发现 ${issues.length} 个问题:`);
  issues.forEach((i) => console.error("  - " + i));
  process.exit(1);
}

console.log(`✅ RLS 迁移检查通过：${files.length} 个迁移，${policies.size} 条最终策略均符合规范`);
