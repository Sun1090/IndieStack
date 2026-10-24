import { describe, expect, it } from "vitest";
import {
  buildHistoryInsertSql,
  buildMigrationApplyPlan,
  isVersionApplied,
  migrationSha256,
  sqlLiteral,
} from "./migration-apply";
import { normalizeMigrationVersion } from "./migration-status";

const SQL = "create table t (id int primary key);\ncommit;\n";
const ENTRY = {
  version: "036",
  fileName: "036_demo.sql",
  sha256: migrationSha256(SQL),
};
const ENTRIES = [ENTRY, { version: "035", fileName: "035_worker_run_backlog_skipped.sql" }];

describe("migrationSha256 / sqlLiteral", () => {
  it("与 check:migrations 同一把 sha256 尺", () => {
    expect(migrationSha256(SQL)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("单引号翻倍——历史 INSERT 是唯一拼字符串字面量的地方", () => {
    expect(sqlLiteral("o'brien")).toBe("'o''brien'");
  });
});

describe("buildHistoryInsertSql", () => {
  it("用序号形状落库：version=序号、name=去 .sql 文件名、原文入 statements", () => {
    const sql = buildHistoryInsertSql("036", "036_demo.sql", SQL);
    expect(sql).toContain("insert into supabase_migrations.schema_migrations (version, name, statements)");
    expect(sql).toContain("'036', '036_demo', ");
    expect(sql).toContain("::text[])");
  });
});

describe("isVersionApplied", () => {
  it("按归一化版本号比较（形状无关）", () => {
    const applied = [{ raw: "2026102409000000", version: "2026102409000000" }];
    expect(isVersionApplied("036", applied, normalizeMigrationVersion)).toBe(false);
    expect(
      isVersionApplied("036", [{ raw: "036", version: normalizeMigrationVersion("036") }], normalizeMigrationVersion),
    ).toBe(true);
  });

  it("读不到云端（null）一律返回 false——放行与否由调用方按「未知」处理", () => {
    expect(isVersionApplied("036", null, normalizeMigrationVersion)).toBe(false);
  });
});

describe("buildMigrationApplyPlan", () => {
  const base = { manifestEntries: ENTRIES, fileText: SQL, applied: [], normalize: normalizeMigrationVersion };

  it("全部前提满足 ⇒ 计划齐备，历史行用序号形状", () => {
    const result = buildMigrationApplyPlan({ ...base, version: "036" });
    if (!("plan" in result)) throw new Error("应为 plan");
    expect(result.plan.version).toBe("036");
    expect(result.plan.fileName).toBe("036_demo.sql");
    expect(result.plan.applySql).toBe(SQL);
    expect(result.plan.historyInsertSql).toContain("'036', '036_demo'");
  });

  it("不在 manifest 里 ⇒ 拒绝", () => {
    const result = buildMigrationApplyPlan({ ...base, version: "099" });
    expect(result).toMatchObject({ block: { code: "APPLY_VERSION_NOT_IN_MANIFEST" } });
  });

  it("文件内容与 manifest 的 SHA-256 不一致 ⇒ 拒绝（应用一条没人审计过的 SQL 不可行）", () => {
    const result = buildMigrationApplyPlan({ ...base, version: "036", fileText: `${SQL}-- tampered\n` });
    expect(result).toMatchObject({ block: { code: "APPLY_SHA_MISMATCH" } });
  });

  it("读不到文件 ⇒ 拒绝", () => {
    const result = buildMigrationApplyPlan({ ...base, version: "036", fileText: null });
    expect(result).toMatchObject({ block: { code: "APPLY_FILE_UNREADABLE" } });
  });

  it("云端已 applied ⇒ 拒绝重放", () => {
    const result = buildMigrationApplyPlan({
      ...base,
      version: "036",
      applied: [{ raw: "036", version: "36" }],
    });
    expect(result).toMatchObject({ block: { code: "APPLY_ALREADY_APPLIED" } });
  });
});
