# v0.6.0 发布 Runbook

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
```

所有命令必须有保存的输出；任一失败即停止，不得以修改清单状态替代修复。

## 发布步骤

1. **冻结范围**：确认 CHANGELOG 的版本、迁移列表、环境变量变更和已知限制；由第二位审查者复核 migrations、workflows、认证和 storage 变更。
2. **构建制品**：从目标 commit 的干净 checkout 构建；记录 Node/pnpm 版本、构建日志和制品摘要。
3. **数据库先行**：执行迁移并保存迁移日志。只允许向前兼容的 schema 变更进入本版本；破坏性变更必须拆分到后续版本。
4. **部署应用**：部署同一 commit SHA，不在平台 UI 临时修改代码或环境变量。
5. **健康检查**：运行 `pnpm health:check -- <url>`（或使用 `.github/workflows/health-check.yml`），验证 `/api/health`、版本、关键依赖状态和安全响应头。
6. **生产冒烟**：匿名首页、登录回调、受保护 dashboard、上传失败路径、通知/邮件 provider fallback 各执行一次；不使用真实用户数据。
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

回滚操作见：[rollback-runbook-v0.6.0.md](./rollback-runbook-v0.6.0.md)。
