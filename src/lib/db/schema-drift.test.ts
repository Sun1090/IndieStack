/**
 * schema 漂移判定的单测。
 *
 * 重点不在「能发现缺列」（那是显而易见的），而在三件容易做错的事：
 *   - 读不到实况时必须说「未知」，既不能绿也不能编出一堆缺失列；
 *   - 生产多出来的表不算漂移（否则这个项目的 5 张无关表会天天报警）；
 *   - 比对集为空要判红——一条什么都没比的红检查比没有检查更危险。
 */
import { describe, expect, it } from "vitest";
import {
  collectReferencedTables,
  inspectSchemaDrift,
  parseLiveSchema,
  type LiveTable,
} from "./schema-drift";

const TYPES = `export type Database = {
  public: {
    Tables: {
      notifications: {
        Row: {
          id: string;
          user_id: string;
          email_sent: boolean;
          email_skipped_reason: string | null;
        };
        Insert: { id?: string; user_id: string };
        Update: { id?: string };
      };
      profiles: {
        Row: { id: string; display_name: string | null };
        Insert: { id: string };
        Update: { id?: string };
      };
      never_queried: {
        Row: { id: string };
        Insert: { id: string };
        Update: { id?: string };
      };
    };
    Views: {};
    Functions: {};
    Enums: {};
    CompositeTypes: {};
  };
};
`;

const SOURCES = [
  {
    file: "src/lib/repositories/notifications.ts",
    content: `const a = admin.from("notifications").select("id");
const b = admin.from("profiles").select("id");
`,
  },
];

function live(overrides: Partial<Record<string, string[]>> = {}): LiveTable[] {
  return [
    {
      table: "notifications",
      columns: ["id", "user_id", "email_sent", "email_skipped_reason"],
    },
    { table: "profiles", columns: ["id", "display_name"] },
    ...Object.entries(overrides).map(([table, columns]) => ({ table, columns: columns ?? [] })),
  ];
}

describe("parseLiveSchema()", () => {
  it("读出 definitions 里每张表的属性名", () => {
    const parsed = parseLiveSchema({
      definitions: { notifications: { properties: { id: { type: "string" } } } },
    });
    expect(parsed).toEqual([{ table: "notifications", columns: ["id"] }]);
  });

  it("文档不是对象 / 没有 definitions → null（= 未知，不是空库）", () => {
    expect(parseLiveSchema(null)).toBeNull();
    expect(parseLiveSchema("[]")).toBeNull();
    expect(parseLiveSchema({ paths: {} })).toBeNull();
  });

  it("单张表没有 properties 时跳过它，而不是把整份文档判废", () => {
    expect(
      parseLiveSchema({
        definitions: { broken: { type: "object" }, good: { properties: { id: {} } } },
      }),
    ).toEqual([{ table: "good", columns: ["id"] }]);
  });
});

describe("collectReferencedTables()", () => {
  it("只认字面量表名", () => {
    expect(
      collectReferencedTables([
        {
          file: "src/x.ts",
          content: `admin.from("a").select("id"); admin.from(tableName).select("id");`,
        },
      ]),
    ).toEqual(new Set(["a"]));
  });
});

describe("inspectSchemaDrift()", () => {
  it("列齐全时无问题，且比对计数如实反映工作量", () => {
    const report = inspectSchemaDrift(TYPES, SOURCES, live());
    expect(report.issues).toEqual([]);
    // never_queried 不参与：代码从没 .from() 过它
    expect(report.stats.referencedTables).toBe(2);
    expect(report.stats.checkedColumns).toBe(6);
  });

  it("线上缺列 → SCHEMA_LIVE_COLUMN_MISSING，并点名是哪一列", () => {
    const missing = live();
    const notifications = missing.find((table) => table.table === "notifications");
    if (notifications) {
      notifications.columns = notifications.columns.filter((c) => c !== "email_skipped_reason");
    }
    const report = inspectSchemaDrift(TYPES, SOURCES, missing);
    expect(report.issues.map((issue) => issue.code)).toEqual(["SCHEMA_LIVE_COLUMN_MISSING"]);
    expect(report.issues[0].message).toContain("notifications.email_skipped_reason");
  });

  it("读不到实况 → 只报 UNREADABLE，绝不编造缺失列，也绝不判绿", () => {
    const report = inspectSchemaDrift(TYPES, SOURCES, null);
    expect(report.issues.map((issue) => issue.code)).toEqual(["SCHEMA_LIVE_UNREADABLE"]);
    expect(report.stats.checkedColumns).toBe(0);
    expect(report.unmanagedTables).toEqual([]);
  });

  it("生产多出来的表不算漂移，但要如实列出来", () => {
    const report = inspectSchemaDrift(TYPES, SOURCES, live({ progress: ["id"], wrongbook: ["id"] }));
    expect(report.issues).toEqual([]);
    expect(report.unmanagedTables).toEqual(["progress", "wrongbook"]);
  });

  it("代码引用的整张表在线上不存在 → 报表级缺失，不刷一屏列级假警", () => {
    const withoutProfiles = live().filter((table) => table.table !== "profiles");
    const report = inspectSchemaDrift(TYPES, SOURCES, withoutProfiles);
    expect(report.issues.map((issue) => issue.code)).toEqual(["SCHEMA_LIVE_TABLE_MISSING"]);
    expect(report.issues[0].message).toContain("profiles");
  });

  it("比对集为空 → 判红：扫不到东西的检查等于没有检查", () => {
    const report = inspectSchemaDrift(
      TYPES,
      [{ file: "src/other.ts", content: `admin.from("something_else")` }],
      live(),
    );
    expect(report.issues.map((issue) => issue.code)).toEqual(["SCHEMA_LIVE_EMPTY"]);
  });

  it("代码引用了生成类型里没有的表 → 不参与比对（那是 check:query-columns 的职责）", () => {
    const report = inspectSchemaDrift(
      TYPES,
      [{ file: "src/x.ts", content: `admin.from("notifications"); admin.from("typo_table");` }],
      live({ typo_table: ["id"] }),
    );
    expect(report.issues).toEqual([]);
    expect(report.stats.referencedTables).toBe(1);
  });

  it("OpenAPI 里列顺序不同不影响判定", () => {
    const reordered = live().map((table) => ({ ...table, columns: [...table.columns].reverse() }));
    expect(inspectSchemaDrift(TYPES, SOURCES, reordered).issues).toEqual([]);
  });
});
