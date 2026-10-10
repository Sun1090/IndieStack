# 迁移回滚 Runbook

> 面向数据库迁移的统一回滚流程。应用侧回滚见 [rollback-runbook-v0.10.0.md](./rollback-runbook-v0.10.0.md)，
> 本文件只管 schema 与数据。
>
> **不自动回滚数据库。** 逆向迁移可能造成不可逆的数据丢失，必须由 DBA 与发布负责人共同决定；
> 多数情况下正确的做法是**前向修复**（新增一条迁移）而不是删除已经应用的历史。

<!-- migration-runbook:latest=034_email_skip_reason.sql -->

## 触发条件

出现以下任一情况时启动本流程：

- 迁移导致请求持续失败（`/api/health` 的数据库依赖为 `error`，或关键路径 5xx）；
- 迁移造成数据完整性风险（唯一约束冲突、外键断裂、孤儿行、错误的默认值）；
- RLS / 权限策略变更导致越权或大面积无权访问；
- 迁移后的写入量与发布前基线相比异常（重复行、重复 webhook、队列堆积）；
- `pnpm check:migration-history` 报告本地库已应用但仓库不存在的版本，或反之。

## 决策树

1. **新代码可回滚、schema 向后兼容** → 只切回上一个已验证 deployment，数据库保持向前 schema。
2. **schema 不向后兼容（旧代码读不到新结构）** → 不要切回旧代码；在**当前** schema 上做前向修复迁移，
   或用 feature flag 关闭受影响路径，先恢复服务。
3. **迁移本身写错且尚未产生业务数据** → 允许在受控窗口内做逆向操作，但必须先快照、必须在 DBA 在场时执行。
4. **已经产生业务数据** → 只允许前向修复迁移（补齐列、回填、重建索引），禁止 `DROP`。
5. **怀疑数据被误写** → 停止相关 worker 与后台任务，保留日志与快照，按备份恢复演练流程处理，并记录影响范围。

## 前向修复优先

「删除迁移」在本仓库是被禁止的动作：`supabase/migrations/` 是只追加的，历史一旦进入
`supabase/migration-manifest.json` 就不可改写。`pnpm update:migrations-manifest` 会拒绝重写已登记的
迁移校验和，`pnpm check:migrations` 会校验每个文件的 SHA-256 与顺序。因此：

- 想撤销一条迁移的效果，正确做法是**新增一条反向迁移**（例如 `035_...`）而不是删掉 `034`；
- 想修正一条写错的迁移，同样是新增一条修复迁移；
- 迁移文件里应当自带幂等保护（`IF EXISTS` / `IF NOT EXISTS`）与可观测注释，方便前向修复。

## 迁移类型与回滚配方

| 迁移类型                | 典型语句                                                | 逆向风险                                     | 推荐做法                                                                 |
| ----------------------- | ------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------ |
| 新增表                  | `CREATE TABLE`                                          | 低（丢表即丢数据）                           | 前向修复可用，逆向前必须先导出数据；确认无外键引用                       |
| 新增可空列              | `ALTER TABLE ... ADD COLUMN ... NULL`                   | 低                                           | 旧代码忽略新列即可，通常只需回滚应用；保留列                               |
| 新增非空列 / 默认值     | `ADD COLUMN ... NOT NULL DEFAULT`                       | 中（回滚会丢回填结果）                       | 先加可空列 → 回填 → 再加约束；回滚只回滚应用                              |
| 新增索引                | `CREATE INDEX`                                          | 极低                                         | 可直接 `DROP INDEX`，但通常留着无副作用                                   |
| 新增枚举值              | `ALTER TYPE ... ADD VALUE`                              | 高（Postgres 无法删除枚举值）                 | **只能前向修复**；不要试图逆向                                           |
| RLS / 策略变更          | `CREATE POLICY` / `ALTER POLICY` / `REVOKE`             | 中（权限真空 = 不可访问或越权）               | 新增旧策略的恢复迁移；回滚后立刻跑 `pnpm check:rls` 与身份矩阵            |
| 触发器 / 函数           | `CREATE OR REPLACE FUNCTION` / `CREATE TRIGGER`         | 中（写入放大、递归）                         | 用 `CREATE OR REPLACE` 前向覆盖；禁止直接删函数                          |
| 数据回填                | `UPDATE` / `INSERT ... SELECT`                          | 高（不可重复执行）                           | 只前向修复；回填脚本必须幂等且可重跑                                     |

## 操作步骤

```bash
# 0. 固定证据：记录时间、当前版本与迁移状态（先保存，不要覆盖）
date -u
pnpm check:migrations                       # 校验每个迁移的 SHA-256 与顺序（离线可跑）
pnpm update:migrations-manifest             # 仅当新增迁移后重新基线；拒绝改写已登记项

# 1. 需要本地 / staging 复现时，确认数据库实际应用到了哪一版
pnpm exec supabase start
pnpm check:migration-history                # 本地库已应用但仓库不存在的版本会在这里暴露

# 2. 选择动作
#    A. 兼容回滚 → 部署平台切到上一个已验证 deployment（不改数据库）
#    B. 不兼容    → 写一条新的前向修复迁移，走正常 PR 流程
#    C. 数据事故  → 冻结写入、快照、按备份恢复流程处理，并记录影响范围

# 3. 回滚后复验（见下一节）
pnpm smoke:supabase-identity -- --url "$STAGING_URL" --anon-key "$ANON_KEY" --service-role-key "$SERVICE_ROLE_KEY"
```

任何涉及生产数据库的写操作都必须由有权限的发布人员执行；命令、URL、deployment ID 与输出必须写入
incident 记录，不允许只留聊天记录。

### `db query --linked` 的两条边界（2026-10-10 实测，写这条是因为我自己踩了）

1. **它只需要 CLI 登录态，不需要数据库密码。** CLI 会用 `SUPABASE_ACCESS_TOKEN`
   临时建一个 role 连进库，所以 `migration list --linked` 与单条 `db query --linked`
   **都属于「不要密码的只读复核」**。本仓库曾把它们登记成「需要 DB 密码」，
   于是「云端到了哪一版」这个一分钟能答的问题挂了两年「本机未复核」，
   而它正是 2026-10-10 那次生产故障的直接原因（见 `docs/progress.md` 同日事故条目）。
   **登记阻塞时必须写清阻塞到哪一层**：只写「做不到」，下一个人会连能做的部分一起放弃。
2. **但它是能写的。** 走的是真 Postgres 连接，返回 204 也可能是真的执行了。
   2026-10-10 我在一次「只读核查」里跑了
   `db query --linked "select … cleanup_old_email_worker_runs()"`（HTTP 204）——
   那是 032 的保留期删除函数。当时与事后各查一次行数都是 0，**所以没有删到任何东西**，
   但「没造成损失」不等于「可以做」：**任何生产库写操作必须由发布人员执行**，
   而我当时因为「这个连接只会返回读数」把它当成了只读通道。
   **要只读就用只读的东西**：`select count(*) …`、`information_schema`、`migration list`；
   带函数调用的 `select` 一律先确认那个函数不写。
   它还有第二条边界：**只接受单条语句**（实测 `db query --local "select 1; select 2"` →
   `cannot insert multiple commands into a prepared statement`），
   所以 `docs/operations/drills/*.sql` 那种多语句 + `begin/rollback` 的演练**仍然要 psql 与 DB 密码**。

### 另外两条读数口径（避免把「空」读成「有」）

- `db query --linked` 连进去是 `current_user=postgres` 且 `rolbypassrls=true`，
  **RLS 不会过滤你的读数**。所以「表是空的」是真空，不是被策略挡住——
  这点必须先排除，否则会把「读不到」误报成「没有数据」（2026-10-10 核过）。
- 想看「这条链路到底跑过没有」，不必等日志：**`pg_stat_statments` 在生产是装着的**，
  `select calls, query from pg_stat_statements where query ilike '%email_worker_runs%'`
  能直接给出「这张表有没有被 INSERT 过」。**但这份统计有两个坑，别把它当万能证据**：
  - **正向读数才有解释力**：导出 GET 的 push-retry 有 4 条各 **19 次 calls** 的
    `push_delivery_attempts` 队列查询，这证明「平台确实按 GET 在调用」。
  - **负向读数证明不了「跑过但失败」**：被 PostgREST 在 schema cache 阶段拒掉的查询
    （400 / 42703）**根本不会进统计**，于是「没跑」与「跑了被拒」在这份表里长得一模一样。
    想知道「worker 有没有进过函数」，用**落表必要条件**（`email_worker_runs` 行数）而不是这条。
  - **别用前缀 LIKE**：`'insert into email_worker_runs%'` 匹配不到 PostgREST 实际发出的
    `INSERT INTO \"public\".\"email_worker_runs\"`，会得到一个**永远为零的假阴性**（2026-10-10 踩过）。
  - **自己的探针也在这份统计里**：拿它做证据前先排除本次核查打出去的那些查询。

## 部署顺序：迁移必须先于代码（每次发布的前置，不是出事才看）

判据**不是「代码会不会写这一列」，而是「读侧会不会 select / filter 这一列」**：

- **只被写入的新列**：代码先上、迁移后上，最坏是那列暂时没人写（可接受）。
- **被 select 的新列**：迁移未 applied 时 PostgREST 直接判 `42703 column … does not exist`
  （2026-10-10 对生产实测：`GET /rest/v1/notifications?select=id&email_skipped_reason=is.null`
  → **HTTP 400 / 42703**），repository 层把它 `throw` 出去。
  **后果取决于调用方有没有包住它**：`src/app/dashboard/admin/page.tsx` 的队列取数在
  `Promise.all` 里调 `readEmailQueueDiagnostics()`，**没有 try/catch**，
  所以那不是少一张卡，而是**整个 admin 概览页错误态**。
- **追加式迁移照样能让线上坏掉**：`034` 给 `notifications` 加 `email_skipped_reason`
  是「只加一个可空列」的形状，看着人畜无害，但队列谓词加了 `.is(col, null)`
  ——**该列不存在时与「有没有数据写它」无关，直接 400**。

含迁移的发布必须按这个顺序，且**每一步都要有读数**：

```bash
# 1. 目标环境应用到哪一版。**这一步不需要数据库密码**（CLI 用自己登录态建 role 读 schema_migrations）
pnpm exec supabase migration list --linked
#    要更硬的读数（列在不在、扩展装没装）就直接问系统目录：
pnpm exec supabase db query --linked \
  "select version from supabase_migrations.schema_migrations order by version desc limit 5"
# 2. 与**要部署的那一版代码**比对；缺哪一条就先 db push —— **不要先放代码**
#    判据是「那一版会 select / filter 哪些列」，不是「仓库里有几条迁移」：
#    并行 PR 各自带的迁移，只有合并进 main 那一版才需要对应的列先存在。
pnpm check:migrations
# 3. 迁移 applied 之后再部署应用，最后跑冒烟（8 步，含 cron 触发方法）
pnpm smoke:production -- --url "$PROD_URL" --expected-commit "$(git rev-parse HEAD)"
```

**顺序反了会是什么形状（2026-10-10 的真实案例，值得记住）**：生产停在 033、代码已在查 034 的列，
看起来应该「每轮 500」——但线上**一个错误都没有**。原因是 digest 走的是
**Vercel Cron 的 HTTP GET**，而那条路由只导出 POST，于是平台每天拿到 **405**，
`405` 在进路由之前就返回，**那 400 从来没有机会发生**。
所以如果只修 GET 而不先推迁移，故障会从「静默不干活」变成「每轮 500 + Sentry 刷屏」。
**这就是「迁移先于代码」最硬的一次证明**：修复顺序不是偏好，是两种失败形态的差。

**把这次的前置精确到列**（免得把「仓库有 035」误当成「必须先推 035」）：
生产要部署的是 `034` 所在那一版，它读 `notifications.email_skipped_reason`，
所以**硬前置只有 `034`**。`035` 与其两列（`backlog` / `skipped`）的**读写代码都在 PR #235**，
`main` 上 digest 只写 `pulled/sent/groups/failed/duration_ms/error`（033 及以前就有的列），
所以 `035` 晚一步推不会让当前部署坏；**但 #235 合并之后，它的硬前置就是 `035`**——
`src/lib/repositories/worker-runs.ts` 会 `.select("… backlog, skipped")`，那两列不在就是 400，
而 #235 同时改了 admin 面板的取数，**没有 try/catch 的那条路径会整页红**。
**两条迁移都追加式、都可先于代码执行；顺序要求只来自「谁在读」。**

**读数的落点**：含迁移的发布，`migration list --linked` 的输出必须进发布记录。
拿不到读数时**不得宣布「云端已同步」，也不得用「本地全绿」代替**——
`check:migrations` 只看仓库里的文件与校验和，它**永远证明不了云端状态**。

## 回滚后验证

- `pnpm check:migrations` 通过：迁移文件未改写、顺序正确、校验和一致；
- `pnpm check:migration-history` 明确当前应用到哪一版，没有半完成迁移；
- `/api/health` 的数据库依赖回到 `ok`，5xx 与延迟恢复到发布前基线；
- RLS 回归通过（`pnpm check:rls` + 身份矩阵 `pnpm smoke:supabase-identity`），租户隔离未被破坏；
- 关键表行数与发布前快照一致，没有重复行或孤儿行；
- 后台 worker（推送重试、邮件、webhook 幂等）没有重复执行；
- 至少一条关键业务 smoke test 通过，并把结果写进 incident 记录。

## 权限与审批

- 生产数据库的逆向操作需要 DBA + 发布负责人双人批准，并事前书面确认锁定窗口；
- 任何 `DROP TABLE` / `DROP COLUMN` / `TRUNCATE` 都必须先有可验证的备份与回滚脚本；
- 发布负责人负责回滚决策与对外沟通，DBA 负责数据安全与恢复执行；
- 权限不足时不得以「临时提权」绕过流程，改为前向修复并走正常 PR。

## 演练记录

- 演练日期（UTC）：
- 目标版本 / 涉及迁移：
- 使用环境（本地 / staging）：
- 决策路径（兼容回滚 / 前向修复 / 备份恢复）：
- 执行的命令与输出摘要：
- 从触发到恢复的耗时：
- 失败点 / 改进项：
- 操作者 / 审查者：

## 附：备份与自动恢复

生产库的自动恢复由 `supabase-restore` provider 驱动，它需要 `SUPABASE_ACCESS_TOKEN` 与可推导或显式指定的
`SUPABASE_PROJECT_REF`；完整变量语义见 [provider 诊断指南](../../docs-site/provider-diagnostics.md)。
逆向迁移前的最小前提是**确认快照可用**，而不是「假设有备份」：

- 快照时间点必须早于待撤销迁移；
- 恢复演练至少验证过「快照 → 恢复 → 应用连通」这条链路；
- 恢复本身也会覆盖当前数据，属于破坏性操作，同样需要双人批准。

若 provider 诊断显示 `supabase-restore` 处于 `disabled` 或 `misconfigured`，视为**不具备回滚条件**，
只能走前向修复路径。
