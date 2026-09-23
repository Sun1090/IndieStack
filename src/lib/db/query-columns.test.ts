/**
 * 查询列名一致性规则的单测。
 *
 * 关键约束：门禁必须既能抓到拼错的列名，又不会把 PostgREST 的合法寻址（`*`、`alias:col`、
 * JSON 路径、关联嵌入）当成错误；并且当它自己读不到代码库时必须失败，而不是报绿。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  inspectQueryColumns,
  parseGeneratedTables,
  readColumnAddress,
  type QueryColumnSource,
} from "./query-columns";

const TYPES_FIXTURE = `
export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: { id: string; email: string | null; display_name: string | null }
        Insert: { id: string; email?: string | null; password_hash: string }
        Update: { email?: string | null }
        Relationships: []
      }
      notifications: {
        Row: { id: string; user_id: string; title: string; email_sent: boolean; created_at: string }
        Insert: { user_id: string; title: string }
        Update: { email_sent?: boolean }
        Relationships: []
      }
    }
    Views: {
      user_stats: { Row: { user_id: string | null; team_count: number | null } }
      _opaque: { Row: Record<string, never> }
    }
  }
}
`;

/** 手工快照用的是对象字面量，也必须读得出来。 */
const OBJECT_LITERAL_TYPES = `
export const Database = {
  public: {
    Tables: {
      api_usage: { Row: { id: 0, method: "", path: "" } },
    },
  },
};
`;

function source(file: string, content: string): QueryColumnSource {
  return { file, content };
}

function codes(
  sources: QueryColumnSource[],
  typesContent: string = TYPES_FIXTURE,
): string[] {
  return inspectQueryColumns({ sources, typesContent }).issues.map((issue) => issue.code);
}

function messages(
  sources: QueryColumnSource[],
  typesContent: string = TYPES_FIXTURE,
): string[] {
  return inspectQueryColumns({ sources, typesContent }).issues.map((issue) => issue.message);
}

function stats(
  sources: QueryColumnSource[],
  typesContent: string = TYPES_FIXTURE,
) {
  return inspectQueryColumns({ sources, typesContent }).stats;
}

const TYPES = parseGeneratedTables(TYPES_FIXTURE);

/** 一条合法查询：让门禁有事可做，避免「什么都没读到」的失败关闭掩盖真正的断言。 */
const REAL_CHAIN = source(
  "src/real.ts",
  `export async function a(client) {
  return client.from("notifications").eq("user_id", id);
}`,
);

describe("parseGeneratedTables", () => {
  it("reads every table and its Row columns out of the generated type literal", () => {
    expect(TYPES.map((table) => table.table)).toEqual(["notifications", "profiles", "user_stats"]);
    expect(TYPES.find((table) => table.table === "profiles")?.columns).toEqual([
      "display_name",
      "email",
      "id",
    ]);
  });

  it("treats a view as addressable, because PostgREST reads it like a table", () => {
    expect(
      codes([
        source(
          "src/view.ts",
          `export async function a(client) {
  return client.from("user_stats").select("user_id, team_count").eq("team_count", 3);
}`,
        ),
      ]),
    ).toEqual([]);
    // 视图的列集同样是真的：视图上的拼写错误也要报。
    expect(
      codes([
        source(
          "src/view.ts",
          `export async function a(client) {
  return client.from("user_stats").eq("tma_count", 3);
}`,
        ),
      ]),
    ).toEqual(["QUERY_COLUMN_NOT_IN_TABLE"]);
  });

  it("drops a relation whose Row it cannot expand instead of rejecting every column", () => {
    // `_opaque` 的 Row 是 `Record<string, never>`：读不出列，就当这条关系不存在。
    expect(TYPES.map((table) => table.table)).not.toContain("_opaque");
  });

  it("reads a hand-written object-literal snapshot too", () => {
    expect(parseGeneratedTables(OBJECT_LITERAL_TYPES)).toEqual([
      { table: "api_usage", columns: ["id", "method", "path"], writeColumns: [] },
    ]);
  });

  it("does not treat Insert/Update/Views as addressable columns", () => {
    // `password_hash` 只出现在 Insert 里，行类型里没有它。
    const columns = TYPES.find((table) => table.table === "profiles")?.columns ?? [];
    expect(columns).toEqual(["display_name", "email", "id"]);
    expect(columns).not.toContain("password_hash");
  });
});

describe("readColumnAddress", () => {
  it("splits a select list but keeps a filter argument as one column", () => {
    expect(readColumnAddress("select", "id, email_sent")).toEqual({
      columns: ["id", "email_sent"],
      exotic: [],
    });
    expect(readColumnAddress("eq", "user_id")).toEqual({
      columns: ["user_id"],
      exotic: [],
    });
  });

  it("resolves an alias to the column behind it", () => {
    expect(readColumnAddress("select", "sent:email_sent")).toEqual({
      columns: ["email_sent"],
      exotic: [],
    });
  });

  it("leaves PostgREST addressing that no row type contains alone", () => {
    expect(readColumnAddress("select", "*")).toEqual({ columns: [], exotic: ["*"] });
    expect(readColumnAddress("eq", "metadata->>role")).toEqual({
      columns: [],
      exotic: ["metadata->>role"],
    });
    expect(readColumnAddress("select", "amount::text")).toEqual({
      columns: [],
      exotic: ["amount::text"],
    });
  });

  it("judges each select token on its own instead of dropping the whole list", () => {
    expect(readColumnAddress("select", "id, metadata->>role, title")).toEqual({
      columns: ["id", "title"],
      exotic: ["metadata->>role"],
    });
  });
});

describe("inspectQueryColumns", () => {
  it("accepts columns that exist on the queried table", () => {
    expect(
      codes([
        source(
          "src/a.ts",
          `export async function a(client) {
  return client.from("notifications").select("id, title").eq("user_id", id).order("created_at", { ascending: false });
}`,
        ),
      ]),
    ).toEqual([]);
  });

  it("flags a filter column that no row type has", () => {
    expect(
      messages([
        source(
          "src/a.ts",
          `export async function a(client) {
  return client.from("notifications").eq("usr_id", id);
}`,
        ),
      ]),
    ).toEqual([expect.stringContaining('src/a.ts:2 uses .eq("usr_id") against table notifications')]);
  });

  it("flags a misspelled order and select column", () => {
    const issues = messages([
      source(
        "src/order.ts",
        `export async function a(client) {
  return client.from("notifications").select("titel").order("started_at", { ascending: false });
}`,
      ),
    ]);
    expect(issues).toEqual([
      expect.stringContaining('.order("started_at")'),
      expect.stringContaining('.select("titel")'),
    ]);
  });

  it("checks the real column behind an alias, so a typo cannot hide in the alias", () => {
    const issues = codes([
      source(
        "src/alias.ts",
        `export async function a(client) {
  return client.from("notifications").select("total:amout");
}`,
      ),
    ]);
    expect(issues).toEqual(["QUERY_COLUMN_NOT_IN_TABLE"]);
  });

  it("reports a table the generated types do not know instead of staying silent", () => {
    const ghost = source(
      "src/b.ts",
      `export async function a(client) {
  return client.from("notifactions").eq("usr_id", 1);
}`,
    );
    expect(codes([ghost])).toEqual(["QUERY_TABLE_UNKNOWN"]);
    // 覆盖计数只算「真的判断过的链」：把读不懂的链也算进去，失败封闭就成了摆设。
    const report = stats([REAL_CHAIN, ghost]);
    expect(report).toMatchObject({ fromCalls: 1, checked: 1 });
  });

  it("ignores Storage buckets, which reuse .from() for a name that is not a table", () => {
    const storageChain = source(
      "src/c.ts",
      `export async function a(client) {
  return client.storage.from("avatars").upload(key, body);
}`,
    );
    // 桶名既不报未知表，也不进入列名判断——只有 1 条真查询被读到。
    expect(codes([REAL_CHAIN, storageChain])).toEqual([]);
    expect(stats([REAL_CHAIN, storageChain])).toMatchObject({ fromCalls: 1, checked: 1 });
  });

  it("still ignores a bucket whose name collides with a table", () => {
    // `profiles` 既是桶名也是表名：把它当查询读，就会开始判断 `.select("titel")`。
    const bucket = source(
      "src/bucket.ts",
      `export async function a(client) {
  return client.storage.from("profiles").select("titel");
}`,
    );
    expect(codes([bucket, REAL_CHAIN])).toEqual([]);
    expect(stats([bucket, REAL_CHAIN]).fromCalls).toBe(1);
  });

  it("skips a chain that embeds a relation, because the base Row no longer bounds it", () => {
    const report = stats([
      source(
        "src/d.ts",
        `export async function a(client) {
  return client.from("notifications").select("id, profiles:user_id (email)").eq("bad_column", 1);
}`,
      ),
    ]);
    expect(report).toMatchObject({ fromCalls: 1, skippedEmbedded: 1, checked: 0 });
  });

  it("counts addressing it deliberately refuses to judge", () => {
    const report = stats([
      source(
        "src/e.ts",
        `export async function a(client) {
  return client.from("notifications").select("id, metadata->>role");
}`,
      ),
    ]);
    expect(report).toMatchObject({ checked: 1, skippedArguments: 1 });
  });

  it("only counts chains on known tables once each, even when several methods follow", () => {
    const report = stats([
      source(
        "src/f.ts",
        `export async function a(client) {
  return client.from("notifications").select("id").eq("user_id", 1).lte("created_at", d);
}`,
      ),
    ]);
    expect(report).toMatchObject({ fromCalls: 1, checked: 3 });
  });

  it("ignores Array.from and other same-shaped calls that are not queries", () => {
    expect(stats([source("src/g.ts", `const a = Array.from(new Set([1]));`)]).fromCalls).toBe(0);
    expect(
      stats([source("src/h.ts", `const a = Array.from({ length: 3 }, (_, i) => i);`)]).fromCalls,
    ).toBe(0);
  });

  it("fails closed when the generated types cannot be read", () => {
    const report = inspectQueryColumns({
      typesContent: `export type Database = { public: { Tables: Record<string, never> } }`,
      sources: [source("src/a.ts", `client.from("notifications").eq("usr_id", 1);`)],
    });
    expect(report.issues.map((issue) => issue.code)).toEqual(["QUERY_TYPES_UNREADABLE"]);
    // 读不到类型时不能顺带报告一堆列名问题。
    expect(report.issues).toHaveLength(1);
  });

  it("fails closed when no column address was checked at all", () => {
    const report = inspectQueryColumns({
      typesContent: TYPES_FIXTURE,
      sources: [source("src/a.ts", `client.from("notifications").delete();`)],
    });
    expect(report.issues.map((issue) => issue.code)).toEqual(["QUERY_COLUMN_GATE_VACUOUS"]);
    expect(report.stats.checked).toBe(0);
  });
});

describe("仓库现状", () => {
  /** 与 scripts/lib/query-columns-check.js 同一套范围：src/ 下非测试的 ts/tsx。 */
  function repoSources() {
    const srcDir = path.join(process.cwd(), "src");
    return fs
      .readdirSync(srcDir, { withFileTypes: true, recursive: true })
      .flatMap((entry) => {
        if (!entry.isFile() || !/\.(ts|tsx)$/.test(entry.name)) return [];
        if (/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) return [];
        const absolute = path.join(entry.parentPath ?? srcDir, entry.name);
        return [
          source(
            path.relative(process.cwd(), absolute).split(path.sep).join("/"),
            fs.readFileSync(absolute, "utf8"),
          ),
        ];
      });
  }

  it("仓库里每个字面量列名都对得上生成的行类型", () => {
    const report = inspectQueryColumns({
      typesContent: fs.readFileSync(
        path.join(process.cwd(), "src", "lib", "supabase", "database.types.ts"),
        "utf8",
      ),
      sources: repoSources(),
    });
    expect(report.issues.map((issue) => issue.message)).toEqual([]);
    // 覆盖下限：扫描真的读到了查询链，而不是把范围调空后假绿。
    expect(report.stats.tables).toBeGreaterThanOrEqual(15);
    expect(report.stats.fromCalls).toBeGreaterThanOrEqual(50);
    expect(report.stats.checked).toBeGreaterThanOrEqual(100);
    // 写载荷那一半同样要有下限，否则「规则没读到任何东西」和「读到了但都合法」在输出里同形。
    expect(report.stats.writeCalls).toBeGreaterThanOrEqual(30);
    expect(report.stats.writeChecked).toBeGreaterThanOrEqual(80);
  });
});

/**
 * 写载荷那一半（`.insert()` / `.update()` / `.upsert()`）。
 *
 * 判的是生成的 `Insert`/`Update` 键集合，不是 `Row`：`Row` 里有 PostgREST 自己派生的列
 * （生成的 id、stored tsvector），写进去反而是错的；而只写进 `Insert` 的列（这里的
 * `password_hash`）确实合法。两条反例各自钉住这两个方向。
 */
describe("query write payloads", () => {
  const writeCodes = (content: string) =>
    codes([source("w.ts", content)]).filter((code) => code === "QUERY_WRITE_COLUMN_NOT_IN_TABLE");

  it("接受 Update 里的键", () => {
    expect(writeCodes(`supabase.from("profiles").update({ email: "a@b.c" })`)).toEqual([]);
  });

  it("拒绝 Update 里没有的键，并点名表与方法", () => {
    const found = inspectQueryColumns({
      typesContent: TYPES_FIXTURE,
      sources: [source("w.ts", `supabase.from("profiles").update({ bio: 1 })`)],
    }).issues;
    expect(found).toHaveLength(1);
    expect(found[0].code).toBe("QUERY_WRITE_COLUMN_NOT_IN_TABLE");
    expect(found[0].message).toContain("profiles");
    expect(found[0].message).toContain(".update");
  });

  it("Insert 独有、Row 里没有的列是合法写入", () => {
    expect(writeCodes(`supabase.from("profiles").insert({ password_hash: "h" })`)).toEqual([]);
  });

  it("Row 里有但不可写的列要判错", () => {
    expect(writeCodes(`supabase.from("profiles").update({ display_name: "n" })`)).toHaveLength(1);
  });

  it("数组载荷逐条判，upsert 同样判", () => {
    expect(writeCodes(`supabase.from("profiles").insert([{ email: "a" }, { nope: 1 }])`)).toHaveLength(1);
    expect(writeCodes(`supabase.from("profiles").upsert({ alsonope: 1 })`)).toHaveLength(1);
  });

  it("读不出的载荷形状不报错，但会被数出来", () => {
    const report = inspectQueryColumns({
      typesContent: TYPES_FIXTURE,
      sources: [
        source(
          "w.ts",
          `supabase.from("profiles").update({ ...patch });
           supabase.from("profiles").update(variable);
           supabase.from("profiles").insert({ [k]: 1 });`,
        ),
      ],
    });
    expect(report.stats.writeCalls).toBe(3);
    expect(report.stats.writeChecked).toBe(0);
    expect(report.stats.writeSkippedShapes).toBe(3);
    // 什么都没判成时要失败关闭，而不是报绿。
    expect(report.issues.map((issue) => issue.code)).toContain("QUERY_COLUMN_GATE_VACUOUS");
  });

  it("没有 Insert/Update 的表不参与判定，但计数可见", () => {
    const loose = TYPES_FIXTURE.replace(
      "        Insert: { id: string; email?: string | null; password_hash: string }\n        Update: { email?: string | null }",
      "",
    );
    const report = inspectQueryColumns({
      typesContent: loose,
      sources: [source("w.ts", `supabase.from("profiles").update({ whatever: 1 })`)],
    });
    expect(report.stats.writeVocabularyMissing).toBe(1);
    expect(report.stats.writeChecked).toBe(0);
  });
});
