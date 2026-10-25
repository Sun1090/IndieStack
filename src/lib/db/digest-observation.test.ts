import { describe, expect, it } from "vitest";
import {
  judgeDigestObservation,
  pickReadChannel,
  toWorkerRunRow,
  type WorkerRunRow,
} from "./digest-observation";

function row(partial: Partial<WorkerRunRow> & { created_at: string }): WorkerRunRow {
  return { pulled: null, sent: null, failed: null, backlog: null, skipped: null, ...partial };
}

const SINCE = "2026-10-24T10:42:42Z";
const FIRST = "2026-10-25T09:00:00.000Z";
const AFTER = "2026-10-25T09:30:00Z";

describe("judgeDigestObservation", () => {
  it("读数窗口未开 ⇒ TOO_EARLY，绝不把「没有行」读成「坏了」", () => {
    const report = judgeDigestObservation({ rows: [], sinceIso: SINCE, firstExpectedIso: FIRST, nowIso: "2026-10-25T06:00:00Z" });
    expect(report.verdict).toBe("TOO_EARLY");
  });

  it("窗口已开且没有行 ⇒ NOT_TRIGGERED（405 同型的库侧形态）", () => {
    const report = judgeDigestObservation({ rows: [], sinceIso: SINCE, firstExpectedIso: FIRST, nowIso: AFTER });
    expect(report.verdict).toBe("NOT_TRIGGERED");
  });

  it("窗口前的旧行不参与判定（since 过滤）", () => {
    const old = row({ created_at: "2026-10-20T09:00:00Z", sent: 3 });
    const report = judgeDigestObservation({ rows: [old], sinceIso: SINCE, firstExpectedIso: FIRST, nowIso: AFTER });
    expect(report.verdict).toBe("NOT_TRIGGERED");
  });

  it("最新轮 sent>0 且 failed=0 ⇒ 端到端跑通", () => {
    const run = row({ created_at: "2026-10-25T09:00:05Z", pulled: 2, sent: 2, failed: 0, backlog: 5, skipped: 1 });
    const report = judgeDigestObservation({ rows: [run], sinceIso: SINCE, firstExpectedIso: FIRST, nowIso: AFTER });
    expect(report.verdict).toBe("COMPLETED_OK");
    expect(report.evidence).toContain("sent=2");
  });

  it("failed>0 ⇒ COMPLETED_FAILING：跑通了，但方向是坏的", () => {
    const run = row({ created_at: "2026-10-25T09:00:05Z", pulled: 2, sent: 0, failed: 2 });
    const report = judgeDigestObservation({ rows: [run], sinceIso: SINCE, firstExpectedIso: FIRST, nowIso: AFTER });
    expect(report.verdict).toBe("COMPLETED_FAILING");
  });

  it("0 发送且 backlog>0 ⇒ COMPLETED_BACKLOG（跑通了但队列仍堵着）", () => {
    const run = row({ created_at: "2026-10-25T09:00:05Z", pulled: 0, sent: 0, failed: 0, backlog: 77 });
    const report = judgeDigestObservation({ rows: [run], sinceIso: SINCE, firstExpectedIso: FIRST, nowIso: AFTER });
    expect(report.verdict).toBe("COMPLETED_BACKLOG");
  });

  it("多行取时间最新的一行判定", () => {
    const rows = [
      row({ created_at: "2026-10-25T09:00:05Z", sent: 1, failed: 0 }),
      row({ created_at: "2026-10-26T09:00:05Z", sent: 0, failed: 3 }),
    ];
    const report = judgeDigestObservation({ rows, sinceIso: SINCE, firstExpectedIso: FIRST, nowIso: "2026-10-26T10:00:00Z" });
    expect(report.verdict).toBe("COMPLETED_FAILING");
  });

  it("时间参数解析失败 ⇒ TOO_EARLY（不基于读不出的时间下结论）", () => {
    const report = judgeDigestObservation({ rows: [], sinceIso: "not-a-date", firstExpectedIso: FIRST, nowIso: AFTER });
    expect(report.verdict).toBe("TOO_EARLY");
  });
});

describe("toWorkerRunRow", () => {
  it("计数缺失按 null（未知），不当 0；created_at 必须存在", () => {
    expect(toWorkerRunRow({ created_at: "2026-10-25T09:00:05Z", pulled: 2 })).toEqual(
      row({ created_at: "2026-10-25T09:00:05Z", pulled: 2 }),
    );
    expect(toWorkerRunRow({ pulled: 2 })).toBeNull();
    expect(toWorkerRunRow(null)).toBeNull();
    expect(toWorkerRunRow("x")).toBeNull();
  });
});

describe("pickReadChannel（本机到底有哪个凭据）", () => {
  it("有 URL + service_role 就走 PostgREST，**即使没有 sbp_ 令牌**", () => {
    // 这条钉的是 2026-10-25 实测到的那个假阴性：本机两个都有、令牌没有，
    // 旧实现只认令牌，于是把「唯一在途的证据任务」挡在门外。
    expect(
      pickReadChannel({
        supabaseUrl: "https://x.supabase.co",
        serviceRoleKey: "jwt",
        accessToken: "",
      }),
    ).toBe("rest");
  });

  it("只有 sbp_ 令牌 ⇒ 退到 Management API 只读 SQL", () => {
    expect(
      pickReadChannel({ supabaseUrl: "", serviceRoleKey: "", accessToken: "sbp_x" }),
    ).toBe("management-api");
  });

  it("service_role 有、URL 没有 ⇒ 不能走 PostgREST（少一半不算配好）", () => {
    expect(
      pickReadChannel({ supabaseUrl: "", serviceRoleKey: "jwt", accessToken: "" }),
    ).toBe("unavailable");
  });

  it("空白值等价于没有（`.env` 写 `KEY=` 的常见踩法）", () => {
    expect(
      pickReadChannel({ supabaseUrl: "  ", serviceRoleKey: " ", accessToken: "   " }),
    ).toBe("unavailable");
  });
});
