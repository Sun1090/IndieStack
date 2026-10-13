/**
 * 「合并进 main 的每个提交，生产到底部署了没有」的**判定层**（纯函数）。
 * IO 在 `scripts/lib/deployment-ledger-check.js`。
 *
 * ## 为什么要有这一条
 *
 * 本仓库反复在文档里写「**生产是否也被挡住 = 未知，需要 Vercel 侧部署记录，本机取不到**」
 * （`docs/operations/environments.md` 的 Vercel 配额行，2026-10-13 之前一直这么写）。
 * **那句话是错的**：Vercel 会把每次部署上报成 GitHub Deployment，
 * `GET /repos/{owner}/{repo}/deployments?environment=…` **匿名可读**
 * （2026-10-13 实测 `curl -sI` 返回 200，不带 token）。
 *
 * 于是「未知」当场变成一个可自动判的问题，而它一判就判出了真故障：
 * #256（`16c23e15`）与 #257（`75b011ba`）合并后**都没有生产部署记录**，
 * 而 `75b011ba` 是 main 的 HEAD——**没有任何后续部署能覆盖它**，
 * 所以生产从 07:00:11Z 起停在 `a5b38466`（#255）。
 *
 * ## 为什么不能只看「有没有部署记录」
 *
 * 这是本模块存在的主要理由。**只按「无记录 = 故障」判会天天误报**：
 * 2026-10-13 实测最近 12 个已合并 PR 里有 7 个无部署记录，
 * 其中 #251 / #252 / #253 / #254 **全部被 #255 的那次部署在 git 历史上覆盖**——
 * Vercel 会把连续合并的提交**并成一次部署**，中间那几个本来就不会单独上线。
 * 全库统计：226 个已合并 PR 中 111 个无生产记录，**这是常态而不是异常**。
 *
 * ⇒ 真正的判据是：**无记录，且没有任何后续部署包含它**。只有这种形态才说明「从未上线」。
 *
 * ## 阈值从哪来
 *
 * `maxLagMinutes` 默认 90。出处：2026-10-13 实测 73 个可配对样本
 * （合并时间 → 该 sha 的生产部署记录时间），**中位 1.5 分钟、最大 57.2 分钟**。
 * 90 是历史最大值的 1.6 倍——留了排队余量，又远小于本轮实测到的
 * 那次真实停滞（#257 合并 4 小时仍无记录）。
 * **阈值不该拍脑袋**：它要么来自样本，要么就该被当成待验证的假设写在这里。
 */

/** 一次「合并进 main 的提交」的观察结果，由 IO 层填好。 */
export interface DeployObservation {
  /** 来源 PR 编号。 */
  pr: number;
  /** PR 的 merge commit SHA。 */
  sha: string;
  /** 合并时间（ISO 8601）。 */
  mergedAt: string;
  /** 该 SHA 的生产部署记录时间；**无记录时为 null**。 */
  deployedAt: string | null;
  /**
   * 无部署记录时：在 git 历史上**包含**本提交的、最近一个后续部署所属的 PR 编号。
   * 有部署记录时忽略。`null` = **没有任何后续部署包含它**（即从未上线）。
   */
  coveredByPr: number | null;
}

/** 判据结论。 */
export type DeployVerdictCode =
  /** 读不到观察（API 失败 / 无网络 / 仓库无已合并 PR）——**未知不算通过**。 */
  | "NO_OBSERVATIONS"
  /**
   * **一条部署记录都没有** ⇒ 判未知，而**不是**判「所有提交都没上线」。
   *
   * 这条判据存在的原因是一个实测到的假绿（准确说是**假红**）：
   * 把环境名写错时 API 返回 **HTTP 200 + 空数组**，于是每个已合并提交都变成
   * 「无记录且无后续覆盖」⇒ 工具会报出「226 个提交从未上线」这种
   * **自信而完全错误**的结论。一个会说出相反结论的读数比没有读数更贵。
   *
   * ⚠️ 它必须是**判定层**的一条而不是 IO 层的一个 `if`：
   * 放 IO 层就没有单测、也进不了变异核对表，而这条恰恰是「读错方向」代价最高的那条。
   */
  | "NO_DEPLOYMENT_RECORDS"
  /** 每个提交要么部署了，要么被后续部署覆盖。 */
  | "CONSISTENT"
  /** 有提交从未上线，且已超过滞后阈值。 */
  | "NEVER_DEPLOYED"
  /** 有提交从未上线，但还在阈值窗口内（可能只是排队）。 */
  | "PENDING";

export interface DeployAudit {
  code: DeployVerdictCode;
  /** 是否判通过。`PENDING` 也算通过——它不是结论，只是还没到下结论的时候。 */
  passed: boolean;
  /** 从未上线且已超阈值的观察。 */
  neverDeployed: DeployObservation[];
  /** 从未上线但仍在窗口内的观察。 */
  pending: DeployObservation[];
  /** 已部署但 lag 超阈值的观察（信息性：部署最终发生了，所以不判红）。 */
  slow: DeployObservation[];
  /** 无记录但被后续部署覆盖的条数——**这个数字是这条判据的价值所在**。 */
  skippedCount: number;
  /** 取一条观察的滞后分钟数（读不出为 null）。 */
  lagMinutes: (observation: DeployObservation) => number | null;
  message: string;
}

/** 落后多少个分钟以内不算异常（见文件头「阈值从哪来」）。 */
export const DEFAULT_MAX_LAG_MINUTES = 90;

/**
 * 结论 → 进程退出码。**放在判定层而不是 IO 层的 `if` 里**，有两个理由：
 *   1. 「哪种结论算未知」是**判据的一部分**，不是打印细节；
 *   2. IO 层的那个函数已经因为多了一个三元表达式撞上 ESLint 的复杂度上限——
 *      撞墙本身在说「这件事不属于这里」。
 *
 * 三种码：**0 通过 / 1 判出故障 / 2 读不出（未知）**。
 * 把 1 和 2 压成同一个码，会让「环境名写错」看起来像「生产真的坏了」——
 * 而这两种情况的处理人、处理方向完全不同。
 */
export function deployExitCode(audit: Pick<DeployAudit, "code" | "passed">): number {
  if (audit.code === "NO_OBSERVATIONS" || audit.code === "NO_DEPLOYMENT_RECORDS") return 2;
  return audit.passed ? 0 : 1;
}

/** API 原始响应里本模块会读到的字段（其余字段忽略）。 */
export interface RawDeployment {
  sha?: unknown;
  created_at?: unknown;
}
export interface RawPull {
  number?: unknown;
  merged_at?: unknown;
  merge_commit_sha?: unknown;
  base?: { ref?: unknown };
}

/**
 * 把 GitHub API 的原始响应映射成观察。
 *
 * ⚠️ **这个映射刻意写在被单测覆盖的模块里，而不是留在 IO 层**。
 * 出处是本仓库的真实教训：`codeql-alert-check.js` 曾在 IO 层另写一份字段映射、
 * **一行测试都没有**，于是我据它把一句错误的因果解释写进了 main
 * （以为严重度为 null 是缺 api-version header，真相是取错了 `rule.` 嵌套层级）。
 * 「字段在哪一层」是一个**会读错的事实**，读错时不会报错、只会静默给出错误结论
 * ——正是最该有单测的那类代码。
 */
export function toObservations(
  deployments: readonly RawDeployment[],
  pulls: readonly RawPull[],
): DeployObservation[] {
  const deployedAtBySha = new Map<string, string>();
  for (const deployment of deployments) {
    const sha = deployment?.sha;
    const created = deployment?.created_at;
    if (typeof sha !== "string" || typeof created !== "string") continue;
    // 同一 sha 有多条记录时取**最早**那条——那才是「第一次上线」
    const existing = deployedAtBySha.get(sha);
    if (!existing || Date.parse(created) < Date.parse(existing)) deployedAtBySha.set(sha, created);
  }

  const merged = pulls
    .filter(
      (pull) =>
        typeof pull?.merged_at === "string" &&
        typeof pull?.merge_commit_sha === "string" &&
        pull?.base?.ref === "main",
    )
    .map((pull) => ({
      pr: Number(pull.number),
      sha: String(pull.merge_commit_sha),
      mergedAt: String(pull.merged_at),
    }))
    .filter((entry) => Number.isFinite(entry.pr))
    .sort((left, right) => Date.parse(left.mergedAt) - Date.parse(right.mergedAt));

  return merged.map((entry, index) => {
    const deployedAt = deployedAtBySha.get(entry.sha) ?? null;
    if (deployedAt !== null) return { ...entry, deployedAt, coveredByPr: null };
    // 「被后续部署覆盖」= 存在合并时间更晚、且**自己真的部署了**的提交。
    // ⚠️ 依赖 main 的**线性 squash 历史**（实测最近 200 个提交全为单父）；
    // 仓库哪天改用 merge commit，这里会开始把「其实没上线」读成「已被覆盖」。
    let coveredByPr: number | null = null;
    for (let later = index + 1; later < merged.length; later += 1) {
      if (deployedAtBySha.has(merged[later].sha)) {
        coveredByPr = merged[later].pr;
        break;
      }
    }
    return { ...entry, deployedAt: null, coveredByPr };
  });
}

/** ISO 时间差（分钟）；任一输入不可解析时返回 null（**读不出不判红**）。 */
function minutesBetween(fromIso: string, toIso: string): number | null {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return (to - from) / 60_000;
}

/**
 * 判定一批观察。
 *
 * @param observations 按合并时间**升序**的观察（乱序不影响结论，只影响报告可读性）
 * @param now          当前时间（ISO），用于判断「无记录」是否已超窗口
 */
export function auditDeploymentLedger(
  observations: readonly DeployObservation[],
  now: string,
  maxLagMinutes: number = DEFAULT_MAX_LAG_MINUTES,
  /** 读到的部署记录条数。**默认按「有记录」处理**，让纯观察的单测不必都传这个参数。 */
  deploymentRecordCount: number = Number.POSITIVE_INFINITY,
): DeployAudit {
  const lagMinutes = (observation: DeployObservation): number | null =>
    observation.deployedAt === null
      ? minutesBetween(observation.mergedAt, now)
      : minutesBetween(observation.mergedAt, observation.deployedAt);

  const neverDeployed: DeployObservation[] = [];
  const pending: DeployObservation[] = [];
  const slow: DeployObservation[] = [];
  let skippedCount = 0;

  for (const observation of observations) {
    if (observation.deployedAt !== null) {
      const lag = lagMinutes(observation);
      if (lag !== null && lag > maxLagMinutes) slow.push(observation);
      continue;
    }
    // 无部署记录：先问「有没有后续部署把它带上去了」
    if (observation.coveredByPr !== null) {
      skippedCount += 1;
      continue;
    }
    const waiting = minutesBetween(observation.mergedAt, now);
    if (waiting === null) {
      // 时间读不出 ⇒ 无法判断窗口：**不判红也不判绿**，留在 pending 里由报告点名
      pending.push(observation);
      continue;
    }
    if (waiting > maxLagMinutes) neverDeployed.push(observation);
    else pending.push(observation);
  }

  const base = { passed: true, neverDeployed, pending, slow, skippedCount, lagMinutes };

  if (observations.length === 0) {
    return {
      ...base,
      code: "NO_OBSERVATIONS",
      passed: false,
      message:
        "一条观察都没读到（API 失败、无网络、或仓库里没有已合并的 PR）。" +
        "**这不等于「部署都正常」**——读不到就是不知道，而不知道不该被印成绿色。",
    };
  }

  // 有观察、却一条部署记录都没有 ⇒ 「无记录」这个事实**不可信**，不能拿它下结论
  if (deploymentRecordCount === 0) {
    return {
      ...base,
      code: "NO_DEPLOYMENT_RECORDS",
      passed: false,
      neverDeployed: [],
      message:
        `读到 ${observations.length} 个已合并提交，却**一条部署记录都没有**。` +
        "多半是环境名写错或被改名、分页参数太小、或 fixture 是空的。" +
        "**这绝不等于「所有提交都没上线」**——按未知处理。",
    };
  }

  if (neverDeployed.length > 0) {
    const list = neverDeployed
      .map((observation) => `#${observation.pr} (${observation.sha.slice(0, 8)}, 合并于 ${observation.mergedAt})`)
      .join("、");
    return {
      ...base,
      code: "NEVER_DEPLOYED",
      passed: false,
      message:
        `${neverDeployed.length} 个已合并提交**从未上线**（无部署记录，且没有任何后续部署包含它们）：${list}。` +
        `已超过阈值 ${maxLagMinutes} 分钟——生产停在比它们更早的构建上。` +
        "先看 PR 上的 Vercel 检查是否写着 `Deployment rate limited`（构建配额），" +
        "再看 Vercel 项目是否被暂停。",
    };
  }

  if (pending.length > 0) {
    return {
      ...base,
      code: "PENDING",
      message:
        `${pending.length} 个提交暂无部署记录、但仍在 ${maxLagMinutes} 分钟窗口内` +
        "（Vercel 常把连续合并的提交并成一次部署，所以这多半不是故障）。",
    };
  }

  return {
    ...base,
    code: "CONSISTENT",
    message:
      "已合并提交均有生产部署记录，或已被后续部署覆盖" +
      `（其中 ${skippedCount} 个属于「被 Vercel 合并部署跳过」的正常形态）。`,
  };
}
