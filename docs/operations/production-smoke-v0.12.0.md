# v0.12.0 生产冒烟矩阵

> 适用范围：v0.12.0 发布前后的生产核验。
> **本文档只记录「跑了什么、看到什么」；空着的行是没跑的，不是通过的。**

- 生产地址：`https://indie-stack-theta.vercel.app`
- 发布后取实际构建身份（不要用本地 HEAD 断言一个还没部署的提交）：
  ```bash
  curl -sS https://indie-stack-theta.vercel.app/api/health | head -c 400
  pnpm smoke:production --expected-commit "<上面读到的 commit>"
  ```

## 无副作用检查（自动化，`pnpm smoke:production`，本版本 7 步）

| 检查项 | 期望 | 状态 |
| --- | --- | --- |
| `GET /api/health`（就绪探针） | 200，`status=ok`、`ready=true`、`version=0.12.0`、`no-store` 且带 `x-request-id`；发布时另传 `--expected-commit` 断言构建身份 | ⏳ 待发布后执行 |
| `GET /api/health/live`（存活探针，本版本新增第 7 步） | 200，且响应体**不含** `checks`/`version`/`commit`/`uptime` —— 它必须既不打 Postgres 也不泄露构建身份 | ⏳ 待发布后执行 |
| 首页/静态资源 | 首页 200 且含 `#main-content`；`/icon.svg` 200 且 MIME 为 SVG | ⏳ 待发布后执行 |
| 未授权 dashboard | 匿名请求重定向到 `/auth/login`，不返回受保护内容 | ⏳ 待发布后执行 |
| Webhook 缺签名 | HTTP 400，`Missing signature`，`no-store` | ⏳ 待发布后执行 |
| 安全头 | CSP、HSTS、nosniff、DENY、Referrer-Policy、Permissions-Policy、request ID 齐全 | ⏳ 待发布后执行 |

> **本版本新增第 7 步的理由**：`/api/health` 拆成就绪与存活两个端点后，
> 必须有人盯着「它们没有被重新合并」。冒烟第 7 步断言 liveness 不返回
> `checks`/`version`/`commit`/`uptime`——**若两端点被合回去，这一步会红**。
> 这不是形式检查：合并回去等于容器健康检查每 30 秒打一次数据库，
> 一次 DB 抖动就会被判成容器已死并重启。

### 部署新鲜度（本版本新增，与冒烟并行执行）

| 检查项 | 期望 | 状态 |
| --- | --- | --- |
| `pnpm ops:deploy-freshness` | 落后 main 在阈值（默认 5）以内；**超阈值会红**，且消息里写明「生产 commit → main commit」与两个短 SHA | ⚠️ 发布前实测（2026-10-05T22:53Z）：生产 `08dd6f17` vs main `c7315633`，**落后 6 个提交 → 红**，原因是 Vercel 构建配额限流 |

> 这条检查现在红是**真实的**：生产确实停在旧构建上。发布完成、部署落地后
> 距离应回落到 0。若连续多天停在同一个距离不回落，那才说明部署坏了。

## 需要只读凭证 / 只读 SQL

| 检查项 | 期望 | 状态 |
| --- | --- | --- |
| 迁移已 applied | `supabase migration list --linked` 显示 001–034 全部 applied；`db push --linked --dry-run` 为空 | ⛔ 本机无 Supabase 凭据（`~/.supabase/access-token` 不存在），**发布前必须在有凭据处复核**——034 未 applied 而代码已部署会让 digest worker 抛错 |
| 队列语义（A05） | `notifications.email_skipped_reason` 列存在；`countEmailSkippedByReason` 能按 `EMAIL_SKIP_REASONS` 返回计数 | ⛔ 同上，需要 service-role 读权限 |
| `email.backlog` 趋势 | A05 落地后积压应**下降**（原先不可投递的行不再占队首） | ⏳ 需要部署后观察 |

## 需要隔离账号（本版本重点）

> **禁止用真实用户跑账户删除演练**：`auth.admin.deleteUser` 不可逆，
> 拿真实用户跑等于删数据。需要一个**可牺牲**的隔离账号。

| 检查项 | 期望 | 状态 |
| --- | --- | --- |
| B03 账户删除全链路 | 确认短语被服务端校验；`api_usage` 与本人邮箱的 `contact_messages` 消失；`audit_logs` 行仍在但 PII 键被清空；独占头像对象从 bucket 消失；被团队引用的封面保留；会话失效 | ⛔ **未闭合**——缺 `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` 与可牺牲账号。B03 是 `0.12.0` 刻意不打 tag 的唯一原因 |
| 租户数据隔离 | 账户 A 读不到账户 B 的项目/通知/上传元数据 | ⏳ 需专用测试账号/租户 |
| **回滚探针** | 上一版本（0.11.0，`commit=08dd6f17`）可恢复，数据库保持向前 schema、034 不逆向执行（见 `rollback-runbook-v0.12.0.md`「数据库向前兼容」） | ⛔ 尚未演练——需要一次真实的生产部署切换，本版本**不制造**该证据 |

## 发布前的外部依赖实况（2026-10-05T22:53Z 观测）

读数来自 `node scripts/check-health.js https://indie-stack-theta.vercel.app`
（权威出处是 `docs/operations/environments.md` 的「外部依赖实况」表）：

```
version=0.11.0 commit=08dd6f17d2c754db688b516934dcfdfeadaf9b8a ready=true
- supabase: required=true  configured=true  status=ok        reachable=true
- sentry:  required=false configured=false status=missing
- stripe:  required=false configured=false status=missing
allConfigured=false degraded=false
```

**发布后这三行应当变化**：若生产仍未变成 `version=0.12.0`，说明部署没落地，
去查 Vercel 构建配额（PR 的 Vercel 检查会直接写 `Deployment rate limited`）。

**发布后也不应变化的两件事**：`sentry` 与 `stripe` 仍是 `configured=false`——
本版本不配置这两项（需要外部凭据）。`ready=true` 而 `allConfigured=false` 是
**预期状态**：可选依赖缺失不会让就绪探针变红。

## 为什么这一版不能只跑自动化的 7 项

自动化 7 步全部无副作用且不需要任何凭据，但它**证明不了三件事**：

1. **迁移 034 在云端真的 applied 了**（自动化检查完全不碰数据库）；
2. **A05 的队列语义在真实数据上成立**（需要 service-role 读权限与观察窗口）；
3. **账户删除链路仍然正确**（B03，需要可牺牲账号）。

第 3 项的缺口正是 `0.12.0` **刻意不打 tag** 的原因：
tag 是对外声明「做完了」，而这一项没有证据。
**没有证据就等于没做**——所以这里留空，不抄上一版的记录。