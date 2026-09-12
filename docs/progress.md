# Project Progress

## 当前阶段

- 阶段：Passkey 完整登录闭环与发布验证
- 日期：2026-09-12
- 策略：本地连续开发、阶段完成后统一推送

## 已完成

- C01–C10、F01–F10
- A01–A10
- B01–B10
- E08、E10
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
- [x] Passkey → Supabase session bridge：一次性 magiclink 服务端消费、MFA aal2 衔接、四路由限流与 challenge 清理、中英双语登录入口

## 2026-09-12 可观测性与发布验证批次

- [x] E03 cron worker 指标：`cron.digest.completed` / `cron.digest.failed` 输出结构化耗时、拉取、发送、分组和失败数。
- [x] E04 邮件队列积压指标：每轮 digest 输出 `email.backlog`，阈值行为与 Sentry 异常告警保持并存。
- [x] E05 存储成功率指标：Supabase/OSS 每次上传输出 `storage.upload.completed` 与 `outcome`。
- [x] E06 provider fallback 指标：OSS 配置不完整时按缺失变量签名去重输出 `provider.fallback`；邮件和 Push 失败也输出结构化事件。
- [x] E07 告警阈值与去重：`docs/operations/sentry-alerts.md` 已记录指标契约、最小样本、聚合维度和恢复窗口。
- [x] D09 键盘导航与焦点回归：语言菜单支持 Enter 打开、Escape 关闭并归还焦点，`aria-current` 标识当前语言；共享 header 用户菜单补齐可访问名称。
- [x] D10 自动化 a11y 门禁：新增 `e2e/a11y.spec.ts`，使用 `@axe-core/playwright` 对首页、功能页、定价页、登录页、注册页执行 WCAG 2.1 A/AA 审计；5/5 通过。
- [x] i18n 文档对齐：默认语言修正为 `en`，命名空间更新为 18 个并补入 `actions`；`pnpm check:locales` 与 `pnpm check:i18n` 通过。
- [x] 发布文档收口：release runbook 和 checklist 加入 `pnpm smoke:production`、Production Smoke workflow 与 30 天 artifact 要求；`pnpm check:release-docs` 通过。

## 2026-09-12 Supabase 运行时证据与自动恢复兜底

- [x] `supabase/seed.sql` 重写为自包含、确定性、可重复执行：先建 `auth.users`（3 个 seed 账号）
      再写两个隔离团队、三个项目、订阅、邀请、API key、会话、审计、通知与 usage；修复了
      外键与 subscriptions 冲突目标导致的 seed 失败。`pnpm exec supabase start` 与
      `pnpm exec supabase db reset`（24 迁移 + seed）均真实执行成功。
- [x] 新增 `scripts/verify-supabase-identity.js`（`pnpm smoke:supabase-identity`）：真实 Auth +
      PostgREST + Storage API 的身份矩阵，覆盖 anon 不可见、A/B 租户隔离、私有项目不可读、
      avatars 前缀写/删权限与 service_role 跨前缀操作；2026-09-12T05:12:32Z 结果 **20/20 通过**，
      证据 `/tmp/indiestack-identity-matrix.json`。
- [x] 新增应用侧恢复兜底层 `/api/ops/supabase-restore` + Vercel Cron `0 4 * * *`：GitHub 在仓库
      静默 60 天后会停用 `schedule`，因此恢复不再只依赖 Actions；仅 `status=INACTIVE` 触发恢复，
      `CRON_SECRET` 鉴权，缺配置时生产返回 503（非生产安全跳过）；新增 24 个 lib 单测与 8 个路由测试。
- [x] 生产 smoke 重新执行：commit `16a285a`、部署
      `indie-stack-aqu77mjze-sun1090s-projects.vercel.app`，**6/6 通过**（2026-09-12T05:12:57Z）。
- [x] 文档对齐：`docs/db/security-audit.md`（真实矩阵替换过期描述）、`docs/testing.md`、
      `docs/operations/environments.md`、`docs/operations/production-smoke-v0.6.0.md`、
      `docs-site/{,zh-CN/}{deployment,configuration}.md`、README 双语测试计数。

## 验证

- 最近本地完整验证：通过（94 files / 853 tests；`pnpm verify:build` 通过；Playwright E2E 50/50 单 worker 通过；`pnpm check:all` 与 `pnpm test:coverage` 通过）
- 覆盖率：Statements 95.37%、Branches 90.68%、Functions 95.72%、Lines 96.64%，branches 门禁 90% 通过
- 安全/运维：`pnpm audit --audit-level high` 无已知漏洞；生产 `/api/health` 通过；Supabase auto-restore 手动 dry-run 确认项目健康且无需恢复
- CI：`0930c1f` 的 CI、CodeQL、Secrets Scan、Security/config checks 均通过（run 34669221490 等）

## 下一入口

下一入口：v0.6.0 无副作用门禁与本地运行时证据已闭环；剩余未验证项集中在本文件与
`docs/operations/production-smoke-v0.6.0.md` 中标注的生产有副作用场景（生产测试账号登录、
生产 dashboard 隔离、合法/非法上传、邮件/通知 provider、合法 Stripe webhook 幂等落库、
回滚切换演练），需要隔离账号或 provider 才能真实执行。

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
- 2026-09-12 更新：本机 Supabase 容器阻塞已解除（`pnpm exec supabase start` / `db reset` 成功），上一条的“身份矩阵尚未完成”已由 `pnpm smoke:supabase-identity` 20/20 运行时结果取代，见 [db/security-audit.md](./db/security-audit.md)。
- 2026-09-09：CI/聚合门禁接入 migration、Supabase security、repository security、release-docs 检查；`pnpm verify:all` 通过（763 tests）。`pnpm test:e2e` 通过（43/43）。
- 2026-09-12：完成 Passkey 登录会话桥接。assertion 与计数器更新成功后由服务端生成并立即消费一次性 magiclink token，通过 `@supabase/ssr` 下发会话 cookie；MFA 用户保留 aal2 跳转；token/action link/邮箱/userId 不出服务端，失败统一 503/400 并清理 challenge cookie。四路由补齐 10 次/分钟 IP 限流、`no-store` 和 flag 门控；新增 8 个契约测试。`verify:build`、E2E 43/43、coverage、audit 与生产 health 均通过。

## 2026-09-12 Supabase 保活/恢复生产收口

- [x] PR [#21](https://github.com/Sun1090/IndieStack/pull/21) 已合并到 `fbad20f`，功能分支已删除，合并后 `origin/main...HEAD` 为 `0/0`。
- [x] Vercel Production/Preview 已配置 `SUPABASE_ACCESS_TOKEN`、`SUPABASE_PROJECT_REF`、`CRON_SECRET`，三者均为 Secret（界面/CLI 不回显值）。
- [x] 三层保活/恢复链路已生效：Vercel `/api/health` 每日保活、Vercel `/api/ops/supabase-restore` 应用侧恢复、GitHub Actions 备份恢复。
- [x] 生产鉴权 no-op 验证通过：HTTP 200、`action=noop`、`projectStatus=ACTIVE_HEALTHY`、`checkedAt=2026-09-12T05:57:14.705Z`；未触发任何恢复写操作。
- [x] 应用功能提交 `fbad20f` 的生产部署 `dpl_7DvLfkEXQcKkjEDcYU8LjEnnL66J` READY，生产别名 `https://indie-stack-theta.vercel.app`；生产 smoke 6/6 通过，证据 `/tmp/indiestack-production-smoke-latest.json`。
- [x] GitHub Actions `Supabase auto-restore` 手动 dry-run 成功：run `34676894311`，配置校验与真实 Management API 检测均通过。
- [x] 修复保活误报：2026-09-12T06:30Z 的真实冷启动返回瞬时 `503 unreachable`，随后恢复健康。
      `health-check`、`supabase-auto-restore` 与 production smoke 现共用有限重试探测（3 次、间隔 5 秒），
      仅重试网络错误、5xx 和未就绪 body；404/401 与持续故障仍然失败。新增 6 个 health-probe
      回归测试，并扩展 production smoke 的瞬时 503 恢复用例。
- [x] 修复本地测试门禁抖动：Vitest 每项目限制 2 个 worker，Playwright 默认单 worker；logger 仅在生产环境
      异步加载 Sentry。完整 832 测试从超时 6 项恢复为 93/93 文件全部通过，`test:coverage` 同步通过。
- [x] 使用新版烟测逻辑复测生产：commit `527fa5d` 对应别名 `https://indie-stack-theta.vercel.app`，6/6 通过，证据 `/tmp/indiestack-production-smoke-20260912-new.json`。
- [x] 仓库开放 PR 0、开放 issue 0；Dependabot、Code Scanning、Secret Scanning 开放告警均为 0。

## 2026-09-12 瞬时报错重试与 Auth 配置即代码（PR #25 合并后收口）

- [x] 修复保活误报：`health-check`、`supabase-auto-restore`、production smoke 共用有限重试探测
      （3 次 / 5 秒；只重试网络错误、`408/425/429/5xx` 与未就绪 body，404/401 立即失败）；
      PR [#24](https://github.com/Sun1090/IndieStack/pull/24) 已合并为 `96a27a9`，
      main 上 CI / CodeQL / Secrets Scan / Security-config 全绿。
- [x] 修复本地测试抖动：Vitest 每项目 2 worker、Playwright 默认单 worker、logger 仅在生产异步加载
      Sentry；832 → 853 测试全部通过（94/94 文件）。
- [x] Auth 邮件模板与重定向白名单固化为可执行配置：`pnpm auth:email-config`
      （dry-run / `--apply` / `--verify`，支持 `--scope=templates|redirects|all`），
      新增 21 个回归测试，并接入 CI 漂移门禁（`security-config`，scope=redirects）；
      PR [#25](https://github.com/Sun1090/IndieStack/pull/25) 已合并为 `16f3b75`。
- [x] 生产重定向白名单已写入并回读校验：`ntqggnztzvoavjbiillb` →
      `http://localhost:3000/**,https://indie-stack-theta.vercel.app/**,https://*-sun1090s-projects.vercel.app/**,https://indie-stack-*.vercel.app/**`。
- [x] 发现并记录免费版硬限制：默认发件人下 Management API 拒绝改模板
      （`Email template modification is not available for free tier...`），且
      `rate_limit_email_sent = 2`（全项目每小时 2 封 Auth 邮件）。模板已就绪，待自定义 SMTP
      或升级套餐后执行 `pnpm auth:email-config -- --apply`。
- [x] PR #25 合并后的生产 smoke 补跑通过：commit `16f3b75`、生产别名
      `https://indie-stack-theta.vercel.app`，run [`34681676184`](https://github.com/Sun1090/IndieStack/actions/runs/34681676184)
      为 **6/6 通过**（health attempt 1，`generatedAt=2026-09-12T07:48:53.011Z`）；
      artifact `10293909831`、SHA256 `21cb9feb8a6b7b888d119bb4b50046b7b263c9399dc1a5a269598c154ff9793d`，
      保留至 `2026-10-12T07:48:53Z`。
- [x] 合并后 Supabase 自动恢复 dry-run 通过：run [`34681676066`](https://github.com/Sun1090/IndieStack/actions/runs/34681676066)
      检测项目健康，输出“无需恢复”，未触发任何恢复写操作。
- [x] 合并后 Post-deploy health check 最终通过：run
      [`34681965716`](https://github.com/Sun1090/IndieStack/actions/runs/34681965716) 为 `success`。
      此前两次手动 run 的输入把站点根地址当作 `health_url`，HTML 200 被严格 readiness 契约判为未就绪；
      改为完整 `https://indie-stack-theta.vercel.app/api/health` 并通过独立 `scripts/check-health.js` 复测后成功。

- [ ] 未执行真实“暂停后恢复”破坏性演练。生产测试账号登录、dashboard 租户隔离、合法/非法上传、邮件/通知 provider、合法 Stripe webhook 幂等落库、真实回滚 deployment 切换仍需隔离账号或 provider 才能验证。
