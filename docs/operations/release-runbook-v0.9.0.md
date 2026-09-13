# v0.9.0 发布 Runbook

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

回滚操作见：[rollback-runbook-v0.9.0.md](./rollback-runbook-v0.9.0.md)。

## v0.9.0 发布差异

相对 v0.8.0，本版本的入口条件与步骤不变，但需要额外确认：

1. **新增五个迁移**：`027_email_worker_runs_retention.sql`、`028_revoke_security_definer_execute.sql`、
   `029_audit_logs_write_lockdown.sql`、`030_webhook_event_idempotency.sql`、`031_upload_objects.sql`。
   全部为**追加式**：新增表/列、新增约束、新增或删除策略、收回权限。发布前必须让 `pnpm check:migrations`
   与 `pnpm check:migration-history` 通过；026 及更早的基线不可改写。
2. **回填迁移 027 依赖 `pg_cron`（可选）**：`cleanup_old_email_worker_runs()` 的定时任务带守卫，
   未安装 `pg_cron` 的环境自动跳过，函数本身仍可由 service_role/定时器手动调用。
3. **权限收口需要一次性核对**：`028` / `029` 收回 `PUBLIC` / `anon` / `authenticated` 的 `EXECUTE`
   与 `audit_logs` 写权限。上线后立刻用 `pnpm check:supabase-security` 与
   `pnpm smoke:supabase-identity` 核对生产目录，确认客户端 `rpc` 与匿名写路径已关闭，
   且服务端 `service_role` 路径未受影响。
4. **`webhook_events` 幂等改为租约模型**：迁移 `030` 把唯一键收窄为 `(provider, event_id)` 并新增
   `attempts` / `last_attempt_at`。Stripe webhook 现在依赖 `claim_webhook_event()` 原子占位，
   旧代码与新 schema 不兼容：**必须先应用迁移再部署新代码**，回滚时先回滚代码、保留 schema。
5. **上传路径语义变化**：迁移 `031` 之后，上传成功需要元数据写入成功。缺少 `upload_objects`
   表会让每次上传返回 `uploadFailed`（失败封闭），部署顺序不能反。
6. **保活与 cron 不变**：`CRON_SECRET`、VAPID 密钥对、HTTPS 生产域名、Supabase 免费版保活/恢复
   仍是既有前置条件，本版本未新增 cron 路由。
7. **观察窗口新增项**：除 v0.8.0 的 health/5xx/Sentry 外，额外观察 `upload_objects` 写入是否随
   上传 1:1 增长、`webhook_events` 是否出现重复 `received` 行，以及 postgrest 是否返回新的权限错误。
