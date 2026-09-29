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

  it("fails when a production surface turns mock on (C13)", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const status = runSecurityConfigCheck({
      productionConfigs: [
        { path: ".env.production", content: "NEXT_PUBLIC_MOCK_ENABLED=true\n" },
        { path: "vercel.json", content: "{}\n" },
      ],
      auditReport: AUDIT_CLEAN,
    });
    expect(status).toBe(1);
    expect(error.mock.calls.flat().join("\n")).toContain(
      ".env.production: NEXT_PUBLIC_MOCK_ENABLED=true on a production surface",
    );
  });

  it("fails closed when no production surface could be read (C13)", () => {
    // 接线层漏读 vercel.json、.env.production 被改名，都会走到这一格。
    // 报绿的话，那就是「没扫」被读成了「干净」——这条规则的全部意义都在反面。
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const status = runSecurityConfigCheck({ productionConfigs: [], auditReport: AUDIT_CLEAN });
    expect(status).toBe(1);
    expect(error.mock.calls.flat().join("\n")).toContain("no production surface to inspect");
  });

  it("wires C13 into the committed repository, not just into injected fixtures", () => {
    // 上面两条用的是注入值；这条不加 productionConfigs，强制走真实读取。
    // 否则「规则接了线」与「规则能被调用」是两件事，而门禁只证明了后者。
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(runSecurityConfigCheck({ auditReport: AUDIT_CLEAN })).toBe(0);
    expect(log.mock.calls.flat().join(" ")).toContain("security/config checks passed");
  });
});
