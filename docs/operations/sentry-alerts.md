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
| `email.send.completed` | `ms` | `provider`, `outcome`, `status` | 每次 Resend 调用结束 |
| `email.backlog` | `count` | 无 | 每轮 digest 开始 |
| `cron.digest.completed` | `ms` | `pulled`, `sent`, `groups`, `failed` | 每轮 digest 成功结束（含空队列） |
| `cron.digest.failed` | `count` | `error_type` | 每轮 digest 未处理异常 |
| `storage.upload.completed` | `ms` | `provider`, `outcome` | 每次对象写入结束 |
| `provider.fallback` | `count` | `provider`, `reason`, `missing` | OSS 配置不完整并回退 Supabase |
| `push.send.failed` | `count` | `provider`, `reason` | Web Push 未配置或适配器不可用 |

指标会丢弃名称为敏感维度的字段（如 `token`、`secret`、`email`、`userId`），并截断过长值；业务代码不得把 URL、邮箱正文或凭据放进 attributes。

## 建议指标告警与去重

| 规则 | 条件（生产环境） | 处置 |
|---|---|---|
| Digest 连续失败 | `cron.digest.failed > 0`，5 分钟窗口 | 立即排查 cron 鉴权、Supabase 与邮件 provider |
| 邮件积压 | `email.backlog > 500`，连续 3 轮或 15 分钟 | 检查 worker、provider 限流与死信增长 |
| 邮件失败率 | `email.send.completed{outcome=failure}` 占比 > 2%，10 分钟且样本 ≥20 | 检查 Resend 状态与响应码 |
| 上传失败率 | `storage.upload.completed{outcome=failure}` 占比 > 5%，15 分钟且样本 ≥20 | 检查 Storage 权限、配额与 provider 状态 |
| 配置回退 | `provider.fallback > 0`，15 分钟窗口 | 补齐 OSS 配置或明确保持 Supabase |
| Push 不可用 | `push.send.failed > 0`，15 分钟窗口 | 检查 VAPID 与适配器发布状态 |

去重规则：

- `cron.digest.completed`、`email.backlog` 和 `cron.digest.failed` 每轮最多一条；不要按通知条数放大告警。
- `provider.fallback` 在单个进程内按缺失变量签名去重。Serverless 冷启动可能跨实例重复，日志平台应再按 `name + attributes.reason + attributes.missing` 聚合，并设置至少 30 分钟恢复窗口。
- 所有比率告警都设置最小样本量，避免低流量误报；阈值变更须在发布记录中说明并观察一个完整业务周期。
