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
