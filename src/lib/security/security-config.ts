/**
 * Repository security/configuration policy.
 *
 * These functions are deliberately side-effect free so the same rules can be covered by
 * Vitest and consumed by the `pnpm check:security` CLI through Node's type stripping.
 */
import {
  inspectDependencyAudit,
  type AuditException,
  type DependencyAuditVerdict,
} from "./dependency-audit.ts";

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

/**
 * 生产构型上不许开着 mock（C13）。
 *
 * 运行时那道闸在 `src/lib/mock/config.ts`：`evaluateMockMode` 见 `NODE_ENV=production`
 * 直接返回 false，模块级常量还写成可被 Next 折成 `false` 的三元（折不出来的话整个 mock
 * 客户端会留在产物里，24.9 kB）。本条管的是**另一件事**：配置面上不许留下那个
 * 「生产也开着 mock」的声明。留着它的代价不是立刻出事，而是**别的判断会开始依赖一句
 * 已经不成立的话**——`RATE_LIMIT_LEDGER` 里 18 条豁免、`ROUTE_AUTH_LEDGER` 里整族
 * `mock-only` 的理由都写着「它们只在 mock 构型下存在」。那句话说对了没人查，说错了
 * 没人知道，所以要让**看得见的配置**把那句话说死。
 *
 * 判据按「谁是生产面」来划，不按「哪里出现了 MOCK 字样」：
 * `.env.production` 按文件名是生产面；`vercel.json` 的 `env` 会被 Vercel 发到**所有**目标
 * （含 production），同样是生产面；CI 工作流只有在**自己声明了生产意图**时才算——
 * `e2e-parallel.yml` 开着 mock 跑 `pnpm build` 是对的（E2E 就要这个构型），
 * 把「出现 MOCK_ENABLED」当判据会把那条现行文件直接判红，那就是一条没人会修的误报。
 */
export const PRODUCTION_MOCK_VARIABLE = "NEXT_PUBLIC_MOCK_ENABLED";

/** 按名字即生产面的配置：不需要在内容里找「生产」两个字。 */
export const PRODUCTION_CONFIG_FILES: readonly string[] = [".env.production", "vercel.json"];

/**
 * 「这个工作流在发生产」的标记。仓库里今天一条都没有——部署走 Vercel 的 git 集成，
 * CI 只做构建与只读冒烟，所以这份名单是**待命**的：先量到误报才有依据的扩展是本项目的
 * 规矩（见 roadmap D01），而「什么都不做」等于把将来的生产构建也放过去。
 * 判据取「同一个文件里同时出现生产意图与 mock 开关」，粒度是文件级而不是 job 级：
 * 没有 YAML 依赖可解析（`package.json` 里没有 `yaml`），而这个方向上粗一点是朝人喊，
 * 不是朝自己骗。
 */
const PRODUCTION_DEPLOY_MARKERS: readonly RegExp[] = [
  /vercel\s+(?:deploy|build)\b[^\n]*--prod\b/,
  /vercel\s+--prod\b/,
  /VERCEL_ENV\s*[:=]\s*["']?production/,
  /--env(?:ironment)?\s+production\b/,
  /docker\s+build\b[^\n]*--build-arg[^\n]*NEXT_PUBLIC_MOCK_ENABLED/,
];

function normalizePath(file: string): string {
  return file.replace(/\\/g, "/");
}

/**
 * 取出文件里**所有** `NEXT_PUBLIC_MOCK_ENABLED` 赋值的值。
 *
 * 覆盖三种写法，因为三种在生产面上都真的存在：`.env*` 的 `KEY=value`、YAML 的
 * `KEY: "value"`、JSON 的 `"KEY": "value"`。四个细节各踩过一次，都在下面写着：
 * ① 值两侧的引号与空白要摘掉，否则 `NEXT_PUBLIC_MOCK_ENABLED="true"`（`.env` 里最常见的
 * 写法）会被读成非真值——那是一条**永远不红**的门禁，比没有门禁更糟；
 * ② 行首锚定让 `.env` 里的注释行安静（`# NEXT_...=true` 不是赋值）；
 * ③ 只锚行首会漏掉**行内** JSON（`{"env":{"NEXT_PUBLIC_MOCK_ENABLED":"true"}}` 整行），
 * 而 `vercel.json` 恰恰经常被写成一行，所以另配一条 JSON 专用式——它的键必定带引号、
 * 必定紧跟 `{` 或 `,`，这两个条件就是它的锚，不需要猜「行内还有没有别的东西」；
 * ④ 键名不写成裸串，于是 `"FOO_NEXT_PUBLIC_MOCK_ENABLED": "true"` 匹配不上。
 *
 * **返回全部而不是第一个**，是一次变异核对逼出来的：只读第一个时，往 `.env.production`
 * 末尾追加一行 `=true` 不会红（文件里本来就有一行 `=false` 被读在前头），而
 * 「先关后开」正是部署平台上改环境变量最常见的形状。判据不依赖赋值顺序，
 * 代价是同一文件里两个值不同时报一次而不是零次——朝人喊是这里要的方向。
 */
function escapedVariable(): string {
  return PRODUCTION_MOCK_VARIABLE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const MOCK_TOGGLE_ASSIGNMENT_PATTERNS: readonly RegExp[] = [
  new RegExp(
    String.raw`^[^\S\n]*"?${escapedVariable()}"?[^\S\n]*[:=][^\S\n]*(?:"([^"\n]*)"|'([^'\n]*)'|([^\s#\n]+))`,
    "gm",
  ),
  new RegExp(
    String.raw`[,{][^\S\n]*"?${escapedVariable()}"?[^\S\n]*:[^\S\n]*(?:"([^"\n]*)"|'([^'\n]*)')`,
    "g",
  ),
];

function readMockToggleValues(content: string): string[] {
  const values: string[] = [];
  for (const pattern of MOCK_TOGGLE_ASSIGNMENT_PATTERNS) {
    for (const match of content.matchAll(pattern)) {
      values.push((match[1] ?? match[2] ?? match[3] ?? "").trim());
    }
  }
  return values;
}


/**
 * 只有字符串 `true` 算开着——**与 `evaluateMockMode` 逐字一致**（那边是 `=== "true"`，
 * 大小写敏感、不接受 `1`/`yes`）。这里刻意不比它更严：更严会造出假红，而这条规则的
 * 存在理由是「配置面不许说谎」，不是「配置面要替运行时多猜几种写法」。
 * 真写出 `TRUE` 的人不会因此开上 mock（运行时那侧仍然关着），要治的是那份配置写得含糊，
 * 归 `.env.example` 的注释，不归这条门禁。
 */
function mockToggleIsOn(value: string | undefined): boolean {
  return value === "true";
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

/**
 * 生产面上的配置不许把 mock 打开。
 *
 * **覆盖面要说准，别说过头**：`.env.production` 被 `.gitignore` 排除（进版本库的只有
 * `.env.example`），所以在 CI 上它根本不存在，**这条规则在 CI 里实际盯的是
 * `vercel.json` 与带生产意图的工作流**。`.env.production` 这一格咬的是本地构建与
 * 模板用户自己的 checkout——那不是零价值，但也不能拿「门禁在 CI 里跑」当它的覆盖率。
 * 记在这里是因为「覆盖面被高估」正是本仓库反复付过学费的形状（C12 那份限流读数、
 * C08 的 22 处台账，都是先量后写的）。
 *
 * **失败封闭的那一半和报红的那一半同样重要**：一条都没扫到生产面时返回
 * `PROD_MOCK_NO_SURFACE`，而不是返回空数组。空数组与「生产面干净」长得一模一样，
 * 而这里的失败模式恰好是「扫描范围被扫空」——`.env.production` 被改名、vercel 配置
 * 挪走、IO 层忘了读它，都会走到这一格。与 `RATE_LIMIT_NOTHING_MEASURED`、
 * `QUERY_ERROR_*` 的分母断言是同一条纪律。
 */
export function inspectProductionMockSettings(files: readonly TextFile[]): string[] {
  const issues: string[] = [];
  let surfaces = 0;

  for (const file of files) {
    const path = normalizePath(file.path);
    const byName = PRODUCTION_CONFIG_FILES.includes(path);
    const declaresProduction = PRODUCTION_DEPLOY_MARKERS.some((marker) => marker.test(file.content));
    if (!byName && !declaresProduction) continue;

    surfaces += 1;
    const values = readMockToggleValues(file.content);
    if (values.some(mockToggleIsOn)) {
      issues.push(
        `${path}: ${PRODUCTION_MOCK_VARIABLE}=true on a production surface (found ${values.length} ` +
          "assignment(s)); mock authenticates as a signed-in fake user, and the mock-only " +
          "rate-limit exemptions in RATE_LIMIT_LEDGER assume these endpoints do not exist in production",
      );
    }
  }

  if (surfaces === 0) {
    issues.push(
      `production mock check found no production surface to inspect ` +
        `(expected ${PRODUCTION_CONFIG_FILES.join(" / ")}); an empty scan is not a clean scan`,
    );
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
    // 刻意要求 `pnpm check:audit` 而不是裸的 `pnpm audit --audit-level high`：
    // 裸命令不看例外台账，于是「上游没有补丁」这一种真实情况会让这条 job 永远红，
    // 而红了之后没人能修——那是一条**不可执行的约束**。判定只有一份实现
    // （src/lib/security/dependency-audit.ts），所以这条 job 与 check:security 不会各判各的。
    path: ".github/workflows/security-config.yml",
    pattern: /pnpm check:audit/,
    label: "Security/config checks must run the dependency audit through the repository policy",
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

/**
 * 依赖审计的判定本体在 `dependency-audit.ts`（含「暂无补丁」例外台账）。
 *
 * 这里保留同名导出是为了不改动既有调用方与单测；判定本身只有一份实现，
 * 所以 CLI 与 CI 走的是同一段代码——**例外台账不可能只对其中一条路径生效**。
 */
export function inspectAuditReport(
  report: unknown,
  options: { exceptions?: readonly AuditException[]; today?: string } = {},
): DependencyAuditVerdict | string[] {
  return inspectDependencyAudit(report, options);
}

export function formatSecurityIssues(issues: readonly string[]): string {
  return issues.map((issue) => `  - ${issue}`).join("\n");
}
