/**
 * 数据保留与账户擦除契约测试（v0.6.0 H08）
 *
 * 保留期、cron 任务名、擦除数据面与 PII 键同时存在于三处：`src/lib/privacy/data-policy.ts`
 * 常量、`supabase/migrations/032_data_retention_erasure.sql`（以及更早的 003 / 014 / 027 / 028）
 * 与 `docs/db/retention.md`。任何一处单独改动都不会有测试失败——而值班和隐私承诺按文档行动。
 *
 * 这里把三处钉在一起：常量 ↔ 迁移里的函数体/调度/撤权 ↔ 文档表格行，
 * 并额外校验确认短语与界面提示同源，避免「按提示输入却永远删不掉」。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_ERASURE_ARG,
  ACCOUNT_ERASURE_COUNT_KEYS,
  ACCOUNT_ERASURE_RPC,
  ACCOUNT_ERASURE_TARGETS,
  ACCOUNT_DELETION_CONFIRM_PHRASES,
  AUDIT_PII_METADATA_KEYS,
  RETENTION_POLICIES,
  isAccountDeletionConfirmed,
  parseAccountErasureCounts,
  type RetentionPolicy,
} from "./data-policy";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase/migrations");
const MIGRATION_SOURCES = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => ({ file, sql: fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8") }));
const MIGRATION_CORPUS = MIGRATION_SOURCES.map((source) => source.sql).join("\n");

const RETENTION_DOC = fs.readFileSync(
  path.join(process.cwd(), "docs/db/retention.md"),
  "utf8",
);

function normalize(sql: string): string {
  return sql.replace(/\s+/g, " ");
}

/** 定义某函数的迁移体（`create or replace function` 到下一个 `$$;`）。 */
function functionBody(name: string): string | null {
  const pattern = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\([\\s\\S]*?\\$\\$;`,
    "i",
  );
  const match = pattern.exec(MIGRATION_CORPUS);
  return match ? match[0] : null;
}

function docRow(needle: string): string | null {
  return (
    RETENTION_DOC.split("\n").find((line) => line.startsWith("|") && line.includes(needle)) ?? null
  );
}

describe("保留策略常量与迁移一致", () => {
  it.each(RETENTION_POLICIES.map((policy) => [policy.cronJob, policy] as const))(
    "%s：函数体按常量声明的天数与状态条件删除",
    (_job, policy) => {
      const body = functionBody(policy.cleanupFunction);
      expect(body, `${policy.cleanupFunction} 必须在某个迁移里定义`).not.toBeNull();
      const sql = normalize(body ?? "");

      expect(sql).toContain(`delete from ${policy.table}`);
      expect(sql).toContain(`${policy.column} < now() - interval '${policy.retentionDays} days'`);
      // 清理函数一律 security definer + 空 search_path，否则可被搜索路径劫持
      expect(sql).toMatch(/security definer set search_path = ''/);
      if (policy.statusPredicate) expect(sql).toContain(policy.statusPredicate);
    },
  );

  it.each(RETENTION_POLICIES.map((policy) => [policy.cronJob, policy] as const))(
    "%s：pg_cron 任务名与调度与常量一致",
    (_job, policy) => {
      // 迁移里的写法固定为多行 perform cron.schedule(...)，压平空白后即可逐字比对
      expect(normalize(MIGRATION_CORPUS)).toContain(
        `cron.schedule( '${policy.cronJob}', '${policy.schedule}', $$select public.${policy.cleanupFunction}()$$ )`,
      );
    },
  );

  it.each(RETENTION_POLICIES.map((policy) => [policy.cronJob, policy] as const))(
    "%s：清理函数只对 service_role 开放（028 的撤权结论必须覆盖每个新增函数）",
    (_job, policy) => {
      const sql = normalize(MIGRATION_CORPUS);
      const signature = `public.${policy.cleanupFunction}()`;
      expect(sql).toMatch(
        new RegExp(`revoke all on function ${escapeRegExp(signature)} from public, anon, authenticated`),
      );
      expect(sql).toMatch(
        new RegExp(`grant execute on function ${escapeRegExp(signature)} to service_role`),
      );
    },
  );

  it("没有未登记的清理函数散落在迁移里", () => {
    const defined = [...MIGRATION_CORPUS.matchAll(/create or replace function public\.([a-z_]+)/gi)]
      .map((match) => match[1])
      .filter((name) => /^(cleanup|prune)_/.test(name));
    expect(defined.sort()).toEqual(
      RETENTION_POLICIES.map((policy) => policy.cleanupFunction).sort(),
    );
  });
});

describe("保留策略文档与常量一致", () => {
  it.each(RETENTION_POLICIES.map((policy) => [policy.cronJob, policy] as const))(
    "%s：docs/db/retention.md 的表格行写着同样的函数与保留天数",
    (_job, policy: RetentionPolicy) => {
      const row = docRow(policy.cleanupFunction);
      expect(row, `${policy.cleanupFunction} 必须出现在保留策略表里`).not.toBeNull();
      expect(row).toContain(`${policy.retentionDays} 天`);
    },
  );

  it("文档不会留下没有代码支撑的保留承诺", () => {
    // 只认「函数调用」写法，避免把 `push.queue.prune_failed` 这类同名前缀的指标读成函数
    const docFunctions = [
      ...new Set(
        [...RETENTION_DOC.matchAll(/\b((?:cleanup|prune)_[a-z_]+)\(\)/g)].map((match) => match[1]),
      ),
    ];
    expect(new Set(docFunctions)).toEqual(new Set(RETENTION_POLICIES.map((p) => p.cleanupFunction)));
  });
});

describe("账户擦除契约", () => {
  it("RPC 名称与参数与迁移签名一致", () => {
    const body = functionBody(ACCOUNT_ERASURE_RPC);
    expect(body).not.toBeNull();
    expect(normalize(body ?? "")).toContain(`public.${ACCOUNT_ERASURE_RPC}(p_user_id uuid)`);
    expect(ACCOUNT_ERASURE_ARG).toBe("p_user_id");
  });

  it("级联覆盖不到的每个数据面都被擦除或匿名化", () => {
    const body = normalize(functionBody(ACCOUNT_ERASURE_RPC) ?? "");
    for (const target of ACCOUNT_ERASURE_TARGETS) {
      expect(body).toContain(`public.${target}`);
    }
    // 审计日志必须匿名化而不是删除：合规要保留行为事实
    expect(body).toContain("update public.audit_logs");
    expect(body).not.toMatch(/delete from public\.audit_logs/);
  });

  it("metadata 剔除的键与常量集合完全一致", () => {
    const body = normalize(functionBody(ACCOUNT_ERASURE_RPC) ?? "");
    const stripped = [...body.matchAll(/- '([a-z_]+)'/g)].map((match) => match[1]);
    expect(stripped).toEqual([...AUDIT_PII_METADATA_KEYS]);
  });

  it("擦除函数只对 service_role 开放", () => {
    const sql = normalize(MIGRATION_CORPUS);
    expect(sql).toContain(
      `revoke all on function public.${ACCOUNT_ERASURE_RPC}(uuid) from public, anon, authenticated`,
    );
    expect(sql).toContain(
      `grant execute on function public.${ACCOUNT_ERASURE_RPC}(uuid) to service_role`,
    );
  });

  it("生成的数据库类型里存在该 RPC（类型漂移即失败）", () => {
    const types = fs.readFileSync(
      path.join(process.cwd(), "src/lib/supabase/database.types.ts"),
      "utf8",
    );
    expect(types).toContain(`${ACCOUNT_ERASURE_RPC}: { Args: { ${ACCOUNT_ERASURE_ARG}: string }`);
  });
});

describe("删除确认短语", () => {
  it("两种语言的界面提示都原样包含服务端接受的短语", () => {
    const en = localeDangerValue("en", "confirmPhrase");
    const zh = localeDangerValue("zh-CN", "confirmPhrase");
    expect(en.toLowerCase()).toContain("delete");
    expect(zh).toContain("删除");
  });

  it("服务端只接受登记过的短语，且忽略大小写与首尾空白", () => {
    expect(ACCOUNT_DELETION_CONFIRM_PHRASES).toEqual(["delete", "删除"]);
    expect(isAccountDeletionConfirmed(" Delete ")).toBe(true);
    expect(isAccountDeletionConfirmed("删除")).toBe(true);
    expect(isAccountDeletionConfirmed("")).toBe(false);
    expect(isAccountDeletionConfirmed("delete me")).toBe(false);
    expect(isAccountDeletionConfirmed(undefined)).toBe(false);
    expect(isAccountDeletionConfirmed(42)).toBe(false);
  });
});

describe("parseAccountErasureCounts", () => {
  it("接受完整计数", () => {
    expect(
      parseAccountErasureCounts({ apiUsage: 3, contactMessages: 1, auditLogsAnonymized: 9 }),
    ).toEqual({ apiUsage: 3, contactMessages: 1, auditLogsAnonymized: 9 });
  });

  it.each([["null", null], ["数组", []], ["字符串", "ok"], ["缺键", { apiUsage: 1 }]])(
    "返回值形状不符时抛错而不是当作已擦除（%s）",
    (_label, value) => {
      expect(() => parseAccountErasureCounts(value)).toThrow();
    },
  );

  it("计数为负或非法数值时抛错", () => {
    expect(() =>
      parseAccountErasureCounts({ apiUsage: -1, contactMessages: 0, auditLogsAnonymized: 0 }),
    ).toThrow();
  });

  it("RPC 的计数键与 SQL 返回的键一致", () => {
    const body = normalize(functionBody(ACCOUNT_ERASURE_RPC) ?? "");
    for (const key of ACCOUNT_ERASURE_COUNT_KEYS) {
      expect(body).toContain(`'${key}'`);
    }
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function localeDangerValue(locale: string, key: string): string {
  const file = path.join(process.cwd(), "messages", locale, "dashboard.json");
  const messages = JSON.parse(fs.readFileSync(file, "utf8")) as {
    settings?: { sections?: { danger?: Record<string, string> } };
  };
  const value = messages.settings?.sections?.danger?.[key];
  expect(typeof value).toBe("string");
  return value as string;
}
