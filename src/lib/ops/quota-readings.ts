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
  /**
   * 观察的**精确时刻**（ISO 8601，UTC）。可选，但**判「解除」的跨度必须有它**。
   *
   * **口径固定为**：`preview` 读数取该 PR 的**合并时刻**（`gh pr view --json mergedAt`），
   * `production` 读数取其**生产部署时刻**（`deployments` API 的 `created_at`）——
   * 跨度于是读作「从第一次观察到生产最后一次跟上经过了多少小时」。
   * 两种时刻都必须实读，不能拿「我以为的时间」填（本仓库为时间戳连错过两次）。
   * 为什么需要：门槛是「连击要跨过一个完整 24 小时窗口」，而 `at` 只到日粒度——
   * 同一天追加的六条读数，`at` 全等于 `2026-10-25`，跨度算出来是 0 小时，
   * 于是那条门槛**立了却没有读数方式**（2026-10-26 自查时抓到的，正是本仓库
   * 反复治的「判据存在但无法如实评估」那一族）。缺它的老条目不参与跨度计算，
   * 跨度按「未知」报，不假装是 0。
   */
  atIso?: string;
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
  {
    pr: 279,
    pool: "preview",
    outcome: "pass",
    at: "2026-10-25",
    note: "两个 Vercel 检查都 pass（`gh pr checks 279`，2026-10-25 实测）",
  },
  {
    pr: 280,
    pool: "preview",
    outcome: "pass",
    at: "2026-10-25",
    note: "两项 pass（`gh pr checks 280`）——与 #281 相隔约 20 分钟，形状相反",
  },
  {
    pr: 281,
    pool: "preview",
    outcome: "fail",
    at: "2026-10-25",
    // 错误文本逐字：`Deployment rate limited — retry in 24 hours.`
    // ⇒ 与 2026-10-13 那两次同形（同一句 rate limited），**不是新的失效模式**。
    note: "两项全 fail，错误文本 `Deployment rate limited — retry in 24 hours`（`gh pr checks 281`）",
  },
  {
    pr: 281,
    pool: "production",
    outcome: "pass",
    at: "2026-10-25",
    // ⚠️ **这条与上一条是同一次观察的两个池子，方向相反**：preview 被限流，生产照样上去了
    // （`pnpm ops:deploy-freshness` ⇒ 生产 commit = `f36523c8` = #281 的合并提交）。
    // 与 #256/#257 那次是**镜像形状**（那时 preview pass、生产零记录）。
    // 按 #258 那条立下的分寸：**跨环境不同步只能说明两个构建结果不同，
    // 不能替我排除任何一个候选**——这里既不能读成「配额只挡 preview」，
    // 也不能读成「生产链路免疫」，只能说这两次结果不同。
    note: "preview 被限流的同时生产已含本 PR 的合并提交（`ops:deploy-freshness` 实测，2026-10-25）",
  },
  {
    pr: 282,
    pool: "preview",
    outcome: "fail",
    at: "2026-10-25",
    note: "两项全 fail，错误文本同 `Deployment rate limited — retry in 24 hours`（`gh pr checks 282`）",
  },
  {
    pr: 282,
    pool: "production",
    outcome: "pass",
    at: "2026-10-25",
    // ⚠️ **同一次 24h 限流窗口里，这个镜像形状连续出现了两次**（#281、#282）：
    // preview 被限流，生产合并后约 90 秒就跟上了（`ops:deploy-freshness` ⇒ 生产 = `5f41bdd1`）。
    // 两次同形**仍然不构成因果结论**——它只说明「preview 失败与生产上线在这两次观察里
    // 可以同时发生」，不说明为什么。上一条立下的分寸在这里继续生效：
    // 不能读成「配额只挡 preview」（那是一次概括），也不能读成「生产链路免疫」。
    note: "合并约 90 秒后生产已含 `5f41bdd1`（`ops:deploy-freshness` 实测）⇒ 镜像形状第二次出现",
  },
  {
    pr: 283,
    pool: "preview",
    outcome: "fail",
    at: "2026-10-25",
    note: "两项全 fail，错误文本同 `Deployment rate limited — retry in 24 hours`（`gh pr checks 283`）",
  },
  {
    pr: 283,
    pool: "production",
    outcome: "pass",
    at: "2026-10-25",
    // ⚠️ **计数不写进台账注释，也不写进文档散文**：这条注释原先写「连续两次」，
    // 而 #283 一合并它就过期了——**我在写下「散文不许写会漂移的数」那条教训的
    // 同一个 PR 里，于另一处埋了同样会漂移的数**。判「第几次」请数
    // `preview === fail && 同 PR 的 production === pass` 的 PR 个数（可复跑），
    // 别信任何写死的计数。
    note: "合并约 60 秒后生产已含 `ebb13b1d`（`ops:deploy-freshness` 实测）⇒ 同一 24h 窗口内再次同形",
  },
  // ==== 2026-10-25 晚批：#284–#289（为避免「记读数⇒开 PR⇒又撞窗口⇒再记」的自引用循环，
  // 单条追加暂停过几轮；批量收口。生产读数只记实测到「生产跑的就是 main」的那三条，
  // #288/#289 合并后生产落后 2 未跟进（阈值内、docs-site 限流窗口期），不记为 pass。）
  {
    pr: 284,
    pool: "preview",
    outcome: "fail",
    at: "2026-10-25",
    note: "两项全 fail（`gh pr checks 284`，限流窗口第 2 天复开的首个 PR）",
  },
  {
    pr: 285,
    pool: "preview",
    outcome: "pass",
    at: "2026-10-25",
    note: "两项 pass（`gh pr checks 285`）——窗口在 #284 与 #285 之间结束",
  },
  {
    pr: 285,
    pool: "production",
    outcome: "pass",
    at: "2026-10-25",
    note: "合并后 `ops:deploy-freshness` ⇒ 生产跑的就是 main（b57caf1f）",
  },
  {
    pr: 286,
    pool: "preview",
    outcome: "pass",
    at: "2026-10-25",
    note: "两项 pass（`gh pr checks 286`）",
  },
  {
    pr: 286,
    pool: "production",
    outcome: "pass",
    at: "2026-10-25",
    note: "合并后 `ops:deploy-freshness` ⇒ 生产跑的就是 main（388c9399）",
  },
  {
    pr: 287,
    pool: "preview",
    outcome: "pass",
    at: "2026-10-25",
    note: "两项 pass（`gh pr checks 287`）",
  },
  {
    pr: 287,
    pool: "production",
    outcome: "pass",
    at: "2026-10-25",
    note: "合并后 `ops:deploy-freshness` ⇒ 生产跑的就是 main（b1674b63）",
  },
  {
    pr: 288,
    pool: "preview",
    outcome: "pass",
    at: "2026-10-25",
    // ⚠️ PR 侧 pass，但同一笔合并的 **main 提交上两个项目都 `rate limited`**
    // （`gh api repos/.../commits/f050a701/status` 实测）⇒ 预览构建与生产构建
    // 在 Vercel 侧是分开的两次构建，配额可以只打中后者。
    // 按 #258 的分寸：这**不能**单独定因，跨环境不同步只说明两个构建结果不同。
    note: "两项 pass（`gh pr checks 288`）；main 提交上却是两项限流，见其生产读数",
  },
  {
    pr: 288,
    pool: "production",
    outcome: "fail",
    at: "2026-10-25",
    note: "合并于 03:01Z，至 13:50Z（649 分钟）NEVER_DEPLOYED（`ops:deploy-ledger` 现读）。**14:22Z 澄清**：随 #291 的生产构建一并上线（`coveredByPr`）⇒ 是窗口期形态，非永久未上线。",
  },
  {
    pr: 289,
    pool: "preview",
    outcome: "mixed",
    at: "2026-10-25",
    note: "主应用 pass、docs-site fail `rate limited`（`gh pr checks 289`）——同一次观察里两项目分裂",
  },
  {
    pr: 289,
    pool: "production",
    outcome: "fail",
    at: "2026-10-25",
    note: "合并于 03:30Z，至 13:50Z（619 分钟）NEVER_DEPLOYED（`ops:deploy-ledger`）；**14:22Z 随 #291 构建覆盖上线**，同条澄清适用于下三条",
  },
  {
    pr: 290,
    pool: "preview",
    outcome: "mixed",
    at: "2026-10-25",
    note: "主应用 pass、docs-site fail `rate limited`（`gh pr view 290` 状态上下文）",
  },
  {
    pr: 290,
    pool: "production",
    outcome: "fail",
    at: "2026-10-25",
    note: "合并于 03:46Z，至 13:50Z（603 分钟）NEVER_DEPLOYED；main 提交上两项 `rate limited`。**14:22Z 起三笔均被 #291 的构建带上线**（`deployments` API：Production 两项 14:22:33Z/14:22:54Z = `f89be94a`）",
  },
  {
    pr: 291,
    pool: "preview",
    outcome: "pass",
    at: "2026-10-25",
    atIso: "2026-10-25T14:21:52Z",
    note: "两项 pass（`gh pr view 291` 的状态上下文）⇒ 配额窗口在 14:21Z 前已结束",
  },
  {
    pr: 291,
    pool: "production",
    outcome: "pass",
    at: "2026-10-25",
    atIso: "2026-10-25T14:22:33Z",
    // ⚠️ 这条就是**恢复事件本身**：合并 14:21:52Z、生产部署 14:22:33Z（41 秒后），
    // 且这次构建把 #288/#289/#290 一并带上（`ops:deploy-ledger` 现读 CONSISTENT，
    // 从未上线 3 ⇒ 0、跳过数 112 ⇒ 115）。判红与解除相隔 39 秒的那次 run 挂在 #290 上。
    note: "合并 14:21:52Z、14:22:33Z 上生产（`deployments` API）并覆盖 #288–#290 ⇒ 本次恢复的载体",
  },
  {
    pr: 292,
    pool: "preview",
    outcome: "pass",
    at: "2026-10-25",
    atIso: "2026-10-25T15:04:35Z",
    note: "两项 pass（`gh pr view 292` 的状态上下文）",
  },
  {
    pr: 292,
    pool: "production",
    outcome: "pass",
    at: "2026-10-25",
    atIso: "2026-10-25T15:05:19Z",
    // 恢复后的第二笔：合并 15:04:35Z，15:10Z 现读「生产跑的就是 main（f8578379）」
    // ⇒ ≤6 分钟，回到 10-13 标定的正常形态（中位 1.5 分钟）；说明恢复是稳定的，不是一次性。
    note: "合并 15:04:35Z，15:10Z 现读生产即 main（`ops:deploy-freshness`）⇒ 恢复稳定",
  },
  {
    pr: 293,
    pool: "preview",
    outcome: "pass",
    at: "2026-10-25",
    atIso: "2026-10-25T15:34:04Z",
    note: "两项 pass（`gh pr view 293` 状态上下文）",
  },
  {
    pr: 293,
    pool: "production",
    outcome: "pass",
    at: "2026-10-25",
    atIso: "2026-10-25T15:34:31Z",
    // 【2026-10-26 订正】下面这条注记原写「被 #294 的构建带上线」，那是**推理**：
    // 我当时的直接读数只有 freshness 显示生产=cf300192。取 `deployments` API 后，
    // 直接证据把它否证了——`2e08962d` 自己就有两条 Production 部署记录
    // （15:34:31Z / 15:35:50Z），#293 有**独立的生产构建**，比推断更早、更强。
    // 留这段是为了记住教训：**「没直接读到」不等于「没有」，取法要能取到就直接取**。
    note: "15:34:31Z / 15:35:50Z 两条 Production 部署记录（`deployments` API 直读 sha 2e08962d）⇒ 独立构建，~76 秒跟上",
  },
  {
    pr: 294,
    pool: "preview",
    outcome: "pass",
    at: "2026-10-25",
    atIso: "2026-10-25T16:02:29Z",
    note: "两项 pass（`gh pr view 294` 状态上下文）",
  },
  {
    pr: 294,
    pool: "production",
    outcome: "pass",
    at: "2026-10-25",
    atIso: "2026-10-25T16:02:55Z",
    note: "16:09Z 现读生产即 main（cf300192，`ops:deploy-freshness`）",
  },
  {
    pr: 295,
    pool: "preview",
    outcome: "pass",
    at: "2026-10-25",
    atIso: "2026-10-25T16:32:22Z",
    note: "两项 pass（`gh pr view 295` 状态上下文）",
  },
  {
    pr: 295,
    pool: "production",
    outcome: "pass",
    at: "2026-10-25",
    atIso: "2026-10-25T16:32:47Z",
    // ⚠️ 连击的**时间跨度**才是判「解除」的关键：跑 `liftStreakSpanHours()` 现读
    // （10-26 实测：6 个 PR 只跨 2.880 小时，远低于 24h 窗口 ⇒ 条数够而跨度不够）。
    // **这里不写死小时数**——它每追加一条读数就可能变，而注释不在任何对账门禁里。
    note: "16:34Z 现读生产即 main（d6a62dc8，`ops:deploy-freshness`）",
  },
  {
    pr: 296,
    pool: "preview",
    outcome: "pass",
    at: "2026-10-26",
    atIso: "2026-10-25T17:14:15Z",
    note: "两项 pass（`gh pr view 296` 状态上下文）",
  },
  {
    pr: 296,
    pool: "production",
    outcome: "pass",
    at: "2026-10-26",
    atIso: "2026-10-25T17:14:41Z",
    note: "17:14:41Z / 17:15:14Z 两条 Production 部署记录（`deployments` API 直读 06116cdd）⇒ 合并后 26 秒上生产",
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
 * 尾部连续的**读数条数**（不是 PR 个数）——别拿它回答「解除」门槛。
 *
 * 从**尾部**往回数，遇到任何非 pass 就停。
 * `mixed` 不算 pass：一 fail 一 pass 的那次观察恰恰是配额在挡路的形态。
 * ⚠️ **这个数天然会虚高一倍**：一个 PR 通常贡献两条读数（preview + 生产），
 * 所以「尾部 4 条」可能只是 2 个 PR。文档里那条门槛写的是「连续多个 **PR**
 * 全过且生产跟上」——**判那个门槛请用 `consecutivePassPrsFromTail()`**，
 * 这个函数只回答「现在几连」。
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
/**
 * 尾部「达标 PR」的列表（判「解除」口径的唯一分组逻辑，三个函数共用）。
 *
 * 达标 = 该 PR 的**每条读数都是 pass**，且**至少有一条 production 读数**
 * （只过预览、生产没上去不算——那正是 #256 与 #288–#290 的形态）。
 * `mixed` 不算 pass。从台账末尾往回走，第一个不达标就停。
 *
 * 抽出来是因为 `consecutivePassPrsFromTail` 与 `liftStreakSpanHours` 都要它，
 * 而抄两份会长歪（本会话为「同一段判定抄两份」修过一次：#285 的 env 取数口）。
 */
function tailQualifyingGroups(readings: readonly QuotaReading[]): QuotaReading[][] {
  const order: number[] = [];
  const byPr = new Map<number, QuotaReading[]>();
  for (const reading of readings) {
    let group = byPr.get(reading.pr);
    if (!group) {
      group = [];
      byPr.set(reading.pr, group);
      order.push(reading.pr);
    }
    group.push(reading);
  }

  const streak: QuotaReading[][] = [];
  for (let index = order.length - 1; index >= 0; index -= 1) {
    const group = byPr.get(order[index]) ?? [];
    const allPass = group.length > 0 && group.every((r) => r.outcome === "pass");
    const hasProduction = group.some((r) => r.pool === "production");
    if (!allPass || !hasProduction) break;
    streak.push(group);
  }
  return streak;
}

/**
 * 「连续多少个 **PR** 全过**且生产跟上**」——文档里判「解除」的那条门槛的唯一正确读数。
 *
 * 与 `consecutivePassFromTail` 的区别就是这条门槛的两半：
 *   · **按 PR 归组**（一个 PR 的 preview + 生产算一次观察，不是两次）；
 *   · **要求该 PR 有生产读数**——只有 preview pass、生产没跟上的 PR，
 *     恰恰是 #256/#288–#290 那类「预览过了线上没上去」的形态，不能计入。
 * 一个 PR 的两条读数里任何一条不是 pass（含 `mixed`），就在此处断开。
 *
 * ⚠️ **这个数达标 ≠ 可以宣布「解除」**：门槛是「连续多个 PR」，但配额是
 * **24 小时窗口**级的东西——一段跨度不足一个窗口的连击，说明不了窗口不会重开。
 * 判「解除」还需要连击**跨过一个完整的 24h 观察窗**（本仓库在 #255/#256
 * 上就是这么被反例按回去的）。
 */
export function consecutivePassPrsFromTail(
  readings: readonly QuotaReading[] = QUOTA_READINGS,
): number {
  return tailQualifyingGroups(readings).length;
}


/**
 * 「连击跨过了多少小时」——判「解除」的**第二半**，没有它那条门槛无法评估。
 *
 * 取尾部 PR 级连击里**最端到最端**的 `atIso` 差（小时）。
 * 返回 `null` 表示**未知**：连击里有任何一条缺精确时刻就报未知，
 * 不假装是 0（把「没数据」读成「跨度 0 小时 ⇒ 不达标」是另一种假绿/假红）。
 *
 * ⚠️ 这个数只回答「跨度」，不回答「窗口是否已结束」。配额是 Vercel 侧的
 * 24 小时窗口，**跨度 ≥ 24 且期间无 fail** 才够宣布解除；两者都满足前记 `flapping`。
 */
export function liftStreakSpanHours(
  readings: readonly QuotaReading[] = QUOTA_READINGS,
): number | null {
  const groups = tailQualifyingGroups(readings);
  if (groups.length === 0) return null;

  const stamps: number[] = [];
  for (const group of groups) {
    for (const reading of group) {
      // 缺一条精确时刻就整体报未知：不部分计算，也不假装是 0。
      if (!reading.atIso) return null;
      const parsed = Date.parse(reading.atIso);
      if (Number.isNaN(parsed)) return null;
      stamps.push(parsed);
    }
  }
  return (Math.max(...stamps) - Math.min(...stamps)) / 3_600_000;
}


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
