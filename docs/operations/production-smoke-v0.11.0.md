# v0.11.0 生产 Smoke Test 矩阵

> 本矩阵只记录**无副作用**检查；任何登录、上传、写库、发信、真实推送、删号场景必须有隔离账号或 provider 才能执行，
> 在这些前置条件具备前保持“未验证”，不得用空白结果冒充通过。

- 目标版本：v0.11.0
- 目标环境：生产（`https://indie-stack-theta.vercel.app`）
- 目标 commit：待填（release 分支合并后的 `main` HEAD SHA）
- 执行人 / 日期（含时区）：待填
- **发布形态说明**：与 v0.10.0「部署 `main` 即发布、事后补记录」不同，v0.11.0 走完整 tag → release 流程。
  本文件在**部署之后**填写结果，打 tag 前必须已经有：入口条件全绿、迁移 DB-first 复核、
  以及下方「账户删除演练」一行（本版本新增，不可省略）。

## 无副作用检查（自动化，`pnpm smoke:production`）

| 检查项                        | 期望                                                                           | 状态        |
| ----------------------------- | ------------------------------------------------------------------------------ | ----------- |
| `GET /api/health`             | 200，`status=ok`、`ready=true`、`version=0.11.0`、`no-store` 且带 `x-request-id` | ⏳ 待执行   |
| 首页/静态资源                 | 首页 200 且含 `#main-content`；`/icon.svg` 200 且 MIME 为 SVG                  | ⏳ 待执行   |
| 未授权 dashboard              | 匿名请求重定向到 `/auth/login`，不返回受保护内容                               | ⏳ 待执行   |
| Webhook 缺签名                | HTTP 400，`Missing signature`，`no-store`                                      | ⏳ 待执行   |
| 安全头                        | CSP、HSTS、nosniff、DENY、Referrer-Policy、Permissions-Policy、request ID 齐全 | ⏳ 待执行   |
| 版本漂移定时检测              | `Production Smoke` workflow `smoke-main`（UTC 02:17）以 `package.json` 为期望版本通过 | ⏳ 待执行 |

## 需要只读凭证 / 只读 SQL

| 检查项                        | 期望                                                                           | 状态        |
| ----------------------------- | ------------------------------------------------------------------------------ | ----------- |
| 迁移基线核对                  | `supabase migration list --linked` 显示 001–033 全部 applied；`db push --linked --dry-run` 为空 | ⏳ 待执行 |
| RLS / 权限目录核对            | `pnpm check:supabase-security` 与 `pnpm smoke:supabase-identity` 对生产回读一致 | ⏳ 需生产只读凭证 |
| 服务端函数只对 `service_role` 开放 | 032/033 的 7 个函数（`erase_user_data`、3 个保留期函数、2 个对象清单函数、孤儿清单函数）`anon`/`authenticated` = false、`service_role` = true | ⏳ 待执行 |
| 匿名 `audit_logs` 写入已关闭  | 直接 `POST /rest/v1/audit_logs` 不再返回 201                                   | ⏳ 未执行   |
| pg_cron 状态                  | `select 1 from pg_extension where extname='pg_cron'` 的结果与文档「保留期未生效」的措辞一致；若已启用，`cron.job` 里必须有登记的清理任务 | ⏳ 待执行 |
| 孤儿对象清单可读              | `find_orphan_upload_objects()` 返回行数与 `upload_objects` 中 `status='active'` 且无业务表引用的行数一致 | ⏳ 需只读 SQL |

## 需要隔离账号（本版本重点）

> ⛔ 以下任何一项都**禁止**用真实用户数据执行。账户删除不可逆。

| 检查项                        | 期望                                                                           | 状态        |
| ----------------------------- | ------------------------------------------------------------------------------ | ----------- |
| 确认短语服务端校验            | 不发送/发送错误确认短语时返回 `confirmPhraseMismatch`，**数据库与 bucket 零变化** | ⏳ 待执行   |
| 频率限制                      | 反复调用 `deleteAccountAction` 触发 429，不进入擦除逻辑                        | ⏳ 待执行   |
| **账户删除端到端演练**（隔离账号） | 用一次性测试账户完成真实删除，逐面核对：`api_usage` 行消失；本人邮箱（大小写/空格变体）的 `contact_messages` 消失；`audit_logs` 行**仍在**但 `user_id`/`entity_id`/PII metadata 键被清空；其独占头像对象从 bucket 消失；被团队引用的封面**保留**；会话失效并跳转首页 | ⏳ 待执行 |
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
- **Vercel Hobby 构建配额**：2026-09-21T18:03Z 起 `indie-stack` 项目的部署状态为
  `Deployment rate limited — retry in 24 hours`（同一时点 `indie-stack-docs-site` 部署成功，
  说明限流按项目计）。配额未恢复前 `main` 的推送**不会**产生生产部署，
  因此 `pnpm smoke:production --expected-version 0.11.0` 与 `check-production-version.js`
  必然失败。被限流的构建不会排队，恢复后要重新触发一次部署才能拿到证据。
- **由此产生的定时告警是预期信号**：`Production Smoke` workflow 的 `smoke-main`
  （每日 02:17 UTC）以 `package.json` 为期望版本，生产停留在 `0.10.0` 期间它会每天失败。
  这正是「生产落后于仓库」的设计用途，禁止通过回退版本号或放宽期望来让它变绿。

## 执行结果

- 结果：待填（格式：无副作用 N/6、只读 N/M、隔离账号 N/K）
- 命令：`node scripts/production-smoke.js "$PRODUCTION_URL" --expected-version 0.11.0 --output production-smoke.json`
- 目标 commit：待填
- GitHub Actions：待填（`CI` / `CodeQL` / `Secrets Scan` / `Security and configuration checks` / `Production Smoke`）
- 证据 artifact：由 `Production Smoke` workflow 上传，保留 30 天
- 证据 JSON：待填（路径 + 关键字段快照）
- 账户删除演练证据：待填（**必须包含删除前后的行数对照与 bucket 对象清单**，这是本版本唯一的不可逆面）

## 为什么这一版不能只跑自动化的 6 项

v0.10.0 是纯 UI 收口，自动化 6 项 + 只读迁移核对足以覆盖风险。v0.11.0 引入了一条**删除用户数据**的链路，
它的正确性无法从外部观测：`/api/health` 全绿、页面全部可用、5xx 为零，都不能证明擦除按顺序发生、
也不能证明它没有多删。所以本矩阵把「账户删除端到端演练」列为打 tag 前的必要条件——
没有隔离账号的演练证据，就没有发布证据。

如果隔离账号或 provider 不可得，正确做法是**推迟发布**并在 `docs/progress.md` 记录阻塞原因，
而不是把「未验证」改成「通过」。
