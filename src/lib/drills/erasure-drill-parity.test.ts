/**
 * 派生版（`account-erasure.single-do.sql`）必须与正本断言**逐条对齐**。
 *
 * **为什么需要机器核对**：派生版的文件头写着「改断言请改正本，再重新压缩这里，
 * 否则两份会各自漂移」——那是一句**承诺**。而本仓库已经付过一次学费：
 * 「结论写进对应 runbook 的执行记录小节」也是承诺，那个小节**根本不存在**。
 * 承诺没有钉子就会长大，所以这里量。
 *
 * 与 `src/lib/mock/auth-surface.test.ts` 同一形态：静态扫描跑在 `pnpm test` 里，
 * 而 `pnpm test` 本来就是 push 的硬性前置（AGENTS.md），不再套一层 `check-*`。
 *
 * **它刻意只核对「标签集合与顺序」，不核对期望值**：
 * 派生版把 3 段信息性输出搬进了报告文本（不参与断言），
 * 而期望值两边都是字面量、由压缩过程机械带过来。
 * 真正会漂移的是**有哪些断言**，那才是这条用例承重的部分。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { stripSqlLineComments } from "./psql-meta";
import { auditRaiseFormats, findRaiseStatements } from "./raise-format";

const SOURCE = resolve(process.cwd(), "docs/operations/drills/account-erasure.sql");
const DERIVED = resolve(process.cwd(), "docs/operations/drills/account-erasure.single-do.sql");

/**
 * 正本里的断言行长这样（`check` / `actual` / `expected` 三列）：
 *   `select 'api-usage-for-user-gone' as check, (select count(*) …) as actual, 0::bigint as expected`
 * 以及后续的 `union all select 'label', (select count(*) …), N`。
 *
 * **必须要求同一行里出现 `count(*)`**：否则会把
 * `insert into public.upload_objects … select 'avatars', v_avatar_key, …`
 * 里的表名字面量（`'avatars'` / `'covers'`）当成断言标签——
 * 第一版就是这么误报出 25 条的（真值 20）。
 */
function sourceAssertionLabels(sql: string): string[] {
  const labels: string[] = [];
  // 按「一条 select / union all select」切块，块内同时有标签、count(*) 与数字才算断言
  const rows = sql.split(/(?=select\s+')/);
  for (const row of rows) {
    const match = /^select\s+'([a-z0-9-]+)'/.exec(row);
    if (!match) continue;
    const head = row.slice(0, 400);
    if (head.includes("count(*)") && /\d/.test(head)) labels.push(match[1]);
  }
  return labels;
}

function derivedAssertionLabels(sql: string): string[] {
  return [...sql.matchAll(/drill_assert\('([^']+)'/g)].map((match) => match[1]);
}

describe("account-erasure 正本 vs 单语句派生版", () => {
  const source = readFileSync(SOURCE, "utf8");
  const derived = readFileSync(DERIVED, "utf8");
  const sourceLabels = sourceAssertionLabels(source);
  const derivedLabels = derivedAssertionLabels(derived);
  /**
   * **只在代码里数**，不数说明文字。
   *
   * 第一版直接对全文正则，结果把文件头那段解释里的
   * `execute 'set role service_role'` 也算了进去（2 数成 3）——
   * 而它恰好是**唯一一处**能证明「角色切换被保留」的证据，多算就是假阳性。
   */
  const derivedCode = stripSqlLineComments(derived);

  it("扫描器本身认得出 20 条（扫不到东西的检查等于没有检查）", () => {
    expect(sourceLabels).toHaveLength(20);
    expect(derivedLabels).toHaveLength(20);
    // 对照：把表名字面量误当断言的那个 bug 会在这里露头
    expect(sourceLabels).not.toContain("avatars");
    expect(sourceLabels).not.toContain("covers");
  });

  it("断言标签**集合与顺序**逐条相同", () => {
    expect(derivedLabels).toEqual(sourceLabels);
  });

  it("派生版仍是一条语句，且不含任何 psql 元命令", () => {
    // 元命令是这份派生版存在的理由：HTTP 通道送不出去
    expect(derivedCode).not.toMatch(/^\s*\\(set|echo|gset)\b/m);
    expect(derivedCode).not.toMatch(/\s\\gset\b/);
    // 对照：正本**确实**有这些，否则上面那两个 not 可能只是因为扫错了文件
    expect(sourceAssertionLabels(source)).toHaveLength(20);
    expect(source).toMatch(/\\\gset\s+drill_/);
    // 顶层只有一个 DO 块（正本有 begin; / rollback; 与多条语句）
    expect(derivedCode.match(/^DO \$drill\$/gm)).toHaveLength(1);
    expect(derivedCode).not.toMatch(/^begin;/m);
    expect(derivedCode).not.toMatch(/^rollback;/m);
  });

  it("派生版保留 `set role service_role`——那是演练对象的一部分，不是噪声", () => {
    // 那三个函数的 EXECUTE 只给了 service_role。删掉角色切换，
    // 演练就变成「postgres 什么都能干」的自证，权限形状这一面**不再被覆盖**。
    const switches = derivedCode.match(/execute 'set role service_role'/g) ?? [];
    expect(switches).toHaveLength(2);
    expect(derivedCode.match(/execute 'reset role'/g)).toHaveLength(2);
    // 对照：正本也是 2 开 2 关（少一次就等于少覆盖一段调用路径）
    const sourceSwitches = source.match(/^set role service_role;/gm) ?? [];
    expect(sourceSwitches).toHaveLength(2);
  });

  it("报告语句只留**一个**占位符——多占位配百分比文本会静默错位", () => {
    // **复用 `raise-format.ts`，不在这里再手搓一份解析器**：
    // 本仓库刚为「两处各写就会各错一份」写过一条教训（剥注释那次）。
    // 解析器自身的形状用例在 `raise-format.test.ts`，这里只管这份文件。
    const statements = findRaiseStatements(derivedCode);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatchObject({ placeholders: 1, args: 1, digitPercent: false });
    expect(auditRaiseFormats(statements, "derived")).toEqual([]);
  });
});
