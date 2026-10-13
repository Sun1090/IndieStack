/**
 * `RAISE` 占位符核对：先证明解析器认得实测行为，再用它扫仓库里的派生版演练 SQL。
 *
 * **为什么分两半**：只有扫描器没有形状用例，扫描器写错了也会「全绿」；
 * 只有形状用例没有扫描器，那它就只是在描述常识。本仓库已经为
 * 「恒真的用例」付过学费，所以两半都在，且扫描那半带**对照**。
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  auditRaiseFormats,
  countBarePercent,
  findRaiseStatements,
  parseRaiseStatement,
  splitTopLevelArgs,
} from "./raise-format";
import { stripSqlLineComments } from "./psql-meta";

describe("countBarePercent——%% 是转义，其余每个 % 都是占位符", () => {
  it("对照：这些形状全部来自 2026-10-13 本地栈实测", () => {
    expect(countBarePercent("A=20% B")).toBe(1); // ⇒ A=20X B
    expect(countBarePercent("A=20%% B")).toBe(0); // ⇒ A=20% B
    expect(countBarePercent("failures=% assertions=20% report=%")).toBe(3);
    expect(countBarePercent("%")).toBe(1);
    expect(countBarePercent("%%")).toBe(0);
    expect(countBarePercent("%%%")).toBe(1); // %% 吃掉前两个，第三个是占位符
    expect(countBarePercent("no percent")).toBe(0);
  });
});

describe("parseRaiseStatement", () => {
  it("格式串 + 参数：数量各自数对", () => {
    expect(parseRaiseStatement("raise exception 'A=% B', 'X';")).toMatchObject({
      placeholders: 1,
      args: 1,
      digitPercent: false,
    });
    // **`%%` 是转义，不该被当成百分比错位**（实测 `raise 'A=20%% B'` 零参数 ⇒ `A=20% B`）。
    // 这条样本是承重的：把判据从 `/\d%(?!%)/` 松成 `/\d%/` 只会在这里红。
    expect(parseRaiseStatement("raise exception 'A=20%% B';")).toMatchObject({
      placeholders: 0,
      args: 0,
      digitPercent: false,
    });
    // 而真·错位形状必须报（同一判据的另一侧，缺了它上面那条就成了恒假）
    expect(parseRaiseStatement("raise exception 'A=20% B';")).toMatchObject({
      placeholders: 1,
      args: 0,
      digitPercent: true,
    });
  });

  it("`||` 拼接的表达式**不能**被逗号切碎（逗号可能在字符串字面量里）", () => {
    // 本仓库报告语句的真实形状：一个占位、一个由 || 拼出来的参数
    const statement =
      "raise exception 'DRILL-RESULT %', 'failures=' || 0 || ' report=ALL-OK';";
    expect(parseRaiseStatement(statement)).toMatchObject({ placeholders: 1, args: 1 });
    // 括号里的逗号也不算：`coalesce(v, 'x, y')` 是**一个**参数
    expect(
      parseRaiseStatement("raise exception 'a=% b=%', coalesce(v, 'x, y'), 3;"),
    ).toMatchObject({ placeholders: 2, args: 2 });
    expect(splitTopLevelArgs("coalesce(v, 'x, y'), 3")).toHaveLength(2);
    // 直接 split(",") 会数出 4 个——那会让安全写法报错，于是检查被忽略
    expect("coalesce(v, 'x, y'), 3".split(",")).toHaveLength(4);
  });

  it("认出「数字紧跟裸 %」——数据库完全不报的那一种", () => {
    const parsed = parseRaiseStatement(
      "raise exception 'failures=% assertions=20% report=%', n, i, r;",
    );
    expect(parsed).toMatchObject({ placeholders: 3, args: 3, digitPercent: true });
    // 参数不够（PostgreSQL 会自己报 too few）
    expect(
      parseRaiseStatement("raise exception 'a=% b=20% c=%', n, r;").placeholders,
    ).toBe(3);
  });

  it("没有参数列表时 args 为 0", () => {
    expect(parseRaiseStatement("raise exception 'done';")).toMatchObject({
      placeholders: 0,
      args: 0,
    });
    // 但一旦文本里有裸 %，0 参数就是**错位**（实测 too few parameters）
    expect(parseRaiseStatement("raise exception 'A=20% B';")).toMatchObject({
      placeholders: 1,
      args: 0,
      digitPercent: true,
    });
  });
});

describe("auditRaiseFormats", () => {
  it("数量对不上 + 百分比字面量，两类都点名", () => {
    const findings = auditRaiseFormats(
      findRaiseStatements(
        "begin raise exception 'f=% assertions=20% r=%', 1, 2; end",
      ),
      "sample.sql",
    );
    // 3 占位 vs 2 参数；同时命中百分比判据 ⇒ 两条
    expect(findings).toHaveLength(2);
    expect(findings.map((finding) => finding.label)).toEqual(["sample.sql", "sample.sql"]);
  });

  it("安全的写法不报（对照：否则上面那条可能恒真）", () => {
    expect(
      auditRaiseFormats(
        findRaiseStatements(
          "begin raise exception 'DRILL %', 'failures=' || 0 || ' assertions=20'; end",
        ),
        "sample.sql",
      ),
    ).toEqual([]);
  });
});

describe("仓库里的派生版演练 SQL", () => {
  const dir = resolve(process.cwd(), "docs/operations/drills");
  // 只扫 `.single-do.sql`：正本走 psql，报告靠 `\echo` / 结果集，没有 RAISE 格式串
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".single-do.sql"))
    .sort();

  it("至少扫到一份（扫不到东西的检查等于没有检查）", () => {
    expect(files.length).toBeGreaterThanOrEqual(1);
  });

  it("每份都恰好有一条 RAISE，且占位符/参数对齐、不含百分比字面量", () => {
    const findings: string[] = [];
    for (const name of files) {
      const raw = readFileSync(resolve(dir, name), "utf8");
      // **只在代码里数**：本仓库的派生版文件头大量引用 `raise exception` 讲机制，
      // 不剥注释就会把说明文字当成语句（本轮在 parity 用例上刚踩过同一个坑）。
      const statements = findRaiseStatements(stripSqlLineComments(raw));
      // 报告通道只应有一条；多出来通常意味着有人拿 raise 当断言用
      expect(statements, `${name} 里的 RAISE 条数`).toHaveLength(1);
      findings.push(...auditRaiseFormats(statements, name).map((f) => `${f.label}: ${f.problem}`));
    }
    expect(findings).toEqual([]);
  });
});
