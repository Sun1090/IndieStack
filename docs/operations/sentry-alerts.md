# Sentry 告警配置指南

> 代码侧已完成 Sentry 集成（client/server/edge 三端，见 `sentry/` 目录）。
> 本文档列出建议在 Sentry Dashboard 手动配置的告警规则（告警规则无法用代码管理）。

## 推荐告警规则

| 规则 | 条件 | 通知渠道 | 说明 |
|------|------|----------|------|
| 错误激增 | 1 小时内 issue 事件数 > 50 | 邮件 + Slack | 可能是线上事故 |
| 新高优错误 | level >= error 且首次出现 | 邮件 | 新引入的回归 |
| 支付链路错误 | 标签 `url:*stripe*` 或 message 含 "Stripe Webhook" | 即时通知 | 支付同步失败直接影响收入 |
| 认证失败率 | `/api/auth` 路由 5xx > 10/小时 | 邮件 | Supabase 连接异常信号 |
| Middleware 崩溃 | transaction 含 "middleware" 的 crash | 即时通知 | 全站不可用级别 |

## 配置路径

1. Sentry Dashboard → 项目 → **Alerts** → Create Alert
2. 选择 **Issue Alerts**（错误聚合）或 **Metric Alerts**（速率阈值）
3. 按上表设置条件与动作（Slack 集成需先在 Settings → Integrations 绑定）

## 环境区分

- 代码通过 `SENTRY_ENVIRONMENT` 区分 production / preview
- 建议告警仅绑定 **production** 环境，preview 环境静默收集

## 与 CI 的关系

- Source maps 由 `pnpm sentry:sourcemaps` 上传（部署后执行）
- Release 版本号取自 `NEXT_PUBLIC_APP_VERSION` / package.json version

## 结构化业务指标

应用通过 `src/lib/metrics.ts` 输出单行 JSON，不依赖 Sentry SDK。日志平台可按 `type=metric` 提取；Sentry 可通过日志/指标集成消费同一批事件。

```json
{"type":"metric","name":"email.send.completed","value":183,"unit":"ms","attributes":{"provider":"resend","outcome":"success","status":200},"timestamp":"2026-09-12T00:00:00.000Z"}
```

当前指标契约：

| 指标 | 单位 | 维度 | 采集时机 |
|---|---|---|---|
| `email.send.completed` | `ms` | `provider`, `outcome`, `status`, `reason` | 每次 Resend 调用结束；provider 未配置时不发起请求，立即以 `reason=not-configured` 结束 |
| `email.backlog` | `count` | 无 | 每轮 digest 开始 |
| `cron.digest.deferred` | `count` | 无 | 每轮 digest 结束；被错峰窗口跳过、本轮不发送的通知条数 |
| `cron.digest.completed` | `ms` | `pulled`, `sent`, `groups`, `failed`, `deferred` | 每轮 digest 成功结束（含空队列） |
| `cron.digest.failed` | `count` | `error_type` | 每轮 digest 未处理异常 |
| `cron.auth.rejected` | `count` | `worker`, `reason` | 任一 cron worker 返回 401（`secret_unconfigured` / `missing_credentials` / `invalid_credentials`） |
| `storage.upload.completed` | `ms` | `provider`, `outcome` | 每次对象写入结束 |
| `upload.request.completed` | `ms` | `operation`, `outcome` | 每次上传请求结束（成功 / 失败 / 取消） |
| `provider.fallback` | `count` | `provider`, `reason`, `missing` | OSS 配置只填了一部分并回退 Supabase（`missing` 是按字母排序的缺失变量名，如 `OSS_BUCKET,OSS_REGION`） |
| `push.send.completed` | `count` | `provider`, `status_code` | 每次 Web Push 传输成功 |
| `push.send.failed` | `count` | `provider`, `reason` | Web Push 未配置或适配器不可用 |
| `push.endpoint.revoked` | `count` | `reason`, `channel` | 404/410 或订阅记录缺失导致端点撤销 |
| `push.delivery.dead` | `count` | `reason`, `channel` | 单条 Push 投递进入死信 |
| `push.backlog` | `count` | 无 | 每轮 push-retry cron 开始 |
| `push.queue.pruned` | `count` | `status`, `retention_days` | 每轮 push-retry 清理过期 `sent` / `dead` 行 |
| `push.queue.prune_failed` | `count` | `error_type` | 每轮 push-retry 保留策略清理失败 |
| `cron.push-retry.completed` | `ms` | `pulled`, `sent`, `retried`, `dead`, `revoked` | 每轮 push-retry 成功结束 |
| `cron.push-retry.failed` | `count` | `error_type` | 每轮 push-retry 未处理异常 |
| `cron.retention.completed` | `ms` | `ran`, `failed` | 每轮 retention 结束（含部分失败），`ran`/`failed` 是清理函数的成功/失败个数 |
| `cron.retention.cleanup_failed` | `count` | `cleanup_function` | 单个保留期清理函数失败，其余函数继续执行 |
| `cron.retention.failed` | `count` | `error_type` | 每轮 retention 未处理异常 |
| `storage.orphan.objects` | `count` | 无 | 每轮 retention 顺带的只读孤儿巡检：`status='active'` 且已无任何业务引用的托管对象数 |
| `storage.orphan.unowned` | `count` | 无 | 同上其中**上传者账户已删除**的部分——这是隐私面（对象仍公开可读），不是容量问题 |
| `ops.supabase.restore` | `count` | `action`, `projectStatus` | 每轮兜底恢复检查结束；`action` ∈ `noop`/`restore`/`wait`/`escalate`/`skipped`，每个终态恰好一条 `value=1` 样本（`projectStatus` 未知时为 `unknown`） |

两层上传指标分工明确：`storage.upload.completed` 只覆盖 provider 的对象写入，反映 OSS/Supabase 自身健康度；
`upload.request.completed` 覆盖整条链路（provider 写入 → 元数据回写 → 失败回滚），因此「写入成功但元数据回写失败并已回滚」
这类用户可见失败只出现在后者。两者的指标名与维度取值都来自 `src/lib/observability/storage-metrics.ts`，不要在调用点手写字面量。

`ops.supabase.restore` 是**每轮计数**而不是状态位：早期实现把 `action=restore` 写成 1、其余写成 0，导致 `escalate`/`skipped` 的样本值恒为 0，按「计数 > 0」配置的告警永远不会触发；配置缺失与状态查询失败更是直接返回、一条样本都不产生。现在所有终态都经由 `src/lib/observability/ops-metrics.ts` 上报 `value=1`，用 `action` 维度区分正常轮次与故障轮次。

指标会丢弃名称为敏感维度的字段（如 `token`、`secret`、`email`、`userId`），并截断过长值；业务代码不得把 URL、邮箱正文或凭据放进 attributes。

## Cron 调度契约

`vercel.json` 的 `crons` 与 worker 注册表（`src/lib/observability/cron-contract.ts`）必须逐字一致，
由 `pnpm check:cron-contract` 强制：登记了却没调度、调度了却没登记、表达式写错或漂移都会失败。

| 路径 | 调度（UTC） | 语义 | 失败告警 |
|---|---|---|---|
| `/api/cron/digest` | `0 9 * * *` | 每天 09:00 UTC 拉取待发邮件，按用户本地时间错峰发送摘要；Vercel Hobby 每天最多一次 | `cron.digest.failed`、`cron.digest.deferred`、`email.backlog` |
| `/api/cron/push-retry` | `0 22 * * *` | 每天 22:00 UTC 重试待投递 Push 并清理保留期外的终态行；Vercel Hobby 每天最多一次 | `cron.push-retry.failed`、`push.backlog` |
| `/api/cron/retention` | `0 5 * * *` | 每天 05:00 UTC 逐个执行迁移里定义的保留期清理函数（不依赖 pg_cron），并顺带只读巡检存储孤儿；Vercel Hobby 每天最多一次 | `cron.retention.failed`、`cron.retention.cleanup_failed`、`storage.orphan.unowned` |

平台级调度不走 worker 契约（无队列、无 worker 指标），在注册表里显式豁免：
`/api/health`（`0 2 * * *` 保活）与 `/api/ops/supabase-restore`（`0 4 * * *` 兜底恢复）。

调度表达式必须部署前核对：`0 25 * * *` 之类的非法表达式会被平台接受但永不触发，
因此 `pnpm check:cron-contract` 会先校验 5 字段语法再比对注册表。
`CRON_SECRET` 缺失时平台调用会得到 401 并产出 `cron.auth.rejected{reason="secret_unconfigured"}`，
这是「调度在跑但鉴权没配对」的唯一信号。

## 建议指标告警与去重

| 规则 | 条件（生产环境） | 处置 |
|---|---|---|
| Digest 连续失败 | `cron.digest.failed > 0`，5 分钟窗口 | 立即排查 cron 鉴权、Supabase 与邮件 provider |
| 邮件积压 | `email.backlog > 500`，连续 3 轮或 15 分钟 | 检查 worker、provider 限流与死信增长 |
| 摘要全部落在错峰窗口外 | `cron.digest.deferred` 等于本轮 `pulled` 且 `sent=0`，连续 2 轮 | 平台 cron 每天只跑一次，只能命中「本地 08:00 恰好在该 UTC 时刻」的时区带；持续成立说明当前调度与错峰门控不匹配，见 `docs-site/email.md` 的窗口说明与退出报告遗留项 |
| 邮件失败率 | `email.send.completed{outcome=failure}` 占比 > 2%，10 分钟且样本 ≥20 | 检查 Resend 状态与响应码 |
| 邮件 provider 未配置 | `email.send.completed{reason="not-configured"} > 0`，15 分钟窗口 | 补部署环境的 `RESEND_API_KEY`；该类样本不带 `status`，说明请求根本没发出去 |
| provider 写入失败率 | `storage.upload.completed{outcome=failure}` 占比 > 5%，15 分钟且样本 ≥20 | 检查 Storage 权限、配额与 provider 状态 |
| 上传请求失败率 | `upload.request.completed{outcome=failure}` 占比 > 10%，30 分钟且样本 ≥20 | 用户可见失败：先按 `operation` 维度拆分，再查结构化错误日志区分鉴权/校验拒绝与存储故障（`cancelled` 不计入分子与分母） |
| 配置回退 | `provider.fallback > 0`，15 分钟窗口 | 补齐 OSS 配置或明确保持 Supabase |
| Push 不可用 | `push.send.failed > 0`，15 分钟窗口 | 检查 VAPID 与适配器发布状态 |
| Push 重试 worker 失败 | `cron.push-retry.failed > 0`，5 分钟窗口 | 立即排查 `CRON_SECRET`、Supabase 与 VAPID 配置 |
| Push 队列积压 | `push.backlog > 500`，连续 3 轮或 15 分钟 | 检查 push service、worker 执行时长和死信增长 |
| Push 失效端点激增 | `push.endpoint.revoked > 10`，1 小时窗口 | 检查浏览器订阅生命周期与 push service 状态码 |
| Push 死信激增 | `push.delivery.dead > 20`，1 小时窗口 | 按 `reason` 区分瞬时上游故障与永久配置问题 |
| Push 队列清理失败 | `push.queue.prune_failed > 0`，15 分钟窗口 | 检查 Supabase 删除权限、连接与表锁；投递不受影响但队列会继续增长 |
| 保留期清理部分失败 | `cron.retention.cleanup_failed > 0`，24 小时窗口 | 按 `cleanup_function` 定位是哪张表：查 service_role 执行权限与连接；其余表照常清理，过期行留到下一轮 |
| 保留期清理整轮失败 | `cron.retention.failed > 0`，或 `/api/cron/retention` 在平台调度记录里返回 500，立即 | 保留期已全面不生效（隐私承诺开始失真）：查 Supabase 连接、迁移是否应用、028/032 的撤权是否变更 |
| 存储孤儿出现 | `storage.orphan.objects > 0`，24 小时窗口 | 跑 `pnpm audit:storage-orphans`（只读）取清单，按 bucket 分组与最老天数判断是否需要补删 |
| 已删账户的对象仍公开可读 | `storage.orphan.unowned > 0`，立即 | 隐私面而非容量面：账户删了、对象还在 bucket。先回溯删号时的 provider 删除失败日志，再补删该清单 |
| 兜底恢复执行 | `ops.supabase.restore{action="restore"} > 0`，立即 | 记录恢复时刻；再回溯保活为何失效（`/api/health`、GitHub Actions 探测是否中断） |
| 兜底层需要人工介入 | `ops.supabase.restore{action="escalate"} > 0`，立即 | 状态查询失败 / 恢复调用失败 / 不可恢复状态；按 `projectStatus` 与结构化错误日志定位 |
| 兜底恢复被跳过 | `ops.supabase.restore{action="skipped"} > 0`，立即 | 生产环境缺 `SUPABASE_ACCESS_TOKEN` 或 `SUPABASE_PROJECT_REF`/`NEXT_PUBLIC_SUPABASE_URL`，兜底层已静默失效 |
| Cron 鉴权持续被拒 | `cron.auth.rejected{reason="secret_unconfigured"} > 0` 立即；`reason` 为 `missing_credentials` / `invalid_credentials` 连续 3 轮 | 先补/轮换部署环境的 `CRON_SECRET`，再确认调度器是否携带 `Authorization: Bearer` |

去重规则：

- `cron.digest.completed`、`cron.digest.deferred`、`email.backlog`、`cron.digest.failed`、`push.backlog` 和
  `cron.push-retry.completed|failed` 每轮最多一条；`push.queue.pruned` 每轮按 `status` 最多两条，
  不要按删除行数放大告警。
- `cron.auth.rejected` 按 `worker + reason` 聚合，且设置 15 分钟抑制窗口：该计数在鉴权失败时
  由未通过鉴权的调用方触发，不排除外部扫描流量，**不要**按原始条数直接报警（会变成噪声），
  只用于区分「鉴权配置坏了」与「调度没跑」。
- `provider.fallback` 在单个进程内按缺失变量签名去重（签名是排序后的缺失变量名列表，因此不随配置书写顺序变化）：同一签名只上报一次，
  缺失集合变化（例如从缺三项变成缺两项）重新上报，配置补齐后重置，之后再次降级仍会上报。
  Serverless 冷启动可能跨实例重复，日志平台应再按 `name + attributes.reason + attributes.missing` 聚合，并设置至少 30 分钟恢复窗口。
  注意「OSS 四项全空」是默认驱动而非降级，永远不会出现在这条指标里——只有「想用 OSS 却配了一半」才告警。
- `ops.supabase.restore` 每轮恰好一条样本，按 `action` 上报（`noop` 是常态，不要对它告警）；`value` 恒为 `1`，只用 `action` 分流，禁止再按 `value` 的 0/1 判断故障。该指标每轮最多一条、平台级 cron 每天一轮，本身不需要抑制窗口：只对 `restore`/`escalate`/`skipped` 三类稀疏动作告警，同一动作连续多天出现时按天聚合计数，避免把「一天恢复一次」当成持续事故。
- `email.send.completed{reason="not-configured"}` 属于配置缺陷而不是上游故障：它会按每封邮件尝试计数（摘要轮次里可能一次几十条），
  只用于「provider 没配上」的即时可见性，告警规则按 `provider + reason` 聚合，不要用它与上游失败率共用同一抑制策略。
- 所有比率告警都设置最小样本量，避免低流量误报；阈值变更须在发布记录中说明并观察一个完整业务周期。
