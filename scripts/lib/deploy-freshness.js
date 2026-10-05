/**
 * 「生产落后 main 多少个提交」的判定（纯规则；IO 在 `scripts/check-deploy-freshness.js`）。
 *
 * ## 为什么要有这一条
 *
 * `production-smoke.yml` 的定时任务**会打印**生产正在跑的 commit，但**不断言**它：
 * `expected_commit` 只在 `workflow_dispatch` 时能传，`schedule` 路径留空。
 * 于是「生产落后 main 十个提交」这件事**不会让任何任务变红**——
 * 2026-10-05 就实测到了这个状态：Vercel 构建配额限流，生产停在 `08dd6f17`，
 * 而 `main` 已经是 `30f8e896`（差 4 个提交），当天的定时任务一路绿。
 *
 * ## 为什么不直接断言「生产 commit == main commit」
 *
 * 因为**部署滞后是常态而不是故障**：合并到部署完成之间天然有几十分钟，
 * 加上 Vercel 的构建排队与配额限流lag 几小时也很正常。
 * 断言相等会让这个任务每天在正常时段红几次，红久了就没人看了——
 * **一个天天误报的检查等于没有检查**。
 *
 * 所以量的是**距离**而不是相等：落后在阈值内 = 通过（并说明落后多少），
 * 超过阈值 = 失败（并区分「还在排队」与「部署可能真坏了」）。
 */

/** 落后多少个提交以内算正常。 */
const DEFAULT_MAX_BEHIND = 5;

/**
 * 判定结果。
 * `status` 三态：
 * - `fresh`：部署的 commit 就是 main（或领先，因为有人在 main 之后又推了别的分支）。
 * - `lagging`：落后但在阈值内。
 * - `stale`：落后超过阈值。
 */
function evaluateFreshness(input) {
  const {
    deployedCommit,
    mainSha,
    commitsBehind,
    maxBehind = DEFAULT_MAX_BEHIND,
  } = input;

  // **先看读数本身可不可信**：`commitsBehind` 是调用方算好的，而它算的前提是
  // 知道生产跑的是哪个 commit。生产没上报 commit（字段不存在，或值为空）时，
  // 距离就没有意义——这时候报「生产就是 main」是一句**没有依据的话**，
  // 而它恰好是最容易让人放心的一句。所以这里失败关闭。
  if (typeof deployedCommit !== "string" || deployedCommit.trim() === "") {
    return {
      status: "unknown",
      passed: false,
      commitsBehind: null,
      maxBehind,
      message:
        "生产没有上报 commit，无法判断新鲜度。" +
        "**这不等于「生产是最新的」**——恰恰相反，读不到构建身份时最不该下的结论就是「没问题」。",
    };
  }

  if (commitsBehind === null || commitsBehind === undefined) {
    return {
      status: "unknown",
      passed: false,
      commitsBehind: null,
      maxBehind,
      message:
        "算不出生产落后多少个提交（多半是本地/CI 的 git 历史不够深，或部署的 commit 不在 main 的祖先链上）。" +
        "这不等于通过——生产确实在一个未知的构建上。",
    };
  }
  if (!Number.isFinite(commitsBehind) || commitsBehind < 0) {
    return {
      status: "unknown",
      passed: false,
      commitsBehind: null,
      maxBehind,
      message: `落后提交数不合法：${commitsBehind}`,
    };
  }

  if (commitsBehind === 0) {
    return {
      status: "fresh",
      passed: true,
      commitsBehind,
      maxBehind,
      message: `生产跑的就是 main（${shortSha(deployedCommit)}）。`,
    };
  }

  const short = shortSha(deployedCommit);
  const shortMain = shortSha(mainSha);
  if (commitsBehind <= maxBehind) {
    return {
      status: "lagging",
      passed: true,
      commitsBehind,
      maxBehind,
      message:
        `生产落后 main ${commitsBehind} 个提交（生产 ${short} → main ${shortMain}），` +
        `在阈值 ${maxBehind} 以内。部署滞后是常态，所以这里判通过，但**记下了距离**：` +
        `连续多天出现同一个距离且不回落，才说明部署坏了。`,
    };
  }

  return {
    status: "stale",
    passed: false,
    commitsBehind,
    maxBehind,
    message:
      `生产落后 main ${commitsBehind} 个提交（生产 ${short} → main ${shortMain}），超过阈值 ${maxBehind}。` +
      "先看是不是 Vercel 构建配额/排队（PR 上的 Vercel 检查会直接写 `Deployment rate limited`）；" +
      "配额没问题那就是部署真的没跟上，需要人工介入。",
  };
}

function shortSha(sha) {
  return typeof sha === "string" && sha.trim() ? sha.trim().slice(0, 8) : "unknown";
}

module.exports = { DEFAULT_MAX_BEHIND, evaluateFreshness, shortSha };
