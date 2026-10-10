# 环境与 Staging 规范

## 环境拓扑

| 环境     | 分支         | Vercel                        | Supabase                       |
| -------- | ------------ | ----------------------------- | ------------------------------ |
| 本地开发 | feature/*    | `pnpm dev`（Mock 模式可离线） | 本地 supabase start / Mock     |
| Preview  | PR / develop | Vercel 自动 preview 部署      | **共享 staging Supabase 项目** |
| 生产     | main         | Vercel production 域名        | 生产 Supabase 项目             |

## Staging 数据库规范

1. **独立项目**：staging 与生产必须是两个 Supabase 项目，严禁共用
2. **迁移先行**：schema 变更先在 staging 验证（`supabase db push`），确认后再对生产执行
3. **数据脱敏**：如从生产导入数据到 staging，必须脱敏（用户邮箱/手机号替换）
4. **种子数据**：使用 `supabase/seed.sql` 维护 staging 演示数据。该 seed 自包含且可重复执行：
   会先写入三个 Auth 用户（`seed-owner-a@example.com`、`seed-owner-b@example.com`、
   `seed-member-a@example.com`，统一密码 `indiestack-local`），再写入两个隔离团队及项目、订阅、
   邀请、API key、通知等数据
5. **种子密码边界**：`indiestack-local` 是公开固定值，只允许用于 local/staging；
   绝对不要在可被公网访问的环境执行该 seed，生产账号必须走真实注册流程
6. **身份矩阵验证**：改 schema / RLS / Storage policy 后，在本地或 staging 执行
   `pnpm smoke:supabase-identity`（anon/authenticated/service_role 三种身份、20 项检查），
   证据与局限见 [../db/security-audit.md](../db/security-audit.md)

## Preview 安全

- Vercel Deployment Protection 建议开启（防止 preview 被搜索引擎收录）
- Preview 环境的 `NEXT_PUBLIC_MOCK_ENABLED` 保持未设置（走真实 Supabase）。这条约定过去只靠人守：
  Vercel 的 preview 与 production 跑的是同一种构型（`NODE_ENV === "production"`），而显式开关当时
  **没有**生产闸门，一个忘在 Preview 环境组里的 `true` 就会让对外可见的预览站发假登录用户。
  现在 `evaluateMockMode()` 对生产构型一律返回 `false`，误设的结果是「按真实凭据走、缺凭据就如实失败」，
  不再是静默的 mock。
- 仓库里**看得见**的生产配置（`.env.production`、`vercel.json`）另有 `pnpm check:security`
  的 `inspectProductionMockSettings` 规则：任一处把 `NEXT_PUBLIC_MOCK_ENABLED` 设成 `true` 即红。
  这不是重复运行时那道闸，而是为了让「生产不开 mock」这句话有第二份可核对的出处——
  `RATE_LIMIT_LEDGER` 里 18 条 mock 豁免与 `ROUTE_AUTH_LEDGER` 里整族 `mock-only` 的理由都写着
  「它们只在 mock 构型下存在」，那句话说错了没有人会知道。E2E 与本地开发面**不**在这条规则内：
  `e2e-parallel.yml` 开着 mock 跑 `pnpm build` 是对的，按「出现 MOCK 字样」判会直接把它判红。
- Stripe 使用 test key；生产 webhook secret 不进 preview

## 外部依赖实况（每行附观测日期与可重跑的查询命令）

**这张表为什么存在**：2026-10-05 一天之内，我连续三次把「依赖外部状态」的结论写错
（Supabase 配没配、Sentry 有没有告警链路、B04 缺什么凭据），三次都是**没去查就写**。
而每次去查都很便宜。根因不是记性，是**这些事实散落在各文档里、没有统一出处**。

所以规则是：**任何关于外部状态的结论，都必须落在这张表里，并带上观测命令与日期。**
散落在别处的同类说法一律以本表为准。

| 依赖 | 实况（各行自带观测日期） | 观测命令 | 影响 |
| ---- | ------------------ | -------- | ---- |
| Supabase（平台 API） | ✅ 可用 | `gh run list --workflow supabase-auto-restore.yml`（每天 success） | Management API 令牌有效 |
| Supabase（Auth 配置读） | ✅ 可用 | `gh run list --workflow security-config.yml`（最近一轮输出「Auth 配置已验证（scope=redirects）」） | 同上，另一条独立证据 |
| Supabase（数据库级：**执行 SQL**，2026-10-13 实测） | ✅ **不需要数据库密码**——`SUPABASE_ACCESS_TOKEN` 就能执行 | `pnpm ops:cloud-sql-probe`（`.github/workflows/cloud-sql-probe.yml`，手动触发；run `38334026946` 七条全 EXECUTED） | **这一行把原先那行否证了**。旧写法是「❌ 无 DB 密码类 secret ⇒ B04 的真正阻塞」，而「`gh secret list` 只有一个令牌」这件事**从来推不出「不能执行 SQL」**：`POST /v1/projects/{ref}/database/query` 的鉴权口径是 `database_read` 或 `database_write`，CI 里那个令牌就有。实测三件事：多语句**全部执行**（判据是让第一条语句自己报错——`select 1/0; select 2` 回 `22012: division by zero`；光看响应体不行，因为它只回**最后一条**的结果）；单条 DO 块通；`read_only: true` 确实让服务端进入只读事务（带字段回 `on`、不带回 `off`）。⇒ **B04 现在缺的不是凭据**，是 (a) 把 `account-erasure.sql` 里那 6 条 psql 元命令压成 HTTP 送得出去的单条语句（本行第一版写「5 条」，真值由 `src/lib/drills/psql-meta.ts` 量出），(b) 一次「可以往生产库写」的人工授权。**同日更新：(a) 做完两份中的一份**——擦除那份的派生版 `docs/operations/drills/account-erasure.single-do.sql` 已入库，本地栈实测 `failures=0 assertions=20` 且回滚干净；**保留期那份的派生版仍在 PR #236 里没进 main**，所以 (a) 未完，(b) 也仍缺 |
| Supabase（数据库级：**直连 Postgres**） | ❌ 仍无 DB 密码 | `gh secret list`（只有 `SUPABASE_ACCESS_TOKEN`） | 与上一行是**两个不同的能力**，别合并：走 TCP 直连（`psql`、`supabase db push`）确实还要密码。这次否证的是「B04 需要它」，**不是**「它没用」 |
| 生产 Supabase（应用侧） | ✅ 配置且可达 | `pnpm health:check -- https://indie-stack-theta.vercel.app` | 连接与凭据是好的。**但「应用侧可达」不等于「worker 跑得通」**：`/api/cron/digest` 对 GET 实测 405（2026-10-12，PR #236 在修），而它一旦能跑就会撞上下一条那个缺列 |
| 生产部署新鲜度（2026-10-13 复测） | ✅ **lagging 3，在阈值 5 内判通过** | `pnpm ops:deploy-freshness`（生产 `b2ffab71` ← main `e9fc59b7`） | **这行原先写的是 2026-10-08 的「fresh = 同 commit」，已被本次读数取代**。落后 3 个 commit 本身不是故障——阈值就是为此而设。但它与上一行是**同一件事的两个面**：生产停在 `b2ffab71` 恰好是**限流开始之前**最后一次成功构建，所以「落后」此刻**不能**用来判断生产构建是否也被挡住了（见上一行的「未知」） |
| 生产冒烟（2026-10-08 观测） | ✅ 7/7 | `node scripts/production-smoke.js --url … --expected-commit d2457d74bd60b23d559a4d1a9c53d764faa5d554` | health / liveness / 主页 / 静态资源 / 安全头 / 匿名看板 307 / webhook 签名拒收 全过，commit 匹配 |
| 生产异步看板鉴权（2026-10-08 观测） | ✅ 匿名 401（admin 面板数据路径） | curl `BASE/api/ops/provider-status`（此时尚无凭据 → Unauthorized） | 与 2026-10-06 记的一致：鉴权边界在线上仍然有效；**content 读数仍需 CRON_SECRET/admin 会话（本机没有，照旧未知）** |
| Sentry | ❌ 生产未配 DSN | 同上（输出 `sentry: configured=false status=missing`） | **告警链路空转**，详见 `sentry-alerts.md` 开头 |
| Stripe | ❌ 生产未配 key | 同上（输出 `stripe: configured=false status=missing`） | 支付路径线上无流量，checkout 未上线 |
| Resend | ❓ **未知**（2026-10-05 起**可查了**） | `curl -H "authorization: Bearer $CRON_SECRET" $BASE/api/ops/provider-status` | **本条曾长期是「未知」**：provider 诊断逻辑（`diagnoseProviders`）写得完整、有单测，却**没有任何生产代码调用它**，`/api/health` 又只回 supabase/sentry/stripe 三项，于是「邮件链路在生产上是不是空转的」只能靠猜。现已新增只读诊断端点（见下）。**端点已在生产上线并实测过鉴权边界**（2026-10-06T00:57Z，commit `105da717`：匿名 401、错密钥 401），但**读数本身仍未知**——取它需要 `CRON_SECRET`，本机没有。**鉴权被验证不等于内容被读到**，所以这一行照旧是「未知」 |
| GitHub 保活变量 | ✅ 已配置 | `gh variable list`（`HEALTHCHECK_URL`） | 每日保活 workflow 在跑 |
| Vercel 构建配额 | ⚠️ **今天有 12 个读数，结论是「会波动」（形状 pass / fail 来回）**（2026-10-13，逐个 `gh pr checks` 实测；链由 `src/lib/ops/quota-readings.ts` 的台账生成，**不是人抄的**）：#251 preview pass → #252 preview mixed → #253 preview fail → #254 preview fail → #255 preview pass → #255 生产 pass → #256 preview fail → #256 生产 fail → #257 preview pass → #257 生产 fail → #258 preview pass → #258 生产 pass | `gh pr checks <n> \| grep Vercel` | **额度是被这些 PR 的构建吃光的**，形态与 2026-10-05 那次同源（两个 Vercel 项目同仓共享额度）。**preview 侧的影响面**：#252 / #253 / #254 / #256 的 7 条 required checks 全绿、照常合并——红的是非 required 的 preview 部署，所以**它没有挡住任何一次合并**。⚠️ **本行原先还写着「生产是否也被挡住 = 未知，需要 Vercel 侧部署记录，本机取不到」——那句话是错的**，订正见下一行。**「取不到」从来不是事实，是没去找过**：本仓库已经三次把「我不知道怎么查」写成「这件事查不了」（另两次是 `supabase migration list` 与 CodeQL 告警列表）。⚠️ **这不等于「配额已解除」**：判「解除」需要连续多个 PR 都 pass 且生产跟上，而**今天尾部连击 2、最长连击只有 2**——两个数都得报，**它们今天恰好相等**。⚠️ **它们今天恰好相等，而这正是那条「两数不相等」的用例存在的理由被触发的时刻**：相等时用一个数冒充另一个会**静默通过**，所以文档必须写明「这是两个口径碰巧同值」，而不是省成一个。尾部 2 的含义是「#258 的 preview + 生产都跟上」，最长 2 的含义是「历史上最好也就这样」——判「解除」要的是**连续多个 PR**，2 还够不上。**这条判据是被反例式验证出来的**：第 5 个读数（#255 两项 pass + 生产跟上）当时足以让人写「解除了」，而紧接着的第 6 个读数（#256 两项全 fail）把它按了回去 ⇒ **一次成功不是趋势**。第 7 个读数（#257 preview 两项 pass）同样没有改变结论——**它只是链条又拉长一格**，所以这里刻意不再手抄 outcome 序列（**抄一份就是再造一个没人对账的数**，链以本行开头那条为准）。**别把它写成「B 域已阻塞」**：roadmap 只把 build 配额列为前置之一 |
| 生产部署台账（2026-10-13 起自动） | ⚙️ **状态不写在这里**——跑 `pnpm ops:deploy-ledger` 现读 | `pnpm ops:deploy-ledger`（`GET /repos/{owner}/{repo}/deployments`，**匿名可读**，实测不带 token 回 200） | 这条补的是「生产到底部署了没有」这个**曾被写成查不了**的问题。Vercel 把每次部署上报成 GitHub Deployment，所以它一直可查。⚠️ **本行的状态列刻意不抄读数**：台账判的是当下状态，抄一份进文档就是本轮立的规矩禁止的形态（凡一次性读出、又没有对账用例盯住的数，不进静态文本）。这不是抽象理由——2026-10-13 那一格抄的是「#256、#257 从未上线」，同一天 #258 自己上了生产，那格当场失效。**一判就判出真故障**：生产最新一条生产部署记录是 `a5b38466`（#255）07:00:11Z，#256 与 #257 合并后都没有记录，而 `75b011ba` 是 main 的 HEAD ⇒ **没有任何后续部署能覆盖它**。⚠️ **本行初版把原因写成「配额挡住生产」，随后又被我改成「不是配额、是链路」——两个结论都不成立，见下**：#257 的 preview 构建 **pass**，同一次合并的 **docs-site 生产 35 秒内就建好**（09:01:33Z），只有主应用生产零记录；#256 也是同样形态（docs-site 28 秒建好、主应用零记录）。**但这条推断本身也被否证了**：#258 合并后 **2 分 11 秒**就上了生产，而**全程无人做任何修复**（15:17:49Z 合并 → 15:19:10Z 部署记录）。配置坏了、项目被暂停都**不会自己好**，配额恢复会。⇒ 「docs-site 上线了所以不是配额」这句推理**不成立**：两个项目各有独立的 production 构建，同一时刻的余量本来可以不同，**跨环境不同步不能替我排除任何一个候选**。本行在这一条上连着过早定因两次——先写「原因是配额」、再写「不是配额」，**两次都是拿一个未验证的前提做排除法**。⚠️ 顺带记下本行那句「两个 Vercel 项目同仓共享额度」：它是 2026-10-05 的旧断言，**本轮没有验证过它今天是否成立**，而它正是上面那次错误排除所依赖的前提。本机没有 Vercel 凭据，**再往下只能列候选、不能定因**（配额 / production branch 配置 / 项目暂停 / 构建提升失败）。⚠️ **已有的 `ops:deploy-freshness` 看不到这件事**：它判「落后几个提交」，当时落后 2 个、阈值 5 个，于是判通过——**距离小不等于部署正常**，所以两条都要留着，它们回答两个问题。⚠️ **判据不是「有没有部署记录」**：实测 226 个已合并 PR 里 **111 个无生产记录**，绝大多数是被 Vercel 的**合并部署**跳过的（连续合并并成一次上线，如 #251–#254 全被 #255 那次带走）。只按「无记录 = 故障」判会天天误报。真判据是「**无记录，且没有任何后续部署包含它**」（依赖 main 的线性 squash 历史，实测最近 200 个提交全为单父）。**阈值 90 分钟有出处**：73 个可配对样本的 lag 中位 1.5 分钟、最大 57.2 分钟，90 是最大值的 1.6 倍。⚠️ **环境名写错时 API 回 200 + 空数组**，会把 226 个提交全读成「从未上线」——一个自信而完全错误的结论，所以空记录判「未知」（退出码 2）而不是判红。退出码 0 一致 / 1 有提交从未上线 / 2 读不到（**未知不算通过**）。作业：`.github/workflows/deploy-ledger.yml`（每天 + 每次 main push；**不在 PR 上跑**，它读的是生产状态、与 PR 改了什么无关）|
| 生产 schema vs 代码期望（2026-10-12 观测） | ❌ **线上缺 1 列**：`notifications.email_skipped_reason`（迁移 034 未 applied） | `pnpm ops:schema-drift`（只需 `SUPABASE_URL` + service_role key，**不需要 DB 密码**） | `listUnsentEmailNotifications()` 对缺列是 `throw`，所以 **digest worker 每轮必抛**；今天没人看见只因为 GET 405 先挡住了——**两个缺陷正好互相掩盖**。另有 5 张表（`progress`/`quiz_scores`/`replay_best`/`replay_history`/`wrongbook`）在本仓库的生成类型里不存在：代码从不引用 ⇒ 不算漂移，是「这个 Supabase 项目还放了别的东西」 |
| 云端已应用的迁移版本（2026-10-13 首跑实测） | ⚙️ **一条只读 API 调用**，不需要数据库密码、也不需要 CLI 登录态；**生产实况 = `034` 未 applied** | `pnpm ops:migration-status`（`GET /v1/projects/{ref}/database/migrations`，用 `SUPABASE_ACCESS_TOKEN`；`.github/workflows/migration-status.yml` 每天与每次 main push 各跑一次） | 这条补的是**「云端到了哪一版」这个问题的自动答案**：它曾被登记成「本机查不了（要 DB 密码）」——**21 天**（最早可查 2026-09-22 `7ea846c1` 记为「仍未取得的生产证据」；「要 DB 密码」这一具体说法是 2026-10-05 `1a18be40`，8 天）。⚠️ **本行原先写的是「过去两年」，那是编的数字**：仓库第一个 commit 是 2026-08-09（GitHub `createdAt` 同日），到 2026-10-13 只有 65 天——「两年」在口径上不可能成立。代价是「034/035 从未 applied」直到线上出事才知道。`supabase migration list` 其实不要密码，但它在没有 TTY 的机器上会挂在交互登录（2026-10-12 实测），而 supabase CLI **不是本仓库依赖** ⇒ CI 里本来也跑不了它。退出码 0 一致 / 1 有差集 / 2 读不到实况（**未知不算通过**）。**它不解锁 B04，也不替代 `db push`**：只读「应用了哪些版本」，不执行任何 SQL。两边版本号完全不相交时判 2 而不是把 68 条差集当成结论（2026-10-13 用本地 mock 实测到这种形态）。**首跑读数**（run 38294116244，main push）：`❌ [MIGRATION_NOT_APPLIED] 034`、exit 1 ⇒ 端点存在、CI 里的 token 有效、版本号是 3 位序号形态；它**只报 034 不报 035**，因为 035 此刻还在 PR #235 里没进 main——这正是「判据是要部署的那一版代码依赖哪些列」的形态。与 `ops:schema-drift` 独立测得的「生产缺 `email_skipped_reason`」互相印证 |
| pg_cron（保留期调度） | ❌ **本地栈与生产都实测未安装**（本地 2026-10-06；生产 2026-10-14，run `38442279610` 回 `pg_cron=NOT_INSTALLED`） | 本地栈：`node scripts/check-retention-cron.js --probe --container supabase_db_indiestack`；生产：`pnpm ops:cloud-sql-probe`（手动触发的 workflow，读 `PG_CRON_INSTALLED` 那一步） | **保留期一周一行都不会删**：6 个清理函数都在（`cleanup_old_*` / `prune_deleted_upload_objects`），但 `pg_extension` 里 `pg_cron` 行数 = 0，`cron.job` 这张关系根本不存在 → 0 个调度被注册。迁移成功、门禁全绿、`/api/health` 正常，**而数据一行不动**。**生产是否安装：从此可自动答**——`pnpm ops:cloud-sql-probe` 的 `PG_CRON_INSTALLED` 那一步（走 HTTP，用仓库里已有的 `SUPABASE_ACCESS_TOKEN`，**不需要数据库密码**）。⚠️ **本行原先写的「生产是否安装仍未核实（需 DB 密码）」，错在两层。****第一层：答案早就在仓库里。**`docs/db/retention.md` 第 79 行（2026-09-21 复核，commit `9ab8c154`）就写着**同一个 ref** `ntqggnztzvoavjbiillb` 的 `pg_extension` 清单里没有 `pg_cron`，而本文件下面「Auth 邮件与重定向白名单」一节把这个 ref 明确称为「**生产 Supabase 项目**」。⇒ 那句「仍未核实」是在答案已入库 **14 天之后**写下的，写之前没有搜过仓库。**根因是那份记录只写了结论、没写可复跑的命令**，所以 14 天后没人能判断它是否仍然可查，只能重新写成「未知」——**「文档已写」不等于「证据可复核」**，这条本仓库早就写进 `docs/operations/release-audit-template.md`，这次轮到它自己踩。**第二层：那个「查不了」的理由本身也是错的**：「执行 SQL 需要 DB 密码」已于 2026-10-13 被同一个端点否证（run `38334026946`，七条全 EXECUTED）——那是 B04 的阻塞理由被写错的第三版（三个版本见 `docs/roadmap-0.12.0.md` 的 B04 条目），而**这一行是另一个还挂着那个旧前提的结论**：前提修好了，依赖它的句子留在原地。（刻意不写「第 N 处」——这类残留没有统一台账，数不出来就不该报数。）⚠️ 也别把「没装 pg_cron」读成「保留期失效」：主执行者是 `/api/cron/retention`（每天 05:00 UTC，见 `docs/db/retention.md`），pg_cron 只是迁移里那组周调度的第二个可选调度器。本行那句「一周一行都不会删」说的是**那一半**，判保留期整体要看 `cron.retention.completed` |
| CodeQL 告警台账 vs 实况（2026-10-13 首跑实测） | ❌ **2 条红，exit 1**：#18 阻断级仍 open + 分诊超 SLA（12 个工作日 > 5） | `GITHUB_TOKEN=$(gh auth token) GITHUB_REPOSITORY=Sun1090/IndieStack pnpm ops:codeql-alerts`（离线复现：`--fixture fixtures/codeql-alerts.json`） | 这条补的是「零回归」这个结论**从来没有被任何自动检查核对过**的缺口：过去 runbook 把它登记成「本地无法复现（要 GitHub 安全 API 权限）」，实测本机 `gh` 就能读全部字段 ⇒ **缺的一直不是权限，是没人写探测**。代价已经出现过一次：2026-09-24 那 4 条 `js/log-injection` 挂了 5 天没人发现。⚠️ 严重度字段是 **`rule.security_severity_level`，在 `rule` 下面**；顶层没有这个键，从顶层取会稳定得到 `null`，而 `null` 看着完全像「GitHub 没评分」。**我第一版把成因写成「只在带 `x-github-api-version: 2022-11-28` 时才有值」，那也是错的**——错在对照实验用 `gh api` 跑「不带 header」那组，而 `gh` 自己会补默认 api-version ⇒ 两组都带了 header；改用 `curl` 后带不带都有值。完整矩阵与「不要用查询参数筛严重度」见 `codeql-alert-triage.md` 的「外部依赖」一节。判定层拒绝把 `null` 当低危，报 `CODEQL_ALERT_SEVERITY_UNKNOWN`。当前 open 实况：#18 `high`、#11/#12/#13/#17 `medium`；dismissed 0 条。**它刻意不进 `check:all`、不进 workflow**：#18 未结案 ⇒ 此刻必红，进 PR 门禁会阻塞每一个 PR |

**四条要读出来的分寸**：

1. **`configured=false` 不等于 readiness 会红**。`/api/health` 里 Sentry / Stripe 都是
   `required: false`，所以它们缺失时 `ready` 仍是 `true`——这是有意的设计（模板的可选依赖），
   但它意味着**一个可选依赖缺失时，健康检查不会替你喊人**。
2. **「平台可用」不等于「数据库可用」——这条分寸本身已经被改过三次，值得整段留着**。
   - **原写法**：Management API 能读项目状态，但**读不到库里的表**，
     所以别把「平台可用」当成「B04 快能做完了」。
   - **2026-10-12 第一次细化**：PostgREST 的 OpenAPI 根端点
     （`GET <root>/rest/v1/`，service_role key，实测匿名 401 / key 200）
     **不要 DB 密码就能读到全部表与列名**——「线上缺哪一列」从「查不了」
     变成「一条命令能回答」（`pnpm ops:schema-drift`）。
     但它只给 schema、不给执行，所以当时判断「替代不了 B04」。
   - **2026-10-13 第二次细化，这次把原写法直接否证了**：Management API 有
     `POST /v1/projects/{ref}/database/query`（以及跑在 `supabase_read_only_user` 下的
     `…/query/read-only`），**用同一个令牌就能执行 SQL**，多语句也全部执行
     （`pnpm ops:cloud-sql-probe`，run `38334026946`）。
     所以「读不到库里的表」是错的——读得到，也写得了。
   - **仍然成立的那半**：**直连 Postgres**（`psql`、`supabase db push`）确实还要 DB 密码。
     分寸从「平台 ≠ 数据库」挪到了「**经 API 执行 SQL ≠ 直连数据库**」——
     两者是不同的能力，而**这次是前者把后者衬托成了不必要的**，别反过来读。
   - **为什么这条要留这么多历史**：同一件事被写错三次，说明错的不是措辞而是方法——
     每次都是**从「手上有哪些 secret」倒推「能做什么」**。
     secret 清单不是能力的证据；**打一次才知道**。
3. **`❓ 未知` 是这一栏允许存在的状态**。写一个听起来合理的猜测，比写「未知」有害——
   本文档开头的那些错误结论，一半是被一个自信的猜测撑起来的。
   **但「未知」也不该被当成常态**：它之所以长期存在，是因为「从外部查不到」。
   现在 `GET /api/ops/provider-status`（`CRON_SECRET` 鉴权，**只回键名、永不回值**）
   把「从外部查不到」变成「一条命令能回答」，所以这张表里的每个 `❓`
   都应该能被一次调用消掉——**留着的理由只能是「还没人去查」，不能是「查不了」**。
   **2026-10-10 要给这条加一个反面教训**：有些 `❓`／`❌` 的理由其实是**「登记错了」**而不是「查不了」。
   「`migration list --linked` 需要数据库密码」被登记了两年，而它不要密码——
   于是「云端到了哪一版」这个一分钟能答的事实一直挂着「本机未复核」，
   而它正好是 v0.12.0 那句「侥幸没同步也没事」的唯一解。**登记阻塞时要写清「阻塞到哪一层」**，
   只写「做不到」会让下一个人把能做的部分一起放弃。

### 查这张表的推荐顺序

```bash
BASE=https://indie-stack-theta.vercel.app
# 1) 逐依赖实况（含邮件 / web push / Appark 等 /api/health 不回的那些），只回键名
curl -sS -H "authorization: Bearer $CRON_SECRET" "$BASE/api/ops/provider-status"
# 2) 就绪状态与 deployed commit（顺手刷新本表的 supabase / 部署两行）
node scripts/check-health.js "$BASE"
# 3) 生产落后 main 多少个提交
node scripts/check-deploy-freshness.js --base-url "$BASE"
# 4) 平台用的那条方法到底能不能进路由（不打凭据，405 就是死）
node scripts/production-smoke.js --url "$BASE" --expected-commit "$(git rev-parse HEAD)"
# 5) 云端 schema 到了哪一版。**不要数据库密码**（这条被误登记成「需要」两年，
#    代价是「034/035 从未 applied」直到线上出事才发现）
pnpm exec supabase migration list --linked
# 6) 线上 schema 与代码期望是否一致（只读 OpenAPI 根端点，不查数据行）
pnpm ops:schema-drift
# 5) 云端 applied 到第几版迁移（只读 Management API，不要 DB 密码、不要 CLI 登录态）
pnpm ops:migration-status
```

## 免费版保活与自动恢复

Supabase 免费版项目 7 天无活动会被暂停，本仓库用三层兜底：

| 层级   | 触发方式                                      | 时间（UTC）  | 作用                                               |
| ------ | --------------------------------------------- | ------------ | -------------------------------------------------- |
| 保活主 | Vercel Cron → `/api/health`                   | `0 2 * * *`  | 每次探测触发一次 `profiles limit(1)` 查询          |
| 保活备 | `.github/workflows/health-check.yml`          | `17 3 * * *` | GitHub schedule 60 天静默后会被停用，仅作备份      |
| 恢复主 | Vercel Cron → `/api/ops/supabase-restore`     | `0 4 * * *`  | 不受仓库静默影响；`INACTIVE` 时调用 Management API |
| 恢复备 | `.github/workflows/supabase-auto-restore.yml` | `37 4 * * *` | 手动触发默认 `dry_run=true`                        |

- 保活与恢复探测共用有限重试：冷启动或瞬时 5xx/网络错误最多尝试 3 次（间隔 5 秒）；
  GitHub workflow 的 `health_url` 或仓库变量 `HEALTHCHECK_URL` 可填部署根地址，也会统一解析到 `/api/health`；404/401 等确定错误和持续故障仍会失败，不会把真实故障静默吞掉。
- 恢复只在 Management API 明确返回 `status=INACTIVE` 时发生；`RESTORING`/`COMING_UP` 等中间态
  只记录不写操作，`REMOVED` 等终态显式失败交给人工。
- 恢复主层需要 Vercel 环境变量 `CRON_SECRET` + `SUPABASE_ACCESS_TOKEN`（`SUPABASE_PROJECT_REF`
  可留空，从 `NEXT_PUBLIC_SUPABASE_URL` 推断）；缺配置时生产返回 503，避免静默失效。
- Secrets 只以加密形式保存于 GitHub/Vercel，协作者通常只能看到名称；拥有管理权限的
  所有者/管理员可以轮换或删除，因此令牌轮换后需同步更新两处。

## Auth 邮件与重定向白名单

- 生产 Supabase 项目（`ntqggnztzvoavjbiillb`）的重定向白名单已包含本地、生产别名与 Vercel preview
  通配域名；`pnpm auth:email-config -- --verify --scope=redirects` 可随时复核，CI 的
  `Security and configuration checks` 也会在 push/PR/周计划上做漂移门禁。
- Auth 邮件模板固化在 `scripts/lib/auth-email-templates.js`（设计稿
  [design/email-templates.md](../design/email-templates.md)）。当前套餐使用默认发件人，
  Management API 会拒绝模板写入，因此 CI 门禁只校验白名单；配置自定义 SMTP 后应改为
  `pnpm auth:email-config -- --verify`（scope=all）。
- 默认发件人的 `rate_limit_email_sent = 2`（全项目每小时 2 封）是注册量增长后的硬瓶颈，
  上线前必须换成自定义 SMTP，否则注册确认/邀请/重置会直接失败。
- Preview 部署若要完成登录回跳，域名必须落在白名单内；新增自定义域名时同步更新
  `scripts/lib/auth-email-templates.js` 的 `PREVIEW_REDIRECT_PATTERNS`。

## 发布流程

```
feat/* → develop → staging 验证 → PR 到 main → CI 七关 → Vercel 自动部署 → 部署验证清单
```

详见 [agents/10-release-manager.md](../../agents/10-release-manager.md) 的部署验证清单。

## `NEXT_PUBLIC_*` 是构建期常量

- 值在 `next build` 时被写进产物，运行时改平台上的值**不会**改变已部署的产物；改完必须重新构建部署。
- 只有**构建时真实存在**的变量才会被内联。没设过的 `NEXT_PUBLIC_*` 在客户端产物里留下的是
  对 `process.env` 的读取，而浏览器里那个 `process` 是空垫片（实测 `typeof process === "undefined"`），
  读到 `undefined` —— 所以「客户端读一个只在平台上设过的变量」这件事必须显式验证，不能靠推。
- **计算式访问永远不会被内联**：`process.env[key]` 以及用模板串拼出来的键都不行，
  必须是 `process.env.NEXT_PUBLIC_X` 这种静态成员写法。`src/lib/feature-flags.ts` 的形状断言钉着这条。
