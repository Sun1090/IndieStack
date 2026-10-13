import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PROBE_MARKER,
  PROBE_PLAN,
  assertProbeSqlReadOnly,
  auditProbePlan,
  classifyProbeResponse,
  firstKeyword,
  probeExitCode,
  splitTopLevelStatements,
  summarizeProbe,
  type ProbeResponse,
  type ProbeStep,
  type ProbeVerdict,
} from "./cloud-sql-probe";

const REPO_ROOT = path.resolve(__dirname, "../../..");

/** 取一条 SQL 的首关键字，用于断言计划里某步的形状。 */
function firstOf(sql: string): string {
  return sql.trim().split(/\s+/)[0].toLowerCase();
}

function readOnly(sql: string): boolean {
  return assertProbeSqlReadOnly(sql).readOnly;
}

function response(overrides: Partial<ProbeResponse>): ProbeResponse {
  return { status: 201, json: null, bodyText: "", transportError: null, ...overrides };
}

function step(id: ProbeStep["id"]): ProbeStep {
  const found = PROBE_PLAN.find((entry) => entry.id === id);
  if (!found) throw new Error(`计划里没有 ${id}`);
  return found;
}

function verdict(overrides: Partial<ProbeVerdict>): ProbeVerdict {
  return {
    id: "READ_ONLY_ENDPOINT",
    outcome: "EXECUTED",
    status: 201,
    evidence: "",
    // 默认给一个耗时读数：证据里要带上它，而缺省值刻意不是 0
    // （0 会被读成「快得可疑」而不是「没测」）。
    elapsedMs: 300,
    ...overrides,
  };
}

describe("splitTopLevelStatements", () => {
  it("按顶层分号切，且保留语句正文", () => {
    const { statements, unterminated } = splitTopLevelStatements(
      "select 1 as first_ok; select 2 as second_ok",
    );
    expect(unterminated).toBeNull();
    expect(statements.map((statement) => statement.text)).toEqual([
      "select 1 as first_ok",
      "select 2 as second_ok",
    ]);
  });

  it("字符串字面量里的分号不是语句边界", () => {
    const { statements } = splitTopLevelStatements("select 'a;b' as s");
    expect(statements).toHaveLength(1);
    expect(statements[0].text).toBe("select 'a;b' as s");
  });

  it("注释里的分号不是语句边界", () => {
    const { statements } = splitTopLevelStatements("select 1 -- trailing; note\n; select 2");
    // `text` 原样保留注释（它要进日志，改动了就不是人写的那条 SQL）；
    // 判定一律看 `masked`——注释位在 masked 里是空格。
    expect(statements.map((statement) => statement.text)).toEqual([
      "select 1 -- trailing; note",
      "select 2",
    ]);
    expect(statements.map((statement) => statement.masked.trim())).toEqual([
      "select 1",
      "select 2",
    ]);
  });

  it("块注释整体被抹掉", () => {
    const { statements } = splitTopLevelStatements("/* delete from t; */ select 1");
    expect(statements).toHaveLength(1);
    expect(firstKeyword(statements[0].masked)).toBe("select");
  });

  it("dollar-quote 块体里的分号不切语句，块体本身被收集", () => {
    const { statements } = splitTopLevelStatements("do $x$ insert into t; select 1; end $x$");
    expect(statements).toHaveLength(1);
    expect(statements[0].bodies).toEqual([" insert into t; select 1; end "]);
  });

  it("嵌套 dollar-quote 的块体也能取到（正本用的是 $fn$ 包 $$ 的形状）", () => {
    const { statements } = splitTopLevelStatements(
      "do $outer$ execute $fn$ create function f() language plpgsql as $$ begin perform 1; end;$$ $fn$; end $outer$",
    );
    expect(statements).toHaveLength(1);
    expect(statements[0].bodies.some((body) => body.includes("perform 1"))).toBe(true);
  });

  it("未闭合的 dollar-quote 报原因而不是抛异常", () => {
    // 第一版在这里直接 TypeError 崩掉——崩溃不是「拒绝」，调用方会当成探测故障。
    expect(() => splitTopLevelStatements("do $x$ begin end")).not.toThrow();
    expect(splitTopLevelStatements("do $x$ begin end").unterminated).toContain("dollar-quote");
  });

  it("未闭合的单引号与块注释同样报原因", () => {
    expect(splitTopLevelStatements("select 'unclosed").unterminated).toContain("单引号");
    expect(splitTopLevelStatements("/* never closed").unterminated).toContain("块注释");
  });

  it("空语句与纯注释不产出条目", () => {
    expect(splitTopLevelStatements("  ;  ;  ").statements).toEqual([]);
    expect(splitTopLevelStatements("-- only a comment").statements).toEqual([]);
  });

  it("'' 是字面量里的引号，不是闭合", () => {
    const { statements, unterminated } = splitTopLevelStatements("select 'it''s; fine' as s");
    expect(unterminated).toBeNull();
    expect(statements).toHaveLength(1);
  });
});

describe("assertProbeSqlReadOnly：放行", () => {
  it("四种只读首关键字", () => {
    expect(readOnly("select 1")).toBe(true);
    expect(readOnly("with a as (select 1) select * from a")).toBe(true);
    expect(readOnly("show server_version")).toBe(true);
    expect(readOnly("reset all")).toBe(true);
  });

  it("字符串与注释里的写入关键字不算数", () => {
    expect(readOnly("select 'insert into t; --' as s")).toBe(true);
    expect(readOnly("select 1 -- update x set y = 1")).toBe(true);
  });

  it("不改变状态的 DO 块放行", () => {
    expect(readOnly(`do $p$ begin raise exception '${PROBE_MARKER} ok'; end $p$`)).toBe(true);
  });

  it("尾随分号与前后空白不影响判定", () => {
    expect(readOnly("  select 1;  ")).toBe(true);
  });
});

describe("assertProbeSqlReadOnly：拒绝（失败封闭）", () => {
  it("DML / DDL 首关键字一律拒", () => {
    for (const sql of [
      "insert into t values (1)",
      "update t set a = 1",
      "delete from t",
      "create table t (a int)",
      "drop table t",
      "truncate t",
      "grant all on t to public",
    ]) {
      expect(readOnly(sql)).toBe(false);
    }
  });

  it("with … (insert …) 这种 CTE 写入要拒：首关键字在白名单里不代表语句不写", () => {
    expect(readOnly("with d as (delete from t returning *) select * from d")).toBe(false);
  });

  it("select … into … 要拒：首关键字在白名单里，而写入信号只有 into 这一个词", () => {
    // 这条专门盯 `into` 在黑名单里。删掉 `into` 之后没有任何别的用例变红——
    // 变异核对实测过（M2 SURVIVED），所以这条不是补装饰。
    // `select id into tmp from t` 会**建一张表**，而它长得完全像一条只读 select。
    expect(readOnly("select id into tmp_table from t")).toBe(false);
    expect(assertProbeSqlReadOnly("select id into tmp_table from t").reasons.join(" ")).toContain(
      "INTO",
    );
  });

  it("DO 块体里的写入动作要拒", () => {
    expect(readOnly("do $p$ begin insert into t values (1); end $p$")).toBe(false);
    expect(readOnly("do $p$ begin perform public.cleanup_old_notifications(); end $p$")).toBe(false);
    expect(
      readOnly("do $p$ execute $fn$ create function f() language plpgsql as $$ begin drop table t; end;$$ $fn$; end $p$"),
    ).toBe(false);
  });

  it("取不到块体的 DO 块拒——不知道它做了什么就不能放行", () => {
    expect(readOnly("do")).toBe(false);
  });

  it("explain analyze 拒（它会真执行）", () => {
    expect(readOnly("explain analyze select 1")).toBe(false);
  });

  it("E'' 转义字符串拒：扫描器不认识这种形状，不猜", () => {
    expect(readOnly("select E'\\'' ; insert into t values (1)")).toBe(false);
  });

  it("空语句与纯空白拒", () => {
    expect(readOnly("")).toBe(false);
    expect(readOnly("   \n  ")).toBe(false);
  });

  it("未闭合的引号 / dollar-quote 拒", () => {
    expect(readOnly("select 'x")).toBe(false);
    expect(readOnly("do $x$ begin end")).toBe(false);
  });

  it("多语句里只要有一条可写就整体拒", () => {
    expect(readOnly("select 1; delete from t")).toBe(false);
  });

  it("仓库里两份演练正本必须被判为可写（守卫不许把 B04 自动放行）", () => {
    // 这条是整份文件最要紧的一条：B04 的演练 SQL 会真的删数据。
    // 守卫一旦哪天误判它为只读，探测就会带着它打生产库。
    for (const file of [
      "docs/operations/drills/retention-cleanup.sql",
      "docs/operations/drills/account-erasure.sql",
    ]) {
      const sql = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
      const verdictReport = assertProbeSqlReadOnly(sql);
      expect(verdictReport.readOnly, `${file} 不该被判为只读`).toBe(false);
      expect(verdictReport.reasons.length).toBeGreaterThan(0);
    }
  });
});

describe("auditProbePlan", () => {
  it("内置计划四条全部可证只读", () => {
    expect(auditProbePlan()).toEqual({ ok: true, rejections: [] });
  });

  it("计划里混进一条写入 ⇒ 审计不通过并点名", () => {
    const tampered = [...PROBE_PLAN, { ...step("MULTI_STATEMENT"), sql: "delete from t" }];
    const audit = auditProbePlan(tampered);
    expect(audit.ok).toBe(false);
    expect(audit.rejections.map((entry) => entry.id)).toContain("MULTI_STATEMENT");
  });

  it("计划里有验 read_only 字段是否生效的一对（带 / 不带）", () => {
    // 这一对要紧在：本探测打「能写」端点时宣称有两层防护，
    // 第二层就是 `read_only: true`。不验它，那句「两层」就只是文档里的一句话。
    const on = step("READ_ONLY_FLAG_ON");
    const off = step("READ_ONLY_FLAG_OFF");
    expect(on.sql).toBe(off.sql);
    expect(on.readOnlyFlag).toBe(true);
    expect(off.readOnlyFlag).toBe(false);
    expect(on.expectation).toEqual({
      kind: "fieldEquals",
      column: "transaction_read_only",
      value: "on",
    });
    // 两条都必须是 `show`：验防护本身不能引入写入风险。
    expect(firstOf(on.sql)).toBe("show");
    expect(firstOf(off.sql)).toBe("show");
  });

  it("判据按字段值比较，不按响应文本子串：`on` 会命中列名里的 on", () => {
    // 第一版写的是「在响应里找子串 on」，于是值为 off 的响应也算命中——
    // 因为列名 `transaction_read_only` 自己含 "on"。
    // 一个同时匹配「是」与「否」的判据等于没有判据，而且它错的方向
    // 正好是让「防护失效」看起来像「防护生效」。
    const on = step("READ_ONLY_FLAG_ON");
    const contradicted = classifyProbeResponse(
      on,
      response({ json: [{ transaction_read_only: "off" }] }),
    );
    expect(contradicted.outcome).toBe("REJECTED_SQL");
    expect(contradicted.evidence).toContain("[FIELD_CONTRADICTED]");
  });

  it("读不到那一列 ⇒ UNKNOWN，不压成「失效」也不压成「生效」", () => {
    const on = step("READ_ONLY_FLAG_ON");
    for (const json of [[], null, [{ other_column: "on" }], "not-an-array"]) {
      expect(classifyProbeResponse(on, response({ json })).outcome).toBe("UNKNOWN");
    }
  });

  it("值为布尔 true 或字符串 on（含大写）两种形状都认", () => {
    const on = step("READ_ONLY_FLAG_ON");
    expect(
      classifyProbeResponse(on, response({ json: [{ transaction_read_only: true }] })).outcome,
    ).toBe("EXECUTED");
    expect(
      classifyProbeResponse(on, response({ json: [{ transaction_read_only: "ON" }] })).outcome,
    ).toBe("EXECUTED");
  });

  it("多语句的决定性判据是「前序语句报错」，不是耗时", () => {
    // 换成报错判据的原因写在 PROBE_PLAN 那条注释里：
    // run 38331295999 实测同形状的两条查询相差 478ms，
    // 而 pg_sleep(1) 相对对照只高出 483ms——噪声与信号同量级，计时答不了这个问题。
    const entry = step("MULTI_STATEMENT_FIRST_ERROR");
    expect(entry.sql).toContain("1/0");
    expect(entry.raisesIfExecuted).toBe(true);
    expect(entry.expectation).toEqual({ kind: "exception", marker: "division by zero" });
    // 计划里不该再有计时步骤。
    expect(PROBE_PLAN.map((item) => item.id)).not.toContain("MULTI_STATEMENT_FIRST_EFFECT");
    expect(PROBE_PLAN.map((item) => item.id)).not.toContain("MULTI_STATEMENT_CONTROL");
  });
});

describe("classifyProbeResponse", () => {
  it("201 + 行数组 ⇒ EXECUTED", () => {
    const verdictReport = classifyProbeResponse(step("READ_ONLY_ENDPOINT"), response({ json: [{ probe_ok: 1 }] }));
    expect(verdictReport.outcome).toBe("EXECUTED");
  });

  it("DO 块那条：服务端把 PROBE-RESULT 报回来才算跑通", () => {
    const doStep = step("SINGLE_DO_BLOCK");
    expect(
      classifyProbeResponse(doStep, response({ status: 500, bodyText: `ERROR: ${PROBE_MARKER} ok` })).outcome,
    ).toBe("EXECUTED");
    // 201 但读不到报告通道 ⇒ 不知道，不算通过。
    expect(classifyProbeResponse(doStep, response({ json: [] })).outcome).toBe("UNKNOWN");
  });

  it("401 / 403 ⇒ REFUSED_AUTH（这是权限结论，不是「端点不存在」）", () => {
    expect(classifyProbeResponse(step("MULTI_STATEMENT"), response({ status: 401 })).outcome).toBe(
      "REFUSED_AUTH",
    );
    expect(classifyProbeResponse(step("MULTI_STATEMENT"), response({ status: 403 })).outcome).toBe(
      "REFUSED_AUTH",
    );
  });

  it("429 ⇒ RATE_LIMITED", () => {
    expect(classifyProbeResponse(step("MULTI_STATEMENT"), response({ status: 429 })).outcome).toBe(
      "RATE_LIMITED",
    );
  });

  it("prepared statement 报错被单独标出来：那正是 issue #245 要的答案", () => {
    const verdictReport = classifyProbeResponse(
      step("MULTI_STATEMENT"),
      response({
        status: 400,
        json: { message: 'cannot insert multiple commands into a prepared statement' },
      }),
    );
    expect(verdictReport.outcome).toBe("REJECTED_SQL");
    expect(verdictReport.evidence).toContain("[PREPARED_STATEMENT]");
  });

  it("普通 SQL 报错不贴 PREPARED_STATEMENT 标签", () => {
    const verdictReport = classifyProbeResponse(
      step("MULTI_STATEMENT"),
      response({ status: 400, json: { message: 'relation "nope" does not exist' } }),
    );
    expect(verdictReport.outcome).toBe("REJECTED_SQL");
    expect(verdictReport.evidence).not.toContain("PREPARED_STATEMENT");
  });

  it("多语句因别的原因被拒 ⇒ 不许算成「限制在服务端」", () => {
    // 这条盯 summarizeProbe 里的 `evidence.includes("PREPARED_STATEMENT")`。
    // 把它写成「只要被拒就算」会把「我们 SQL 写错了 / 端点形状变了」误答成
    // issue #245 有了结论——那是比「没答案」更坏的结果。
    const rejected = PROBE_PLAN.map((entry) =>
      entry.id === "MULTI_STATEMENT"
        ? verdict({
            id: entry.id,
            outcome: "REJECTED_SQL",
            status: 400,
            evidence: 'relation "nope" does not exist',
          })
        : verdict({ id: entry.id }),
    );
    const report = summarizeProbe(rejected);
    expect(report.multiStatementWorks).toBe(false);
    expect(report.multiStatementBlocked).toBe(false);
  });

  it("传输层失败 ⇒ UNKNOWN，且不带状态码冒充结论", () => {
    const verdictReport = classifyProbeResponse(
      step("READ_ONLY_ENDPOINT"),
      response({ status: 0, transportError: "The operation was aborted due to timeout" }),
    );
    expect(verdictReport.outcome).toBe("UNKNOWN");
    expect(verdictReport.status).toBe(0);
  });

  it("201 但形状不认识 ⇒ UNKNOWN（不把「没返回数组」当成成功）", () => {
    expect(
      classifyProbeResponse(step("READ_ONLY_ENDPOINT"), response({ bodyText: "<html>proxy error</html>" })).outcome,
    ).toBe("UNKNOWN");
  });

  it("意料之外的状态码 ⇒ UNKNOWN", () => {
    expect(classifyProbeResponse(step("READ_ONLY_ENDPOINT"), response({ status: 404 })).outcome).toBe(
      "UNKNOWN",
    );
  });

  it("每条结论都带上真实耗时读数", () => {
    // 口径在 2026-10-13 改过一次：原先只给「耗时判据」那条贴 elapsed，
    // 结果读数变成孤零零一个「2547ms」而没有任何基线可比。
    // 后来整个计时判据被废弃（见 PROBE_PLAN 里决定性那条的注释），
    // 但**每条都记耗时**保留下来：它现在是这个探测唯一的延迟观测点。
    const plain = classifyProbeResponse(
      step("READ_ONLY_ENDPOINT"),
      response({ json: [{ probe_ok: 1 }], elapsedMs: 42 }),
    );
    expect(plain.elapsedMs).toBe(42);
    expect(plain.evidence).toContain("[elapsed=42ms]");
  });

  it("拿不到耗时 ⇒ 结论里不出现 elapsed，也不出现假的 0", () => {
    const plain = classifyProbeResponse(step("READ_ONLY_ENDPOINT"), response({ json: [{ a: 1 }] }));
    expect(plain.elapsedMs).toBeUndefined();
    expect(plain.evidence).not.toContain("elapsed");
  });

  it("证据文本被截断：不把整页 HTML 抄进日志", () => {
    const verdictReport = classifyProbeResponse(
      step("READ_ONLY_ENDPOINT"),
      response({ status: 502, bodyText: "x".repeat(5000) }),
    );
    expect(verdictReport.evidence.length).toBeLessThanOrEqual(340);
  });
});

describe("summarizeProbe / probeExitCode", () => {
  const allExecuted = PROBE_PLAN.map((entry) => verdict({ id: entry.id }));

  it("五条都跑通 ⇒ 各能力结论都为真，退出码 0", () => {
    const report = summarizeProbe(allExecuted);
    expect(report.readOnlyEndpointWorks).toBe(true);
    expect(report.writeEndpointWorks).toBe(true);
    expect(report.singleDoBlockWorks).toBe(true);
    expect(report.multiStatementFullyExecutes).toBe(true);
    expect(report.multiStatementSkipsEarlier).toBe(false);
    expect(report.hasUnknown).toBe(false);
    expect(probeExitCode(report)).toBe(0);
  });

  it("决定性那条报出 division by zero ⇒ 前序语句确实执行了", () => {
    const report = summarizeProbe(
      allExecuted.map((entry) =>
        entry.id === "MULTI_STATEMENT_FIRST_ERROR"
          ? verdict({
              id: entry.id,
              outcome: "EXECUTED",
              status: 400,
              evidence: "division by zero",
            })
          : entry,
      ),
    );
    expect(report.multiStatementFullyExecutes).toBe(true);
    expect(report.multiStatementSkipsEarlier).toBe(false);
    expect(probeExitCode(report)).toBe(0);
  });

  it("决定性那条拿到 201 ⇒ 判为「前序语句被静默跳过」，退出码 1", () => {
    // 这是本探测最要紧的一种坏读数：HTTP 201，看起来完全成功，
    // 但排在前面的语句根本没跑。当成「多语句可用」的话，
    // 多语句演练 SQL 会「通过」而实际什么都没做——比跑不了更坏，
    // 因为跑不了会喊人，静默少跑不会。
    const report = summarizeProbe(
      allExecuted.map((entry) =>
        entry.id === "MULTI_STATEMENT_FIRST_ERROR"
          ? verdict({
              id: entry.id,
              outcome: "REJECTED_SQL",
              status: 201,
              evidence: "[FIRST_STATEMENT_SKIPPED] 期望 division by zero",
            })
          : entry,
      ),
    );
    expect(report.multiStatementWorks).toBe(true);
    expect(report.multiStatementFullyExecutes).toBe(false);
    expect(report.multiStatementSkipsEarlier).toBe(true);
    expect(probeExitCode(report)).toBe(1);
  });

  it("决定性那条因别的原因被拒 ⇒ 不许算成「静默跳过」", () => {
    // 把「任何拒绝」都读成「服务端会静默跳过前序语句」是一个具体的假结论，
    // 而且方向很坏：它会让人以为这个端点不能用于多语句，
    // 而真相只是我们那条 SQL 没跑成（语法、权限、端点换形状都可能）。
    const report = summarizeProbe(
      allExecuted.map((entry) =>
        entry.id === "MULTI_STATEMENT_FIRST_ERROR"
          ? verdict({
              id: entry.id,
              outcome: "REJECTED_SQL",
              status: 400,
              evidence: 'operator does not exist: integer / integer',
            })
          : entry,
      ),
    );
    expect(report.multiStatementFullyExecutes).toBe(false);
    expect(report.multiStatementSkipsEarlier).toBe(false);
  });

  it("「没报 prepared statement 错」与「前序语句真的执行了」是两个结论", () => {
    // 这两个字段必须能各自独立为真假，否则汇总层就把它们悄悄合并成一个了。
    const report = summarizeProbe(
      allExecuted.map((entry) =>
        entry.id === "MULTI_STATEMENT_FIRST_ERROR"
          ? verdict({
              id: entry.id,
              outcome: "REJECTED_SQL",
              status: 201,
              evidence: "[FIRST_STATEMENT_SKIPPED] 前面的语句被静默跳过",
            })
          : entry,
      ),
    );
    expect(report.multiStatementWorks).toBe(true);
    expect(report.multiStatementFullyExecutes).toBe(false);
    expect(report.multiStatementSkipsEarlier).toBe(true);
    expect(probeExitCode(report)).toBe(1);
  });

  it("多语句被接受 ⇒ issue #245 的答案是「限制在 CLI 侧」", () => {
    const report = summarizeProbe(allExecuted);
    expect(report.multiStatementWorks).toBe(true);
    expect(report.multiStatementBlocked).toBe(false);
  });

  it("多语句被 prepared statement 拒 ⇒ 答案反过来，且退出码是 1 不是 2", () => {
    const report = summarizeProbe(
      allExecuted.map((entry) =>
        entry.id === "MULTI_STATEMENT"
          ? verdict({ id: entry.id, outcome: "REJECTED_SQL", status: 400, evidence: "[PREPARED_STATEMENT] x" })
          : entry,
      ),
    );
    expect(report.multiStatementWorks).toBe(false);
    expect(report.multiStatementBlocked).toBe(true);
    expect(probeExitCode(report)).toBe(1);
  });

  it("任何一步不知道 ⇒ 退出码 2，优先于「被拒」", () => {
    const report = summarizeProbe(
      allExecuted.map((entry) =>
        entry.id === "SINGLE_DO_BLOCK" ? verdict({ id: entry.id, outcome: "UNKNOWN" }) : entry,
      ),
    );
    expect(report.hasUnknown).toBe(true);
    expect(probeExitCode(report)).toBe(2);
  });

  it("限流算「不知道」：它既不是通过也不是失败", () => {
    const report = summarizeProbe([verdict({ id: "READ_ONLY_ENDPOINT", outcome: "RATE_LIMITED" })]);
    expect(report.hasUnknown).toBe(true);
    expect(probeExitCode(report)).toBe(2);
  });

  it("401 时四个能力结论全为 false，但不谎称「端点不存在」", () => {
    const report = summarizeProbe(
      PROBE_PLAN.map((entry) =>
        verdict({ id: entry.id, outcome: "REFUSED_AUTH", status: 401, evidence: "bad token" }),
      ),
    );
    expect(report.readOnlyEndpointWorks).toBe(false);
    expect(report.writeEndpointWorks).toBe(false);
    expect(report.singleDoBlockWorks).toBe(false);
    expect(report.hasUnknown).toBe(false);
    expect(probeExitCode(report)).toBe(1);
  });

  it("计划缺步 ⇒ 对应结论 false（不会因为「没测」而算通过）", () => {
    const report = summarizeProbe([verdict({ id: "READ_ONLY_ENDPOINT" })]);
    expect(report.readOnlyEndpointWorks).toBe(true);
    expect(report.writeEndpointWorks).toBe(false);
    expect(report.multiStatementWorks).toBe(false);
    expect(report.multiStatementFullyExecutes).toBe(false);
    // 「没测」不等于「跳过了」：后者是一个明确的坏结论，不能由缺步推出。
    expect(report.multiStatementSkipsEarlier).toBe(false);
  });
});
