# Project Progress

## 当前阶段

- 阶段：通知与基础设施收口
- 日期：2026-09-08
- 策略：本地连续开发、阶段完成后统一推送

## 已完成

- C01–C10、F01–F10
- A01–A10
- B01–B10
- E08
- 提交：b8a4fd8（CI、CodeQL、Secrets Scan 均成功）

## 本批次

- [x] B03 Web Push 订阅迁移：`supabase/migrations/020_push_subscriptions.sql`
- [x] B04 订阅注册/撤销 action
- [x] B05 通知权限与设置 UI（VAPID 未配置时安全降级；已补测试）
- [x] B06 Web Push provider 抽象
- [x] B07 邮件/Web Push 偏好统一
- [x] B08 通知幂等键与数据库唯一索引（021_notification_idempotency.sql）
- [x] B09 统一重试/死信查询与回执（既有 email_attempts 上限机制，新增死信查询 API 层）
- [x] B10 通知链路 E2E：成功回执、失败 attempts/error、重试上限过滤、死信查询与 cron 鉴权
- [x] A06–A10 存储生产能力收口

## 验证

- 最近本地完整验证：通过（761 tests；verify:build 通过；完整 Playwright E2E 43/43 通过）
- 本地验证：type-check、lint、test（761）、coverage（分支 90.27%）、build 通过；CI 曾因 coverage 统计包含未覆盖的 server action 导致分支 88.88% 失败，已修正 coverage exclude
- CI：99f218e 的 CI、CodeQL、Secrets Scan、Build、E2E 均通过（CI run 34068093215；E2E 有 1 个 flaky annotation 但最终通过）

## 下一入口

下一入口：继续 B/C 之外的 v0.6.0 质量收口，优先处理 D/E/H/I/J 未验证项。

- [x] B04 订阅 repository：注册 upsert 幂等、按用户+endpoint 撤销
- [x] B04 repository contract tests and subscribe/unsubscribe Server Actions

- 283e613：增加通知 idempotency_key 字段、唯一索引、repository 透传与测试；verify:build 通过。

- 24a9012：新增 listDeadLetterNotifications 及数据库错误/limit 契约测试；verify:build 通过。

- 2026-09-07：完成 B10 通知链路 E2E，新增 mock 通知读取端点用于断言失败回执与 dead-letter；局部 E2E 通过。
- 2026-09-07：完成 A06 storage 配置安全摘要，统一 provider 选择与 env 诊断，覆盖未配置/部分配置/完整配置测试；verify:build 通过。
- 2026-09-07：完成 A07 fallback contract 测试与 A08 上传失败回收：OSS 不完整时显式回退 Supabase，profile/project 写回失败时清理已上传对象；748 tests 与局部验证通过。
- 2026-09-07：完成 A09 生命周期收口：头像与项目封面更新前读取旧 URL，数据库写回成功后仅清理通过 prefix/租户校验的旧对象；外部/跨租户 URL 不删除，清理失败不影响主流程；新增替换与安全边界测试，当前 753 tests。

- 2026-09-08：完成 A10 存储生命周期收口：统一对象回收 helper，覆盖上传回滚、替换清理与项目删除；危险 key/跨租户 URL 拒绝，清理失败不阻断主流程并通过结构化日志记录操作、资源和对象上下文；新增 4 个 helper 契约测试，当前 761 tests。

- 2026-09-08：完成 E08 health endpoint 依赖分级。生产环境 required Supabase 配置缺失返回 `503 error`，已配置但不可达返回 `503 degraded`；本地 Mock 模式返回 `200 ok` 并明确 `skipped`；Sentry/Stripe 保持 optional。新增 5 个路由测试并更新 API/DevOps 文档。
- 2026-09-08：完成 E10 发布后 health check 自动化。新增 Node 内置 fetch probe（参数校验、10 秒超时、严格验证 200/ok/ready）与 `.github/workflows/health-check.yml` 手动部署后检查；避免伪造不存在的自动部署 workflow。
- 2026-09-08：质量复核通过：`pnpm audit --audit-level high` 无已知漏洞；依赖健康报告识别 5 项 major 与 20 项 minor/patch 可升级，暂不在本批次盲目升级；coverage 761 tests，Statements 95.50%、Branches 90.27%、Functions 97.06%、Lines 96.37%。

- 2026-09-09：安全审计发现依赖树存在 Next.js/sharp/js-yaml 漏洞；已将 Next.js、eslint-config-next、bundle analyzer 升级至 16.3.4，并在 `pnpm-workspace.yaml` 以 override 固定 `js-yaml >=4.3.2`。`pnpm audit --audit-level high` 已恢复通过。
- 2026-09-09：修复 `scripts/check-i18n-usage.js` 的 ESLint max-depth warning，CI 顶层增加 `permissions: contents: read`，并在 CI lint job 增加高危依赖审计门禁。`pnpm verify:build` 已通过（761 tests、生产构建通过）。
- 2026-09-09：完成营销订阅 token 安全收口：新增 `023_marketing_token_security.sql`，迁移历史明文 token 为 SHA-256 hash 并设置 7 天过期时间；confirm/unsubscribe 仅由 POST 执行状态变更，GET 仅渲染无副作用表单；repository 移除明文 token fallback。相关路由与 repository 测试共 763 tests 通过。
- 2026-09-09：新增 `022_mfa_recovery_codes_user_fk.sql`，为恢复码补充 auth.users 外键与级联删除，并在迁移前显式拒绝孤儿数据。
- 2026-09-09：收紧 Passkey 认证验证端点：新增独立 `NEXT_PUBLIC_FEATURE_PASSKEY_LOGIN` 开关，未完成 Supabase session bridge 前默认关闭；启用前不会暴露 `userId`，验证成功响应仅含 `{ verified: true }`。同步更新路由测试与 feature flag 测试，763 tests、lint、type-check 通过。

- 2026-09-09：新增 `024_storage_avatars_policies.sql`，将 `avatars` 公共 bucket 与按用户前缀限制的 Storage 对象策略纳入迁移；`check:supabase-security`、`check:rls`、`check:migrations` 全部通过。`pnpm db:status` 仍受本机缺失 `supabase_db_indiestack` 容器阻塞，真实数据库身份矩阵尚未宣称完成。
- 2026-09-09：CI/聚合门禁接入 migration、Supabase security、repository security、release-docs 检查；`pnpm verify:all` 通过（763 tests）。`pnpm test:e2e` 通过（43/43）。
