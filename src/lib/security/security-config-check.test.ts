import { afterEach, describe, expect, it, vi } from "vitest";
import { runSecurityConfigCheck } from "../../../scripts/lib/security-config-check.js";

const AUDIT_CLEAN = { metadata: { vulnerabilities: { high: 0, critical: 0 } } };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runSecurityConfigCheck()", () => {
  it("passes against the committed repository with a clean audit report", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(runSecurityConfigCheck({ auditReport: AUDIT_CLEAN })).toBe(0);
    expect(log.mock.calls.flat().join(" ")).toContain("security/config checks passed");
  });

  it("fails when the dependency audit reports a high vulnerability", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const status = runSecurityConfigCheck({
      auditReport: { metadata: { vulnerabilities: { high: 1, critical: 0 } } },
    });
    expect(status).toBe(1);
    expect(error.mock.calls.flat().join("\n")).toContain("0 critical, 1 high");
  });

  it("fails closed for a malformed audit report", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(runSecurityConfigCheck({ auditReport: null })).toBe(1);
    expect(error.mock.calls.flat().join("\n")).toContain(
      "pnpm audit: report must be a JSON object",
    );
  });

  it("fails when a tracked environment file is present", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const status = runSecurityConfigCheck({ trackedFiles: [".env"], auditReport: AUDIT_CLEAN });
    expect(status).toBe(1);
    expect(error.mock.calls.flat().join("\n")).toContain(".env: environment file is tracked");
  });

  it("fails when a required scanner configuration file is missing", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const status = runSecurityConfigCheck({ gateFiles: [], auditReport: AUDIT_CLEAN });
    expect(status).toBe(1);
    expect(error.mock.calls.flat().join("\n")).toContain(
      ".github/workflows/codeql.yml: required security scanner file is missing",
    );
  });
});
