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
 * ## 一个 header 的坑，以及一个我把原因写错的坑（都踩过）
 *
 * **先说我写错的那半**：我原先在这里写「`security_severity_level` 只在带
 * `x-github-api-version: 2022-11-28` 时才有值，不带它返回 `null`」——**那是错的**。
 * 错因是拿 `gh api` 做「不带 header」那一组，而 **`gh` 自己会补默认 api-version**，
 * 于是两组都带了 header，我看到的差异根本不在 header 上。改用 `curl` 严格对照后：
 *   不带 header / 带 `2022-11-28` / 带 `2026-03-10` ⇒ `rule.security_severity_level` 都有值。
 * 真正的成因是**字段取错了嵌套层级**：它在 `rule` 下面，顶层没有这个键。
 * （映射逻辑因此从本文件搬进 `src/lib/.../codeql-alert-registry.ts` 并配了单测。）
 *
 * **header 本身仍要带**，但理由与严重度无关：不受支持的版本值会直接 **HTTP 400**
 * （实测 `2023-03-02` 报 `supported versions are "2026-03-10" (most recent) and "2022-11-28"`），
 * 而 `2022-11-28` 是响应头 `x-github-api-version-selected` 实测选中的那一版，钉住它让读数可复现。
 *
 * 还有一条实测：别用查询参数筛严重度。`severity=` 过滤的是 `security_severity_level`
 * （`severity=high` 只回 #18，而 #18 的 `rule.severity` 是 `warning`），
 * 且**无法识别的取值被静默忽略**（`severity=error` / `nonsense` 都回全部 5 条）
 * ⇒ 拼错的过滤器看起来像「生效了且全命中」。
 *
 * 拿不到值时判「未知」（退出码 2），**绝不**把 `null` 读成「低危」。
 *
 * 只读：只发 `GET /repos/{owner}/{repo}/code-scanning/alerts`，不改任何告警状态。
 * 改 dismissal 是 maintainer 在产品界面里做的事，本脚本不碰。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  inspectCodeqlAlerts,
  toLiveAlert,
} from "../../src/lib/security/codeql-alert-registry.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
/** 钉住 API 版本让读数可复现；不受支持的版本值会直接 400（不是返回 null）。 */
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

// 「字段在哪一层」的唯一决定点已搬到 `src/lib/security/codeql-alert-registry.ts` 的
// `toLiveAlert()`——那里有单测钉住它，本文件只负责发请求与读 fixture。
// 之前在这里另写一份映射逻辑而**一行测试都没有**，于是我据此把一句错误的因果解释
// 写进了 main（以为严重度为 null 是缺 api-version header，真相是取错了嵌套层级）。
export { toLiveAlert };

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
  `只读：只发 GET /repos/{repo}/code-scanning/alerts，并钉住 x-github-api-version:`,
  `      ${REQUIRED_API_VERSION}（不受支持的版本值会直接 HTTP 400；它不是严重度字段的前提——`,
  `      严重度在 rule.security_severity_level 下，取顶层同名键才会得到 null）。`,
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
