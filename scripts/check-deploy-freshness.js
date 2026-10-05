#!/usr/bin/env node
/**
 * 量一量「生产落后 main 多少个提交」。
 *
 * 存在的理由：`production-smoke.yml` 的定时任务**会打印**生产跑的 commit，但**不断言**它
 * （`expected_commit` 只在 `workflow_dispatch` 时能传，`schedule` 路径留空）。
 * 2026-10-05 实测到这个状态：Vercel 构建配额限流，生产停在 `08dd6f17`，
 * `main` 已经是 `30f8e896`（差 4 个提交），而当天的定时任务一路绿——
 * **没有任何自动检查会注意到它**。
 *
 * 用法：
 *   node scripts/check-deploy-freshness.js [--base-url URL] [--max-behind N] [--main REF]
 *
 * 退出码：
 *   0  在阈值内（含「生产就是 main」）
 *   1  落后超过阈值，或读不到构建身份（**未知不算通过**）
 *   2  用法错误
 *
 * **刻意复用**已有的 `probeHealth` 与 `evaluateFreshness`，不新造 HTTP 与判定逻辑。
 */
const { execFileSync } = require("node:child_process");
const { probeHealth } = require("./lib/health-probe");
const { DEFAULT_MAX_BEHIND, evaluateFreshness } = require("./lib/deploy-freshness");

const DEFAULT_BASE_URL = "https://indie-stack-theta.vercel.app";

function parseArgs(argv) {
  const options = { baseUrl: DEFAULT_BASE_URL, maxBehind: DEFAULT_MAX_BEHIND, main: "origin/main" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--base-url") options.baseUrl = argv[++i];
    else if (arg === "--max-behind") options.maxBehind = Number(argv[++i]);
    else if (arg === "--main") options.main = argv[++i];
    else if (arg === "--") continue;
    else return { error: `未知参数：${arg}` };
  }
  if (!/^https?:$/.test(new URL(options.baseUrl).protocol)) {
    return { error: "--base-url 需要 http/https" };
  }
  if (!Number.isInteger(options.maxBehind) || options.maxBehind < 0) {
    return { error: "--max-behind 需要一个非负整数" };
  }
  return { options };
}

/** `git rev-list --count <deployed>..<main>`：生产落后 main 多少个提交。 */
function countCommitsBehind(deployedCommit, mainRef) {
  try {
    const out = execFileSync("git", ["rev-list", "--count", `${deployedCommit}..${mainRef}`], {
      encoding: "utf8",
    });
    return Number(out.trim());
  } catch {
    // git 历史不够深、或部署的 commit 不在这台机器的仓库里——都归为「算不出」
    return null;
  }
}

function resolveMainSha(mainRef) {
  try {
    return execFileSync("git", ["rev-parse", mainRef], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2).filter((a) => a !== "--"));
  if (parsed.error) {
    console.error(`❌ ${parsed.error}`);
    console.error(
      "用法：node scripts/check-deploy-freshness.js [--base-url URL] [--max-behind N] [--main REF]",
    );
    return 2;
  }
  const { baseUrl, maxBehind, main: mainRef } = parsed.options;

  const probe = await probeHealth(`${baseUrl.replace(/\/$/, "")}/api/health`);
  if (!probe.healthy) {
    console.error(`❌ 健康探测失败：${probe.error || `HTTP ${probe.status}`}`);
    console.error("   连生产在跑什么都读不到，就更无从谈新鲜度。");
    return 1;
  }

  const deployedCommit = typeof probe.body?.commit === "string" ? probe.body.commit.trim() : "";
  const mainSha = resolveMainSha(mainRef);
  const commitsBehind = deployedCommit ? countCommitsBehind(deployedCommit, mainRef) : null;

  const verdict = evaluateFreshness({ deployedCommit, mainSha, commitsBehind, maxBehind });
  const icon = verdict.passed ? "✅" : "❌";
  console.log(`${icon} deploy freshness: ${verdict.status} (阈值 ${maxBehind})`);
  console.log(`   生产 commit：${deployedCommit || "（未上报）"}`);
  console.log(`   ${mainRef}：${mainSha || "（本地解析不到）"}`);
  console.log(`   ${verdict.message}`);
  return verdict.passed ? 0 : 1;
}

if (require.main === module) {
  main().then((code) => process.exit(code));
}

module.exports = { countCommitsBehind, main, parseArgs, resolveMainSha };
