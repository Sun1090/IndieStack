/**
 * Repository security/configuration policy.
 *
 * These functions are deliberately side-effect free so the same rules can be covered by
 * Vitest and consumed by the `pnpm check:security` CLI through Node's type stripping.
 */

export const SERVER_ONLY_ENV_NAMES = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_DB_URL",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "OSS_ACCESS_KEY_SECRET",
  "ALIYUN_ACCESS_KEY_SECRET",
  "SENTRY_AUTH_TOKEN",
  "VERCEL_TOKEN",
  "GITHUB_TOKEN",
  "CRON_SECRET",
  "SUPABASE_ACCESS_TOKEN",
  "RESEND_API_KEY",
  "VAPID_PRIVATE_KEY",
] as const;

export interface TextFile {
  path: string;
  content: string;
}

export interface EnvFile extends TextFile {
  mode: number;
}

export interface SecurityGateRequirement {
  path: string;
  pattern: RegExp;
  label: string;
}

export interface AuditVulnerabilityCounts {
  high: number;
  critical: number;
}

function normalizePath(file: string): string {
  return file.replace(/\\/g, "/");
}

function hasEnvironmentAssignment(content: string, name: string): boolean {
  return new RegExp(`^(?:export\\s+)?${name}\\s*=`, "m").test(content);
}

function hasAnyPattern(content: string, pattern: RegExp): boolean {
  return pattern.test(content);
}

export function inspectTrackedFiles(files: readonly string[]): string[] {
  const issues: string[] = [];
  for (const rawFile of files) {
    const file = normalizePath(rawFile);
    if (/(^|\/)\.env(?:\.|$)/.test(file) && !/(^|\/)\.env\.example$/.test(file)) {
      issues.push(`${file}: environment file is tracked`);
    }
    if (/(^|\/)(?:id_rsa|id_ed25519|id_ecdsa|id_dsa)(?:$|\/)|\.(?:pem|key|p12|pfx)$/i.test(file)) {
      issues.push(`${file}: private-key-like file is tracked`);
    }
  }
  return issues;
}

export function inspectEnvFile(file: EnvFile): string[] {
  const issues: string[] = [];
  const mode = file.mode & 0o777;
  if ((mode & 0o077) !== 0) {
    issues.push(
      `${file.path}: permissions ${mode.toString(8).padStart(3, "0")} are broader than 0600`,
    );
  }
  if (file.path === ".env.development") {
    for (const name of SERVER_ONLY_ENV_NAMES) {
      if (hasEnvironmentAssignment(file.content, name)) {
        issues.push(
          `${file.path}: contains server-only secret ${name}; keep secrets out of shared development env files`,
        );
      }
    }
  }
  return issues;
}

export function inspectClientModules(
  files: readonly TextFile[],
  names: readonly string[] = SERVER_ONLY_ENV_NAMES,
): string[] {
  const issues: string[] = [];
  const clientDirective = /^\s*["']use client["'];?\s*$/m;
  for (const file of files) {
    if (!clientDirective.test(file.content)) continue;
    for (const name of names) {
      const dotAccess = new RegExp(`process\\.env\\.${name}\\b`);
      const bracketAccess = new RegExp(`process\\.env\\s*\\[\\s*["']${name}["']\\s*\\]`);
      if (dotAccess.test(file.content) || bracketAccess.test(file.content)) {
        issues.push(`${file.path}: client module references server-only ${name}`);
      }
    }
  }
  return issues;
}

export function inspectWorkflowPermissions(files: readonly TextFile[]): string[] {
  const issues: string[] = [];
  for (const file of files) {
    const hasPermissions =
      hasAnyPattern(file.content, /^permissions\s*:/m) ||
      hasAnyPattern(file.content, /^\s{2,}permissions\s*:/m);
    if (!hasPermissions) issues.push(`${file.path}: missing explicit permissions block`);
    if (hasAnyPattern(file.content, /permissions\s*:\s*write-all\b/)) {
      issues.push(`${file.path}: permissions: write-all is not least privilege`);
    }
  }
  return issues;
}

const SECURITY_GATE_REQUIREMENTS: readonly SecurityGateRequirement[] = [
  {
    path: ".github/workflows/secrets-scan.yml",
    pattern: /\bpull_request\s*:/,
    label: "Secrets Scan must run on pull requests",
  },
  {
    path: ".github/workflows/secrets-scan.yml",
    pattern: /\bmain\b/,
    label: "Secrets Scan must cover main pushes",
  },
  {
    path: ".github/workflows/secrets-scan.yml",
    pattern: /\bdevelop\b/,
    label: "Secrets Scan must cover develop pushes",
  },
  {
    path: ".github/workflows/secrets-scan.yml",
    pattern: /gitleaks\/gitleaks-action@v3/,
    label: "Secrets Scan must use the reviewed gitleaks action",
  },
  {
    path: ".github/workflows/secrets-scan.yml",
    pattern: /fetch-depth\s*:\s*0/,
    label: "Secrets Scan must fetch full git history",
  },
  {
    path: ".github/workflows/secrets-scan.yml",
    pattern: /contents\s*:\s*read/,
    label: "Secrets Scan must use read-only repository permissions",
  },
  {
    path: ".github/workflows/security-config.yml",
    pattern: /\bschedule\s*:/,
    label: "Security/config checks must run on a schedule",
  },
  {
    path: ".github/workflows/security-config.yml",
    pattern: /pnpm audit --audit-level high/,
    label: "Security/config checks must run the high-severity dependency audit",
  },
  {
    path: ".github/workflows/security-config.yml",
    pattern: /pnpm check:security/,
    label: "Security/config checks must run the repository security policy",
  },
  {
    path: ".github/workflows/codeql.yml",
    pattern: /github\/codeql-action\/analyze@v4/,
    label: "CodeQL analysis must remain enabled",
  },
  {
    path: ".github/workflows/codeql.yml",
    pattern: /security-extended/,
    label: "CodeQL must run the security-extended query suite",
  },
  {
    path: ".github/workflows/codeql.yml",
    pattern: /security-events\s*:\s*write/,
    label: "CodeQL must retain security-events write permission",
  },
  {
    path: ".github/dependabot.yml",
    pattern: /package-ecosystem\s*:\s*npm/,
    label: "Dependabot must track npm dependencies",
  },
  {
    path: ".github/dependabot.yml",
    pattern: /package-ecosystem\s*:\s*github-actions/,
    label: "Dependabot must track GitHub Actions",
  },
];

export function inspectSecurityGateFiles(files: readonly TextFile[]): string[] {
  const issues: string[] = [];
  const byPath = new Map(files.map((file) => [normalizePath(file.path), file.content]));
  const missingPaths = new Set<string>();
  for (const requirement of SECURITY_GATE_REQUIREMENTS) {
    const content = byPath.get(requirement.path);
    if (content === undefined) {
      if (!missingPaths.has(requirement.path)) {
        issues.push(`${requirement.path}: required security scanner file is missing`);
        missingPaths.add(requirement.path);
      }
      continue;
    }
    if (!hasAnyPattern(content, requirement.pattern)) {
      issues.push(`${requirement.path}: ${requirement.label}`);
    }
  }
  return issues;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 报告读不懂时，把「到底拿到了什么」写进结论。
 *
 * `pnpm audit --json` 在注册表请求失败时退出码为 1，并打印
 * `{"error":{"code":"pnpm","message":"fetch failed"}}`——它同样是合法 JSON，只是没有
 * `metadata`。笼统地报「report is missing metadata」会让人去查仓库配置，而真正该做的是重跑。
 * 两种情况都仍然失败封闭：读不到审计结果不等于没有漏洞。
 */
function describeUnreadableReport(report: Record<string, unknown>): string {
  const error = report.error;
  if (isRecord(error)) {
    const code = typeof error.code === "string" ? error.code : "unknown";
    const message = typeof error.message === "string" ? error.message : "(empty)";
    return `pnpm audit: advisory request failed (code=${code}, message=${message})`;
  }
  const keys = Object.keys(report).sort().join(", ") || "(none)";
  return `pnpm audit: report is missing metadata (top-level keys: ${keys})`;
}

export function inspectAuditReport(report: unknown): AuditVulnerabilityCounts | string[] {
  if (!isRecord(report)) return ["pnpm audit: report must be a JSON object"];
  const metadata = report.metadata;
  if (!isRecord(metadata)) return [describeUnreadableReport(report)];
  const vulnerabilities = metadata.vulnerabilities;
  if (!isRecord(vulnerabilities)) return ["pnpm audit: report is missing vulnerability counts"];

  const high = vulnerabilities.high;
  const critical = vulnerabilities.critical;
  if (
    typeof high !== "number" ||
    !Number.isInteger(high) ||
    high < 0 ||
    typeof critical !== "number" ||
    !Number.isInteger(critical) ||
    critical < 0
  ) {
    return ["pnpm audit: high/critical vulnerability counts must be non-negative integers"];
  }
  if (high + critical > 0)
    return [`pnpm audit: ${critical} critical, ${high} high vulnerabilities`];
  return { high, critical };
}

export function formatSecurityIssues(issues: readonly string[]): string {
  return issues.map((issue) => `  - ${issue}`).join("\n");
}
