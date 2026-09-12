import { describe, expect, it } from "vitest";
import {
  SERVER_ONLY_ENV_NAMES,
  formatSecurityIssues,
  inspectAuditReport,
  inspectClientModules,
  inspectEnvFile,
  inspectSecurityGateFiles,
  inspectTrackedFiles,
  inspectWorkflowPermissions,
  type TextFile,
} from "./security-config";

const VALID_GATE_FILES: TextFile[] = [
  {
    path: ".github/workflows/secrets-scan.yml",
    content: [
      "on:",
      "  push:",
      "    branches: [main, develop]",
      "  pull_request:",
      "permissions:",
      "  contents: read",
      "jobs:",
      "  scan:",
      "    steps:",
      "      - with:",
      "          fetch-depth: 0",
      "      - uses: gitleaks/gitleaks-action@v3",
    ].join("\n"),
  },
  {
    path: ".github/workflows/security-config.yml",
    content: [
      "on:",
      "  schedule:",
      "permissions:",
      "  contents: read",
      "steps:",
      "  - run: pnpm check:security",
      "  - run: pnpm audit --audit-level high",
    ].join("\n"),
  },
  {
    path: ".github/workflows/codeql.yml",
    content: [
      "permissions:",
      "  security-events: write",
      "steps:",
      "  - uses: github/codeql-action/analyze@v4",
      "    with:",
      "      queries: security-extended",
    ].join("\n"),
  },
  {
    path: ".github/dependabot.yml",
    content: [
      "updates:",
      "  - package-ecosystem: npm",
      "  - package-ecosystem: github-actions",
    ].join("\n"),
  },
];

function withGateContent(path: string, content: string): TextFile[] {
  return VALID_GATE_FILES.map((file) => (file.path === path ? { ...file, content } : file));
}

function auditIssues(report: unknown): string[] {
  const result = inspectAuditReport(report);
  expect(Array.isArray(result)).toBe(true);
  return result as string[];
}

describe("inspectTrackedFiles()", () => {
  it("allows the committed environment template and ordinary files", () => {
    expect(
      inspectTrackedFiles([".env.example", "src/config.ts", ".github/workflows/ci.yml"]),
    ).toEqual([]);
  });

  it("rejects tracked environment files", () => {
    expect(inspectTrackedFiles([".env", ".env.local", "apps/web/.env.production"])).toEqual([
      ".env: environment file is tracked",
      ".env.local: environment file is tracked",
      "apps/web/.env.production: environment file is tracked",
    ]);
  });

  it.each([
    "id_rsa",
    "nested/id_ed25519",
    "certs/server.pem",
    "certs/server.key",
    "bundle.p12",
    "identity.pfx",
  ])("rejects private-key-like tracked file %s", (file) => {
    expect(inspectTrackedFiles([file])).toEqual([`${file}: private-key-like file is tracked`]);
  });

  it("normalizes Windows separators before matching", () => {
    expect(inspectTrackedFiles(["deploy\\id_rsa"])).toEqual([
      "deploy/id_rsa: private-key-like file is tracked",
    ]);
  });
});

describe("inspectEnvFile()", () => {
  it("accepts owner-only 0600 permissions", () => {
    expect(inspectEnvFile({ path: ".env.local", mode: 0o600, content: "TOKEN=value\n" })).toEqual(
      [],
    );
  });

  it.each([0o640, 0o644, 0o666])("rejects permissions broader than 0600 (%s)", (mode) => {
    const issues = inspectEnvFile({ path: ".env.local", mode, content: "" });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("broader than 0600");
  });

  it.each(["RESEND_API_KEY", "VAPID_PRIVATE_KEY"])(
    "rejects server-only %s in the shared development environment",
    (name) => {
      const issues = inspectEnvFile({
        path: ".env.development",
        mode: 0o600,
        content: `export ${name}=secret\n`,
      });
      expect(issues).toEqual([
        `.env.development: contains server-only secret ${name}; keep secrets out of shared development env files`,
      ]);
    },
  );

  it("ignores commented and similarly prefixed assignments", () => {
    expect(
      inspectEnvFile({
        path: ".env.development",
        mode: 0o600,
        content: "# RESEND_API_KEY=commented\nRESEND_API_KEY_PUBLIC=not-secret\n",
      }),
    ).toEqual([]);
  });

  it("does not reject server-only values in the private local environment", () => {
    expect(
      inspectEnvFile({
        path: ".env.local",
        mode: 0o600,
        content: "RESEND_API_KEY=local-secret\n",
      }),
    ).toEqual([]);
  });
});

describe("SERVER_ONLY_ENV_NAMES", () => {
  it("covers the reviewed server-only secret set without duplicates", () => {
    expect(SERVER_ONLY_ENV_NAMES).toContain("RESEND_API_KEY");
    expect(SERVER_ONLY_ENV_NAMES).toContain("VAPID_PRIVATE_KEY");
    expect(new Set(SERVER_ONLY_ENV_NAMES).size).toBe(SERVER_ONLY_ENV_NAMES.length);
    expect(SERVER_ONLY_ENV_NAMES.length).toBeGreaterThanOrEqual(13);
  });
});

describe("inspectClientModules()", () => {
  it.each(['"use client";', "'use client';"])(
    "detects dot access after directive %s",
    (directive) => {
      expect(
        inspectClientModules([
          {
            path: "src/client.ts",
            content: `${directive}\nconst token = process.env.CRON_SECRET;\n`,
          },
        ]),
      ).toEqual(["src/client.ts: client module references server-only CRON_SECRET"]);
    },
  );

  it("detects bracket access with quotes and whitespace", () => {
    expect(
      inspectClientModules([
        {
          path: "src/client.tsx",
          content: `"use client";\nconst token = process.env[ "STRIPE_SECRET_KEY" ];\n`,
        },
      ]),
    ).toEqual(["src/client.tsx: client module references server-only STRIPE_SECRET_KEY"]);
  });

  it("allows server-only access outside client modules", () => {
    expect(
      inspectClientModules([
        {
          path: "src/server.ts",
          content: `process.env.${["SUPABASE_SERVICE", "ROLE_KEY"].join("_")};`,
        },
      ]),
    ).toEqual([]);
  });

  it("does not treat a commented directive as a client boundary", () => {
    expect(
      inspectClientModules([
        {
          path: "src/server.ts",
          content: "// use client\nconst token = process.env.CRON_SECRET;\n",
        },
      ]),
    ).toEqual([]);
  });
});

describe("inspectWorkflowPermissions()", () => {
  it("accepts a top-level permissions block", () => {
    expect(
      inspectWorkflowPermissions([{ path: "ci.yml", content: "permissions:\n  contents: read\n" }]),
    ).toEqual([]);
  });

  it("accepts job-level permissions", () => {
    expect(
      inspectWorkflowPermissions([
        { path: "ci.yml", content: "jobs:\n  test:\n    permissions:\n      contents: read\n" },
      ]),
    ).toEqual([]);
  });

  it("rejects workflows without explicit permissions", () => {
    expect(inspectWorkflowPermissions([{ path: "ci.yml", content: "jobs:\n  test:\n" }])).toEqual([
      "ci.yml: missing explicit permissions block",
    ]);
  });

  it("rejects write-all permissions", () => {
    expect(
      inspectWorkflowPermissions([{ path: "ci.yml", content: "permissions: write-all\n" }]),
    ).toEqual(["ci.yml: permissions: write-all is not least privilege"]);
  });
});

describe("inspectSecurityGateFiles()", () => {
  it("accepts the reviewed scanner configuration", () => {
    expect(inspectSecurityGateFiles(VALID_GATE_FILES)).toEqual([]);
  });

  it("reports a missing scanner file once", () => {
    const files = VALID_GATE_FILES.filter((file) => file.path !== ".github/workflows/codeql.yml");
    expect(inspectSecurityGateFiles(files)).toEqual([
      ".github/workflows/codeql.yml: required security scanner file is missing",
    ]);
  });

  it("blocks removal of pull-request secret scanning", () => {
    const content = VALID_GATE_FILES[0].content.replace("  pull_request:\n", "");
    expect(inspectSecurityGateFiles(withGateContent(VALID_GATE_FILES[0].path, content))).toContain(
      ".github/workflows/secrets-scan.yml: Secrets Scan must run on pull requests",
    );
  });

  it("blocks downgrades of the reviewed gitleaks action", () => {
    const content = VALID_GATE_FILES[0].content.replace("gitleaks-action@v3", "gitleaks-action@v2");
    expect(inspectSecurityGateFiles(withGateContent(VALID_GATE_FILES[0].path, content))).toContain(
      ".github/workflows/secrets-scan.yml: Secrets Scan must use the reviewed gitleaks action",
    );
  });

  it("blocks loss of full history or read-only secret-scan permissions", () => {
    const content = VALID_GATE_FILES[0].content
      .replace("          fetch-depth: 0\n", "")
      .replace("  contents: read", "  contents: write");
    const issues = inspectSecurityGateFiles(withGateContent(VALID_GATE_FILES[0].path, content));
    expect(issues).toContain(
      ".github/workflows/secrets-scan.yml: Secrets Scan must fetch full git history",
    );
    expect(issues).toContain(
      ".github/workflows/secrets-scan.yml: Secrets Scan must use read-only repository permissions",
    );
  });

  it("blocks removal of scheduled security/config checks", () => {
    const content = VALID_GATE_FILES[1].content.replace("  schedule:\n", "");
    expect(inspectSecurityGateFiles(withGateContent(VALID_GATE_FILES[1].path, content))).toContain(
      ".github/workflows/security-config.yml: Security/config checks must run on a schedule",
    );
  });

  it("blocks removal of the repository security policy or audit command", () => {
    const content = VALID_GATE_FILES[1].content
      .replace("  - run: pnpm check:security\n", "")
      .replace("  - run: pnpm audit --audit-level high", "");
    const issues = inspectSecurityGateFiles(withGateContent(VALID_GATE_FILES[1].path, content));
    expect(issues).toContain(
      ".github/workflows/security-config.yml: Security/config checks must run the high-severity dependency audit",
    );
    expect(issues).toContain(
      ".github/workflows/security-config.yml: Security/config checks must run the repository security policy",
    );
  });

  it("blocks weaker CodeQL configuration", () => {
    const content = VALID_GATE_FILES[2].content
      .replace("github/codeql-action/analyze@v4", "github/codeql-action/analyze@v3")
      .replace("      queries: security-extended", "");
    const issues = inspectSecurityGateFiles(withGateContent(VALID_GATE_FILES[2].path, content));
    expect(issues).toContain(".github/workflows/codeql.yml: CodeQL analysis must remain enabled");
    expect(issues).toContain(
      ".github/workflows/codeql.yml: CodeQL must run the security-extended query suite",
    );
  });

  it("blocks removal of either Dependabot ecosystem", () => {
    const content = VALID_GATE_FILES[3].content.replace("  - package-ecosystem: npm\n", "");
    expect(inspectSecurityGateFiles(withGateContent(VALID_GATE_FILES[3].path, content))).toContain(
      ".github/dependabot.yml: Dependabot must track npm dependencies",
    );
  });
});

describe("inspectAuditReport()", () => {
  it("accepts a report with no high or critical vulnerabilities", () => {
    expect(inspectAuditReport({ metadata: { vulnerabilities: { high: 0, critical: 0 } } })).toEqual(
      {
        high: 0,
        critical: 0,
      },
    );
  });

  it.each([
    [{ high: 1, critical: 0 }, "0 critical, 1 high"],
    [{ high: 0, critical: 2 }, "2 critical, 0 high"],
    [{ high: 1, critical: 2 }, "2 critical, 1 high"],
  ])("reports blocking vulnerability counts", (vulnerabilities, message) => {
    expect(auditIssues({ metadata: { vulnerabilities } })[0]).toContain(message);
  });

  it.each([
    null,
    [],
    {},
    { metadata: null },
    { metadata: {} },
    { metadata: { vulnerabilities: { high: -1, critical: 0 } } },
    { metadata: { vulnerabilities: { high: 1.5, critical: 0 } } },
    { metadata: { vulnerabilities: { high: "1", critical: 0 } } },
  ])("fails closed for malformed report %#", (report) => {
    expect(auditIssues(report).length).toBeGreaterThan(0);
  });
});

describe("formatSecurityIssues()", () => {
  it("formats issues as bullet points", () => {
    expect(formatSecurityIssues([])).toBe("");
    expect(formatSecurityIssues(["first", "second"])).toBe("  - first\n  - second");
  });
});
