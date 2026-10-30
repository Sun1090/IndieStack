# v0.12.0 生产冒烟矩阵

> 适用范围：v0.12.0 发布前后的生产核验。
> **本文档只记录「跑了什么、看到什么」；空着的行是没跑的，不是通过的。**

- 生产地址：`https://indie-stack-theta.vercel.app`
- 发布后取实际构建身份（不要用本地 HEAD 断言一个还没部署的提交）：
  ```bash
  curl -sS https://indie-stack-theta.vercel.app/api/health | head -c 400
  pnpm smoke:production --expected-commit "<上面读到的 commit>"
  ```

## 无副作用检查（自动化，`pnpm smoke:production`，本版本 8 步）

> 本行原写「7 步」，是 2026-10-05 发布当时的快照；**2026-10-10 起冒烟为 8 步**
> （新增 `cron-trigger-method`，见 `release-runbook-v0.12.0.md` 与下表最后一行）。

| 检查项 | 期望 | 状态 |
| --- | --- | --- |
| `GET /api/health`（就绪探针） | 200，`status=ok`、`ready=true`、`version=0.12.0`、`no-store` 且带 `x-request-id`；发布时另传 `--expected-commit` 断言构建身份 | ✅ 2026-10-05T23:52Z：`status=ok`、`ready=true`、`version=0.12.0`、`commit=5cdbf0c`（release PR #224 合并后的构建）；`--expected-commit` 断言**通过**（传错会红，见 runbook 停止条件） |
| `GET /api/health/live`（存活探针，本版本新增第 7 步） | 200，且响应体**不含** `checks`/`version`/`commit`/`uptime` —— 它必须既不打 Postgres 也不泄露构建身份 | ✅ 2026-10-05T23:52Z：冒烟第 7 步通过；直连响应体仅 `{"status":"ok","timestamp":"…"}`，确认无泄露 |
| 首页/静态资源 | 首页 200 且含 `#main-content`；`/icon.svg` 200 且 MIME 为 SVG | ✅ `homepage:200`、`static-asset:200`（icon.svg 以 SVG 提供） |
| 未授权 dashboard | 匿名请求重定向到 `/auth/login`，不返回受保护内容 | ✅ `anonymous-dashboard:307` → `/auth/login` |
| Webhook 缺签名 | HTTP 400，`Missing signature`，`no-store` | ✅ `webhook-signature-rejection:400`，拒绝且无副作用 |
| `cron-trigger-method`（2026-10-10 新增第 8 步） | `vercel.json` 的每条 cron 路径 GET 必须**不是 405**（401=进了函数被鉴权拒，可接受） | ✅ 2026-10-24 实测：`/api/cron/{digest,retention,push-retry}` GET ⇒ 401/401/401，8/8 通过（405 修复 #236 部署后） |
| 安全头 | CSP、HSTS、nosniff、DENY、Referrer-Policy、Permissions-Policy、request ID 齐全 | ✅ CSP（含 nonce + `strict-dynamic`）、HSTS `max-age=63072000; includeSubDomains; preload`、nosniff、`DENY`、`strict-origin-when-cross-origin`、permissions-policy、`x-request-id` |

> **本版本新增第 7 步的理由**：`/api/health` 拆成就绪与存活两个端点后，
> 必须有人盯着「它们没有被重新合并」。冒烟第 7 步断言 liveness 不返回
> `checks`/`version`/`commit`/`uptime`——**若两端点被合回去，这一步会红**。
> 这不是形式检查：合并回去等于容器健康检查每 30 秒打一次数据库，
> 一次 DB 抖动就会被判成容器已死并重启。

### 部署新鲜度（本版本新增，与冒烟并行执行）

| 检查项 | 期望 | 状态 |
| --- | --- | --- |
| `pnpm ops:deploy-freshness` | 落后 main 在阈值（默认 5）以内；**超阈值会红**，且消息里写明「生产 commit → main commit」与两个短 SHA | ⚠️ 发布前（2026-10-05T22:53Z）：生产 `08dd6f17` vs main `c7315633`，**落后 6 → 红**（Vercel 配额限流）。✅ 发布后（23:52Z）：**`fresh`，距离回落到 0**，生产与 main 同为 `5cdbf0cb` |

> **这条检查在一天内走完了它的两种状态**，这正是设计意图：
> 22:53Z 因配额限流报「落后 6 → 红」，23:52Z 配额恢复、部署落地后报「`fresh`」。
> 红的时候它说对了（生产确实在旧构建上），绿的时候它也说对了——
> 而在加这条检查之前，**这两种情况都不会有任何自动检查出声**。

### 生产部署台账（2026-10-14 追加，与本版本无关但补的是同一类缺口）

| 检查项 | 期望 | 说明 |
| --- | --- | --- |
| `pnpm ops:deploy-ledger` | `CONSISTENT`，exit 0；exit 2（读不到）**不算通过** | 问「**这个提交今天在不在线上**」，与上面的新鲜度检查**回答两个问题** |

> **为什么在本版本的文档里补这一节**：上面那条新鲜度检查是这一族证据里唯一管「生产到没到最新」的，
> 而它**结构性地看不见**「某个提交永远不会有自己的部署」这件事——它只量距离，阈值 5，落后 2 个照样绿。
> 2026-10-13 实测到「`fresh` 在阈值内」与「两个已合并提交从未上线」同时成立。
> ⇒ 判「部署正常」需要**两条都读**，缺一条就是拿距离冒充归属。
> 台账的判据、90 分钟阈值的出处、以及「环境名写错时 API 回 200 + 空数组 ⇒ 判未知而不是判红」
> 都写在 `docs/operations/environments.md` 的「生产部署台账」行，此处不重复。

## 需要只读凭证 / 只读 SQL

| 检查项 | 期望 | 状态 |
| --- | --- | --- |
| 迁移已 applied | `pnpm ops:migration-status` 报告本仓库登记的迁移全部已在云端 applied | ✅ **2026-10-24 转绿**：034/035 经 Management API applied + 版本号订正后探测一致。旧行写「⛔ 本机无凭据、034 未 applied」是 10-13 的快照——CLI 登录态那条路确实走不通，但 `ops:migration-status` 只要 repo secret 就能答（见 roadmap B 组「第四版否证」与 `migration-rollback-runbook.md` 的等价路径节） |
| 队列语义（A05） | `notifications.email_skipped_reason` 列存在；`countEmailSkippedByReason` 能按 `EMAIL_SKIP_REASONS` 返回计数 | ✅ **2026-10-25 转绿**：列存在（REST select 该列 ⇒ 200；列不在会 42703）；逐 reason 复刻计数查询（`email_sent=is.false&email_skipped_reason=eq.<reason>` + `Prefer: count=exact`）⇒ `no_email`/`preferences_off` 双 `*/0`，与 notifications 总数 `*/0` 的基线自洽。取数凭据是 `.env.local` 的 service_role（#285 起探测统一从 env 文件读），旧行写「⛔ 需要 service-role 读权限」时它就躺在本机——同 B03「缺凭据」一族的第 6 处。⚠️ 0 是**空表的 0**（查询形状可用）。**2026-10-30 补读**：digest 已连续 6 天常态执行（见下一行），6 轮全部 `skipped=0`——因为生产 notifications 表本来就空、没有可跳过的行；**非零计数要的是真实待发数据，不是「等首轮」**（首轮早已过去）。判当下请重跑上面的复刻查询 |
| `email.backlog` 趋势 | A05 落地后积压应**下降**（原先不可投递的行不再占队首） | ✅ **连续 6 天常态执行已观测**（2026-10-30 13:47Z `pnpm ops:digest-observation` 读全表）：`email_worker_runs` 6 行 `2026-10-25 09:57Z` / `10-26 09:57Z` / `10-27 09:56Z` / `10-28 09:56Z` / `10-29 09:56Z` / `10-30 09:56Z`，**每轮都是 `pulled=0 sent=0 failed=0 backlog=0 skipped=0` ⇒ 全 COMPLETED_OK**。两条可复核结论：① 链路自 405 修复后**连续 6 天每天都跑通、零失败**（不再是「首轮单次」）；② 落表时刻 6/6 都在 **09:56–09:57Z**（比调度 09:00Z 晚约 57 分钟，但高度稳定）——这也是本轮新增的读数：原来是「首个 57 分钟差 unexplained」，现在是「常态偏移、跨 6 天稳定」，**仍不外推成因**（没有 Vercel 侧调度明细）。⚠️ **趋势仍无可判数据**：6 轮全是空轮（生产 notifications 为空），backlog 恒 0 属预期，「积压下降」这条要等真实积压出现才有牙齿——**判当下请重跑 `ops:digest-observation`** |

## 需要隔离账号（本版本重点）

> **禁止用真实用户跑账户删除演练**：`auth.admin.deleteUser` 不可逆，
> 拿真实用户跑等于删数据。需要一个**可牺牲**的隔离账号。

| 检查项 | 期望 | 状态 |
| --- | --- | --- |
| B03 账户删除全链路 | 确认短语被服务端校验；`api_usage` 与本人邮箱的 `contact_messages` 消失；`audit_logs` 行仍在但 PII 键被清空；独占头像对象从 bucket 消失；被团队引用的封面保留；会话失效 | ⛔ **未闭合**——缺 `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` 与可牺牲账号。B03 是 `0.12.0` 刻意不打 tag 的唯一原因。**【2026-10-25 订正】前半句「缺三个凭据」不成立**：本机 `.env.local` 三项都在，`drills:preflight --drill B03` 现报三项 ✓、只缺 `DRILL_ISOLATED_ACCOUNT_EMAIL`；当日 `GET /auth/v1/admin/users` 用 service_role 返回 200（生产 1 个账号，且它不是可牺牲的）。根因是旧探针只看 `process.env` ⇒ 假阴性滚成了「缺凭据」登记 |
| 租户数据隔离 | 账户 A 读不到账户 B 的项目/通知/上传元数据 | ✅（本地栈，2026-10-25）`pnpm smoke:supabase-identity` **23/23**：项目（owner-a-cannot-read-private-project-b）、通知（A/B 各只见自己的种子行，RLS `auth.uid()=user_id`）、上传元数据（无客户端策略 ⇒ 连 owner 自己也读不到，A 有一行的前提下 B 仍 `[]`——实测过再删）。⏳ **生产侧**仍需两个可牺牲账号做同型核对（与 B03 同一请求项），本地证据不自动迁移（同栈同迁移，形态相同） |
| **回滚探针** | 上一版本（0.11.0，`commit=08dd6f17`）可恢复，数据库保持向前 schema、034 不逆向执行（见 `rollback-runbook-v0.12.0.md`「数据库向前兼容」） | ⛔ 尚未演练——需要一次真实的生产部署切换，本版本**不制造**该证据 |

## 发布前的外部依赖实况（2026-10-05T22:53Z 观测）

读数来自 `node scripts/check-health.js https://indie-stack-theta.vercel.app`
（权威出处是 `docs/operations/environments.md` 的「外部依赖实况」表）：

```
version=0.12.0 commit=5cdbf0cb812e87f8f920870bfec421661471eafa ready=true   # 发布后（23:52Z）
# 发布前同一命令的读数：version=0.11.0 commit=08dd6f17… ready=true
- supabase: required=true  configured=true  status=ok        reachable=true
- sentry:  required=false configured=false status=missing
- stripe:  required=false configured=false status=missing
allConfigured=false degraded=false
```

**发布后 `version` 已变为 `0.12.0`、`commit=5cdbf0cb`，部署落地成功**（2026-10-05T23:52Z）。
若生产未变成 `version=0.12.0`，说明部署没落地，去查 Vercel 构建配额
（PR 的 Vercel 检查会直接写 `Deployment rate limited`）。

**发布后也不应变化的两件事**：`sentry` 与 `stripe` 仍是 `configured=false`——
本版本不配置这两项（需要外部凭据）。`ready=true` 而 `allConfigured=false` 是
**预期状态**：可选依赖缺失不会让就绪探针变红。

## 为什么这一版不能只跑自动化的 7 项

自动化 8 步全部无副作用且不需要任何凭据，但它**证明不了三件事**：

1. **迁移 034 在云端真的 applied 了**（自动化检查完全不碰数据库）；
2. **A05 的队列语义在真实数据上成立**（需要 service-role 读权限与观察窗口）；
3. **账户删除链路仍然正确**（B03，需要可牺牲账号）。

第 3 项的缺口正是 `0.12.0` **刻意不打 tag** 的原因：
tag 是对外声明「做完了」，而这一项没有证据。
**没有证据就等于没做**——所以这里留空，不抄上一版的记录。
