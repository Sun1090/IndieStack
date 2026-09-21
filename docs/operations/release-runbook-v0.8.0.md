# v0.8.0 发布 Runbook

> 目的：把发布从“打 tag”变成可审计、可暂停、可回滚的操作。本文是操作手册，不代表发布已完成。

## 发布前入口条件

发布负责人必须在发布记录中填写 commit SHA、目标环境、操作者和时间。不得从有未提交变更的工作树发布。

```bash
git status --short
git fetch origin --prune
git rev-parse HEAD
pnpm verify:build
pnpm test:e2e
pnpm audit --audit-level high
pnpm check:release-docs
pnpm check:migrations            # 离线：迁移命名/顺序/SHA-256 校验和
pnpm check:migration-history     # 本地 Supabase 迁移历史（需先 `pnpm exec supabase start`）
```

所有命令必须有保存的输出；任一失败即停止，不得以修改清单状态替代修复。

## 发布步骤

1. **冻结范围**：确认 CHANGELOG 的版本、迁移列表、环境变量变更和已知限制；由第二位审查者复核 migrations、workflows、认证和 storage 变更。
2. **构建制品**：从目标 commit 的干净 checkout 构建；记录 Node/pnpm 版本、构建日志和制品摘要。
3. **数据库先行**：先确认迁移历史一致——本地运行 `pnpm check:migration-history` 必须通过（pending 或数据库独有的版本都会失败），对 linked/生产环境用带显式凭据与审批的只读 `supabase migration list` 复核后再执行迁移，并保存迁移日志。已基线化的迁移不可改写，只能追加前向迁移；破坏性变更必须拆分到后续版本。
4. **部署应用**：部署同一 commit SHA，不在平台 UI 临时修改代码或环境变量。
5. **健康检查**：运行 `pnpm health:check -- <url>`（或使用 `.github/workflows/health-check.yml`），验证 `/api/health`、版本、关键依赖状态和安全响应头。
6. **生产冒烟**：执行 `pnpm smoke:production -- "$PRODUCTION_URL" --expected-version "$EXPECTED_APP_VERSION" --output production-smoke.json`（或触发 `.github/workflows/production-smoke.yml`）验证 health、公共页面、静态资源、匿名 dashboard 跳转、安全头和无效 webhook；需要登录、上传、邮件或合法 webhook 的场景在隔离测试账号/provider 中另行执行。不得使用真实用户数据。
7. **观察窗口**：至少观察 15 分钟错误率、5xx、延迟、队列积压、Sentry 新事件和数据库迁移错误。仅在指标稳定后发布公告并创建 tag。

## 停止条件

出现以下任一项立即停止发布并进入回滚判断：health 失败、5xx 持续上升、认证失败、迁移错误、关键队列积压、数据写入异常、依赖 provider 大面积失败或无法证明部署 commit 与验证 commit 相同。

## 发布记录模板

- 版本 / tag：
- commit SHA：
- 数据库迁移：
- 构建与 E2E 证据路径：
- 冒烟开始/结束时间（含时区）：
- 观察指标及基线：
- 操作者 / 审查者：
- 结果：成功 / 暂停 / 回滚
- 未解决风险与后续 issue：

回滚操作见：[rollback-runbook-v0.8.0.md](./rollback-runbook-v0.8.0.md)。

## v0.8.0 发布差异

相对 v0.7.0，本版本的入口条件与步骤不变，但需要额外确认：

1. **新增迁移**：本版本新增 `026_push_delivery_attempts.sql`（纯新增表，不改动既有列）。发布前必须让
   `pnpm check:migrations` 与 `pnpm check:migration-history` 通过；迁移只能追加，不可改写 025 及更早的基线。
2. **新 cron 任务**：`vercel.json` 新增 `/api/cron/push-retry`（`0 22 * * *`，受 Vercel Hobby 每日一次限制约束）。部署平台必须存在
   `CRON_SECRET`，否则该路由与 digest/restore 一样返回 401；Vercel Cron 会自动附加
   `Authorization: Bearer`。缺少 `CRON_SECRET` 时推送重试不会执行，pending 行会在队列中累积。
3. **VAPID 凭证**：与 v0.7.0 相同，必须设置 `NEXT_PUBLIC_VAPID_PUBLIC_KEY`、`VAPID_PRIVATE_KEY`。
   worker 在 provider 未配置时整轮快速失败（不把队列静默转死信），并在 Sentry 记录
   `cron.push-retry.failed`。
4. **HTTPS 要求**：`NEXT_PUBLIC_APP_URL` 在生产必须是 HTTPS，非 HTTPS 时适配器回退到
   `mailto:support@indiestack.dev` 作为 VAPID subject，且浏览器只在安全上下文暴露 PushManager。
5. **队列积压告警**：`push.backlog` 阈值 500，超过时 Sentry 报 `push_backlog_threshold_exceeded`。
   观察窗口需一并检查 `push.delivery.dead`、`push.endpoint.revoked` 与 `cron.push-retry.*`。
6. **语义变化**：Push 不再是即时 best-effort，而是**at-least-once** 投递。极端情况下（进程在回执前崩溃）
   同一端点可能重复收到通知；站内通知仍是唯一事实来源，客户端需保持按 `idempotencyKey` 幂等。
7. **队列保留策略**：push-retry worker 每轮清理超过 7 天的 `sent` 与超过 30 天的 `dead`，每个状态最多
   1000 行，`pending` 永不清理。成功时响应含 `pruned: { sent, dead }`；清理失败返回 `pruned: null`
   并上报 `push.queue.prune_failed`，但不应把当轮投递结果误判为失败。观察窗口需确认清理计数和
   `push.queue.pruned{status,retention_days}` 正常上报。
