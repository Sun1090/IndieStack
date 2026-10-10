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

## 外部依赖实况（2026-10-05 观测，每行附可重跑的查询命令）

**这张表为什么存在**：2026-10-05 一天之内，我连续三次把「依赖外部状态」的结论写错
（Supabase 配没配、Sentry 有没有告警链路、B04 缺什么凭据），三次都是**没去查就写**。
而每次去查都很便宜。根因不是记性，是**这些事实散落在各文档里、没有统一出处**。

所以规则是：**任何关于外部状态的结论，都必须落在这张表里，并带上观测命令与日期。**
散落在别处的同类说法一律以本表为准。

| 依赖 | 实况（2026-10-05） | 观测命令 | 影响 |
| ---- | ------------------ | -------- | ---- |
| Supabase（平台 API） | ✅ 可用 | `gh run list --workflow supabase-auto-restore.yml`（每天 success） | Management API 令牌有效 |
| Supabase（Auth 配置读） | ✅ 可用 | `gh run list --workflow security-config.yml`（最近一轮输出「Auth 配置已验证（scope=redirects）」） | 同上，另一条独立证据 |
| Supabase（数据库级·**只读单条**） | ✅ **连得上生产库，且不需要 DB 密码**（2026-10-10 实测） | `pnpm exec supabase db query --linked "<单条只读 SQL>"`；CLI 用自己登录态临时建 role 连进去 | 原登记的「数据库级一律连不上」**是错的**。本表下面几行生产读数就是这么取的。注意 `current_user=postgres` 且 `rolbypassrls=true`，所以 RLS 不会过滤读数——空表读数是真空，不是被策略挡住 |
| Supabase（数据库级·**多语句脚本**） | ❌ **仍需 psql + DB 密码** | 实测 `pnpm exec supabase db query --local "select 1; select 2"` → `cannot insert multiple commands into a prepared statement` | **B04 的阻塞只收窄到这里**：`docs/operations/drills/*.sql` 是多语句 + `begin/rollback`，`db query` 跑不了。**只读复核不要密码，不可逆演练要** |
| 生产 Supabase（应用侧） | ⚠️ **配置可达，但摘要邮件链路线上是死的**（2026-10-10 更正） | `curl -o /dev/null -w '%{http_code}' -X GET $BASE/api/cron/digest` → **405**；`node scripts/production-smoke.js` 第 8 步 | 原先这行写的「digest / 保留期路径在线上是活的」**是未核实的推断，且是错的**：Vercel Cron 用 **HTTP GET** 触发，而这两条路由只导出 POST → 每轮 405，**自被调度以来一次都没执行过**（详见下两行与 `docs/progress.md` 2026-10-10 事故条目） |
| 生产 cron 触发方法（2026-10-10） | ❌ **`digest` 与 `retention` 每轮 405** | `for p in digest retention push-retry; do echo -n "$p "; curl -s -o /dev/null -w '%{http_code}\n' -X GET $BASE/api/cron/$p; done` → 405 / 405 / **401** | 导出 GET 的 `push-retry` 得到 401（**进了函数**），只导出 POST 的两条得到 405（**没进函数**）。405 发生在鉴权、指标、落表之前，所以 `cron.auth.rejected`、`cron.digest.*`、`/api/health`、冒烟**全都看不见**这条故障——这就是它活了 20 天（digest，2026-09-20 起）/ 18 天（retention，2026-09-22 起）而无人察觉的原因。`pnpm smoke:production` 第 8 步（`cron-trigger-method`）现在每次都核对它。**A/B 已取到**：本地生产构建（本分支 + dummy env，无任何请求打到生产库）上同一批路径的 GET 全部变成 **401**，而**未导出的 `PUT` 照样 405**——那一列 405 是这条证据的牙齿，它证明 405 确实是「方法没导出」的框架响应，于是「GET 由 405 变 401」只能解释为 GET 真的进了 handler |
| 生产迁移状态（2026-10-10） | ❌ **034 / 035 未 applied**（生产 schema 只到 033） | `pnpm exec supabase migration list --linked`（两条 `remote` 为空）；`pnpm exec supabase db query --linked "select version from supabase_migrations.schema_migrations order by version desc limit 3"` | **一条不要密码的只读命令就能复核，而 v0.12.0 发布时把它记成「本机未复核」**。后果分两层：① 部署中的 main 已在查 `.is("email_skipped_reason", null)`，该列不存在 → PostgREST 实测 **400 / 42703**；② 但因为上面那条 405，digest **从未走到这条查询**，所以线上表现为「静默不干活」而不是「每轮报错」。**修的顺序必须是先 `db push`、后部署 GET 修复**——反过来会把静默死变成每轮 500（见 `migration-rollback-runbook.md`「部署顺序」）。**前置精确到列**：本分支（= `origin/main`）的迁移只到 `034`、部署中的代码只读那一列，所以本 PR 的硬前置是 `034` applied；`035` 与读它那两列的代码都在 PR #235，**#235 合并后其硬前置才是 `035`**（`035` 只加两个可空列，`034` 先上不会让 #235 之前的代码坏掉）。**判据始终是「要部署的那一版代码会 select / filter 哪些列」，不是「仓库里有几条迁移」**。**`db push --linked` 同样不需要数据库密码**（2026-10-10 在主检出 `--dry-run` 实测 exit 0，`Would push these migrations` 列出 034 / 035——这条读数只说明「那个 checkout 相对云端缺什么」，且 `--linked` 依赖 gitignored 的 `supabase/.temp/`，换 worktree 就 `ProjectRefNotLinkedError`）——**挡在写操作前面的是审批，不是能力** |
| 生产 admin 概览页（2026-10-10） | ❌ **队列取数必然抛错** | REST 实测：`notifications?email_skipped_reason=is.null` → **400 / 42703**；代码路径 `src/app/dashboard/admin/page.tsx` 的 `Promise.all([...readEmailQueueDiagnostics()])` **无 try/catch** | 与 digest 不同，这条**没有被 405 掩盖**：它是人打开面板就会撞的。整页错误态（`dashboard/error.tsx` 兜底），不是少一张卡。**未用 admin 会话实测页面本身**（本机没有生产账号），所以这条是「已实测的列缺失 + 已读到的代码路径」的推论，不是截图证据 |
| 生产 `CRON_SECRET` | ✅ **production 与 preview 均已配置**（2026-10-10） | Vercel 项目环境变量列表（只读，取值不外泄）；`curl -X POST $BASE/api/cron/digest` 匿名 → **401** JSON | 这条**排除了一整类解释**（「cron 因漏配而静默 401」）。401 恰恰证明请求进了函数；而 GET 的 405 证明另一件事：**平台根本没进到函数里** |
| 生产 `email_worker_runs`（2026-10-10） | ❌ **空表**（`notifications` 亦 0 行；`profiles` 1 行） | `pnpm exec supabase db query --linked "select (select count(*) from public.email_worker_runs)::int as runs, (select count(*) from public.notifications)::int as notes"` → `{"runs":0,"notes":0}` | **这条比 405 更难反驳**：digest 的成功路径与失败路径**都会** `recordWorkerRun` 落一行（失败轮走的 `recordFailedRun` 只写 033 就有的列，不会因为缺列而写失败），所以只要 worker 进过函数就必然有一行。**零行 = 一次都没进过函数** |
| 生产 `pg_stat_statements`（2026-10-10，`stats_reset=2026-09-12`） | ✅ 可读（扩展已装） | `pnpm exec supabase db query --linked "select calls, left(query,180) as q from pg_stat_statements where query ilike '%push_delivery_attempts%' order by calls desc limit 5"` | **正向读数**：4 条 `push_delivery_attempts` 队列查询各 **19 次 calls** —— 导出 GET 的 push-retry 确实在跑，这是「平台真的按 GET 调用」的独立证据。**⚠️ 两个坑，本次都踩过**：① 不要用前缀 LIKE `insert into email_worker_runs%`——PostgREST 发的是带引号的 `"public"."…"`，那会得到一个**永远为零的假阴性**；② **被 PostgREST 在 schema cache 阶段拒掉的查询（400 / 42703）根本不会进这份统计**，所以「看不到 notifications 的队列查询」**证明不了** digest 跑过但失败——没跑与被拒两种原因在统计里长得一模一样。负向读数只作佐证，**结论靠 GET=405（直接）与零行（必要条件）**。另外**自己的探针也会进统计**（本次那条 `calls=1` 的队列查询就是我自己打的匿名 REST 核查），别把它读成 worker 的痕迹 |
| pg_cron（生产） | ❌ **未安装**（2026-10-10 由「未核实」转为实测） | `pnpm exec supabase db query --linked "select count(*) from pg_extension where extname='pg_cron'"` → **0** | 生产同样**一行都不会自动清理**：6 个 `cleanup_old_*` 函数在、调度不在。这条 retention worker 存在的理由就是取代 SQL 侧调度——**而它自己也在 405**，所以两层都没在跑。当前无数据可清，是**潜在故障，不是已发生损失** |
| 生产部署新鲜度（2026-10-08 观测） | ✅ fresh，阈值 5 | `pnpm ops:deploy-freshness`（生产 `d2457d74` = origin/main 同 commit） | **生产已追上 main**，不再滞后；前面几轮的 lagging 是 Vercel 构建排队的副作用 |
| 生产冒烟（2026-10-08 观测） | ⚠️ **当时 7/7 全绿，但覆盖不到这条链路**（2026-10-10 更正其含义） | `node scripts/production-smoke.js --url … --expected-commit <sha>`（现为 **8 步**） | 那 7 步真实、也确实全过（health / liveness / 主页 / 静态资源 / 安全头 / 匿名看板 307 / webhook 签名）。**但「7/7 绿」与「摘要邮件在跑」之间没有蕴含关系**：`/api/health` 的 DB 探测用 **anon** 身份打 `profiles limit(1)`，那张表和那一列都在，所以 `ready=true` 只说明「连得上」，不说明「业务查询跑得通」。第 8 步 `cron-trigger-method` 就是为补这个洞加的（**不打凭据**，只看平台用的 GET 会不会被路由接受） |
| 生产异步看板鉴权（2026-10-08 观测） | ✅ 匿名 401（admin 面板数据路径） | curl `BASE/api/ops/provider-status`（此时尚无凭据 → Unauthorized） | 与 2026-10-06 记的一致：鉴权边界在线上仍然有效；**content 读数仍需 CRON_SECRET/admin 会话（本机没有，照旧未知）** |
| Sentry | ❌ 生产未配 DSN | 同上（输出 `sentry: configured=false status=missing`） | **告警链路空转**，详见 `sentry-alerts.md` 开头 |
| Stripe | ❌ 生产未配 key | 同上（输出 `stripe: configured=false status=missing`） | 支付路径线上无流量，checkout 未上线 |
| Resend | ❓ **未知**（2026-10-05 起**可查了**） | `curl -H "authorization: Bearer $CRON_SECRET" $BASE/api/ops/provider-status` | **本条曾长期是「未知」**：provider 诊断逻辑（`diagnoseProviders`）写得完整、有单测，却**没有任何生产代码调用它**，`/api/health` 又只回 supabase/sentry/stripe 三项，于是「邮件链路在生产上是不是空转的」只能靠猜。现已新增只读诊断端点（见下）。**端点已在生产上线并实测过鉴权边界**（2026-10-06T00:57Z，commit `105da717`：匿名 401、错密钥 401），但**读数本身仍未知**——取它需要 `CRON_SECRET`，本机没有。**鉴权被验证不等于内容被读到**，所以这一行照旧是「未知」 |
| GitHub 保活变量 | ✅ 已配置 | `gh variable list`（`HEALTHCHECK_URL`） | 每日保活 workflow 在跑 |
| Vercel 构建配额 | ⛔ 限流中 | PR 上的 `Vercel – indie-stack` 检查（2026-10-05 报 `retry in 24 hours`） | preview 部署排队，非代码缺陷 |
| pg_cron（保留期调度） | ❌ **本地栈与生产都实测未安装**（本地 2026-10-06 / 生产 2026-10-10） | 本地：`node scripts/check-retention-cron.js --probe --container supabase_db_indiestack`；生产：`pnpm exec supabase db query --linked "select count(*) from pg_extension where extname='pg_cron'"` | **保留期一周一行都不会删**：6 个清理函数都在（`cleanup_old_*` / `prune_deleted_upload_objects`），但 `pg_extension` 里 `pg_cron` 行数 = 0，`cron.job` 这张关系根本不存在 → 0 个调度被注册。迁移成功、门禁全绿、`/api/health` 正常，**而数据一行不动**。生产这一行原写「仍未核实（需 DB 密码）」——**那是错的登记**，上面那条不要密码的命令就是它的解。注意本仓库的保留期清理**不依赖** pg_cron（走 `/api/cron/retention`），而那条 worker 正被 405 挡着，所以**两层同时是死的** |

**四条要读出来的分寸**：

1. **`configured=false` 不等于 readiness 会红**。`/api/health` 里 Sentry / Stripe 都是
   `required: false`，所以它们缺失时 `ready` 仍是 `true`——这是有意的设计（模板的可选依赖），
   但它意味着**一个可选依赖缺失时，健康检查不会替你喊人**。
2. **「平台可用」不等于「数据库可用」**。两者差着一层：Management API 能读项目状态，
   **读不到库里的表**。把前者当成后者会让人以为 B04 快能做完了。
3. **「调度在平台上一行不少」不等于「worker 在跑」**。Vercel Cron 触发用的是 **HTTP GET**，
   而本仓库曾有两条 worker 只导出 POST：平台每天照常调用、每天拿到 405，`vercel.json` 与
   `pnpm check:cron-contract` 都只显示「调度存在」。**405 发生在进路由之前**——鉴权指标、业务指标、
   落表、`/api/health`、冒烟全都不覆盖它，于是这条故障在没有任何红灯的情况下活了 20 天。
   能证明「平台确实在按 GET 调用」的正向读数是 `pg_stat_statements` 里 push-retry 的 19 次队列查询，
   加上 `email_worker_runs` 的**零行**（digest 成败两条路径都会落一行）。
   门禁在 `pnpm check:cron-contract`（`CRON_PLATFORM_METHOD_UNDECLARED`）与冒烟第 8 步。
   **第 8 步只该打生产部署**：2026-10-10 在 PR #236 的 preview 上实测，开着 Vercel Deployment
   Protection 时**每个**请求（连 一条**故意编造的假 cron 路径**一起）都被 302 到
   `vercel.com/sso-api`，应用行为一次都没被观察到。所以 302 判红是**如实表达「未知」**，
   不是误报——**别为了「让 preview 也绿」把 3xx 加进放行名单**，那等于让冒烟对受保护的部署永远绿。
   这条自己做了变异核对：把 3xx 放行 ⇒ 新增用例红；复原 ⇒ 11 绿。
4. **`❓ 未知` 是这一栏允许存在的状态**。写一个听起来合理的猜测，比写「未知」有害——
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
