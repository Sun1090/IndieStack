# v0.11.0 生产 Smoke Test 矩阵

> 本矩阵只记录**无副作用**检查；任何登录、上传、写库、发信、真实推送、删号场景必须有隔离账号或 provider 才能执行，
> 在这些前置条件具备前保持“未验证”，不得用空白结果冒充通过。

- 目标版本：v0.11.0
- 目标环境：生产（`https://indie-stack-theta.vercel.app`）
- 目标 commit：取证据的当时**无法从响应确定**——生产跑的是 `/api/health` 尚未暴露 `commit` 字段的构建，
  响应里只有 `version`。原先用 `uptime=368s`（观测于 08:05:33Z）反推部署窗口，那只是旁证。
  事后改用**权威来源**：`indie-stack` 生产最后一次成功部署是 `6587025748`
  （2026-09-22T08:56:51Z，commit `a322a4e`），即生产落后于 `main`；10:50:39Z 再直读 `/api/health`
  仍是 `version=0.11.0` 且没有 `commit` 字段，两边互相印证。取这条证据不需要 Vercel 权限，
  两步命令（连同「环境名必须精确匹配，否则会把 docs-site 那个项目一起捞进来」与
  「部署记录存在 ≠ 构建成功」两个坑）写在 `docs/operations/release-runbook-v0.11.0.md`
  的打标签前置一节，本文件不复述以免两处漂移。
  自下一次包含 `commit` 字段的部署起，这一行改由 `pnpm smoke:production --expected-commit <SHA>` 判定。
- 执行人 / 日期（含时区）：自主开发代理，2026-09-22 08:05–08:11 UTC（本地探测 + CI 定时与手动运行）
- **发布形态说明**：与 v0.10.0「部署 `main` 即发布、事后补记录」不同，v0.11.0 走完整 tag → release 流程。
  本文件在**部署之后**填写结果，打 tag 前必须已经有：入口条件全绿、迁移 DB-first 复核、
  以及下方「账户删除演练」一行（本版本新增，不可省略）。

## 无副作用检查（自动化，`pnpm smoke:production`）

> 2026-09-22 起生产已是 `0.11.0`（构建配额限流间歇放行过，详见下文「冷启动与部署配额」），以下 6 项由本地直跑与 CI 各取一次证据，
> 两边结论一致。

| 检查项                        | 期望                                                                           | 状态        |
| ----------------------------- | ------------------------------------------------------------------------------ | ----------- |
| `GET /api/health`             | 200，`status=ok`、`ready=true`、`version=0.11.0`、`no-store` 且带 `x-request-id`；发布时另传 `--expected-commit` 断言构建身份 | ✅ 2026-09-22T08:05:33Z：`status=ok`、`ready=true`、`version=0.11.0`、`environment=production`、`mockMode=false`、`supabase.reachable=true`、`cache-control: no-store, must-revalidate`、`x-request-id: 4320a463-161c-4ab9-ae7f-e390c30f3c4c`（该构建尚无 `commit` 字段） |
| 首页/静态资源                 | 首页 200 且含 `#main-content`；`/icon.svg` 200 且 MIME 为 SVG                  | ✅ 本地 6/6 与 CI 6/6 均通过（`homepage:200`、`static-asset:200`） |
| 未授权 dashboard              | 匿名请求重定向到 `/auth/login`，不返回受保护内容                               | ✅ `anonymous-dashboard:307` → `/auth/login` |
| Webhook 缺签名                | HTTP 400，`Missing signature`，`no-store`                                      | ✅ `webhook-signature-rejection:400`，拒绝且无副作用 |
| 安全头                        | CSP、HSTS、nosniff、DENY、Referrer-Policy、Permissions-Policy、request ID 齐全 | ✅ `security-headers:200`；实测响应含 `content-security-policy`（含 nonce + `strict-dynamic`）、`strict-transport-security: max-age=63072000; includeSubDomains; preload`、`x-content-type-options: nosniff`、`x-frame-options: DENY`、`referrer-policy: strict-origin-when-cross-origin`、`permissions-policy`、`x-request-id` |
| 版本漂移定时检测              | `Production Smoke` workflow `smoke-main`（UTC 02:17）以 `package.json` 为期望版本通过 | ✅ run `35700843878`（schedule 2026-09-22T07:41:07Z）该作业 success；run `35702965727`（dispatch 08:05:56Z）两作业均 success |

> ⚠️ 同一批定时运行暴露一条真实缺陷（已修）：`smoke`（手动 smoke）作业被 `schedule` 一起触发，
> 而它的参数全来自 `workflow_dispatch` inputs——`inputs` 在定时触发时为空，于是它每天以
> `Error: --timeout-ms requires a value` 失败（2026-09-21T07:56Z、2026-09-22T07:41Z 两次日志一致），
> 从未访问过生产，却长期占据「Production Smoke 变红」这个信号位。
> 现在它带作业级 `if: github.event_name == 'workflow_dispatch'`，并由
> `pnpm check:production-smoke` 的 `SMOKE_MANUAL_TRIGGER_GUARD_MISSING` 守住；
> 两个作业的证据 artifact 也改为不同名（`production-smoke-evidence` / `production-version-drift-evidence`），
> 此前同名会让 `gh run download -n` 静默留下后落地的一份。


## 需要只读凭证 / 只读 SQL

| 检查项                        | 期望                                                                           | 状态        |
| ----------------------------- | ------------------------------------------------------------------------------ | ----------- |
| 迁移基线核对                  | `supabase migration list --linked` 显示 001–033 全部 applied；`db push --linked --dry-run` 为空 | ✅ 通过（2026-09-22 只读复核，证据记录见 `docs/operations/release-runbook-v0.11.0.md` 差异 1） |
| RLS / 权限目录核对            | `pnpm check:supabase-security` 与 `pnpm smoke:supabase-identity` 对生产回读一致 | ⏳ 需生产只读凭证 |
| 服务端函数只对 `service_role` 开放 | 032/033 的 7 个函数（`erase_user_data`、3 个保留期函数、2 个对象清单函数、孤儿清单函数）`anon`/`authenticated` = false、`service_role` = true | ✅ 权限矩阵已按**真实调用**核验（本地库 `set role anon` / `set role authenticated` 逐个调用 7 个函数，14/14 `permission denied`；`service_role` 正常返回）。⏳ 云端仍只有 `has_function_privilege` 目录核对，未做匿名 `rpc` 实调 |
| 匿名 `audit_logs` 写入已关闭  | 直接 `POST /rest/v1/audit_logs` 不再返回 201                                   | ⏳ 未执行   |
| pg_cron 状态                  | `select 1 from pg_extension where extname='pg_cron'` 的结果与文档「保留期未生效」的措辞一致；若已启用，`cron.job` 里必须有登记的清理任务 | ⏳ 待执行 |
| 孤儿对象清单可读 | `find_orphan_upload_objects()` 返回集合与 `upload_objects` 中 `status='active'` 且无业务引用的行一致 | ✅ 通过：`pnpm audit:storage-orphans` 对本地栈零孤儿时报 0 条；插入 2 条 `owner_id is null` 的 active 行后报「2 条 / 9.5 MiB，其中 2 条上传者账户已删除」、最老 12 天、按 bucket 分组；`--json` 可机读、`--fail-on-findings` 退出码 2；验证后已删除这 2 行，表回到 0 行 |

## 需要隔离账号（本版本重点）

> ⛔ 以下任何一项都**禁止**用真实用户数据执行。账户删除不可逆。

| 检查项                        | 期望                                                                           | 状态        |
| ----------------------------- | ------------------------------------------------------------------------------ | ----------- |
| 确认短语服务端校验            | 不发送/发送错误确认短语时返回 `confirmPhraseMismatch`，**数据库与 bucket 零变化** | ⏳ 待执行   |
| 频率限制                      | 反复调用 `deleteAccountAction` 触发 429，不进入擦除逻辑                        | ⏳ 待执行   |
| **账户删除端到端演练**（隔离账号） | 用一次性测试账户完成真实删除，逐面核对：`api_usage` 行消失；本人邮箱（大小写/空格变体）的 `contact_messages` 消失；`audit_logs` 行**仍在**但 `user_id`/`entity_id`/PII metadata 键被清空；其独占头像对象从 bucket 消失；被团队引用的封面**保留**；会话失效并跳转首页 | ⏳ **生产**上未执行（需可牺牲账号 + 真实 `auth.admin.deleteUser`）。✅ 数据层等价演练已通过并入库：`docs/operations/drills/account-erasure.sql` 在本地 `001`–`033` 库上 20/20 断言成立（含「擦除后、删号前 profiles 仍在」这条顺序证据与 `deleted` 行不再进清单），结果记录见 `docs/db/retention.md` 的演练记录 |
| 审计留痕不含身份              | 演练后新增的 `account.deleted` 行 `user_id` 与 `entity_id` 均为 `null`，metadata 只有不受影响的计数（**不得出现 object key**，key 内含 user id） | ⏳ 待执行 |
| 擦除失败不删号                | 让 `erase_user_data` 返回错误（如临时收回 EXECUTE）后调用删除：请求失败、账户仍在、可重试 | ⏳ 待执行 |
| 登录与登出闭环                | 测试账号可完成登录→dashboard→登出                                              | ⏳ 需专用测试账号 |
| dashboard 业务查询            | 关键查询无 5xx，**租户数据隔离**成立（账户 A 读不到账户 B 的项目/通知/上传元数据） | ⏳ 需专用测试账号/租户 |
| 上传元数据落库                | 一次真实头像/封面上传后 `upload_objects` 出现对应 `status='active'` 行，且 `owner_id` 非空 | ⏳ 需专用测试项目与存储对象 |
| 上传中断/取消                 | 取消上传不留下 `active` 元数据行，也不留下引用它的业务字段                      | ⏳ 需隔离账号 |
| 邮件/通知                     | provider 可用且不重复发送                                                      | ⏳ 需隔离收件箱或 staging provider |
| Web Push 未配置               | 无 VAPID 密钥时设置页显示“未配置”，点击不写入 `push_subscriptions`             | ⏳ 未执行   |
| Push / digest cron 401 防护   | 无或错误 `CRON_SECRET` 调用 `/api/cron/push-retry`、`/api/cron/digest` 返回 401，且不产生 `cron.*.completed` 样本 | ⏳ 未执行   |
| Webhook 幂等（重复事件）      | 同一 `event.id` 投递两次后副作用行数仍为 1，第二次返回 200 `duplicate`         | ⏳ 需 Stripe test-mode 签名生成器与隔离测试租户 |
| **回滚探针**                  | 上一版本（0.10.0）可恢复，数据库保持向前 schema、账户删除入口随回滚消失（见回滚 runbook 决策树第 2 条） | ⏳ 见回滚 runbook，尚未演练 |

## 执行前置：冷启动与部署配额

- **首次探针可能是 503**：`/api/health` 在应用冷启动的第一次请求上会返回
  `status=degraded`、`ready=false`、`supabase=unreachable`（`uptime=0`），随后数次均为
  `200 + status=ok`。这是 required 依赖在冷启窗口内真的连不上，而不是探针写错——
  `pnpm health:check` 最多 3 次探测正是为此设计。**不要**据此判定需要回滚，也不要为了让第一帧变绿
  把 supabase 降级成 optional 依赖。
- **Vercel Hobby 构建配额（2026-09-22 全天在限流中，且越推越晚）**：`indie-stack` 项目被
  `Deployment rate limited — retry in 24 hours` 挡下的可核对记录——09-21T18:03Z 起第一次；
  09-22T09:31Z（`main` 推进到 `8037bbd`）又一次；10:50:02Z 一次，**同一分钟**
  `indie-stack-docs-site` 返回 `Deployment has completed`，说明限流**按项目计**；
  11:50:00Z 起两个项目**同时**被拒。每次提示都是「再等 24 小时」，而时间戳跟着最近一次尝试走——
  从仓库侧无法区分这是滑动窗口还是固定配额，能确定的只有一件事：**多推一次就多一次被拒记录**，
  攒批合并比小步推送更可能早点恢复部署能力（自主推进时尤其要记这条）。
  限流期间 `main` 的推送不产生生产部署，被限流的构建也不会排队：窗口结束后必须**再触发一次**部署才有证据。
  **别用 `version` 判断「main 已落地」**：`0.11.0` 之后的十几个提交在生产上都是同一个版本号，
  09-22 08:05Z 那次就是这样把「配额已恢复」推成了「当前 `main` 已落地生产」——结论当时是错的，
  生产其实停在 `a322a4e`。能判断身份的只有 `/api/health` 的 `commit` 字段（PR #69 加入，
  当天始终没上生产，响应里连这个键都不存在）与上一条的部署记录。
- **少踩配额只有两条路**（都在仓库之外，记下来供有 dashboard 权限的一方决定）：把多次推送攒成一次
  生产部署，或在 Vercel 项目的 Build & Deployment → Ignored Build Step 里跳过纯文档提交。
  仓库里没有可改这项配置的地方，`.env.local` 的 `VERCEL_TOKEN` 是占位值，本机无法代为设置。
- **定时告警的含义**：`smoke-main`（每日 02:17 UTC）以 `package.json` 为期望版本，
  它变红只应表示「生产落后于仓库」，禁止通过回退版本号或放宽期望来让它变绿。
  在它旁边还有一个同名作业名的干扰项已消除：`smoke`（手动）作业此前每次定时运行都以空参数崩溃，
  使「Production Smoke 变红」这句话失去区分力——见上方无副作用检查一节末尾的说明。

## 执行结果

- 结果：无副作用 6/6；只读 3/6（迁移基线、函数权限矩阵、孤儿清单；另 3 项需生产只读凭证或云端实调）；
  隔离账号 0/14（**本版本打 tag 的必要前置仍未满足**）
- 命令：`node scripts/production-smoke.js https://indie-stack-theta.vercel.app --expected-version 0.11.0 --output production-smoke.json`
  → `✅ production smoke: 6/6 passed`（本地 2026-09-22T08:05:00Z）
- 目标 commit：不可判定（见文首「目标 commit」——`/api/health` 不暴露构建 SHA）
- GitHub Actions：`Production Smoke` run `35702965727`（`workflow_dispatch`，2026-09-22T08:05:56Z）
  两作业均 success；定时 run `35700843878`（07:41:07Z）`smoke-main` success
- 证据 artifact：`production-smoke-evidence`（run `35702965727` 内 id `10683565868`，666 B，
  zip SHA-256 `7075985ca093ab2c63f3a1fe545a8de9edfe98cf705ecf614c8ddb5419dbe1dc`，保留 30 天）；
  定时漂移检查的证据自 2026-09-22 起改名为 `production-version-drift-evidence`
- 证据 JSON：本地 `production-smoke.json`（`generatedAt=2026-09-22T08:05:0xZ`、`passed=true`、
  6 项状态码 `200/200/200/200/307/400`，文件 SHA-256
  `cfb32bb3a125380b0245dcfc987738837eb658b7a88808624db97e6bcd419229`）；
  CI 两份 JSON 关键字段一致（`expectedVersion=0.11.0`、`passed=true`、同一组状态码）
- 迁移基线核对：见 `docs/operations/release-runbook-v0.11.0.md` 差异 1（2026-09-22 对云端项目
  `ntqggnztzvoavjbiillb` 的只读复核：001–033 全部 applied、`db push --linked --dry-run` 为空、
  `confdeltype = n`、7 个新函数权限矩阵符合预期）
- 账户删除演练证据：待填（**必须包含删除前后的行数对照与 bucket 对象清单**，这是本版本唯一的不可逆面；
  数据层等价演练 20/20 已通过并入库，见上表，但那不能替代真实 `auth.admin.deleteUser` + 真实 bucket）


## 为什么这一版不能只跑自动化的 6 项

v0.10.0 是纯 UI 收口，自动化 6 项 + 只读迁移核对足以覆盖风险。v0.11.0 引入了一条**删除用户数据**的链路，
它的正确性无法从外部观测：`/api/health` 全绿、页面全部可用、5xx 为零，都不能证明擦除按顺序发生、
也不能证明它没有多删。所以本矩阵把「账户删除端到端演练」列为打 tag 前的必要条件——
没有隔离账号的演练证据，就没有发布证据。

如果隔离账号或 provider 不可得，正确做法是**推迟发布**并在 `docs/progress.md` 记录阻塞原因，
而不是把「未验证」改成「通过」。
