import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PRODUCTION_CONFIG_FILES,
  SERVER_ONLY_ENV_NAMES,
  formatSecurityIssues,
  inspectAuditReport,
  inspectClientModules,
  inspectEnvFile,
  inspectProductionMockSettings,
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

  it("names the registry failure instead of blaming the repository", () => {
    // pnpm audit --json 在请求失败时退出码 1 并打印这个形状：合法 JSON，只是没有 metadata。
    expect(auditIssues({ error: { code: "pnpm", message: "fetch failed" } })).toEqual([
      "pnpm audit: advisory request failed (code=pnpm, message=fetch failed)",
    ]);
    expect(auditIssues({ error: { code: "ERR_HTTP429" } })[0]).toBe(
      "pnpm audit: advisory request failed (code=ERR_HTTP429, message=(empty))",
    );
  });

  it("reports which keys an unreadable report actually carried", () => {
    expect(auditIssues({ metadata: null })[0]).toBe(
      "pnpm audit: report is missing metadata (top-level keys: metadata)",
    );
    expect(auditIssues({})[0]).toBe(
      "pnpm audit: report is missing metadata (top-level keys: (none))",
    );
  });

  it("never reads a missing or failed report as a clean audit", () => {
    for (const report of [{}, { error: { code: "pnpm", message: "fetch failed" } }, null, []]) {
      expect(Array.isArray(inspectAuditReport(report))).toBe(true);
    }
  });
});

describe("inspectProductionMockSettings() (C13)", () => {
  /** 一份「扫得到东西」的生产面集合：分母不为零的那些用例都要带上它。 */
  const CLEAN_PRODUCTION: TextFile[] = [
    { path: ".env.production", content: "NEXT_PUBLIC_APP_URL=https://app.example.com\n" },
    { path: "vercel.json", content: '{\n  "$schema": "https://openapi.vercel.sh/vercel.json"\n}\n' },
  ];

  it("接受生产面里没有这个开关，或者显式关掉", () => {
    expect(inspectProductionMockSettings(CLEAN_PRODUCTION)).toEqual([]);
    expect(
      inspectProductionMockSettings([
        ...CLEAN_PRODUCTION,
        { path: ".env.production", content: "NEXT_PUBLIC_MOCK_ENABLED=false\n" },
      ]),
    ).toEqual([]);
  });

  it.each([
    ["dotenv 无引号", "NEXT_PUBLIC_MOCK_ENABLED=true\n"],
    ["dotenv 带引号", 'NEXT_PUBLIC_MOCK_ENABLED="true"\n'],
    ["dotenv 带注释", "NEXT_PUBLIC_MOCK_ENABLED=true # 本地想开\n"],
    ["YAML 映射", "env:\n  NEXT_PUBLIC_MOCK_ENABLED: \"true\"\n"],
    ["YAML 空值", "env:\n  NEXT_PUBLIC_MOCK_ENABLED: 'true'\n"],
    ["JSON 映射", '{ "env": { "NEXT_PUBLIC_MOCK_ENABLED": "true" } }\n'],
  ])("生产环境文件里 %s 开着 mock 即红", (_label, content) => {
    const issues = inspectProductionMockSettings([{ path: ".env.production", content }]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain(".env.production: NEXT_PUBLIC_MOCK_ENABLED=true on a production surface");
  });

  it("同一文件里先关后开也要红（不看赋值顺序）", () => {
    // 变异核对逼出来的一格：`.env.production` 本来就有一行 =false，只读第一个值时
    // 往末尾追加 =true 不会红——而「先关后开」正是部署平台改环境变量最常见的形状。
    const issues = inspectProductionMockSettings([
      { path: ".env.production", content: "NEXT_PUBLIC_MOCK_ENABLED=false\nNEXT_PUBLIC_MOCK_ENABLED=true\n" },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("found 2 assignment(s)");
  });

  it("多次赋值但没有一处是 true 时不报（条数不是判据）", () => {
    expect(
      inspectProductionMockSettings([
        { path: ".env.production", content: "NEXT_PUBLIC_MOCK_ENABLED=false\nNEXT_PUBLIC_MOCK_ENABLED=\n" },
      ]),
    ).toEqual([]);
  });

  it("vercel.json 的 env 会被发到所有目标（含 production），因此同样按生产面判", () => {
    const issues = inspectProductionMockSettings([
      { path: "vercel.json", content: '{ "env": { "NEXT_PUBLIC_MOCK_ENABLED": "true" } }\n' },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("vercel.json");
  });

  it.each(["1", "yes", "TRUE ", "truthy"])("只认字符串 true（%s 算没开）", (value) => {
    // 与 evaluateMockMode 同一套读法：那边只认 "true"，这里也只认 "true"，
    // 两边一旦分叉，配置面报「干净」而运行时报「开着」或反过来。
    const issues = inspectProductionMockSettings([
      ...CLEAN_PRODUCTION,
      { path: ".env.production", content: `NEXT_PUBLIC_MOCK_ENABLED=${value}\n` },
    ]);
    expect(issues, value).toEqual([]);
  });

  it("注释里的值不算赋值", () => {
    expect(
      inspectProductionMockSettings([
        ...CLEAN_PRODUCTION,
        { path: ".env.production", content: "# NEXT_PUBLIC_MOCK_ENABLED=true\n" },
      ]),
    ).toEqual([]);
  });

  it("e2e / 开发面开着 mock 是对的，不按生产面判", () => {
    // 这不是设想出来的宽松：e2e-parallel.yml 现在就开着 mock 跑 pnpm build。
    // 把「出现 MOCK_ENABLED」当判据，那条现行文件会直接红，而没有人会去修它。
    expect(
      inspectProductionMockSettings([
        ...CLEAN_PRODUCTION,
        { path: ".github/workflows/e2e-parallel.yml", content: "env:\n  NEXT_PUBLIC_MOCK_ENABLED: \"true\"\n" },
        { path: ".env.development", content: "NEXT_PUBLIC_MOCK_ENABLED=true\n" },
        { path: ".env.example", content: "NEXT_PUBLIC_MOCK_ENABLED=true\n" },
        { path: ".env.local", content: "NEXT_PUBLIC_MOCK_ENABLED=true\n" },
      ]),
    ).toEqual([]);
  });

  it.each([
    ["vercel deploy --prod", "run: npx vercel deploy --prod --token ${{ secrets.VERCEL_TOKEN }}\n"],
    ["vercel --prod", "run: npx vercel --prod\n"],
    ["VERCEL_ENV=production", "env:\n  VERCEL_ENV: production\n"],
    ["--env production", "run: npx vercel deploy --env production\n"],
    ["docker build --build-arg", "run: docker build --build-arg NEXT_PUBLIC_MOCK_ENABLED=true .\n"],
  ])("CI 工作流声明了生产意图（%s）时，里面的 mock 开关才算生产面", (_label, marker) => {
    const issues = inspectProductionMockSettings([
      ...CLEAN_PRODUCTION,
      {
        path: ".github/workflows/deploy.yml",
        content: `env:\n  NEXT_PUBLIC_MOCK_ENABLED: "true"\nsteps:\n  - ${marker}`,
      },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain(".github/workflows/deploy.yml");
  });

  it("一条生产面都没扫到时报红，不把空扫描读成干净", () => {
    // 失败模式恰恰是「范围被扫空」：文件改名、配置挪走、IO 层忘了读。
    // 返回 [] 会和「生产面干净」长得一模一样。
    const issues = inspectProductionMockSettings([{ path: "README.md", content: "nothing here\n" }]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("no production surface to inspect");
  });

  it("真实仓库的生产面集合本身是干净的（分母不为零）", () => {
    const root = resolve(__dirname, "../../..");
    const files: TextFile[] = [
      ...PRODUCTION_CONFIG_FILES.map((name) => ({
        path: name,
        content: readFileSync(resolve(root, name), "utf8"),
      })),
      ...readdirSync(resolve(root, ".github/workflows"))
        .filter((name) => name.endsWith(".yml"))
        .map((name) => ({
          path: `.github/workflows/${name}`,
          content: readFileSync(resolve(root, ".github/workflows", name), "utf8"),
        })),
    ];
    // 先确认扫到的面确实多于一条，否则下面那句 [] 只是「没扫到」的另一种写法。
    expect(
      files.filter((file) => PRODUCTION_CONFIG_FILES.includes(file.path)),
    ).toHaveLength(PRODUCTION_CONFIG_FILES.length);
    expect(inspectProductionMockSettings(files)).toEqual([]);
  });
});

describe("formatSecurityIssues()", () => {
  it("formats issues as bullet points", () => {
    expect(formatSecurityIssues([])).toBe("");
    expect(formatSecurityIssues(["first", "second"])).toBe("  - first\n  - second");
  });
});
