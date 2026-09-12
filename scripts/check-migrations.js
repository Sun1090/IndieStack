#!/usr/bin/env node
/** Validate migration filenames and ordering before a database is touched. */
const fs = require("fs");
const path = require("path");
const dir = path.join(__dirname, "..", "supabase", "migrations");
const files = fs.readdirSync(dir).filter((file) => file.endsWith(".sql")).sort();
const issues = [];
const seen = new Map();
for (const file of files) {
  const match = /^(\d+)_([a-z0-9][a-z0-9_-]*)\.sql$/i.exec(file);
  if (!match) {
    issues.push(`${file}: migration filename must be <number>_<description>.sql`);
    continue;
  }
  const number = Number(match[1]);
  if (seen.has(number)) issues.push(`${file}: duplicate migration number ${match[1]} (also ${seen.get(number)})`);
  seen.set(number, file);
}
if (issues.length) {
  console.error(`❌ migration drift check failed (${issues.length}):`);
  issues.forEach((issue) => console.error(`  - ${issue}`));
  process.exit(1);
}
console.log(`✅ migration filename check passed: ${files.length} migrations, ${seen.size} unique versions`);
