import { describe, expect, it } from "vitest";
import {
  BLOCKING_SEVERITY_LEVELS,
  CODEQL_ALERT_REGISTRY,
  inspectCodeqlAlerts,
  missingEntryFields,
  workingDaysBetween,
  type AlertRegistryEntry,
  type LiveAlert,
} from "./codeql-alert-registry";

function entry(overrides: Partial<AlertRegistryEntry> = {}): AlertRegistryEntry {
  return {
    number: 1,
    ruleId: "js/log-injection",
    verdict: "true-positive",
    decidedBy: "Sun1090",
    decidedOn: "2026-09-24",
    evidence: "issue #132",
    reviewBy: "2026-12-31",
    ...overrides,
  };
}

function alert(overrides: Partial<LiveAlert> = {}): LiveAlert {
  return {
    number: 1,
    ruleId: "js/log-injection",
    severity: "error",
    securitySeverityLevel: "medium",
    state: "open",
    createdAt: "2026-09-19",
    path: "src/lib/logger.ts",
    dismissedReason: null,
    ...overrides,
  };
}

describe("workingDaysBetween", () => {
  it("跳过周末", () => {
    // 2026-10-12 是周一，10-18 是周日 ⇒ 5 个工作日
    expect(workingDaysBetween("2026-10-12", "2026-10-18")).toBe(5);
  });

  it("同一天算 1 个工作日", () => {
    expect(workingDaysBetween("2026-10-12", "2026-10-12")).toBe(1);
  });

  it("倒序返回 0，日期格式不对返回 null", () => {
    expect(workingDaysBetween("2026-10-13", "2026-10-12")).toBe(0);
    expect(workingDaysBetween("2026/10/12", "2026-10-13")).toBeNull();
    expect(workingDaysBetween("2026-10-12", "")).toBeNull();
  });

  it("跨月的周数算得对（2026-09-27 周日 → 2026-10-13 周二 = 12 个工作日）", () => {
    // 这条就是 #18 的真实读数，SLA 判定依赖它
    expect(workingDaysBetween("2026-09-27", "2026-10-13")).toBe(12);
  });
});

describe("missingEntryFields", () => {
  it("完整登记返回空数组", () => {
    expect(missingEntryFields(entry())).toEqual([]);
  });

  it("缺判定人 / 证据 / 日期各报一项", () => {
    expect(missingEntryFields(entry({ decidedBy: "  " }))).toContain("decidedBy");
    expect(missingEntryFields(entry({ evidence: "" }))).toContain("evidence");
    expect(missingEntryFields(entry({ decidedOn: "24/09/2026" }))).toContain("decidedOn");
    expect(missingEntryFields(entry({ reviewBy: "soon" }))).toContain("reviewBy");
  });

  it("`triaging` 必须配一句为什么还没结案", () => {
    expect(missingEntryFields(entry({ verdict: "triaging" }))).toContain("note");
    expect(missingEntryFields(entry({ verdict: "triaging", note: "等 maintainer" }))).toEqual([]);
    // 已结案的结论不需要 note
    expect(missingEntryFields(entry({ verdict: "false-positive" }))).toEqual([]);
  });
});

describe("inspectCodeqlAlerts", () => {
  it("读不到实况 ⇒ 只报未知，绝不暗示「零回归」", () => {
    const report = inspectCodeqlAlerts([entry()], null, "2026-10-13");
    expect(report.issues.map((issue) => issue.code)).toEqual(["CODEQL_ALERT_LIVE_UNREADABLE"]);
    expect(report.stats.live).toBe(0);
  });

  it("实况有、台账没有 ⇒ 未登记（这条就是「零回归」的正向形态）", () => {
    const report = inspectCodeqlAlerts([], [alert()], "2026-10-13");
    expect(report.issues.map((issue) => issue.code)).toEqual(["CODEQL_ALERT_UNREGISTERED"]);
    expect(report.issues[0].message).toContain("#1");
  });

  it("台账有、实况没有 ⇒ 腐烂条目", () => {
    const report = inspectCodeqlAlerts([entry()], [], "2026-10-13");
    expect(report.issues.map((issue) => issue.code)).toEqual(["CODEQL_ALERT_STALE_ENTRY"]);
  });

  it("编号对得上但规则不同 ⇒ 告警被删重建，台账结论已失效", () => {
    const report = inspectCodeqlAlerts(
      [entry({ ruleId: "js/log-injection" })],
      [alert({ ruleId: "js/some-other-rule" })],
      "2026-10-13",
    );
    expect(report.issues.map((issue) => issue.code)).toEqual(["CODEQL_ALERT_RULE_MISMATCH"]);
  });

  it("复核期限过了 ⇒ 红", () => {
    const report = inspectCodeqlAlerts(
      [entry({ reviewBy: "2026-10-01" })],
      [alert()],
      "2026-10-13",
    );
    expect(report.issues.map((issue) => issue.code)).toContain("CODEQL_ALERT_REVIEW_OVERDUE");
  });

  it("阻断级还开着 ⇒ 红，即使已判定为假阳性", () => {
    const report = inspectCodeqlAlerts(
      [entry({ verdict: "false-positive", number: 18, ruleId: "js/insufficient-password-hash" })],
      [alert({ number: 18, ruleId: "js/insufficient-password-hash", securitySeverityLevel: "high" })],
      "2026-10-13",
    );
    expect(report.issues.map((issue) => issue.code)).toContain("CODEQL_ALERT_BLOCKING_OPEN");
  });

  it("阻断级但已 dismissal ⇒ 不再判红", () => {
    const report = inspectCodeqlAlerts(
      [entry({ verdict: "false-positive" })],
      [alert({ securitySeverityLevel: "critical", dismissedReason: "false positive" })],
      "2026-10-13",
    );
    expect(report.issues.map((issue) => issue.code)).not.toContain("CODEQL_ALERT_BLOCKING_OPEN");
  });

  it("`security_severity_level` 为 null ⇒ 判「未知」，**不**当成低危", () => {
    const report = inspectCodeqlAlerts(
      [entry({ verdict: "false-positive" })],
      [alert({ securitySeverityLevel: null })],
      "2026-10-13",
    );
    expect(report.issues.map((issue) => issue.code)).toContain("CODEQL_ALERT_SEVERITY_UNKNOWN");
  });

  it("triaging 且超过 5 个工作日 ⇒ SLA 红", () => {
    const report = inspectCodeqlAlerts(
      [entry({ verdict: "triaging", note: "等 dismissal" })],
      [alert({ createdAt: "2026-09-27" })],
      "2026-10-13",
    );
    expect(report.issues.map((issue) => issue.code)).toContain("CODEQL_ALERT_TRIAGE_SLA_BREACHED");
  });

  it("已结案的旧告警不会被 SLA 判红（那是假红）", () => {
    const report = inspectCodeqlAlerts(
      [entry({ verdict: "true-positive" })],
      [alert({ createdAt: "2025-01-01" })],
      "2026-10-13",
    );
    expect(report.issues.map((issue) => issue.code)).not.toContain("CODEQL_ALERT_TRIAGE_SLA_BREACHED");
  });

  it("一切一致 ⇒ 无 issue", () => {
    const report = inspectCodeqlAlerts(
      [entry({ verdict: "true-positive" })],
      [alert({ createdAt: "2026-10-12" })],
      "2026-10-13",
    );
    expect(report.issues).toEqual([]);
    expect(report.stats).toEqual({ registered: 1, live: 1, unregistered: 0, stale: 0 });
  });
});

describe("台账本体", () => {
  it("每条登记都字段完整", () => {
    for (const item of CODEQL_ALERT_REGISTRY) {
      expect(missingEntryFields(item), `#${item.number}`).toEqual([]);
    }
  });

  it("编号不重复", () => {
    const numbers = CODEQL_ALERT_REGISTRY.map((item) => item.number);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it("复核期限都晚于判定日期", () => {
    for (const item of CODEQL_ALERT_REGISTRY) {
      expect(item.reviewBy > item.decidedOn, `#${item.number}`).toBe(true);
    }
  });
});

describe("阻断档映射", () => {
  it("只有 high 与 critical 落在 runbook 的 ≥7.0", () => {
    expect([...BLOCKING_SEVERITY_LEVELS].sort()).toEqual(["critical", "high"]);
    expect(BLOCKING_SEVERITY_LEVELS.has("medium")).toBe(false);
    expect(BLOCKING_SEVERITY_LEVELS.has("low")).toBe(false);
  });
});
