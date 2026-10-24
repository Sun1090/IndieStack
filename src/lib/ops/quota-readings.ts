/**
 * Vercel 构建配额的**读数台账**——文档里那句「今天有 N 个读数」由这里算，不由人抄。
 *
 * **为什么要写成代码**：本仓库已经为同一个形态付过两次学费。
 * 第一次是 B04 的「5 条 psql 元命令」（手量，真值 6，漏的偏偏是唯一那条结构性的），
 * 修法是 `src/lib/drills/psql-meta.ts` + `preflight.test.ts` 的跨文件对账。
 * 这一次是 `docs/operations/environments.md` 的 Vercel 配额行：
 * 表头写「**今天有四个读数**」，而同一行正文一路数到「**第 6 个读数**」——
 * 第 5、6 个读数是在两次后续 commit 里追加进这一行的，**表头没人回头改**。
 * 这不是「一个数写错了」：那一行的**结论**（会波动 / 未解除）依赖读数的个数与形状，
 * 而个数说少了，读者就会以为反例只有三个。
 *
 * ## 台账的口径（决定什么算「一个读数」）
 *
 * 一条读数 = **一次对某个池子的可重跑观察**。所以：
 *   · 同一个 PR 的 preview 与生产是**两条**（#255 preview pass 与 #255 生产跟上
 *     回答的是两个不同问题——「preview 池放没放行」与「生产跟没跟上」）；
 *   · 「两个 Vercel 检查一 pass 一 fail」算**一条**（同一次观察，形状记 `mixed`）；
 *   · 带日期的历史叙述**不新增条目**（「本条写完时是五个读数」是对旧快照的引用，
 *     不是新观察）——所以本模块**刻意只收观察，不收评论**。
 *
 * ⚠️ **这条口径今天被 #256 自己压了一次**：那个 PR 有 4 个 commit（`gh pr view 256
 * --json commits` 实测），每次 push 都重新触发那两个 Vercel 检查，
 * 而我四次查 `gh pr checks 256` 看到的最新状态**都是 fail**。按「一个 PR 在每个池子里最多一条」
 * 的唯一性约束（`quota-readings.test.ts` 里有断言），后两次**进不来**。
 * 那是约束的代价，不是数据的损失：三次同向的观察对「会不会波动」不增加信息，
 * 而放宽约束会让台账变成流水账。**哪天同一 PR 的两次观察方向相反**
 * （第一次 fail、重跑 pass——那才是新信息），届时要改的是约束本身，
 * 而不是把第二次观察偷偷并进 `note` 里。
 *
 * ## ⚠️ 台账里的「生产 fail」与探针判的「CONSISTENT」不矛盾——它们问两个问题
 *
 * 本台账 #256 / #257 的 `production` 两条记的是 **fail**，
 * 而 `pnpm ops:deploy-ledger` 现在判 **CONSISTENT**（那两条被 #258 的部署覆盖了）。
 * **两个读数同时为真**，因为问的不是同一件事：
 *   · 台账问「**这个 PR 自己有没有单独上生产**」——没有，所以记 fail（观察当时成立）；
 *   · 探针问「**这个提交今天在不在线上**」——在，因为 Vercel 把连续合并并成一次部署。
 *
 * ⇒ 读台账时**别把 `production: fail` 当成「线上缺这段代码」**，它记的是「这次合并没单独上线」。
 * 要看线上到底缺不缺，**跑探针，不要数台账**。
 * 这也正是探针的判据必须是「无记录**且无任何后续部署包含它**」而不是「无记录」的原因。
 */

/** 一次观察属于哪个池子。 */
export type QuotaPool = "preview" | "production";

/** 一次观察的判定。`mixed` = 同一次观察里两个检查不一致。 */
export type QuotaOutcome = "pass" | "fail" | "mixed";

export interface QuotaReading {
  /** 被观察的 PR 编号。 */
  pr: number;
  pool: QuotaPool;
  outcome: QuotaOutcome;
  /** 观察日期（YYYY-MM-DD，Asia/Shanghai）。 */
  at: string;
  /** 一句话读数来源，便于报告里点名。 */
  note: string;
}

/**
 * 台账本体。**追加新读数请只往这里加**，然后在
 * `quota-readings.test.ts` 的提示下回头改文档表头那一句——
 * 那条用例会在你忘记时变红。
 */
export const QUOTA_READINGS: readonly QuotaReading[] = [
  {
    pr: 251,
    pool: "preview",
    outcome: "pass",
    at: "2026-10-13",
    note: "两个 Vercel 检查都 pass（`gh pr checks 251`）",
  },
  {
    pr: 252,
    pool: "preview",
    outcome: "mixed",
    at: "2026-10-13",
    note: "主应用 fail、docs-site pass——同一次观察里的分裂",
  },
  {
    pr: 253,
    pool: "preview",
    outcome: "fail",
    at: "2026-10-13",
    note: "两项全 fail，错误文本 `retry in 24 hours`",
  },
  // ⚠️ **这条是补记的，而且我第一版把漏记的原因写错了**（写成「#254 是纯文档 PR
  // 所以没被当成新观察」——那是猜的）。实测：台账模块创建于 09:00:57Z
  // （`git log --diff-filter=A`），而 #254 早在 **05:13:55Z** 就合并了——
  // 建台账时它已经存在 3h47m。⇒ 真实原因是**回填时靠记忆而不是靠重跑查询**：
  // 我只把自己当时记得的那几个 PR 抄进台账，没有遍历 `gh pr list` 逐个查 checks。
  // 教训：**手工回填的清单，完整性等于记忆的长度**。要它可信就得由一次遍历生成，
  // 这也是下面那条生产部署探针存在的理由——**能自动读的观察不该靠人记**。
  {
    pr: 254,
    pool: "preview",
    outcome: "fail",
    at: "2026-10-13",
    note: "两项全 fail（`gh pr checks 254` 实测）——本条为事后补记，当时漏了",
  },
  {
    pr: 255,
    pool: "preview",
    outcome: "pass",
    at: "2026-10-13",
    note: "14 项 checks 全 pass，含两个 Vercel 项——方向与前三个相反",
  },
  {
    pr: 255,
    pool: "production",
    outcome: "pass",
    at: "2026-10-13",
    note: "合并 6 分钟后 `/api/health` 回同一个 SHA、`ops:deploy-freshness` 报 fresh（距离 0）",
  },
  {
    pr: 256,
    pool: "preview",
    outcome: "fail",
    at: "2026-10-13",
    note: "两项又全 fail——把「已解除」当场按回去的那条",
  },
  {
    pr: 256,
    pool: "production",
    outcome: "fail",
    at: "2026-10-13",
    note: "生产部署记录里**没有** `16c23e15`，且没有任何后续部署包含它（`gh api .../deployments`）",
  },
  {
    pr: 257,
    pool: "preview",
    outcome: "pass",
    at: "2026-10-13",
    note: "两项（主应用 + docs-site）都 pass，`gh pr checks 257` 实测；方向再次反转",
  },
  {
    pr: 257,
    pool: "production",
    outcome: "fail",
    at: "2026-10-13",
    // ⚠️ 本条**推翻了我原本写下的解释**。我一开始把「生产没跟上」归因给配额，
    // 但三个读数放在一起就对不上了：#257 的 **preview 构建是 pass**、
    // 同一次合并的 **docs-site 生产 35 秒内上线**（09:01:33Z，合并于 09:00:58Z），
    // 而**主应用生产零记录**。配额若是原因，docs-site 没道理照常上线。
    // ⇒ 「配额挡住生产」解释不了 #257；主应用的生产部署链路**单独**有问题。
    // 本机没有 Vercel 凭据，往下只能列假设、不能定因（见 `environments.md` 那一行）。
    note: "合并后 6 小时无生产部署记录（历史 lag 中位 1.5min、最大 57.2min）；同期 docs-site 35 秒内上线",
  },
  {
    pr: 258,
    pool: "preview",
    outcome: "pass",
    at: "2026-10-13",
    note: "两项都 pass（`gh pr checks 258`）",
  },
  {
    pr: 258,
    pool: "production",
    outcome: "pass",
    at: "2026-10-13",
    // ⚠️ **这条否证了我上一轮写下的「不是配额，是链路单独有问题」**。
    // #258 合并后 **2 分 11 秒**就上了生产，而**我没有做任何修复动作**。
    // 配置坏了、项目被暂停，都**不会自己好**；配额恢复会。
    // 所以 #256 / #257 主应用生产当时没上线，与「配额」并不矛盾。
    // 而它同时也**不证明**是配额——它只证明「那两次没构建，第三次构建了」。
    // 我在这条上连着过早定因两次（先「原因是配额」、后「不是配额」），
    // 教训：**跨环境不同步只能说明两个构建结果不同，不能替我排除任何一个候选。**
    note: "合并 2 分 11 秒后上生产（无人干预）⇒ 上一轮「链路单独坏了」的推断被否证",
  },
];

/** 台账里读数的条数——文档表头那句「今天有 N 个读数」必须等于它。 */
export function readingCount(readings: readonly QuotaReading[] = QUOTA_READINGS): number {
  return readings.length;
}

/**
 * 文档里那条读数链的**规范写法**（`#251 pass → #252 mixed → …`）。
 *
 * 为什么由代码生成而不是让人写：链的**内容**和**条数**必须一致，
 * 而人抄的时候最容易只改条数不改链（或反之）。
 */
export function readingChainText(readings: readonly QuotaReading[] = QUOTA_READINGS): string {
  return readings
    .map((reading) =>
      reading.pool === "production"
        ? `#${reading.pr} 生产 ${reading.outcome}`
        : `#${reading.pr} preview ${reading.outcome}`,
    )
    .join(" → ");
}

/**
 * 从台账算出的结论词。
 *
 * 判据是**形状**而不是最后一条：只要链里同时出现过 pass 与 fail，
 * 结论就是「会波动」。**这一条刻意不看尾部**——按尾部下结论
 * （最近一次是 pass 就说解除）正是本台账要拦的那个错。
 */
export function readingVerdict(
  readings: readonly QuotaReading[] = QUOTA_READINGS,
): "unknown" | "stable-pass" | "stable-fail" | "flapping" {
  if (readings.length === 0) return "unknown";
  const sawPass = readings.some((reading) => reading.outcome === "pass");
  const sawFail = readings.some((reading) => reading.outcome === "fail");
  if (sawPass && sawFail) return "flapping";
  return sawPass ? "stable-pass" : "stable-fail";
}

/**
 * 「连续多少个 PR 都 pass 且生产跟上」——文档里判「解除」的那条门槛。
 *
 * 从**尾部**往回数，遇到任何非 pass 就停。
 * `mixed` 不算 pass：一 fail 一 pass 的那次观察恰恰是配额在挡路的形态。
 */
export function consecutivePassFromTail(
  readings: readonly QuotaReading[] = QUOTA_READINGS,
): number {
  let streak = 0;
  for (let index = readings.length - 1; index >= 0; index -= 1) {
    if (readings[index].outcome !== "pass") break;
    streak += 1;
  }
  return streak;
}

/**
 * 全程**最长**的连续 pass 段。
 *
 * 与 `consecutivePassFromTail` 是两个问题，别混：
 *   · 尾部连击回答「**现在**攒到几连」——它决定能不能宣布解除；
 *   · 最长连击回答「**今天最好到过几连**」——它决定「会不会波动」这句话的证据强度。
 * ⚠️ **这里刻意不写「今天是几」**：台账每追加一条读数，这两个数就可能变，
 * 而注释不在任何对账门禁里——写死它等于又立一个没人回头改的数
 * （本仓库为「文档里的数字」付过三次学费，见 `docs/testing.md`）。
 * 要读数就跑 `summarizeRegistry` 之外的这两个函数，或看 `environments.md` 那一行
 * （**那里的两个数由 `quota-readings.test.ts` 的正则对账钉住**）。
 * 只报其中一个数都会误导：报尾部像是「从没通过过」，报最长像是「快解除了」。
 */
export function longestPassStreak(
  readings: readonly QuotaReading[] = QUOTA_READINGS,
): number {
  let best = 0;
  let current = 0;
  for (const reading of readings) {
    current = reading.outcome === "pass" ? current + 1 : 0;
    if (current > best) best = current;
  }
  return best;
}
