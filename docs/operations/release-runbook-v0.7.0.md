# v0.7.0 发布 Runbook

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

回滚操作见：[rollback-runbook-v0.7.0.md](./rollback-runbook-v0.7.0.md)。

## v0.7.0 发布差异

相对 v0.6.0，本版本的入口条件与步骤不变，但需要额外确认：

1. **Web Push 凭证**：部署前必须设置 `NEXT_PUBLIC_VAPID_PUBLIC_KEY`、`VAPID_PRIVATE_KEY`；
   缺失时 provider 保持 `configured=false`，设置页显示“未配置”并跳过推送，不会伪造投递成功。
   可用 `pnpm exec web-push generate-vapid-keys` 生成一次密钥对并长期复用。
2. **HTTPS 要求**：`NEXT_PUBLIC_APP_URL` 在生产必须是 HTTPS；非 HTTPS 时适配器回退到
   `mailto:support@indiestack.dev` 作为 VAPID subject，且浏览器只在安全上下文暴露 PushManager。
3. **迁移范围**：本版本不新增迁移（最新仍为 `025_notifications_realtime.sql`）；H09 门禁要求
   已基线化迁移不可改写，因此发布前必须让 `pnpm check:migrations` 与 `pnpm check:migration-history` 通过。
4. **已知限制**：Web Push 为即时 best-effort 投递，没有持久化重试队列或死信表；瞬时失败只写日志与
   `push.send.failed` 指标，站内通知始终是事实来源。该限制必须在 Release Notes 中保留。
