/**
 * CodeQL 告警台账对账的 IO 层（判定在 `src/lib/security/codeql-alert-registry.ts`，
 * 由 Vitest 覆盖）。
 *
 * 用法：
 *   GITHUB_TOKEN=… node scripts/check-codeql-alerts.js [--repo owner/name] [--json] [--today YYYY-MM-DD]
 *   node scripts/check-codeql-alerts.js --fixture fixtures/codeql-alerts.json   # 离线，喂录制数据
 *
 * 退出码：
 *   0  台账与实况一致，且无阻断级未处置、无超期
 *   1  发现差集 / 未结案 / 超期
 *   2  用法错误，或**读不到实况**（缺 token / 网络失败 / API 换形状）
 *
 * 为什么 2 而不是 0：读不到告警列表不是「零告警」，也不是「零回归」。
 * 一条会把「未知」显示成「通过」的检查，比没有检查更危险。
 *
 * ## 这个脚本存在的原因
 *
 * `docs/operations/codeql-alert-triage.md` 里写着「告警计数与对比…**本地无法复现**」，
 * 于是「零回归」这个结论从来没有被任何自动检查核对过。2026-09-24 那 4 条
 * `js/log-injection` 就是这么挂了 5 天没人发现。而本机 `gh` 实测能读到全部字段
 * ⇒ **缺的不是权限，是没人写这个探测**。
 *
 * ## 一个必须带上的 header（本仓库自己踩过）
 *
 * `security_severity_level` **只在带 `x-github-api-version: 2022-11-28` 时才有值**。
 * 不带它，同一个字段返回 `null`——而 `null` 看起来完全像「GitHub 没给这条评分」。
 * 2026-10-13 实测对照（同一份数据、同一时刻）：
 *   无 header ⇒ `security_severity_level = null`；带 header ⇒ `high` / `medium`。
 * 所以本脚本把它当成**必需参数**，并在拿不到值时判「未知」（退出码 2），
 * **绝不**把 `null` 读成「低危」。
 *
 * 只读：只发 `GET /repos/{owner}/{repo}/code-scanning/alerts`，不改任何告警状态。
 * 改 dismissal 是 maintainer 在产品界面里做的事，本脚本不碰。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectCodeqlAlerts } from "../../src/lib/security/codeql-alert-registry.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
/** 拿不到这个 header 就拿不到 severity 分类——见文件头。 */
export const REQUIRED_API_VERSION = "2022-11-28";
const VALUE_FLAGS = { "--repo": "repo", "--token": "token", "--today": "today", "--fixture": "fixture" };
const BOOLEAN_FLAGS = { "--help": "help", "-h": "help", "--json": "json" };

export function parseArgs(argv, env = process.env) {
  const args = argv.filter((arg) => arg !== "--");
  const options = {
    repo: env.GITHUB_REPOSITORY || "",
    token: env.GITHUB_TOKEN || env.GH_TOKEN || "",
    today: "",
    fixture: "",
    json: false,
    help: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    const boolean = Object.hasOwn(BOOLEAN_FLAGS, token) ? BOOLEAN_FLAGS[token] : null;
    if (boolean !== null) {
      options[boolean] = true;
      continue;
    }
    const key = Object.hasOwn(VALUE_FLAGS, token) ? VALUE_FLAGS[token] : null;
    if (key === null) return { error: `未知参数：${token}` };
    const raw = args[(index += 1)];
    if (raw === undefined) return { error: `${token} 需要一个值` };
    options[key] = raw;
  }
  if (options.today && !/^\d{4}-\d{2}-\d{2}$/.test(options.today)) {
    return { error: "--today 需要 YYYY-MM-DD" };
  }
  return { options };
}

/** 把 API 的一条告警裁剪成判定需要的形状。 */
export function toLiveAlert(alert) {
  const rule = typeof alert.rule === "object" && alert.rule !== null ? alert.rule : {};
  const instance =
    typeof alert.most_recent_instance === "object" && alert.most_recent_instance !== null
      ? alert.most_recent_instance
      : {};
  const location = typeof instance.location === "object" && instance.location !== null ? instance.location : {};
  return {
    number: alert.number,
    ruleId: typeof rule.id === "string" ? rule.id : "",
    severity: typeof rule.severity === "string" ? rule.severity : "",
    // **原样带回 null**：把「拿不到」洗成「低」是这个探测最坏的失败方式
    securitySeverityLevel: typeof rule.security_severity_level === "string" ? rule.security_severity_level : null,
    state: typeof alert.state === "string" ? alert.state : "",
    createdAt: typeof alert.created_at === "string" ? alert.created_at.slice(0, 10) : "",
    path: typeof location.path === "string" ? location.path : null,
    dismissedReason: typeof alert.dismissed_reason === "string" ? alert.dismissed_reason : null,
  };
}

/** 从 GitHub 读 open 告警。返回 `{ alerts }` 或 `{ error }`——**不返回 `[]` 表示「没有告警」**。 */
export async function fetchOpenAlerts(repo, token, apiBase = "https://api.github.com") {
  if (!repo || !repo.includes("/")) {
    return { error: "不知道要查哪个仓库：需要 --repo owner/name 或 GITHUB_REPOSITORY" };
  }
  if (!token) {
    return {
      error:
        "缺少 GitHub token（GITHUB_TOKEN / GH_TOKEN / --token）。" +
        "实测（2026-10-13）匿名打这个端点回 401 ⇒ 没有 token 就只能回答「未知」",
    };
  }
  const alerts = [];
  try {
    for (let page = 1; page <= 10; page += 1) {
      const response = await fetch(
        `${apiBase.replace(/\/+$/, "")}/repos/${repo}/code-scanning/alerts` +
          `?state=open&per_page=100&page=${page}`,
        {
          method: "GET",
          headers: {
            authorization: `Bearer ${token}`,
            accept: "application/vnd.github+json",
            "x-github-api-version": REQUIRED_API_VERSION,
            "user-agent": "indiestack-codeql-alert-check",
          },
        },
      );
      if (!response.ok) return { error: `HTTP ${response.status} ${response.statusText}` };
      const batch = await response.json();
      if (!Array.isArray(batch)) return { error: "响应不是数组——API 换了形状，不猜它的含义" };
      alerts.push(...batch);
      if (batch.length < 100) break;
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  return { alerts: alerts.map(toLiveAlert) };
}

/** 读录制好的 fixture（离线复现与 CI 无网络时用）。 */
export function readFixture(file, repoRoot = REPO_ROOT) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.resolve(repoRoot, file), "utf8"));
    const list = Array.isArray(raw) ? raw : raw.alerts;
    if (!Array.isArray(list)) return { error: `${file} 里找不到 alerts 数组` };
    return { alerts: list.map(toLiveAlert) };
  } catch (error) {
    return { error: `读不了 ${file}：${error instanceof Error ? error.message : String(error)}` };
  }
}

/** 跑一次对账并打印结果，返回进程退出码。 */
export async function runCodeqlAlertCheck(options, repoRoot = REPO_ROOT) {
  const today = options.today || new Date().toISOString().slice(0, 10);
  let fetched;
  if (options.fixture) {
    fetched = readFixture(options.fixture, repoRoot);
  } else {
    fetched = await fetchOpenAlerts(options.repo, options.token, options.apiBase);
  }
  if (fetched.error) console.error(`❌ 读不到 code-scanning 告警：${fetched.error}`);

  // 动态导入台账：放在这里而不是模块顶层，好让单测能自己传 registry
  const { CODEQL_ALERT_REGISTRY } = await import("../../src/lib/security/codeql-alert-registry.ts");
  const report = inspectCodeqlAlerts(CODEQL_ALERT_REGISTRY, fetched.error ? null : fetched.alerts, today);

  if (options.json) {
    console.log(JSON.stringify({ ...report, error: fetched.error ?? null, today }, null, 2));
  } else {
    for (const issue of report.issues) {
      const unknown = issue.code === "CODEQL_ALERT_LIVE_UNREADABLE";
      console.log(`${unknown ? "⚠️" : "❌"} [${issue.code}] ${issue.message}`);
    }
    if (report.issues.length === 0) {
      console.log(
        `✅ 台账与实况一致：${report.stats.registered} 条登记 / ${report.stats.live} 条 open 告警，` +
          "无未登记、无腐烂条目、无阻断级未处置、无超期",
      );
    }
  }

  if (fetched.error) return 2;
  return report.issues.length > 0 ? 1 : 0;
}

const HELP = [
  "用法：node scripts/check-codeql-alerts.js [选项]",
  "",
  "  --repo <owner/name>   目标仓库（默认取 GITHUB_REPOSITORY）",
  "  --token <ghp_…>       GitHub token（默认取 GITHUB_TOKEN / GH_TOKEN；不会打印）",
  "  --fixture <path>      用录制数据代替 API（离线复现用；仓库相对路径）",
  "  --today <YYYY-MM-DD>  固定「今天」，让 SLA 与期限判定可复现",
  "  --json                机器可读输出",
  "",
  `只读：只发 GET /repos/{repo}/code-scanning/alerts，且必须带 x-github-api-version:`,
  `      ${REQUIRED_API_VERSION}（不带它 security_severity_level 会是 null，那是用法错误不是「没评分」）。`,
  "      不改任何告警状态——dismissal 是 maintainer 在产品界面里做的事。",
  "退出码：0 一致 / 1 发现差集或未结案或超期 / 2 用法错误或读不到实况（未知不算通过）",
].join("\n");

/** 解析参数、跑对账并返回退出码。 */
export async function runCli(argv, repoRoot = REPO_ROOT) {
  const parsed = parseArgs(argv);
  if (parsed.error) {
    console.error(`❌ ${parsed.error}`);
    console.error(HELP);
    return 2;
  }
  if (parsed.options.help) {
    console.log(HELP);
    return 0;
  }
  return runCodeqlAlertCheck(parsed.options, repoRoot);
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  runCli(process.argv.slice(2)).then((code) => process.exit(code));
}
