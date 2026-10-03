import { describe, expect, it } from "vitest";
import {
  DEPENDENCY_AUDIT_EXCEPTIONS,
  EXCEPTION_MODULE_PATH,
  inspectDependencyAudit,
  type AuditException,
  type DependencyAuditVerdict,
} from "./dependency-audit";

/** 一条真实的 advisory 形状（字段名取自 `pnpm audit --json` 的 `advisories` 映射）。 */
interface AdvisoryOptions {
  advisoryId?: string | null;
  module?: string;
  severity?: string;
  dev?: boolean;
  version?: string;
  path?: string;
}

function advisory({
  advisoryId = "GHSA-vfj7-8cjw-p6xm",
  module = "braces",
  severity = "high",
  dev = true,
  version = "3.0.3",
  path = ".>eslint-config-next>@next/eslint-plugin-next>fast-glob>micromatch>braces",
}: AdvisoryOptions = {}) {
  return {
    id: 1240992,
    github_advisory_id: advisoryId === null ? undefined : advisoryId,
    title: "braces vulnerable to stack-exhaustion denial of service",
    module_name: module,
    vulnerable_versions: "<=3.0.3",
    patched_versions: ">=3.0.4",
    severity,
    findings: [{ version, paths: [path], dev, optional: false, bundled: false }],
  };
}

function report(advisories: Record<string, unknown>, counts?: { high: number; critical: number }) {
  const high = counts?.high ?? Object.keys(advisories).length;
  return { metadata: { vulnerabilities: { high, critical: counts?.critical ?? 0 } }, advisories };
}

function issues(result: DependencyAuditVerdict | string[]): string[] {
  expect(Array.isArray(result)).toBe(true);
  return result as string[];
}

function verdict(result: DependencyAuditVerdict | string[]): DependencyAuditVerdict {
  expect(Array.isArray(result)).toBe(false);
  return result as DependencyAuditVerdict;
}

const EXCEPTION: AuditException = {
  advisoryId: "GHSA-vfj7-8cjw-p6xm",
  module: "braces",
  severity: "high",
  reachability: "仅开发期可达：eslint-config-next → … → braces",
  justification: "上游未发布任何修复版本（npm 上 braces 最新仍是 3.0.3）",
  reviewedOn: "2026-10-03",
  reviewBy: "2026-11-02",
};

const TODAY = "2026-10-03";

describe("inspectDependencyAudit() — 未登记即失败", () => {
  it("clean report passes and reports an empty exception list", () => {
    expect(
      verdict(inspectDependencyAudit(report({}), { exceptions: [], today: TODAY })),
    ).toEqual({ high: 0, critical: 0, excepted: [] });
  });

  it("blocks a high advisory that is not registered", () => {
    const result = issues(
      inspectDependencyAudit(report({ "1240992": advisory() }), { exceptions: [], today: TODAY }),
    );
    expect(result[0]).toBe("pnpm audit: 0 critical, 1 high vulnerabilities");
    expect(result.join("\n")).toContain("GHSA-vfj7-8cjw-p6xm (braces, high");
    expect(result.join("\n")).toContain("is not registered in DEPENDENCY_AUDIT_EXCEPTIONS");
    // 报错必须能让人自己去查：路径要带在结论里。
    expect(result.join("\n")).toContain("eslint-config-next>@next/eslint-plugin-next");
  });

  it("blocks a moderate or low advisory never does", () => {
    const result = verdict(
      inspectDependencyAudit(
        report({ "1": advisory({ advisoryId: "GHSA-aaaa-bbbb-cccc", severity: "moderate" }) }, { high: 0, critical: 0 }),
        { exceptions: [], today: TODAY },
      ),
    );
    expect(result).toEqual({ high: 0, critical: 0, excepted: [] });
  });

  it("blocks a critical advisory just like a high one", () => {
    const result = issues(
      inspectDependencyAudit(
        report({ "1": advisory({ advisoryId: "GHSA-aaaa-bbbb-cccc", severity: "critical" }) }, {
          high: 0,
          critical: 1,
        }),
        { exceptions: [], today: TODAY },
      ),
    );
    expect(result.join("\n")).toContain("1 critical, 0 high");
  });
});

describe("inspectDependencyAudit() — 已登记的例外", () => {
  it("accepts a registered, dev-only, in-window exception", () => {
    expect(
      verdict(
        inspectDependencyAudit(report({ "1240992": advisory() }), {
          exceptions: [EXCEPTION],
          today: TODAY,
        }),
      ),
    ).toEqual({ high: 1, critical: 0, excepted: ["GHSA-vfj7-8cjw-p6xm"] });
  });

  it("fails once the exception stops being development-only", () => {
    const result = issues(
      inspectDependencyAudit(report({ "1240992": advisory({ dev: false }) }), {
        exceptions: [EXCEPTION],
        today: TODAY,
      }),
    );
    expect(result.join("\n")).toContain("no longer marks every finding as dev-only");
    expect(result.join("\n")).toContain("the production surface can reach it");
  });

  it("fails when the ledger and the report disagree about the module", () => {
    const result = issues(
      inspectDependencyAudit(report({ "1240992": advisory({ module: "micromatch" }) }), {
        exceptions: [EXCEPTION],
        today: TODAY,
      }),
    );
    expect(result.join("\n")).toContain(
      "the report attributes this advisory to micromatch; a ledger entry that disagrees",
    );
  });

  it("fails when the ledger and the report disagree about the severity", () => {
    const result = issues(
      inspectDependencyAudit(
        report({ "1240992": advisory({ severity: "critical" }) }, { high: 0, critical: 1 }),
        { exceptions: [{ ...EXCEPTION, severity: "high" }], today: TODAY },
      ),
    );
    expect(result.join("\n")).toContain("recorded as high but the report says critical");
  });
});

describe("inspectDependencyAudit() — 反向断言：条件变了必须自己变红", () => {
  it("fails when a registered advisory is no longer in the report", () => {
    // 修复落地后的形状：报告干净了，而台账还留着那条「已知无法修复」。
    // 不报这一条，例外就会变成一句没人再看的话——文档腐化是静默的，这条不是。
    const result = issues(
      inspectDependencyAudit(report({}), { exceptions: [EXCEPTION], today: TODAY }),
    );
    expect(result.join("\n")).toContain("no longer present in the audit report");
    expect(result.join("\n")).toContain(EXCEPTION_MODULE_PATH);
  });

  it("fails after the review window closes", () => {
    const result = issues(
      inspectDependencyAudit(report({ "1240992": advisory() }), {
        exceptions: [EXCEPTION],
        today: "2026-11-03",
      }),
    );
    expect(result.join("\n")).toContain("review window ended on 2026-11-02");
    expect(result.join("\n")).toContain("re-check whether a patched release exists");
  });

  it("passes on the last day of the review window", () => {
    expect(
      verdict(
        inspectDependencyAudit(report({ "1240992": advisory() }), {
          exceptions: [EXCEPTION],
          today: "2026-11-02",
        }),
      ).excepted,
    ).toEqual(["GHSA-vfj7-8cjw-p6xm"]);
  });
});

describe("inspectDependencyAudit() — 台账自己写不完整就红", () => {
  it.each([
    [{ advisoryId: "vfj7-8cjw-p6xm" }, "advisory id must look like GHSA-xxxx-xxxx-xxxx"],
    [{ module: "  " }, "module must not be empty"],
    [{ severity: "moderate" as AuditException["severity"] }, "severity must be high or critical"],
    [{ reachability: "" }, "reachability must state why the production surface cannot reach it"],
    [{ justification: " " }, "justification must state why there is nothing to upgrade to"],
    [{ reviewedOn: "2026/10/03" }, "reviewedOn must be YYYY-MM-DD"],
    [{ reviewBy: "20261003" }, "reviewBy must be YYYY-MM-DD"],
    [
      { reviewedOn: "2026-10-03", reviewBy: "2026-10-02" },
      "reviewBy (2026-10-02) is earlier than reviewedOn (2026-10-03)",
    ],
  ])("rejects a malformed ledger entry %#", (override, expected) => {
    const result = issues(
      inspectDependencyAudit(report({ "1240992": advisory() }), {
        exceptions: [{ ...EXCEPTION, ...override } as AuditException],
        today: TODAY,
      }),
    );
    expect(result.join("\n")).toContain(expected);
  });

  it("judges the ledger even when the report is clean", () => {
    // 空理由的条目如果只在「有漏洞时」才被检查，那么仓库会带着一条空理由的例外变绿。
    const result = issues(
      inspectDependencyAudit(report({}), {
        exceptions: [{ ...EXCEPTION, justification: "" }],
        today: TODAY,
      }),
    );
    expect(result.join("\n")).toContain("justification must state why there is nothing to upgrade");
  });
});

describe("inspectDependencyAudit() — 失败封闭", () => {
  it.each([
    [null, "pnpm audit: report must be a JSON object"],
    [[], "pnpm audit: report must be a JSON object"],
    [
      { error: { code: "pnpm", message: "fetch failed" } },
      "pnpm audit: advisory request failed (code=pnpm, message=fetch failed)",
    ],
    [{ error: { code: "ERR_HTTP429" } }, "message=(empty)"],
    [{}, "pnpm audit: report is missing metadata (top-level keys: (none))"],
    [{ metadata: {} }, "pnpm audit: report is missing vulnerability counts"],
    [
      { metadata: { vulnerabilities: { high: -1, critical: 0 } } },
      "high/critical vulnerability counts must be non-negative integers",
    ],
    [
      { metadata: { vulnerabilities: { high: 1.5, critical: 0 } } },
      "high/critical vulnerability counts must be non-negative integers",
    ],
    [
      { metadata: { vulnerabilities: { high: "1", critical: 0 } } },
      "high/critical vulnerability counts must be non-negative integers",
    ],
  ])("fails closed for malformed report %#", (input, expected) => {
    expect(issues(inspectDependencyAudit(input, { exceptions: [], today: TODAY })).join("\n")).toContain(
      expected,
    );
  });

  it("fails when blocking counts come without any advisory detail", () => {
    // 「有 1 个高危」但给不出是哪一条：无法判断它是否已登记，于是按未登记处理。
    const result = issues(
      inspectDependencyAudit({ metadata: { vulnerabilities: { high: 1, critical: 0 } } }, {
        exceptions: [EXCEPTION],
        today: TODAY,
      }),
    );
    expect(result.join("\n")).toContain("carries no advisory details to account for");
  });

  it("fails when the blocking count and the enumerable advisories disagree", () => {
    // 计数说有 2 个高危，明细只列出 1 个：差出来的那一个存在但看不见，
    // 而看不见的东西无法登记，也就无法豁免。
    const result = issues(
      inspectDependencyAudit(
        { metadata: { vulnerabilities: { high: 2, critical: 0 } }, advisories: { "1": advisory() } },
        { exceptions: [EXCEPTION], today: TODAY },
      ),
    );
    expect(result.join("\n")).toContain("blocking count 2 does not match the 1 advisory entries");
  });

  it("fails when a blocking advisory carries no github_advisory_id", () => {
    const result = issues(
      inspectDependencyAudit(report({ "1": advisory({ advisoryId: null }) }), {
        exceptions: [],
        today: TODAY,
      }),
    );
    expect(result.join("\n")).toContain("has no github_advisory_id");
  });

  it("never reads an unreadable report as a clean audit", () => {
    for (const input of [null, [], {}, { error: { code: "pnpm", message: "fetch failed" } }]) {
      expect(Array.isArray(inspectDependencyAudit(input))).toBe(true);
    }
  });
});

describe("shipped DEPENDENCY_AUDIT_EXCEPTIONS", () => {
  it("every shipped entry is complete and inside its own review window", () => {
    expect(DEPENDENCY_AUDIT_EXCEPTIONS.length).toBeGreaterThan(0);
    for (const exception of DEPENDENCY_AUDIT_EXCEPTIONS) {
      const result = inspectDependencyAudit(report({}), {
        exceptions: [exception],
        today: exception.reviewBy,
      });
      // 只允许 STALE 一条报错（报告里本来就没有那条公告），其余形状问题都必须为零。
      const stale = issues(result).filter((issue) => issue.includes("no longer present"));
      expect(stale).toHaveLength(1);
      expect(issues(result).join("\n")).not.toContain("must not be empty");
      expect(issues(result).join("\n")).not.toContain("must be YYYY-MM-DD");
    }
  });

  it("accounts for the real braces advisory the repository currently reports", () => {
    // 这条 fixture 抄的是 `pnpm audit --json` 在 2026-10-03 的真实输出形状。
    // 台账与现实脱节时（上游改了字段、例外被删了），这里会红。
    const result = inspectDependencyAudit(report({ "1240992": advisory() }), { today: TODAY });
    expect(verdict(result).excepted).toEqual(["GHSA-vfj7-8cjw-p6xm"]);
  });
});