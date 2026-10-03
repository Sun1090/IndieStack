import { afterEach, describe, expect, it, vi } from "vitest";
import { runDependencyAuditCheck } from "../../../scripts/lib/dependency-audit-check.js";

/** 与 dependency-audit.test.ts 同源的公告形状；这里只关心 IO 层的接线与打印。 */
const BRACES_ADVISORY = {
  "1240992": {
    github_advisory_id: "GHSA-vfj7-8cjw-p6xm",
    module_name: "braces",
    severity: "high",
    findings: [
      {
        version: "3.0.3",
        paths: [".>eslint-config-next>@next/eslint-plugin-next>fast-glob>micromatch>braces"],
        dev: true,
      },
    ],
  },
};

const CLEAN = { metadata: { vulnerabilities: { high: 0, critical: 0 } } };
const WITH_BRACES = { metadata: { vulnerabilities: { high: 1, critical: 0 } }, advisories: BRACES_ADVISORY };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runDependencyAuditCheck()", () => {
  it("passes on a clean report and prints the reading", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(runDependencyAuditCheck({ runAudit: () => CLEAN, exceptions: [], today: "2026-10-03" })).toBe(0);
    expect(log.mock.calls.flat().join(" ")).toContain("依赖审计通过：0 critical / 0 high");
  });

  it("fails and names the unregistered advisory", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const status = runDependencyAuditCheck({
      runAudit: () => WITH_BRACES,
      exceptions: [],
      today: "2026-10-03",
    });
    expect(status).toBe(1);
    const output = error.mock.calls.flat().join("\n");
    expect(output).toContain("依赖审计门禁失败");
    expect(output).toContain("GHSA-vfj7-8cjw-p6xm");
  });

  it("reports which registered exception carried the verdict", () => {
    // 只印「通过」而不印「有 1 条是靠例外放行的」，等于把读数丢掉一半。
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(runDependencyAuditCheck({ runAudit: () => WITH_BRACES, today: "2026-10-03" })).toBe(0);
    const output = log.mock.calls.flat().join(" ");
    expect(output).toContain("0 critical / 1 high");
    expect(output).toContain("1 条已登记例外（GHSA-vfj7-8cjw-p6xm）");
  });

  it("fails closed when the audit command cannot be read", () => {
    // 「取不到」与「没有漏洞」必须分开说：前者要重跑，后者要修。
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const status = runDependencyAuditCheck({
      runAudit: () => {
        throw new Error("fetch failed");
      },
      today: "2026-10-03",
    });
    expect(status).toBe(1);
    expect(error.mock.calls.flat().join("\n")).toContain(
      "pnpm audit: command failed or returned invalid JSON (fetch failed)",
    );
  });
});