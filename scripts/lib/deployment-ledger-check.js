/**
 * 生产部署台账对账的 IO 层（判定在 `src/lib/ops/deployment-ledger.ts`，由 Vitest 覆盖）。
 *
 * 用法：
 *   node scripts/check-deploy-ledger.js [--repo owner/name] [--environment "Production – indie-stack"]
 *   node scripts/check-deploy-ledger.js --fixture fixtures/deployments.json   # 离线
 *
 * 退出码：
 *   0  已合并提交均已上线或被后续部署覆盖
 *   1  发现「从未上线」的提交（超阈值）
 *   2  用法错误，或**读不到实况**（网络失败 / API 换形状）
 *
 * 为什么 2 而不是 0：读不到部署记录不是「部署都正常」。
 * 一条会把「未知」显示成「通过」的检查，比没有检查更危险。
 *
 * ## 这个脚本存在的原因
 *
 * `docs/operations/environments.md` 的 Vercel 配额那一行，从 2026-10-13 上午起
 * 反复写着「**生产是否也被挡住 = 未知，需要 Vercel 侧部署记录，本机取不到**」。
 * **那句话是错的**：Vercel 把每次部署上报成 GitHub Deployment，
 * 而 `GET /repos/{owner}/{repo}/deployments` **匿名可读**
 * （2026-10-13 实测 `curl -sI` 不带 token 返回 200）。
 *
 * 一判就判出了真故障：#256（`16c23e15`）、#257（`75b011ba`）合并后都没有生产部署记录，
 * 而 `75b011ba` 是 main 的 HEAD ⇒ 没有任何后续部署能覆盖它，生产从 07:00:11Z 起
 * 停在 `a5b38466`（#255）。而当时的 `ops:deploy-freshness` 因为阈值是「落后 5 个提交」，
 * 对这种「落后 2 个」的停滞**判通过**。
 *
 * ## 为什么判据不是「有没有部署记录」
 *
 * 见 `deployment-ledger.ts` 文件头：226 个已合并 PR 里 111 个无生产记录，
 * 绝大多数是被 Vercel 的**合并部署**跳过的（连续合并的几个提交并成一次上线）。
 * 只按「无记录 = 故障」判会让这条检查天天误报，红久了就没人看。
 *
 * ## 「被覆盖」怎么判——以及为什么不用 git
 *
 * 直觉做法是 `git merge-base --is-ancestor`，但那要求 CI 里 `fetch-depth: 0`
 * （`production-smoke.yml` 的 deploy-freshness 作业就是为此才拉全历史）。
 * 实测本仓库 **main 是线性 squash 历史**（最近 200 个提交全部只有一个父提交，
 * `git rev-list --merges --count origin/main` = 2，且已合并 PR 的 base 全是 main）
 * ⇒ 「后续」等价于「合并时间更晚」，所以按时间顺序判即可，**不需要 git 历史**。
 * ⚠️ **这个等价依赖线性历史**：仓库哪天改用 merge commit，本判据会开始漏判
 * （把「其实没上线」读成「已被覆盖」）。前提写在这里，改动历史策略时要回来改判据。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditDeploymentLedger,
  deployExitCode,
  diagnoseNeverDeployed,
  toObservations,
} from "../../src/lib/ops/deployment-ledger.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
/** 钉住 API 版本让读数可复现（不受支持的版本值会直接 HTTP 400）。 */
export const REQUIRED_API_VERSION = "2022-11-28";
/** 本仓库的主应用生产环境名（docs-site 是另一个项目，另有一条）。 */
export const DEFAULT_ENVIRONMENT = "Production – indie-stack";

/**
 * 值型 flag：flag → `{ option, kind }`。
 * `kind: "number"` 的 flag 要求**正数**，所以在这里声明成数据，
 * 而不是在解析循环里加 `if` 分支——那个循环的复杂度已经撞到 ESLint 的 15。
 * （撞墙这件事本身是对的：它在提醒「一个函数在做两件半的事」。）
 */
const VALUE_FLAGS = {
  "--repo": { option: "repo", kind: "string" },
  "--token": { option: "token", kind: "string" },
  "--environment": { option: "environment", kind: "string" },
  "--fixture": { option: "fixture", kind: "string" },
  "--now": { option: "now", kind: "string" },
  "--max-lag-minutes": { option: "maxLagMinutes", kind: "number" },
  "--api-base": { option: "apiBase", kind: "string" },
  "--pages": { option: "pages", kind: "number" },
  "--timeout-ms": { option: "timeoutMs", kind: "number" },
};
const BOOLEAN_FLAGS = { "--help": "help", "-h": "help", "--json": "json" };
/** 单次请求超时（毫秒）。与 `health-probe.js` / `migration-status-check.js` 同一套做法。 */
export const DEFAULT_TIMEOUT_MS = 15_000;

/** 把一个值型 flag 的原始字符串转成选项值；不合法时返回 `{ error }`。 */
function coerceValue(flag, spec, raw) {
  if (spec.kind !== "number") return { value: raw };
  const numeric = Number(raw);
  if (!Number.isFinite(numeric) || numeric <= 0) return { error: `${flag} 需要一个正数` };
  return { value: numeric };
}

export function parseArgs(argv, env = process.env) {
  const args = argv.filter((arg) => arg !== "--");
  const options = {
    repo: env.GITHUB_REPOSITORY || "",
    token: env.GITHUB_TOKEN || env.GH_TOKEN || "",
    environment: DEFAULT_ENVIRONMENT,
    fixture: "",
    now: new Date().toISOString(),
    maxLagMinutes: undefined,
    apiBase: "https://api.github.com",
    pages: 5,
    timeoutMs: DEFAULT_TIMEOUT_MS,
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
    const spec = Object.hasOwn(VALUE_FLAGS, token) ? VALUE_FLAGS[token] : null;
    if (spec === null) return { error: `未知参数：${token}` };
    const raw = args[(index += 1)];
    if (raw === undefined) return { error: `${token} 需要一个值` };
    const coerced = coerceValue(token, spec, raw);
    if (coerced.error) return { error: coerced.error };
    options[spec.option] = coerced.value;
  }
  if (options.now !== "" && !Number.isFinite(Date.parse(options.now))) {
    return { error: "--now 需要一个可解析的时间（ISO 8601）" };
  }
  return { options };
}

/** 分页拉取，返回 `{ rows }` 或 `{ error }`——**不返回 `[]` 表示「没有记录」**。 */
async function fetchPages(urlFor, headers, pages, timeoutMs) {
  const rows = [];
  try {
    for (let page = 1; page <= pages; page += 1) {
      // ⚠️ **必须带超时**：本轮实测到一次 fetch 被中断（错误文本 `terminated`）。
      // 没有超时的话，API 挂起会一路等到 workflow 自己的 5 分钟 timeout 才红——
      // 那时读到的错误是「作业被杀」而不是「API 没响应」，排查方向就错了。
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response;
      try {
        response = await fetch(urlFor(page), { method: "GET", headers, signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) return { error: `HTTP ${response.status} ${response.statusText}` };
      const batch = await response.json();
      if (!Array.isArray(batch)) return { error: "响应不是数组——API 换了形状，不猜它的含义" };
      rows.push(...batch);
      if (batch.length < 100) break;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const aborted = error instanceof Error && error.name === "AbortError";
    return { error: aborted ? `请求超时（${timeoutMs}ms 未响应）` : message };
  }
  return { rows };
}

/**
 * 读「生产部署记录」+「已合并 PR」。
 * 部署记录端点**匿名可读**（实测 200），所以 token 是可选的：
 * 有就用（避开 60 次/小时的匿名限流），没有也能出结论。
 */
export async function fetchDeploymentLedger(
  repo,
  token,
  environment,
  apiBase,
  pages,
  timeoutMs = DEFAULT_TIMEOUT_MS,
) {
  if (!repo || !repo.includes("/")) {
    return { error: "不知道要查哪个仓库：需要 --repo owner/name 或 GITHUB_REPOSITORY" };
  }
  const headers = {
    accept: "application/vnd.github+json",
    "x-github-api-version": REQUIRED_API_VERSION,
    "user-agent": "indiestack-deploy-ledger-check",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  const base = apiBase.replace(/\/+$/, "");
  const encoded = encodeURIComponent(environment);

  const deployments = await fetchPages(
    (page) => `${base}/repos/${repo}/deployments?environment=${encoded}&per_page=100&page=${page}`,
    headers,
    pages,
    timeoutMs,
  );
  if (deployments.error) return { error: `读不到 deployments：${deployments.error}` };
  const pulls = await fetchPages(
    (page) => `${base}/repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=${page}`,
    headers,
    pages,
    timeoutMs,
  );
  if (pulls.error) return { error: `读不到 pulls：${pulls.error}` };
  return { deployments: deployments.rows, pulls: pulls.rows };
}

// 「字段在哪一层」「同一 sha 取最早那条」「后续 = 合并时间更晚」这些决定
// 全部搬进 `src/lib/ops/deployment-ledger.ts` 的 `toObservations()` 并由 Vitest 覆盖。
// 本文件**不再自己写一份映射**——`codeql-alert-check.js` 的教训就是：
// IO 层里一份没有测试的映射，会让错误的因果解释一路写进 main。

/**
 * 为**少数几个 sha** 拉全环境的部署记录（用于跨环境对比）。
 *
 * ⚠️ **为什么不干脆去掉 `?environment=` 一次拉全量**：试过，会把结果读错。
 * 实测本仓库 `--pages 5`（500 条）不带过滤时只有 **90 条**属于主应用生产，
 * 而带过滤能拿到 **230 条**——覆盖范围从 08-23 缩到 09-27。
 * ⇒ 目标环境的记录被其它环境的记录**稀释**，「已上线」的计数从 115 掉到 90，
 *   而**这个变化看起来完全合理**（没有报错、没有异常形态），只有对照旧读数才发现。
 * 所以：目标环境用服务端过滤拉全量，其它环境**只按需查那几个 sha**（通常 1–2 个）。
 */
export async function fetchDeploymentsForShas(repo, token, apiBase, shas, timeoutMs) {
  const headers = {
    accept: "application/vnd.github+json",
    "x-github-api-version": REQUIRED_API_VERSION,
    "user-agent": "indiestack-deploy-ledger-check",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  const base = apiBase.replace(/\/+$/, "");
  const rows = [];
  for (const sha of shas) {
    const fetched = await fetchPages(
      () => `${base}/repos/${repo}/deployments?sha=${sha}&per_page=100`,
      headers,
      1,
      timeoutMs,
    );
    if (fetched.error) return { error: `读不到 ${sha.slice(0, 8)} 的部署记录：${fetched.error}` };
    rows.push(...fetched.rows);
  }
  return { rows };
}

/** 读录制好的 fixture（离线复现与无网络环境用）。 */
export function readFixture(file, repoRoot = REPO_ROOT) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.resolve(repoRoot, file), "utf8"));
    if (!Array.isArray(raw.deployments) || !Array.isArray(raw.pulls)) {
      return { error: `${file} 需要含 deployments 与 pulls 两个数组` };
    }
    return { deployments: raw.deployments, pulls: raw.pulls };
  } catch (error) {
    return { error: `读不了 ${file}：${error instanceof Error ? error.message : String(error)}` };
  }
}

/** 机器可读输出。抽成函数是为了让 `runDeployLedgerCheck` 只负责编排。 */
export function formatJsonReport(audit, observations, options) {
  return JSON.stringify(
    {
      code: audit.code,
      passed: audit.passed,
      environment: options.environment,
      now: options.now,
      observations: observations.length,
      skippedCount: audit.skippedCount,
      neverDeployed: audit.neverDeployed,
      pending: audit.pending,
      slow: audit.slow.map((observation) => ({ ...observation, lagMinutes: audit.lagMinutes(observation) })),
      message: audit.message,
    },
    null,
    2,
  );
}

/**
 * 人读输出，返回**行数组**而不是直接打印。
 *
 * 为什么要抽出来：`runDeployLedgerCheck` 第三次撞上 ESLint 的复杂度上限（17 > 15）。
 * 前两次撞墙时它都在说真话（一次是 flag 该变成数据、一次是退出码该进判定层），
 * 这次说的是「一个函数在同时做取数、判定和排版」。
 * 排版留在 IO 层是对的（它不属于 `src/lib/`），但它不该和编排挤在一个函数里。
 */
export function formatTextReport(input) {
  const { audit, observations, options, icon, diagnosis, crossEnvError } = input;
  const lines = [];
  const minutes = (value) => (value === null ? "（算不出）" : `${Math.round(value)} 分钟`);
  lines.push(`${icon} 生产部署台账: ${audit.code}（环境「${options.environment}」）`);
  lines.push(`   ${audit.message}`);
  lines.push(
    `   观察 ${observations.length} 个已合并提交：` +
      `已上线 ${observations.filter((observation) => observation.deployedAt !== null).length}、` +
      `被合并部署跳过 ${audit.skippedCount}、` +
      `从未上线 ${audit.neverDeployed.length}、窗口内待观察 ${audit.pending.length}`,
  );
  for (const observation of audit.neverDeployed) {
    lines.push(
      `   ❌ #${observation.pr} ${observation.sha.slice(0, 8)} 合并于 ${observation.mergedAt}，` +
        `至今 ${minutes(audit.lagMinutes(observation))}仍无部署记录`,
    );
  }
  if (crossEnvError) {
    lines.push(`   ℹ️ 跨环境对比读不到：${crossEnvError}`);
  }
  // 跨环境对比：**能自动做的对照不该靠人想起来**。
  // 本轮就是靠它发现「配额挡住生产」这个解释站不住——同一次合并里另一个
  // Vercel 项目 30 秒内就上线了。
  for (const item of diagnosis ?? []) {
    if (!item.projectSpecific) {
      lines.push(`   ℹ️ #${item.pr} 在其它环境也没有记录 ⇒ 这次合并**可能整体没构建**（先看配额）`);
      continue;
    }
    const detail = Object.entries(item.otherEnvironments)
      .map(([env, at]) => `${env} @ ${at}`)
      .join("、");
    lines.push(
      `   🔎 #${item.pr} 同一个 sha 在别的环境上线了（${detail}）` +
        "⇒ **不是配额**，是本环境的部署链路单独有问题",
    );
  }
  for (const observation of audit.slow) {
    lines.push(
      `   ⚠️ #${observation.pr} ${observation.sha.slice(0, 8)} 上线滞后 ` +
        `${minutes(audit.lagMinutes(observation))}（最终部署了，所以不判红）`,
    );
  }
  return lines;
}

/** 跑一次对账并打印结果，返回进程退出码。 */
/**
 * 取数：fixture 或 API。**两条入口只在这里分岔一次**——
 * 分岔留在 IO 层是对的（它是取数细节），但塞进编排函数里会让复杂度撞上限
 * （本函数撞过三次，每次都在说真话：见 `formatTextReport` 的注释）。
 */
async function loadLedgerData(options, repoRoot) {
  if (options.fixture) return readFixture(options.fixture, repoRoot);
  return fetchDeploymentLedger(
    options.repo,
    options.token,
    options.environment,
    options.apiBase,
    options.pages,
    options.timeoutMs,
  );
}

export async function runDeployLedgerCheck(options, repoRoot = REPO_ROOT) {
  const fetched = await loadLedgerData(options, repoRoot);
  if (fetched.error) {
    console.error(`❌ 读不到生产部署台账：${fetched.error}`);
    return 2;
  }

  const observations = toObservations(fetched.deployments, fetched.pulls, options.environment);
  /**
   * 「一条部署记录都没有」的判据**在判定层**（`NO_DEPLOYMENT_RECORDS`），不在这里。
   *
   * 它原先是这里的一个 `if`，被搬走了两次才搬对：
   *   第一次挂在 `fetchDeploymentLedger()` 上 ⇒ `--fixture` 路径绕过它
   *   （**守卫挂在其中一条入口上，等于另一条没有守卫**）；
   *   挪到两条路径的汇合处之后仍然没有单测、也进不了变异核对表。
   * ⇒ 本仓库的规矩：**判定进 `src/lib/`，IO 层只负责取数与打印**。
   */
  const audit = auditDeploymentLedger(
    observations,
    options.now,
    options.maxLagMinutes,
    fetched.deployments.length,
  );
  // 三种结论用三个图标：**「读不出」和「判出故障」混在一起显示**，
  // 就是让人去查错方向的开始。退出码同理，见 `deployExitCode()`。
  const icon = audit.passed ? "✅" : deployExitCode(audit) === 2 ? "⚠️" : "❌";

  if (options.json) {
    console.log(formatJsonReport(audit, observations, options));
    return deployExitCode(audit);
  }

  // 跨环境对比的数据**在这里取**（而不是塞进打印函数）：它是网络调用，
  // 而打印函数要保持纯、可单测。
  let crossEnv = fetched.deployments;
  if (!options.fixture && audit.neverDeployed.length > 0) {
    const extra = await fetchDeploymentsForShas(
      options.repo,
      options.token,
      options.apiBase,
      audit.neverDeployed.map((observation) => observation.sha),
      options.timeoutMs,
    );
    // 读不到对比数据**不改变主结论**，只是少一条缩小方向的线索——所以不 return 2
    if (extra.error) crossEnv = { error: extra.error };
    else crossEnv = extra.rows;
  }
  const diagnosis =
    crossEnv && crossEnv.error
      ? null
      : diagnoseNeverDeployed(audit.neverDeployed, crossEnv, options.environment);

  const lines = formatTextReport({
    audit,
    observations,
    options,
    icon,
    diagnosis,
    crossEnvError: crossEnv?.error ?? "",
  });
  for (const line of lines) console.log(line);

  return deployExitCode(audit);
}

const HELP = [
  "用法：node scripts/check-deploy-ledger.js [选项]",
  "",
  "  --repo <owner/name>       目标仓库（默认取 GITHUB_REPOSITORY）",
  "  --token <ghp_…>           GitHub token（可选：deployments 端点匿名可读；有 token 可避开限流）",
  `  --environment <name>      生产环境名（默认「${DEFAULT_ENVIRONMENT}」）`,
  "  --fixture <path>          用录制数据代替 API（离线复现用；仓库相对路径）",
  "  --now <ISO 8601>          固定「现在」，让窗口判定可复现",
  "  --max-lag-minutes <n>     覆盖默认阈值 90（出处见 deployment-ledger.ts 文件头）",
  "  --pages <n>               每个端点最多翻几页（默认 5 = 500 条）",
  "  --timeout-ms <n>          单次请求超时（默认 15000；挂起时判未知而不是干等）",
  "  --json                    机器可读输出",
  "",
  `只读：只发 GET /repos/{repo}/deployments 与 /pulls，钉住 x-github-api-version: ${REQUIRED_API_VERSION}。`,
  "退出码：0 均已上线或被覆盖 / 1 有提交从未上线 / 2 用法错误或读不到实况（未知不算通过）",
].join("\n");

/** 解析参数、跑对账并返回退出码。 */
export async function runCli(argv, repoRoot = REPO_ROOT) {
  const parsed = parseArgs(argv);
  if (parsed.error) {
    console.error(`❌ ${parsed.error}\n`);
    console.error(HELP);
    return 2;
  }
  if (parsed.options.help) {
    console.log(HELP);
    return 0;
  }
  return runDeployLedgerCheck(parsed.options, repoRoot);
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  runCli(process.argv.slice(2)).then((code) => process.exit(code));
}
