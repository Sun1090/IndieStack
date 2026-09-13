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

## 2026-09-12 依赖安全刷新

- [x] 升级 11 个 minor/patch 依赖：React / React DOM 与对应类型到 `19.3.0`，
      Sentry `10.74.0`、Stripe server `22.6.2` / client `9.16.0`、next-intl `4.14.3`、
      lucide-react `1.44.0`、Zod `4.6.2`、`@types/node` `22.20.2`。
- [x] `pnpm dep:health` 确认无剩余可安全直接升级的 minor/patch；仅保留需要独立迁移验证的
      ESLint 10 与 TypeScript 7 两个 major 候选。
- [x] 验证通过：`pnpm peers check`、`pnpm check:all`（94 files / 853 tests）、
      `pnpm test:coverage`（statements 95.37% / branches 90.68% / functions 95.72% /
      lines 96.64%）、`pnpm test:e2e`（50/50）、`pnpm verify:build` 与
      `pnpm audit --audit-level high`（无已知漏洞）。

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

## 2026-09-12 G08/G09 上传闭环与通知实时刷新

- [x] G08 上传进度与取消：头像/项目封面使用同源 XHR `/api/uploads/*`，读取真实
      `xhr.upload.onprogress` 并支持 `abort()`；Route Handler 与 Server Action 共用
      `src/lib/uploads/service.ts`，保留鉴权、MIME/文件头/大小校验、元数据回写失败回滚和旧对象清理。
      新增 service/client/request/Route/组件测试与头像 E2E 进度/取消闭环。
- [x] G09 通知实时刷新：`NotificationsLive` 订阅当前用户的 `public.notifications` INSERT，
      120ms 合并 `router.refresh()`，显示 `connecting/live/offline` 并安全降级；错误 `user_id`
      事件不会刷新，新通知无需手动 reload 即出现。
- [x] `025_notifications_realtime.sql` 真实重建证据：2026-09-12 执行 `pnpm exec supabase start`
      与 `pnpm exec supabase db reset`，25 个迁移和 seed 全部成功；查询
      `pg_publication_tables` 返回
      `supabase_realtime|public|notifications`，`schema_migrations` 计数为 25。
- [x] 修复 `EmptyState` 实际服务端边界缺陷：移除无状态展示组件的 `"use client"`，避免服务端页面
      传递 Lucide 图标函数时触发 RSC 序列化错误；该问题由通知页真实 E2E 首次暴露。
- [x] 静态/Mock 定向验证：`pnpm check:migrations`、`pnpm check:locales`、`pnpm check:i18n`、
      `pnpm check:security`、`pnpm check:supabase-security` 均通过；Realtime 组件测试 3/3、
      定向 E2E 1/1 通过。
- [x] 完整门禁：`pnpm verify:build` 通过（100 files / 899 tests；bundle 2761.5 kB，
      基线 2733.8 kB；生产构建 23/23 静态页生成）；`pnpm test:coverage` 为
      statements 95.35% / branches 90.62% / functions 96% / lines 96.5%；
      `pnpm test:e2e` 52/52 单 worker 通过；`pnpm check:all` 全部通过；
      `pnpm audit --audit-level high` 无已知漏洞。

- [ ] 未执行真实“暂停后恢复”破坏性演练。生产测试账号登录、dashboard 租户隔离、合法/非法上传、邮件/通知 provider、合法 Stripe webhook 幂等落库、真实回滚 deployment 切换仍需隔离账号或 provider 才能验证。

## 2026-09-12 G10 视觉回归基线

- 状态：DONE
- 工作分支：codex/visual-regression-baseline（沿用既有任务分支；项目约定 `feat/*`）
- PR：none
- PR 状态：none
- Base：origin/main@15b05ebe8e93725e16698e8b66fc9c43e3733965（`git fetch --prune origin` 后 base 未前进，无需 rebase）
- 远端 Head：none（LOCAL_ONLY 模式，未推送）
- 本地提交：dd38cd73（`test(e2e): add visual regression baselines for public pages`）、b93211e（`docs(changelog): record G10 visual regression baselines`）
- 目标：为关键公共页建立可复现的视觉回归基线，并在 CI 中拦截非预期 UI 回归。
- 已完成：
  - 新增 `playwright.visual.config.ts`：`testDir=./e2e-visual`、单 worker、60s 超时、1440×900、`en-US`/UTC/浅色/Reduced Motion，`expect.toHaveScreenshot.maxDiffPixelRatio=0.001`，dev server 固定 3100 端口并以 Mock 模式启动（`VISUAL_REGRESSION=1`）。
  - 新增 `e2e-visual/visual.spec.ts`：首页、功能页、定价页、登录页四张全页截图；截图前等待 `networkidle`、React hydration（`__reactFiber$`）与 `document.fonts.ready`，注入禁用动画/过渡样式，遮罩页脚版权年份避免时间假失败。
  - 新增 4 张 Linux Chromium 基线：`e2e-visual/visual.spec.ts-snapshots/{home,features,pricing,login}-chromium-visual-linux.png`（在 Playwright 容器内生成）。
  - 修复基线自身缺陷：首次容器内复跑时首页/功能页/定价页 3 项失败，定位为基线在 `maskColor` 生效前生成、页脚遮罩块残留 Playwright 默认洋红（`#FF00FF`），与当前白色遮罩不一致；登录页无站点页脚故未受影响。已在容器内 `pnpm test:visual:update` 重新生成 3 张基线（登录页字节未变），随后两次独立比对均 4/4 通过。
  - `next.config.ts`：仅当 `VISUAL_REGRESSION=1` 时关闭 Next.js dev indicator，避免开发角标进入截图。
  - `messages/en/footer.json`：`&copy;` 改为 `©`（ICU 不解析 HTML 实体，英文页脚此前会原样显示 `&copy;`），与中文文案一致。
  - CI `e2e` job 在 E2E 之后执行 `pnpm test:visual`；失败时上传 `playwright-report/` 与 `test-results/`（失败截图与 diff PNG）。
  - 文档同步：`docs/testing.md`（新增视觉回归章节与容器内生成基线命令）、README 双语、docs-site 脚本双语、`docs/roadmap-0.6.0.md` G10。
- 变更文件：`CHANGELOG.md`、`.github/workflows/ci.yml`、`package.json`、`next.config.ts`、`messages/en/footer.json`、`playwright.visual.config.ts`（新）、`e2e-visual/visual.spec.ts`（新）、`e2e-visual/visual.spec.ts-snapshots/*-chromium-visual-linux.png`（新）、`docs/testing.md`、`README.md`、`README.zh-CN.md`、`docs-site/scripts.md`、`docs-site/zh-CN/scripts.md`、`docs/roadmap-0.6.0.md`、`docs/progress.md`。
- 验证命令与结果：
  - `pnpm type-check`：通过（可视配置曾因 `maskColor` 放错层级报 TS 错误，已下移到单测用例选项）。
  - `pnpm verify:build`：通过——100 个测试文件 / 899 个测试；bundle 当前 2795.8 kB / 基线 2733.8 kB（1.023×，门禁 1.05×）；生产构建 23/23 静态页成功。
  - `pnpm check:all`：全部检查通过（含 `pnpm check:release-docs`：7 个发布文档产物校验通过、type-check、lint、100 files / 899 tests）；CHANGELOG 追加后重跑 `pnpm check:all` 仍全部通过，`npx prettier --check CHANGELOG.md` 通过。
  - `pnpm test:e2e`：52/52 通过。
  - `pnpm test:coverage`：statements 95.35% / branches 90.62% / functions 96% / lines 96.5%。
  - `pnpm audit --audit-level high`：`No known vulnerabilities found`。
  - `pnpm --filter indiestack-docs build`：通过。
  - Linux 容器视觉比对（最终状态）：连续两次 `pnpm test:visual` 均 4/4 通过；此前的 3 项失败已定位并修复（见「已完成」中的基线遮罩缺陷）。生成/比对命令：
    `docker run --rm --ipc=host --platform linux/amd64 -v "$PWD":/work -w /work -v indiestack-g10-node-modules:/work/node_modules -v indiestack-g10-next:/work/.next mcr.microsoft.com/playwright:v1.63.0-noble bash -lc 'corepack enable && pnpm test:visual'`（生成基线时末段为 `pnpm test:visual:update`）。
    排障中间证据：失败产物落在 `test-results/visual-public-page-visual--*/{home,features,pricing}-{actual,diff}.png`；裁剪基线右下角可见洋红遮罩块，重生成后消失。
- 上游依赖：无。
- 未验证项：
  - GitHub Actions `ubuntu-latest` 运行器与 `mcr.microsoft.com/playwright:v1.63.0-noble` 容器的字体/渲染差异未验证：LOCAL_ONLY 模式不允许推送，CI 尚未运行过该 job。若首次 CI 出现像素差异，需在 CI 环境重生成基线，或把该 job 改为在容器内执行。
  - macOS 直接执行 `pnpm test:visual` 会因缺少 `-darwin` 基线而失败（预期行为，文档已说明必须用容器）。
- 风险与回滚：
  - 风险：视觉基线对字体/抗锯齿环境敏感，环境漂移会带来假失败；已用固定环境（单 worker、UTC、浅色、Reduced Motion、禁用动画）+ 0.1% 像素阈值 + 版权年份遮罩收敛抖动。
  - 风险：本机 bundle 测量值包含本地 dev server 在 `.next/static` 的残留 chunk，数值偏高，但仍通过 5% 容差门禁。
  - 已知局限：页脚版权段落被整段遮罩，该段落自身的文案回归不会被基线捕获（换取年份变化不产生假失败）；若要覆盖可改为仅遮罩年份节点。
  - 回滚：`git revert <本地提交>` 即可整体回退（不涉及数据库、运行时接口或对外契约）；`next.config.ts` 的开关仅在 `VISUAL_REGRESSION=1` 时生效，生产不受影响。
- 下一步：由用户决定是否推送 `codex/visual-regression-baseline` 并创建 PR；首次 CI 运行后确认 `ubuntu-latest` 与容器基线一致。
- 提交记录：G10 代码与基线为 dd38cd7，CHANGELOG 为 b93211e；`docs(progress)` 提交只补充证据与 SHA 回填。无需 rebase：`git fetch --prune origin` 后 `origin/main` 仍为 15b05eb，未经过 rebase/force push。
- 最后更新：2026-09-12

## 2026-09-12 I05 CHANGELOG 自动校验

- 状态：DONE
- 工作分支：codex/visual-regression-baseline（沿用既有任务分支；项目约定 `feat/*`）
- PR：none
- PR 状态：none
- Base：origin/main@15b05ebe8e93725e16698e8b66fc9c43e3733965（未前进，无需 rebase）
- 远端 Head：none（LOCAL_ONLY 模式，未推送）
- 本地提交：09fe960（`feat(docs): add changelog structure gate`）
- 目标：为 CHANGELOG.md 增加结构门禁，防止发布说明漂移（roadmap I05）。
- 已完成：
  - 新增纯函数模块 `src/lib/changelog/parse-changelog.ts`：把 CHANGELOG 解析为版本 / 章节 / 条目树，并校验 `# Changelog` 标题与说明、`[Unreleased]` 必须置顶、版本标题 `## [x.y.z] — YYYY-MM-DD` 与日期合法性、版本降序、版本号重复、每版本至少一个 `### 章节`、章节至少一个顶层条目、条目非空且不超过 2000 字符、非法/悬空标题与条目。行尾空白与文件结尾换行也纳入检查（warning / error 分级）。
  - 新增 `scripts/lib/changelog-check.js`（读文件 + 打印 + 退出码）与 `scripts/check-changelog.js`（Node 原生 type stripping 入口），避免门禁与单测重复实现规则。
  - `package.json` 新增 `check:changelog`；`scripts/check-all.sh` 与 `.github/workflows/ci.yml` 的 Lint & Type Check job 均执行该门禁。
  - 补 38 条单测：`src/lib/changelog/parse-changelog.test.ts`（解析树、行号、全部错误码、告警、当前仓库 CHANGELOG 通过）与 `src/lib/changelog/changelog-check.test.ts`（默认路径、合法返回 0、非法返回 1、文件不存在不抛出、warnings 不阻断）。
  - 文档同步：`docs/testing.md` 新增门禁说明，docs-site 双语 scripts 表补 `pnpm check:changelog`，`docs/roadmap-0.6.0.md` I05 标记完成，CHANGELOG `[Unreleased]` 增加条目。
  - 门禁自举：先让 `pnpm check:changelog` 校验当前 CHANGELOG.md（6 个已发布版本 + 1 个 Unreleased），通过后才接入聚合入口。
- 变更文件：`src/lib/changelog/parse-changelog.ts`（新）、`src/lib/changelog/parse-changelog.test.ts`（新）、`src/lib/changelog/changelog-check.test.ts`（新）、`scripts/lib/changelog-check.js`（新）、`scripts/check-changelog.js`（新）、`package.json`、`scripts/check-all.sh`、`.github/workflows/ci.yml`、`CHANGELOG.md`、`docs/testing.md`、`docs-site/scripts.md`、`docs-site/zh-CN/scripts.md`、`docs/roadmap-0.6.0.md`、`docs/operations/release-gap-audit-v0.6.0.md`、`docs/progress.md`。
- 验证命令与结果：
  - `pnpm check:changelog`：通过（6 个已发布版本，1 个 Unreleased）。
  - `pnpm vitest run src/lib/changelog`：38/38 通过。
  - `pnpm type-check`、`pnpm lint`：通过。
  - `pnpm check:all`：全部检查通过（含本次新增的 `check:changelog`：6 个已发布版本 / 1 个 Unreleased）。
  - `pnpm test:coverage`：statements 95.54% / branches 91.09% / functions 96.25% / lines 96.66%（新模块 97.94% / 97.77% / 100% / 98.51%）。
  - `pnpm verify:build`：通过——102 个测试文件 / 937 个测试；bundle 2795.8 kB / 基线 2733.8 kB（1.023×，门禁 1.05×）；生产构建 23/23 静态页。
  - `pnpm test:e2e`：52/52 通过。
  - `pnpm audit --audit-level high`：`No known vulnerabilities found`。
  - `pnpm --filter indiestack-docs build`：通过。
  - Node 22 兼容性：`docker run --rm -v "$PWD":/work -w /work node:22-alpine node --no-warnings --experimental-strip-types scripts/lib/changelog-check.js` 通过（与 CI 的 Node 22 主版本一致），排除 CI 因 type stripping flag 或类型剥离语法失败的可能。
- 上游依赖：无。
- 未验证项：CI 运行前的动作类步骤（`actions/setup-node@v7` 与 pnpm 缓存路径）未实测；Node 版本与命令本身已在 node:22-alpine 容器验证。
- 风险与回滚：风险为门禁对既有 CHANGELOG 结构变严，可能阻断不合规的新条目；已用 warning/error 分级（行尾空白仅提示）把误报面收敛。回滚方式为 revert 本任务提交并移除 `check:all` / CI 中的调用。
- 下一步：由用户决定是否推送该分支；继续处理 roadmap 中其余可本地验证的任务。
- 提交记录：门禁与单测为 09fe960（8 个文件，808 行新增）；`docs(...)` 提交补充 CHANGELOG、roadmap、testing、docs-site、release-gap audit 与本进度记录。无需 rebase：origin/main 未前进。
- 最后更新：2026-09-12

## 2026-09-12 H09 migration drift 检查

- 状态：DONE
- 工作分支：feat/visual-regression-baseline（沿用既有任务分支；项目约定 `feat/*`）
- PR：none
- PR 状态：none
- Base：origin/main@15b05ebe8e93725e16698e8b66fc9c43e3733965（未前进，无需 rebase）
- 远端 Head：none（LOCAL_ONLY 模式，未推送）
- 本地提交：c3d2c84（`feat(db): add migration checksum drift gate`）
- 目标：把 `check:migrations` 从“只查文件名”升级为迁移内容与数据库历史漂移门禁（roadmap H09）。
- 已完成：
  - 新增纯函数模块 `src/lib/migrations/migration-drift.ts`：`inspectMigrationFiles` 校验迁移命名 `<3位以上编号>_<描述>.sql`、编号连续且唯一、非 SQL 文件、空文件、UTF-8 BOM、CRLF 行尾、结尾换行，并对每个迁移内容计算 SHA-256；`createMigrationManifest` 生成确定性清单；`validateMigrationManifest` 校验清单 schemaVersion/algorithm/条目形状/重复条目/缺失条目/多余条目/哈希漂移；`validateMigrationHistory` 比对 local/remote 版本，报 `HISTORY_MIGRATION_PENDING`（未应用）与 `HISTORY_VERSION_MISSING_LOCAL`（数据库独有）以及重复版本；`parseSupabaseMigrationOutput` 解析 CLI 输出（容忍前置状态文本）。
  - 原 `scripts/check-migrations.js` 重写为 CJS 包装器，改用 Node 原生 type stripping 调用共享实现 `scripts/lib/migration-drift-check.js`，Node 22 与 Node 26 均无需构建步骤。命令名 `check:migrations` 保持不变，语义升级为 checksum 门禁。
  - 新增 `supabase/migration-manifest.json`：25 个迁移的 SHA-256 基线（schemaVersion 1 / sha256）。
  - 新增 `pnpm update:migrations-manifest`（`--update`）：只允许追加新迁移；会把已有清单与当前文件对比，**拒绝改写已基线化迁移**（报 `MANIFEST_HASH_DRIFT` 并提示只能新增前向迁移），清单 JSON 损坏时同样拒绝覆盖，避免用“重跑基线”掩盖历史被篡改。
  - 新增只读的 `pnpm check:migration-history`（`scripts/check-migration-history.js` + `scripts/lib/migration-history-check.js`）：调用 `supabase migration list --local --output-format json`，比对本地文件与本地数据库历史；Supabase 不可用时给出 `supabase start` 提示。不访问 linked/生产，因依赖 `supabase start` **未**接入 `check:all`/CI 离线聚合。
  - 门禁自举：先生成清单并让 `pnpm check:migrations` 通过（25 个迁移），再确认 CI 与 `scripts/check-all.sh` 已在调用该命令（本次无需改 CI/聚合脚本）。
  - 补 43 条单测：`src/lib/migrations/migration-drift.test.ts`（命名/文件类型/重复版本/断号/空文件/BOM/CRLF/结尾换行/清单形状与漂移/历史比对/CLI 输出解析/格式化）与 `src/lib/migrations/migration-check.test.ts`（真实仓库清单通过、缺失清单提示、损坏 JSON、update 模式拒绝非法迁移、**update 模式拒绝改写已基线化迁移**、update 模式允许追加新迁移、update 模式拒绝覆盖损坏清单、历史通过对/pending 失败/Supabase 不可用提示）。
  - 文档同步：README 双语与 docs-site 双语脚本表新增三条命令（并去掉 docs-site `db:migrate` 重复行）、docs-site 双语 Supabase 文档新增 Migration drift 章节、`docs/testing.md` 新增 H09 门禁说明、`CONTRIBUTING.md` 更新新增迁移流程、`docs/operations/release-runbook-v0.6.0.md` 入口条件与“数据库先行”步骤加入迁移历史一致性预检、`docs/roadmap-0.6.0.md` H09 标记完成、CHANGELOG `[Unreleased]` 增加条目、`docs/operations/release-gap-audit-v0.6.0.md` 记录本次加固。
- 变更文件：`src/lib/migrations/migration-drift.ts`（新）、`src/lib/migrations/migration-drift.test.ts`（新）、`src/lib/migrations/migration-check.test.ts`（新）、`scripts/lib/migration-drift-check.js`（新）、`scripts/lib/migration-history-check.js`（新）、`scripts/check-migrations.js`（重写）、`scripts/check-migration-history.js`（新）、`supabase/migration-manifest.json`（新）、`package.json`、`CHANGELOG.md`、`README.md`、`README.zh-CN.md`、`docs-site/scripts.md`、`docs-site/zh-CN/scripts.md`、`docs-site/supabase.md`、`docs-site/zh-CN/supabase.md`、`docs/testing.md`、`CONTRIBUTING.md`、`docs/operations/release-runbook-v0.6.0.md`、`docs/operations/release-gap-audit-v0.6.0.md`、`docs/roadmap-0.6.0.md`、`docs/progress.md`。
- 验证命令与结果：
  - `pnpm check:migrations`：通过（`25 immutable migrations match SHA-256 manifest`）。
  - `pnpm check:migration-history`：通过（`25 local migrations applied`，本地 Supabase 已 `supabase start`）。
  - `pnpm vitest run src/lib/migrations`：43/43 通过（2 个文件）。
  - `pnpm type-check`、`pnpm lint`：通过。
  - `pnpm check:all`：全部检查通过（104 个测试文件 / 980 个测试；含 `check:migrations`、`check:rls` 25 迁移 18 张表 23 条策略、`check:changelog` 6 版本 + 1 Unreleased、`check:release-docs` 7 个产物）。
  - `pnpm test:coverage`：statements 95.76% / branches 91.44% / functions 96.45% / lines 96.82%（新模块 `lib/migrations` 99.21% / 96.62% / 100% / 99.15%）。
  - `pnpm verify:build`：通过——104 个测试文件 / 980 个测试；bundle 2795.8 kB / 基线 2733.8 kB（门禁 1.05× 内）；生产构建 23/23 静态页。
  - `pnpm test:e2e`：52/52 通过。
  - `pnpm audit --audit-level high`：`No known vulnerabilities found`。
  - `pnpm --filter indiestack-docs build`：通过（3.14s）。
  - G10 视觉回归在 Linux 容器内复跑：`docker run --rm --ipc=host --platform linux/amd64 -v "$PWD":/work -w /work -v indiestack-g10-node-modules:/work/node_modules -v indiestack-g10-next-clean:/work/.next mcr.microsoft.com/playwright:v1.63.0-noble bash -lc 'corepack enable && pnpm test:visual'` → 4/4 通过。
  - Node 22 兼容性：`docker run --rm -v "$PWD":/work -w /work node:22-alpine node --no-warnings --experimental-strip-types scripts/lib/migration-drift-check.js` 通过，排除 CI（Node 22）因 type stripping 失败的可能。
- 上游依赖：无。
- 未验证项：
  - linked/production 迁移历史一致性未验证：需显式凭据与审批，属发布 Runbook 步骤，LOCAL_ONLY 模式下不执行。
  - GitHub Actions `ubuntu-latest` 上的 `check:migrations` 未实测（本地与 node:22-alpine 容器已验证命令与退出码）。
- 风险与回滚：
  - 风险：门禁对既有迁移变严，若有人有意改写历史文件会直接失败——这是设计目标，不是回归。
  - 风险：`update:migrations-manifest` 的“仅追加”语义依赖清单本身完好；清单损坏时命令会拒绝而非静默重建，需人工用 git 恢复清单。
  - 回滚：`git revert c3d2c84` 可整体回退；命令名 `check:migrations` 未变化，CI/聚合脚本无需改动即可退回旧语义（需同时恢复 `scripts/check-migrations.js` 旧实现）。
- 下一步：由用户决定是否推送 `feat/visual-regression-baseline`；首次 CI 运行后确认 `check:migrations` 在 `ubuntu-latest` 上通过。
- 提交记录：门禁、清单与单测为 c3d2c84（9 个文件，1128 行新增）；`docs(...)` 提交补充 CHANGELOG、README、docs-site、CONTRIBUTING、runbook、roadmap、release-gap audit 与本进度记录。无需 rebase：`git fetch --prune origin` 后 `origin/main` 仍为 15b05eb，未经过 rebase/force push。
- 最后更新：2026-09-12

## H10 依赖与 secrets 扫描门禁

- 状态：DONE
- 工作分支：feat/visual-regression-baseline（沿用当前功能分支；本轮未重命名，项目约定为 `feat/*`）
- PR：none
- PR 状态：none
- Base：origin/main@15b05ebe8e93725e16698e8b66fc9c43e3733965
- 远端 Head：none（LOCAL_ONLY 模式，未推送）
- 本地提交：42543be（`feat(security): harden dependency and secrets gate`）、c98b8dc（`docs(security): document dependency and secrets gate`）、e6b1dec（`test(security): avoid service-role audit false positive`）
- 目标：把依赖漏洞和 secrets/扫描配置检查从单体脚本升级为可测试、fail-closed 的仓库门禁，覆盖环境文件、客户端密钥泄漏、workflow 权限、gitleaks/CodeQL/Dependabot 配置漂移和高危依赖。
- 已完成：
  - 新增纯策略模块 `src/lib/security/security-config.ts`，覆盖被跟踪的 `.env*`/私钥文件、环境文件权限不得宽于 `0600`、`.env.development` 服务端密钥、真实 `"use client"` 模块的 dot/bracket `process.env` 服务端变量泄漏、workflow 显式最小权限、gitleaks/CodeQL/security-config/Dependabot 配置契约，以及 `pnpm audit --json` 的 high/critical fail-closed。
  - 服务端变量清单补齐 `RESEND_API_KEY`、`VAPID_PRIVATE_KEY`；扫描器文件缺失按路径去重报告。
  - 新增可注入 IO/CLI 实现 `scripts/lib/security-config-check.js`，原 `scripts/check-security-config.js` 改为经 Node 原生 type stripping 调用的薄 wrapper。
  - 新增 `src/lib/security/security-config.test.ts` 与 `src/lib/security/security-config-check.test.ts`，共 2 个文件 / 54 条专项测试。
  - 文档同步：`README.md`、`README.zh-CN.md`、`docs-site/scripts.md`、`docs-site/zh-CN/scripts.md`、`docs/roadmap-0.6.0.md`、`docs/testing.md`、`CHANGELOG.md`、`docs/operations/release-gap-audit-v0.6.0.md`。
  - `pnpm check:all` 首次复跑时发现 `check:supabase-security` 将测试夹具中的 `'use client'` 与 `SUPABASE_SERVICE_ROLE_KEY` 字符串组合误判为客户端 admin 访问；已在不降低 H10 泄漏用例覆盖的前提下拆开夹具字面量，并新增修复提交 e6b1dec，随后全部门禁通过。
- 变更文件：`src/lib/security/security-config.ts`（新）、`src/lib/security/security-config.test.ts`（新）、`src/lib/security/security-config-check.test.ts`（新）、`scripts/lib/security-config-check.js`（新）、`scripts/check-security-config.js`、`README.md`、`README.zh-CN.md`、`docs-site/scripts.md`、`docs-site/zh-CN/scripts.md`、`docs/roadmap-0.6.0.md`、`docs/testing.md`、`CHANGELOG.md`、`docs/operations/release-gap-audit-v0.6.0.md`、`docs/progress.md`。
- 验证命令与结果：
  - `pnpm exec vitest run src/lib/security`：2 个文件 / 54 个测试通过；修复误报后 `pnpm exec vitest run src/lib/security/security-config.test.ts`：49/49 通过。
  - `pnpm type-check`、`pnpm lint`：通过。
  - `pnpm check:security`：`✅ security/config checks passed: 663 tracked files, 395 source files, 8 workflows`。
  - `pnpm check:supabase-security`：`✅ Supabase security audit passed: 25 migrations, 18 public tables, server-only service role checks`。
  - `pnpm check:docs`：docs-site scripts 与 package.json 同步；`pnpm check:release-docs`：7 个发布文档产物通过；`pnpm check:changelog`：6 个已发布版本 + 1 个 Unreleased 章节通过。
  - `pnpm check:all`：最终全部通过（106 个测试文件 / 1,034 个测试；翻译 970 key 对称、RLS 25 迁移/18 表/23 策略、migration manifest 25/25）。
  - `pnpm test:coverage`：106 个文件 / 1,034 个测试通过；statements 95.9% / branches 91.72% / functions 96.57% / lines 96.92%。
  - `pnpm verify:build`：通过；106 个文件 / 1,034 个测试；bundle 当前 2795.8 kB / 基线 2733.8 kB（门禁 1.05× 内）；Next.js production build 成功生成 23/23 静态页。
  - `pnpm test:e2e`：52/52 通过（1 worker，1.4m；dev server 日志中的 mock ECONNRESET 为 E2E 请求结束噪声，测试全部通过）。
  - `pnpm audit --audit-level high`：`No known vulnerabilities found`。
  - `pnpm --filter indiestack-docs build`：VitePress build complete（3.92s）。
  - Node 22 兼容性：`docker run --rm -v "$PWD":/work -w /work node:22-alpine node --input-type=module --no-warnings --experimental-strip-types -e 'await import("./src/lib/security/security-config.ts"); console.log("Node 22 type stripping OK")'` → `Node 22 type stripping OK`。
- 上游依赖：无。
- 未验证项：
  - GitHub Actions `ubuntu-latest` 上尚未实际运行本次新门禁；LOCAL_ONLY 模式未推送，无法触发远端 CI。
  - 真实 gitleaks/CodeQL 定时扫描结果未在本地观察到；本地只验证其配置契约与触发器，不代替历史提交扫描。
  - linked/production secrets 与真实凭证检查不在 LOCAL_ONLY 范围；需发布审批与外部环境后验证。
- 风险与回滚：
  - 风险：扫描策略变严后，合法的服务端变量或测试夹具可能触发误报；本次已将 Supabase 旧扫描器与 H10 新策略的边界分别验证，但后续新增变量仍需同步维护 `SERVER_ONLY_ENV_NAMES`。
  - 回滚：按提交逆序执行 `git revert e6b1dec c98b8dc 42543be` 可完整移除本次 H10 改动、文档和误报修复；不会改写已发布历史。
- 下一步：由用户决定是否推送 `feat/visual-regression-baseline` 并创建 PR；首次 CI 运行后确认 `Security and configuration checks`、CodeQL 与 Secrets Scan 在 `ubuntu-latest` 上通过。
- 最后更新：2026-09-12

## I03 / Web Push 真实投递与运维文档

- 状态：DONE
- 工作分支：feat/visual-regression-baseline（沿用当前功能分支；项目分支约定为 `feat/*`）
- PR：none
- PR 状态：none
- Base：origin/main@15b05ebe8e93725e16698e8b66fc9c43e3733965
- 远端 Head：none（LOCAL_ONLY 模式，未推送）
- 本地提交：6d97f07（`feat(notifications): implement web push delivery`）、f2e0070（`docs(site): document web push operations`）
- 目标：把 B06 的 Web Push provider 占位实现替换为真实投递，补齐订阅撤销与失效端点清理，并完成 I03 docs-site 章节同步；同批完成 I01（邮件投递章节，0b94d8e）与 I02（存储章节，e3a2ac1）。
- 已完成：
  - `src/lib/push-provider.ts` 接入真实 `web-push` 传输层：VAPID 鉴权、1 小时 TTL、10 秒超时、high urgency；缺公钥或私钥时 `configured=false` 并显式失败，不伪造投递成功。404/410 归类为 `subscription-gone`；成功上报 `push.send.completed{status_code}`，失败上报 `push.send.failed{reason}`（`not-configured`/`subscription-gone`/`timeout`/`http-*`/`network`）。
  - 新增 `src/lib/push-notify.ts`：按用户扇出到全部订阅，404/410 立即撤销失效端点，瞬时失败仅记录，返回 `attempted/sent/failed/revoked/skipped` 结果。
  - `src/lib/email-notify.ts` 改为「站内通知 → Web Push（全类型、best-effort）→ 邮件（仅 realtime 类型）」，Push 异常被隔离，不会抑制站内通知与邮件。
  - 设置页 `push-notification-form.tsx` 刷新后检测既有浏览器订阅，并支持关闭：先撤销数据库记录再 `unsubscribe()` 浏览器订阅；新增 `disable`/`disabled` 中英文案。
  - `src/lib/repositories/push-subscriptions.ts` 增加 service-role 的 list/remove（服务端投递用），用户可见访问仍由 RLS 约束。
  - `src/lib/supabase/database.types.ts` 仅补 `push_subscriptions` 表类型：Supabase CLI 生成会额外写入约 1.9k 行无关 `auth` schema，已回退并手工补齐该表。
  - docs-site 新增 `web-push.md` 与 `zh-CN/web-push.md`（VAPID 配置、订阅流程、投递契约、失败清理、当前无持久化重试的限制），注册到运维导航/侧边栏，并在两份 configuration 参考中补 `NEXT_PUBLIC_VAPID_PUBLIC_KEY`、`VAPID_PRIVATE_KEY`、`NEXT_PUBLIC_APP_URL`；`.env.example` 补 `VAPID_PRIVATE_KEY`。
- 变更文件：`package.json`、`pnpm-lock.yaml`、`.env.example`、`messages/{en,zh-CN}/dashboard.json`、`src/lib/push-provider{,.test}.ts`、`src/lib/push-notify{,.test}.ts`、`src/lib/email-notify{,.test}.ts`、`src/lib/repositories/push-subscriptions{,.test}.ts`、`src/components/forms/push-notification-form{,.test}.tsx`、`src/lib/supabase/database.types.ts`、`docs-site/{,zh-CN/}web-push.md`、`docs-site/{,zh-CN/}configuration.md`、`docs-site/.vitepress/config.mts`。
- 验证命令与结果：
  - `pnpm check:all`：全部通过 —— 翻译 en/zh-CN 各 972 key 对称、next-intl 837 个静态调用无缺失、RLS 25 迁移/18 表/23 策略、migration manifest 25/25、Supabase security 与 security/config（667 tracked files / 397 source files / 8 workflows）、release-docs 7 产物、changelog 6 版本 + 1 Unreleased、docs-site scripts 同步、a11y；`type-check`、`lint` 通过，`test` 107 文件 / 1050 测试通过。
  - `pnpm test:coverage`：107 文件 / 1050 测试通过；statements 95.8% / branches 91.36% / functions 96.64% / lines 96.86%（满足 branches ≥ 90% 退出标准）。
  - `pnpm --filter indiestack-docs build`：VitePress build complete（18.85s）。
  - `pnpm install --frozen-lockfile`：通过，lockfile 与 `package.json` 一致，供应链策略校验通过。
  - Web Push 专项（本周期内）：`src/lib/push-provider.test.ts`、`src/lib/push-notify.test.ts`、`src/lib/repositories/push-subscriptions.test.ts`、`src/lib/email-notify.test.ts` 4 文件 / 33 测试通过；设置页 UI 2 测试通过；`src/lib/email-notify.ts` 变更后 `pnpm build` 23/23 静态页通过（无需 `serverExternalPackages`）。
- 上游依赖：无。
- 未验证项：
  - 真实浏览器推送未验证：需要 VAPID 凭证、HTTPS、支持 Push API 的浏览器和 push service，属部署后外部检查，本地仅覆盖传输层契约与失败路径。
  - 抖动/瞬时限流下的端到端行为未验证：当前 Push 无持久化重试队列或死信表（与邮件的 `email_attempts` 重试上限机制不同），文档已显式声明为 best-effort，不套用 B09 的广义重试/死信结论。
- 风险与回滚：
  - 风险：Push 为 best-effort，订阅端点长期失效前会重复投递失败并写日志/指标；404/410 会自动清理，其余错误只记录。
  - 风险：`web-push` 新增生产依赖（含 `https-proxy-agent`、`asn1.js` 等传递依赖），已通过 `pnpm audit --audit-level high` 与供应链策略校验。
  - 回滚：`git revert f2e0070 6d97f07` 可整体回退文档与实现；`020_push_subscriptions.sql` 未被本批改动，数据库无需回滚。
- 下一步：进入 v0.7.0 `RELEASE_FREEZE`（版本号、CHANGELOG、发布 runbook/checklist、全量验证与本地发布准备）；推送与 PR 需用户显式授权后执行。
- 最后更新：2026-09-12

## v0.7.0 / RELEASE_FREEZE（Web Push 真实投递 + 门禁加固里程碑收口）

- 状态：VERIFYING（本地发布准备已完成；生产 smoke 未执行，等待发布权限）
- 里程碑 / 发布目标：`0.7.0`（minor：新增 Web Push 真实投递能力，无 breaking change、无新迁移）
- 分支 / PR：`feat/visual-regression-baseline` / PR none（LOCAL_ONLY，未推送、未创建 PR）
- Base：`origin/main`@`15b05ebe8e93725e16698e8b66fc9c43e3733965`（本周期 `git fetch --prune origin` 后未前进，未执行 rebase）
- 本地提交：`6d97f07`、`f2e0070`、`3f0da27` + 本次 `chore(release): prepare v0.7.0`
- 目标：把本里程碑（Web Push 真实投递、迁移漂移门禁 H09、安全扫描门禁 H10、实时刷新与上传进度）按 v0.7.0 冻结发布，
  产出可复现的本地发布证据并停在权限边界。
- 已完成：
  - 版本与入口：`package.json` 0.7.0、`.env.example` `NEXT_PUBLIC_APP_VERSION=0.7.0`。
  - CHANGELOG：新增 `## [0.7.0] — 2026-09-12`（主题：Web Push 真实投递 + 安全与发布门禁加固），
    `[Unreleased]` 保留一条显式**未实现**待办（Push 持久化重试与死信队列），不冒充已完成能力。
  - 发布产物：新增 `docs/operations/release-runbook-v0.7.0.md`（含“v0.7.0 发布差异”：VAPID 凭证、HTTPS、
    无新迁移、best-effort 限制）、`rollback-runbook-v0.7.0.md`（无破坏性 DB 回滚）、
    `production-smoke-v0.7.0.md`（**重写为干净“未执行”基线**，避免继承 v0.6.0 生产证据）、
    `release-gap-audit-v0.7.0.md`。
  - 门禁去版本硬编码：`scripts/check-release-docs.js` 改为从 `package.json` 解析版本，并新增
    `.github/RELEASE_CHECKLIST.md` 的 tag/runbook/rollback/smoke 引用校验，发版不再需要手改脚本。
  - 文档入口：双语 README 指向 v0.7.0 产物；新增 `docs-site/v0.7.0.md`、`docs-site/zh-CN/v0.7.0.md`
    并注册到导航与侧边栏。
- 变更文件：`package.json`、`.env.example`、`CHANGELOG.md`、`README.md`、`README.zh-CN.md`、
  `.github/RELEASE_CHECKLIST.md`、`scripts/check-release-docs.js`、`docs/operations/{release-runbook,rollback-runbook,production-smoke,release-gap-audit}-v0.7.0.md`、
  `docs-site/{,zh-CN/}v0.7.0.md`、`docs-site/.vitepress/config.mts`、`docs/progress.md`。
- 验证命令与结果（均在本次 release-freeze 工作树上执行通过）：
  - `pnpm check:release-docs`：`✅ release documentation checks passed (v0.7.0, 7 artifacts)`。
  - `pnpm check:all`：全部通过 —— locales 972 key 对称、i18n 837 调用、agents 10/10、RLS 25 迁移/18 表/23 策略、
    migrations 25/25 SHA-256 基线、Supabase security、security/config 671 tracked files / 397 source files / 8 workflows、
    release-docs 7 产物、changelog 7 版本 + 1 Unreleased、docs-site scripts 同步、a11y、type-check、lint、
    test 107 文件 / 1050 测试。
  - `pnpm test:coverage`：statements 95.8% / branches 91.36% / functions 96.64% / lines 96.86%。
  - `pnpm verify:build`：通过（production build，23/23 静态页面）。
  - `pnpm test:e2e`：52/52 通过（45.5s）。
  - `pnpm audit --audit-level high`：No known vulnerabilities found。
  - `pnpm --filter indiestack-docs build`：VitePress build complete。
- 阻塞：无技术阻塞；发布侧阻塞为权限边界（LOCAL_ONLY，无 push / PR / merge / deploy 授权）。
- 未验证项：
  - 真实浏览器 Web Push 未验证：需要 VAPID 密钥对、HTTPS 站点与可用 push service，属部署后外部检查。
  - `docs/operations/production-smoke-v0.7.0.md` 全部行状态为“未执行”，不得作为通过证据。
  - 回滚演练未在本版本执行；`pnpm check:migration-history` 需要本地 `supabase start`，未纳入本次离线验证。
  - GitHub Actions 未在本地重现；v0.7.0 exit report 需在真实发布后生成。
- 风险与回滚：
  - 风险：Push 为即时 best-effort（无重试队列/死信表），瞬时失败只写日志与 `push.send.failed` 指标；
    站内通知始终是事实来源，该限制已写入 CHANGELOG、runbook 与 docs-site。
  - 风险：`web-push` 及其传递依赖进入生产依赖树，已通过 audit 与供应链策略校验。
  - 回滚：应用层回退到上一个 deployment；清空 VAPID 密钥即关闭 Push 通道且保留订阅行；
    本版本无新迁移，不需要 DB down migration。
- 下一步：获得用户显式 push / PR / merge / deploy 授权后，推送 `feat/visual-regression-baseline`、
  创建 v0.7.0 PR（rebase 合并）、执行生产 smoke 与回滚演练、生成 exit report；在此之前保持本地冻结。
- 最后更新：2026-09-12

## 2026-09-13 Web Push 持久化重试与死信队列（v0.8.0 里程碑任务）

- 状态：IN_PROGRESS（功能与门禁已完成并提交；已进入 v0.8.0 `RELEASE_FREEZE`）
- 里程碑 / 发布目标：`0.8.0`（minor：新增 Web Push 持久化重试能力，无 breaking change；新增迁移 026）
- 分支 / PR：`feat/visual-regression-baseline` / PR none（LOCAL_ONLY，未推送、未创建 PR）
- 本地提交：`c514f2c`（feat(push): persist retries and dead-letter deliveries）
- Base：`origin/main`@`15b05ebe8e93725e16698e8b66fc9c43e3733965`（未 fetch 前进，未 rebase）
- 目标：把 v0.7.0 遗留的“Push 即时 best-effort”缺口补齐为可持久化重试、可上限截断、可死信查询的能力，
  与邮件 `email_attempts` 语义对齐，并接入 cron worker 与可观测性。
- 已完成：
  - 迁移 `026_push_delivery_attempts.sql`：按 `(notification_id, endpoint)` 唯一键持久化投递状态
    （`pending|sent|dead`）、`attempt_count`、`failure_code`、`next_attempt_at`、`last_attempt_at`、`sent_at`；
    外键级联/置空、到期队列索引、`handle_updated_at` 触发器；开启 RLS 且**不建 anon/authenticated 策略**（仅 service_role）。
  - Repository `src/lib/repositories/push-delivery-attempts.ts`：幂等入队（`ignoreDuplicates` 保留 sent/dead 历史）、
    到期拉取、sent/retry/dead 回执、死信列表、积压/死信/失效端点计数；退避公式 `60s × 2^(n-1)`，上限 1 小时，重试上限 3（含首次）。
  - 即时投递链路 `src/lib/push-notify.ts`：发送前按端点入队（`next_attempt_at` 留 60s 窗口避免 cron 抢占），
    成功记 `sent`、瞬时失败记 `pending` 退避、404/410 撤销订阅并记死信；入队失败降级为即时 best-effort，不阻断站内通知与邮件。
  - Cron worker `src/lib/push-retry.ts` + `/api/cron/push-retry`：每 15 分钟、单轮 50 条，按端点重试；
    订阅缺失/用户关闭 Push → dead，404/410 → 撤销并 dead；provider 未配置时整轮快速失败（不静默转死信）；返回脱敏计数。
  - 共享鉴权 `src/lib/cron-auth.ts`（Bearer 或 `x-cron-secret`），digest 与 supabase-restore 路由复用，未配置 secret 一律拒绝。
  - 可观测性：新增 `push.backlog`（阈值 500 告警）、`push.endpoint.revoked`、`push.delivery.dead`、
    `cron.push-retry.completed|failed`；文档同步到 `docs/operations/sentry-alerts.md`。
  - 类型与工具：`db:types` 改为 `--schema public`，避免 regen 引入无关 auth 类型；`database.types.ts` 纳入迁移 026。
- 变更文件：`supabase/migrations/026_push_delivery_attempts.sql`、`supabase/migration-manifest.json`、
  `src/lib/repositories/push-delivery-attempts.ts`（+test）、`src/lib/push-retry.ts`（+test）、`src/lib/push-notify.ts`（+test）、
  `src/app/api/cron/push-retry/route.ts`（+test）、`src/lib/cron-auth.ts`（+test）、`src/lib/email-notify.ts`、
  `src/lib/push-provider.ts`、`src/lib/ops/supabase-restore.ts`、`src/app/api/cron/digest/route.ts`、
  `src/lib/repositories/{notifications,profiles,push-subscriptions,test-helpers}.ts`、
  `src/lib/supabase/database.types.ts`、`vercel.json`、`package.json`、
  `docs-site/{,zh-CN/}web-push.md`、`docs/operations/sentry-alerts.md`、`CHANGELOG.md`。
- 验证命令与结果：
  - `pnpm check:all`：通过 —— locales 972 key、i18n 837 调用、RLS 26 迁移/19 表/23 策略、
    migrations 26/26 SHA-256 基线、Supabase security、security/config 677 tracked/405 source/8 workflows、
    release-docs、changelog、docs、a11y、type-check、lint、**test 111 文件 / 1099 测试通过**。
  - 数据库运行时证据（本地 Supabase）：RLS 开启 0 策略、唯一键/索引/触发器存在、重复入队不生效、
    到期行可拉取、回执更新 `updated_at`、通知删除级联清理，smoke 后残留行数为 0。
- 阻塞：无技术阻塞；发布侧为权限边界（LOCAL_ONLY，无 push / PR / merge / deploy 授权）。
- 未验证项：
  - 真实浏览器 Web Push 端到端仍未验证（需 VAPID、HTTPS 与真实 push service），属部署后外部检查。
  - 抖动/限流下的实际多次退避节奏只在单测与本地 DB 层面验证，未在生产环境观察。
- 风险与回滚：
  - 风险：新增一张仅 service_role 可写的队列表；若 cron 未调度，pending 行会累积（已加 `push.backlog` 阈值告警）。
  - 风险：入队失败会降级为 best-effort（与 v0.7.0 行为一致），不影响站内通知与邮件事实来源。
  - 回滚：`git revert c514f2c` 回退代码与文档；迁移 026 为纯新增，应用回退后该表可保留（未被读取），
    确认无消费者后可 `drop table public.push_delivery_attempts` 清理；`020_push_subscriptions.sql` 未改动。
- 下一步：进入 v0.8.0 `RELEASE_FREEZE`（定版 0.8.0、CHANGELOG 发布章节、发布/回滚/smoke/gap-audit runbook、双语入口、
  全量 `verify:build` + coverage + e2e + audit + docs build），产出本地 exit report 并停在权限边界。
- 最后更新：2026-09-13

## v0.8.0 / RELEASE_FREEZE（Web Push 持久化重试与死信队列里程碑收口）

- 状态：VERIFYING（本地发布准备已完成；生产 smoke 未执行，等待发布权限）
- 里程碑 / 发布目标：`0.8.0`（minor：新增 Web Push 持久化重试、死信队列与 cron worker；新增迁移 026）
- 分支 / PR：`feat/visual-regression-baseline` / PR none（LOCAL_ONLY，未推送、未创建 PR）
- Base：`origin/main`@`15b05ebe8e93725e16698e8b66fc9c43e3733965`（本周期未 fetch 前进，未执行 rebase）
- 本地提交：`c514f2c`（功能）、`efaf73f`（进度）、`facf47e`（`chore(release): prepare v0.8.0`）
- 目标：把本里程碑（Push 持久化重试与死信队列）按 v0.8.0 冻结发布，产出可复现的本地发布证据并停在权限边界。
- 已完成：
  - 版本与入口：`package.json` 0.8.0、`.env.example` `NEXT_PUBLIC_APP_VERSION=0.8.0`。
  - CHANGELOG：`## [0.8.0] — 2026-09-13`（主题：Web Push 持久化重试与死信队列）；
    `[Unreleased]` 保留一条显式**未实现**待办（Push 重试链路 E2E 覆盖），不冒充已完成能力。
  - 发布产物：新增 `docs/operations/release-runbook-v0.8.0.md`（含“v0.8.0 发布差异”：新增迁移 026、
    新 cron 任务与 `CRON_SECRET`、VAPID/HTTPS、`push.backlog` 阈值、at-least-once 语义）、
    `rollback-runbook-v0.8.0.md`（026 纯新增，代码回退即可；`drop table` 仅在 DBA 批准后执行）、
    `production-smoke-v0.8.0.md`（干净“未执行”基线 + Push 重试/死信/cron/401 行）、`release-gap-audit-v0.8.0.md`。
  - 文档入口：双语 README 指向 v0.8.0 产物；新增 `docs-site/v0.8.0.md`、`docs-site/zh-CN/v0.8.0.md`
    并注册到导航与侧边栏；`.github/RELEASE_CHECKLIST.md` 更新为 v0.8.0 tag 与产物链接。
- 变更文件：`package.json`、`.env.example`、`CHANGELOG.md`、`README.md`、`README.zh-CN.md`、
  `.github/RELEASE_CHECKLIST.md`、`docs/operations/{release-runbook,rollback-runbook,production-smoke,release-gap-audit}-v0.8.0.md`、
  `docs-site/{,zh-CN/}v0.8.0.md`、`docs-site/.vitepress/config.mts`、`docs/progress.md`。
- 验证命令与结果（均在本次 release-freeze 工作树上执行通过）：
  - `pnpm check:release-docs`：`✅ release documentation checks passed (v0.8.0, 7 artifacts)`。
  - `pnpm check:all`：全部通过 —— locales 972 key 对称、i18n 837 调用、agents 10/10、
    RLS 26 迁移/19 表/23 策略、migrations 26/26 SHA-256 基线、Supabase security、
    security/config 677 tracked/405 source/8 workflows、release-docs 7 产物、
    changelog 8 版本 + 1 Unreleased、docs-site scripts 同步、a11y、type-check、lint、test 111 文件 / 1099 测试。
  - `pnpm test:coverage`：statements 96.05% / branches 91.08% / functions 96.26% / lines 97.02%。
  - `pnpm verify:build`：通过（production build）。
  - `pnpm test:e2e`：52/52 通过（1.3m）。
  - `pnpm audit --audit-level high`：No known vulnerabilities found。
  - `pnpm --filter indiestack-docs build`：VitePress build complete。
  - `pnpm check:migration-history`：`✅ migration history is aligned: 26 local migrations applied`。
- 阻塞：无技术阻塞；发布侧阻塞为权限边界（LOCAL_ONLY，无 push / PR / merge / deploy 授权）。
- 未验证项：
  - 真实浏览器 Web Push 未验证：需要 VAPID 密钥对、HTTPS 站点与可用 push service，属部署后外部检查。
  - `docs/operations/production-smoke-v0.8.0.md` 全部行状态为“未执行”，不得作为通过证据。
  - 回滚演练未在本版本执行；GitHub Actions 未在本地重现；v0.8.0 exit report 需在真实发布后生成。
- 风险与回滚：
  - 风险：新增队列表仅 service_role 可写；若 cron 未调度或 `CRON_SECRET` 缺失，pending 行会累积
    （已加 `push.backlog` 阈值告警）；投递语义改为 at-least-once，极端情况下端点可能重复收到通知。
  - 回滚：应用层回退到上一个 deployment；迁移 026 为纯新增，应用回退后该表可保留；
    确认无消费者后可经 DBA 批准 `drop table public.push_delivery_attempts`；`020/025` 迁移未改动。
- 下一步：获得用户显式 push / PR / merge / deploy 授权后，推送 `feat/visual-regression-baseline`、
  创建 v0.8.0 PR（rebase 合并）、执行生产 smoke 与回滚演练、生成 exit report；在此之前保持本地冻结。
- 最后更新：2026-09-13

## v0.8.0 / PUSH_RETENTION（Push 队列保留策略，本地验证完成）

- 状态：DONE（本地实现 + 单测 + 全量门禁 + 本地 Supabase 实证均已完成；受权限边界未 push / PR / merge / deploy）
- 里程碑 / 发布目标：`0.8.0`（并入 v0.8.0 发布内容，不单独升版本；补 v0.8.0 发布说明与运维 runbook）
- 分支 / PR：`feat/visual-regression-baseline` / PR none（LOCAL_ONLY，未推送、未创建 PR）
- Base：`origin/main`@`15b05ebe8e93725e16698e8b66fc9c43e3733965`（本周期未 fetch 前进，未执行 rebase）
- 本地提交：`1c7e812`（`fix(mock): compare range filters by ISO timestamp`）、
  `9f52303`（`feat(push): prune expired delivery queue rows`）
- 目标：给 `push_delivery_attempts` 加保留策略，避免队列表无限增长；同时修掉 mock 范围查询对 ISO 时间戳的误比较。
- 已完成：
  - 代码：`prunePushDeliveryAttempts()` —— `sent` 按 `sent_at` 保留 7 天、`dead` 按 `last_attempt_at` 保留 30 天，
    单批上限 1000 条并按保留列升序取样；**pending 永不清理**（仍欠投递）。查询与删除都重新断言
    status + cutoff，避免两条语句之间状态翻转被误删；删除计数缺失时回退为选中行数。
  - 代码：cron `handle()` 在出完成日志前调用 `pruneWithMetrics()`，失败只记
    `push.queue.prune_failed` + 日志且不影响投递结果（返回 `null`），响应新增脱敏计数 `pruned`。
  - 修复：mock query builder 的 `:gte` / `:lt` 原先用 `Number()` 双向强转，ISO 时间戳恒为 NaN、
    条件永不命中；且 `Date.parse("3")` 会解析成 2001 年而误判数字字符串。现抽出有序比较（仅
    `YYYY-MM-DD`/`YYYY-MM-DDTHH...` 形态或 `Date` 走时间戳，其余走数值，无法解析返回 null），
    并补齐 `:lte` 与 `push_delivery_attempts` 表分支以对齐 PostgREST。
  - 测试：`push-delivery-attempts.test.ts` 新增 `prunePushDeliveryAttempts()` 套件（cutoff/顺序/上限/
    pending 安全/空集合/默认上限/select 报错/delete 报错/删除计数回退）；`push-retry/route.test.ts`
    覆盖 `pruned` 响应与清理失败降级；`mock.test.ts` 覆盖 `lte`、排序、limit、保留策略选择与删除，
    并显式守住「数值字符串不被当作日期」。
  - 文档：`CHANGELOG.md` 0.8.0 增加保留策略与 mock 范围查询修复；`docs-site/{,zh-CN/}web-push.md`
    补保留策略、`pruned` 字段与两个新指标；`docs/operations/sentry-alerts.md` 增 `push.queue.pruned` /
    `push.queue.prune_failed` 指标行与告警/去重说明；`release-runbook` / `rollback-runbook` /
    `production-smoke` / `release-gap-audit`（均 v0.8.0）同步记录。
- 变更文件：`src/lib/repositories/push-delivery-attempts.ts`（+test）、`src/app/api/cron/push-retry/route.ts`（+test）、
  `src/lib/mock/index.ts`、`src/lib/mock.test.ts`、`CHANGELOG.md`、`docs-site/{,zh-CN/}{web-push,v0.8.0}.md`、
  `docs/operations/{sentry-alerts,release-runbook-v0.8.0,rollback-runbook-v0.8.0,production-smoke-v0.8.0,release-gap-audit-v0.8.0}.md`。
- 验证命令与结果：
  - `pnpm vitest run src/lib/mock.test.ts src/lib/repositories/push-delivery-attempts.test.ts src/app/api/cron/push-retry/route.test.ts`
    → 3 文件 / 58 测试通过。
  - `pnpm check:all` → 通过（locales、i18n、agents、RLS 26 迁移/19 表/23 策略、migration SHA-256 基线、
    Supabase security、security/config、release-docs、changelog、docs-site 同步、a11y、type-check、lint、
    test 111 文件 / **1110 测试**）。
  - `pnpm test:coverage` → statements **96.08%** / branches **91.08%** / functions **96.28%** / lines **97.04%**。
  - `pnpm verify:build`（lint + type-check + test + build）→ 通过，production build 23/23 静态页，
    bundle 2796.6 kB / baseline 2733.8 kB（仍标记 within baseline）。
  - `pnpm test:e2e` → **52/52 通过**（43.3s）。
  - `pnpm audit --audit-level high` → No known vulnerabilities found。
  - `pnpm --filter indiestack-docs build` → 通过。
  - `pnpm check:migration-history` → `✅ migration history is aligned: 26 local migrations applied`。
  - `pnpm check:release-docs` → 通过（v0.8.0，7 产物）；`pnpm check:changelog` → 通过（8 已发布版本 + 1 Unreleased）。
  - **本地 Supabase 实证**（`next dev -p 3101` + `NEXT_PUBLIC_MOCK_ENABLED=false` + `CRON_SECRET=local-retention-check`，
    指向 `http://127.0.0.1:54321`）：播种 5 行 `endpoint like 'https://retention-check.example/%'`
    （sent 8 天 / sent 1 天 / dead 31 天 / dead 29 天 / pending 60 天），
    `curl -H 'x-cron-secret: local-retention-check' /api/cron/push-retry` → **HTTP 200**
    `{"pulled":0,"sent":0,"retried":0,"dead":0,"revoked":0,"pruned":{"sent":1,"dead":1}}`；
    剩余行恰为 `fresh-sent` + `fresh-dead` + `old-pending`（pending 未被清理）；服务端指标
    `push.backlog=1`、`push.queue.pruned{status=sent,retention_days=7}=1`、
    `push.queue.pruned{status=dead,retention_days=30}=1`、`cron.push-retry.completed`。验证后已删除 5 行探针数据并关闭 dev server（3101 端口已释放）。
  - 环境注意（非仓库缺陷，供后续复现）：`.env.local` 的 `NEXT_PUBLIC_SUPABASE_URL` 指向远端云项目
    `ntqggnztzvoavjbiillb`，该库**没有** `push_delivery_attempts` 表；本地实证必须显式覆盖
    `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` 为
    `pnpm exec supabase status` 的本地值，否则请求会打到云端并以 500
    `Could not find the table ... in the schema cache` 失败。若直连 psql 建表后 REST 仍报同样错误，
    需 `notify pgrst, 'reload schema';` 刷新 PostgREST 缓存。
- 阻塞：无技术阻塞；发布侧为权限边界（LOCAL_ONLY，无 push / PR / merge / deploy 授权）。
- 未验证项：
  - 真实浏览器 Web Push 端到端仍未验证（需 VAPID 密钥对、HTTPS 与真实 push service），属部署后外部检查。
  - 保留策略未在远端/生产库执行过；`docs/operations/production-smoke-v0.8.0.md` 保留策略行仍为“未执行”。
  - 多批（>1000 行）清理只在单测层面覆盖，未在真实大表上压测。
- 风险与回滚：
  - 风险：保留窗口写死为 sent 7 天 / dead 30 天；若排障需要更久历史，须先调常量再发布。
  - 风险：清理为“每轮最多 1000 条”，若历史积压远超单轮上限，需要多轮 cron 才能收敛（有 `push.queue.pruned` 可观测）。
  - 回滚：`git revert 9f52303` 只回退清理逻辑与文档，队列表与投递链路不受影响（表继续增长但不丢数据）；
    `git revert 1c7e812` 会同时回退 mock 范围查询修复，请勿单独回退——它已修掉 ISO 时间戳比较失效的真实缺陷。
- 下一步：补齐 Push 重试链路 E2E 覆盖（mock-only `/api/e2e/*` seed + query 路由驱动
  失败 → 退避 → 重试 → 死信 → 失效端点撤销），随后继续下一里程碑条目。
- 最后更新：2026-09-13

## v0.8.0 后续 / PUSH_RETRY_E2E（Push 重试链路端到端覆盖，本地完成）

- 状态：DONE（本地实现 + E2E + 全量门禁通过；受权限边界未 push / PR / merge / deploy）
- 里程碑 / 发布目标：`0.8.0` 缺口收口项，记录在 `[Unreleased]`（不单独升版本；v0.8.0 已冻结，本项不改变其发布内容）
- 分支 / PR：`feat/visual-regression-baseline` / PR none（LOCAL_ONLY，未推送、未创建 PR）
- 本地提交：`5c76873`（test(e2e): cover push retry chain end to end）
- Base：`origin/main`@`15b05ebe8e93725e16698e8b66fc9c43e3733965`（本周期未 fetch 前进，未执行 rebase）
- 目标：把 v0.8.0 发布文档缺口审计中唯一未闭合的测试缺口（Push 重试/死信只有单测 + 本地 DB 证据）
  补成可复现的端到端用例，且不引入真实 VAPID 凭据或出网依赖。
- 已完成：
  - `src/lib/mock/push-transport.ts`：mock-only 保留端点传输层（`https://push-e2e.test/{ok,transient,timeout,gone}`）。
    真实的 `web-push` 适配器固定走 `https.request`，无法像 Resend 那样用 `RESEND_API_URL` 重定向到本地捕获端点
    （`http://` 会直接 TLS 失败），因此只替换底层传输：`createPushProvider()` 的配置校验、载荷构造、
    指标上报与错误映射全部保持真实代码路径；未识别端点一律失败，避免“忘了注入传输层”被误判为投递成功。
  - `src/app/api/cron/push-retry/route.ts`：mock 模式经 `createRuntimePushProvider()` 注入上述传输层；非 mock 路径不变。
  - `src/lib/mock/index.ts`：补齐 `push_subscriptions` 表读/写支持（缓存持有者、`getMockPushSubscriptions()`、reset 与读写分支）。
  - `src/app/api/e2e/push-queue/route.ts`：mock-only 种子/查询/重置端点（Bearer `E2E_BEARER_TOKEN` 鉴权，
    非 mock 一律 404）。POST 支持 endpoint/status/attemptCount/dueInMs/withNotification/withSubscription/
    pushDisabled/终态时间偏移；DELETE 清空队列表、订阅与通知并复位 push 偏好。
  - `e2e/push-retry.spec.ts`：**10 条用例**，直接驱动真实 `POST /api/cron/push-retry`，覆盖
    401 鉴权（cron + 种子端点）、空队列全零计数、成功投递 `pending → sent`、瞬时失败保持 `pending`
    且指数退避到未来（防 cron 空转热循环）、超过重试上限进入死信 `max-attempts`、410 死信并撤销本地订阅、
    订阅记录缺失、用户关闭 Push、通知行缺失、终态保留策略清理（sent 8 天/dead 31 天被清理，
    sent 1 天/dead 29 天/pending 保留）。
  - `playwright.config.ts`：webServer 增加占位 `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`，
    让 provider 判定为 configured 而不需要真实密钥（mock 模式传输层不参与签名）。
  - 文档：`CHANGELOG.md` `[Unreleased]` 用真实条目替换原先“下一里程碑将补充 E2E”的 Planned 待办；
    `docs/operations/release-gap-audit-v0.8.0.md` 该缺口行更新为“已补齐（mock-only）”并声明其不等同于
    真实 push service 验证；`docs/testing.md` E2E 用例数 52 → 62 并新增 Push 重试链路覆盖说明。
- 变更文件：`e2e/push-retry.spec.ts`、`src/lib/mock/push-transport.ts`、`src/lib/mock/index.ts`、
  `src/app/api/e2e/push-queue/route.ts`、`src/app/api/cron/push-retry/route.ts`、`playwright.config.ts`、
  `CHANGELOG.md`、`docs/testing.md`、`docs/operations/release-gap-audit-v0.8.0.md`、`docs/progress.md`。
- 验证命令与结果：
  - `pnpm lint` / `pnpm type-check` → 通过。
  - `pnpm check:all` → 通过（locales 972 key、i18n 837 调用、agents 10/10、RLS 26 迁移/19 表/23 策略、
    migrations 26/26 SHA-256 基线、Supabase security、security/config 692 tracked/407 source/8 workflows、
    release-docs（v0.8.0，7 产物）、changelog（8 已发布 + 1 Unreleased）、docs、a11y、type-check、lint、
    **test 111 文件 / 1110 测试**）。
  - `pnpm test:e2e` → **62/62 通过**（39.4s，新增 10 条 push 重试用例全绿）。
  - `pnpm verify:build` → 通过（production build，含 check + test + bundle 门禁）。
  - `pnpm check:changelog` / `pnpm check:release-docs` / `pnpm check:docs` → 通过。
- 阻塞：无技术阻塞；发布侧为权限边界（LOCAL_ONLY，无 push / PR / merge / deploy 授权）。
- 未验证项：
  - 本套用例替换的是出网传输层，**不等于**真实 push service 投递验证；真实浏览器订阅 → 推送
    仍需 VAPID 密钥对、HTTPS 站点与可用 push service，属部署后外部检查。
  - mock-only 端点在生产（`NEXT_PUBLIC_MOCK_ENABLED` 非 true）返回 404 的行为只有代码路径保证，
    未在真实部署上探测。
  - v0.8.0 生产 smoke 仍未执行（`docs/operations/production-smoke-v0.8.0.md` 全部行保持“未执行”）。
- 风险与回滚：
  - 风险：`/api/e2e/push-queue` 会写入 mock 队列表与订阅表；它只在 mock 模式存在且需要
    `E2E_BEARER_TOKEN`，生产不注册该行为（`isMockEnabled` 为假时直接 404）。
  - 风险：`push_subscriptions` mock 表默认为空，真实 E2E 里订阅由种子端点写入；若未来有人依赖
    预置订阅数据需显式 seed。
  - 回滚：`git revert 5c76873` 回退新增/修改的测试与 mock 传输层、种子端点、占位 VAPID 环境变量与文档，
    不影响生产 Push 投递链路（`src/lib/push-provider.ts` 未被本提交改动）。
- 下一步：继续推进下一批可本地执行的工作（优先真实缺口与失败/未验证项），并保持 v0.8.0 冻结产物不变。
- 最后更新：2026-09-13

## v0.8.0 后续 / DEPS_REFRESH_2026-09-13（依赖补丁刷新，本地完成）

- 状态：DONE（本地实现 + 全量门禁通过；受权限边界未 push / PR / merge / deploy）
- 里程碑 / 发布目标：维护性批次，记录在 `[Unreleased]`（不单独升版本）
- 分支 / PR：`feat/visual-regression-baseline` / PR none（LOCAL_ONLY，未推送、未创建 PR）
- 本地提交：`24b9461`（chore(deps): refresh next.js and tooling patch releases）
- Base：`origin/main`@`15b05ebe8e93725e16698e8b66fc9c43e3733965`（本周期未 fetch 前进，未执行 rebase）
- 目标：消化 `pnpm dep:health` 报告的 minor/patch 可升级项，缩小运行时与工具链的已知修复缺口；
  major（eslint 10 / typescript 7）需要专项迁移，评估后不在本批次冒险升级。
- 已完成：
  - `next` 16.3.4 → **16.3.5**、`eslint-config-next` 16.3.4 → **16.3.5**、
    `@next/bundle-analyzer` 16.3.4 → **16.3.5**、`next-intl` 4.14.3 → **4.14.4**、
    `lucide-react` 1.44.0 → **1.45.0**（`pnpm-lock.yaml` 同步重解，`pnpm up` 通过供应链策略校验）。
  - 未处理：`eslint` 9.39.5 → 10.10.0、`typescript` 6.0.3 → 7.0.2 均为 major，
    需要独立迁移批次（flat config / tsconfig / 规则行为），本批次保持不动并在此声明。
- 变更文件：`package.json`、`pnpm-lock.yaml`、`CHANGELOG.md`、`docs/progress.md`。
- 验证命令与结果：
  - `pnpm verify:build` → 通过（`pnpm check` + `pnpm test` + bundle 门禁 + production build；
    Next.js 16.3.5 下 23/23 静态页正常生成）。
  - `pnpm test:e2e` → **62/62 通过**（2.5m，Mock 模式 dev server 在 next 16.3.5 下正常）。
  - `pnpm --filter indiestack-docs build` → 通过（VitePress build complete）。
  - `pnpm audit --audit-level high` → No known vulnerabilities found。
  - `pnpm check:migration-history` → `✅ migration history is aligned: 26 local migrations applied`。
  - `pnpm dep:health` → 剩余 major 2 项（eslint、typescript）、minor/patch 0 项。
  - `pnpm peers check` → 仅剩 docs-site 的 `@docsearch/react` 要求 React <19（VitePress 1.6 传递依赖，
    与本批次升级无关，属既有告警）；根应用 peer 无新增问题。
- 阻塞：无技术阻塞；发布侧为权限边界（LOCAL_ONLY，无 push / PR / merge / deploy 授权）。
- 未验证项：
  - 升级后的 Next.js 在真实部署（Vercel）上的构建/运行时行为未验证，需部署权限。
  - `pnpm peers check` 的 docs-site React 19 peer 告警未修复（属既有状态，非本批次引入）。
- 风险与回滚：
  - 风险：patch 升级理论上可能改变构建/运行时行为；本批次已用全量门禁 + E2E + docs build 覆盖。
  - 回滚：`git revert 24b9461` 回到 16.3.4 / 4.14.3 / 1.44.0，并重新安装依赖（lockfile 一并回退）。
- 下一步：继续下一批可本地执行的工作（优先真实缺口与未验证项）。
- 最后更新：2026-09-13

## v0.8.0 后续 / H08_RETENTION_EMAIL_WORKER（邮件 worker 运行记录保留期，本地完成）

- 状态：DONE（本地实现 + 门禁通过；受权限边界未 push / PR / merge / deploy）
- 里程碑 / 发布目标：H08 数据保留续，记录在 `[Unreleased]`（不单独升版本）
- 分支 / PR：`feat/visual-regression-baseline` / PR none（LOCAL_ONLY，未推送、未创建 PR）
- 本地提交：见本条目下方“提交”字段（本条提交）
- Base：`origin/main`@`15b05ebe8e93725e16698e8b66fc9c43e3733965`（本周期未 fetch 前进，未执行 rebase）
- 目标：`email_worker_runs` 此前无任何保留期，`/api/cron/digest` 每轮落一行会导致长期无界增长；
  补齐与 `notifications` / `webhook_events` 对齐的 90 天保留策略。
- 已完成：
  - 新增迁移 `027_email_worker_runs_retention.sql`：`cleanup_old_email_worker_runs()`（SECURITY DEFINER、
    `search_path=''`）按 90 天窗口删除 `email_worker_runs`；守卫式 `pg_cron` 调度
    `15 4 * * 0`（仅当 `pg_cron` 扩展存在时注册，本地/最小化环境安全跳过）。
  - `supabase/migration-manifest.json` 重新定基线（27 个迁移，仅追加）。
  - `src/lib/supabase/database.types.ts` 补 `cleanup_old_email_worker_runs` 函数类型。
  - `docs/db/retention.md` 重写为完整保留矩阵（notifications / webhook_events / email_worker_runs /
    push_delivery_attempts 各状态），补设计约束、运维检查与变更痕迹。
  - `CHANGELOG.md` `[Unreleased]` 新增真实条目。
- 变更文件：`supabase/migrations/027_email_worker_runs_retention.sql`、
  `supabase/migration-manifest.json`、`src/lib/supabase/database.types.ts`、`docs/db/retention.md`、
  `CHANGELOG.md`、`docs/progress.md`。
- 验证命令与结果：
  - `pnpm check:migrations` → ✅ 27 个不可变迁移与 SHA-256 基线一致。
  - `pnpm check:rls` → ✅ 27 迁移、19 表、23 策略。
  - `pnpm check:supabase-security` → ✅ 27 迁移。
  - `pnpm exec supabase migration up` → 本地应用 027 成功。
  - 本地 psql 演练：函数存在且 `prosecdef=t` / `proconfig={"search_path=\"\""}`；`pg_cron` 未安装 →
    调度分支按守卫跳过；插入 91/89/0 天三行后执行 `select public.cleanup_old_email_worker_runs();`
    → 删除 1 行，保留 89 天与当前行，演练行随后清理为 0。
  - `pnpm check:all` → 通过（111 文件 / 1110 测试）。
  - `pnpm lint` / `pnpm type-check` → 通过。
  - `pnpm verify:build` → 通过（production build）。
- 阻塞：无技术阻塞；发布侧为权限边界（LOCAL_ONLY，无 push / PR / merge / deploy 授权）。
- 未验证项：
  - 生产 `pg_cron` 调度是否实际注册未验证（依赖 Supabase Dashboard 扩展状态与生产权限）。
  - 生产库上 90 天窗口的真实删除量未测量（属运维观察项）。
- 风险与回滚：
  - 风险：`pg_cron` 缺失时不会有自动清理，`email_worker_runs` 会继续增长（与迁移前状态一致，非回退；
    已在文档中标注为需 Dashboard 确认项）。
  - 风险：清理为不可逆删除；窗口固定 90 天且只按 `created_at`，不读取业务字段。
  - 回滚：`git revert <本提交>` 删除该迁移；如需撤销已应用状态，另行追加迁移 `drop function
    public.cleanup_old_email_worker_runs()` 并 `cron.unschedule('cleanup-old-email-worker-runs')`
    （迁移仅追加，不改写历史）。
- 下一步：实现 028 SECURITY DEFINER 授权加固（撤销 PUBLIC/anon/authenticated 对清理类函数的 EXECUTE），
  并扩展 `pnpm check:supabase-security` 使其对默认 PUBLIC EXECUTE 失败封闭。
- 最后更新：2026-09-13

## v0.8.0 后续 / H09_SECURITY_DEFINER_GRANTS（SECURITY DEFINER 执行权限收口，本地完成）

- 状态：DONE（本地实现 + 门禁通过；受权限边界未 push / PR / merge / deploy）
- 里程碑 / 发布目标：H09 安全加固续，记录在 `[Unreleased]`（不单独升版本）
- 分支 / PR：`feat/visual-regression-baseline` / PR none（LOCAL_ONLY，未推送、未创建 PR）
- 本地提交：`5db7c0b`（fix(db): revoke client execute on server-only security definer functions）
- Base：`origin/main`@`15b05ebe8e93725e16698e8b66fc9c43e3733965`（本周期未 fetch 前进，未执行 rebase）
- 目标：PostgreSQL 默认把新函数的 `EXECUTE` 授予 `PUBLIC`，Supabase 的默认权限再显式授予
  `anon` / `authenticated` / `service_role`，因此**每个 `SECURITY DEFINER` 函数默认可被匿名用户
  通过 PostgREST `rpc()` 调用并绕过 RLS**。此前 `pnpm check:supabase-security` 只校验
  `search_path`，无法发现该越权面。
- 已完成：
  - 新增迁移 `028_revoke_security_definer_execute.sql`：收回
    `cleanup_old_notifications()` / `cleanup_old_webhook_events()` /
    `cleanup_old_email_worker_runs()` / `log_audit_action(text,text,text,jsonb)` 对
    `public, anon, authenticated` 的 `EXECUTE`，显式回授 `service_role`（属主与 pg_cron 路径天然保留）。
    刻意**不**动 RLS 策略内引用的辅助函数（`is_team_*` / `get_*`）：策略以查询角色求值，
    撤权会让策略直接抛 `permission denied`。
  - 新增可测规则模块 `src/lib/security/security-definer-grants.ts`：解析迁移中的
    `SECURITY DEFINER` 函数（`create or replace` 以最后一次定义为准）、`create policy` 引用与
    `create [or replace] trigger ... execute function` 绑定；对既非策略引用也非触发器的函数
    要求显式 `revoke ... from public, anon, authenticated`，并对后续 `grant execute` 给客户端角色
    报错。自动豁免策略引用与触发器函数。
  - 门禁重构：`scripts/check-supabase-security.js` 变为 CJS 入口，审计实现迁到
    `scripts/lib/supabase-security-check.js`（ESM + 原生 type stripping，与 `check:migrations`
    同一模式），拆分为 `checkRealtimePublication` / `checkTableRls` / `checkStoragePolicies` /
    `checkClientServiceRole` 以满足复杂度门禁。
  - 测试：`src/lib/security/security-definer-grants.test.ts` 14 条（提取签名与标志、最后定义胜出、
    策略/触发器豁免、部分撤权仍失败、无关函数误匹配、缺 `search_path`、回授客户端角色、
    仓库真实迁移零发现、`runSupabaseSecurityCheck()` 对真实仓库返回 0）。
  - 文档：`docs/db/security-audit.md` 新增“SECURITY DEFINER 执行权限”章节（风险矩阵、豁免清单、
    运行时证据、局限）；`docs/db/retention.md` 补撤权说明与运维核查 SQL；`CHANGELOG.md`
    `[Unreleased] → ### Security`。
- 变更文件：`supabase/migrations/028_revoke_security_definer_execute.sql`、
  `supabase/migration-manifest.json`（28 文件）、`scripts/check-supabase-security.js`、
  `scripts/lib/supabase-security-check.js`、`src/lib/security/security-definer-grants.ts`、
  `src/lib/security/security-definer-grants.test.ts`、`docs/db/security-audit.md`、
  `docs/db/retention.md`、`CHANGELOG.md`、`docs/progress.md`。
- 验证命令与结果：
  - `pnpm exec supabase migration up` → 本地应用 `028_revoke_security_definer_execute.sql` 成功。
  - ACL 证据（psql `pg_proc.proacl`）→ 四个函数仅剩 `postgres=X/postgres,service_role=X/postgres`。
  - `has_function_privilege` 矩阵 → anon/authenticated 全部 `f`，service_role 全部 `t`；
    RLS 辅助函数（`is_team_*` / `get_*`）的 authenticated 授权保持 `t`（未被破坏）。
  - 真实 PostgREST `rpc` 路径（本地 `http://127.0.0.1:54321`）：
    临时 `grant execute ... to anon` 复现加固前状态 → `cleanup_old_notifications` 返回 **HTTP 204**
    （删除被执行）；恢复 028 状态后 → **HTTP 401 `42501 permission denied`**；
    `cleanup_old_email_worker_runs` / `log_audit_action` 同为 401；`service_role` 调用 → 204。
  - `pnpm smoke:supabase-identity -- --url http://127.0.0.1:54321 ...` → **20/20 通过**
    （`/tmp/indiestack-identity-028.json`），确认撤权未破坏任何合法 authenticated 路径。
  - `pnpm check:migrations` → ✅ 28 个不可变迁移与 SHA-256 基线一致。
  - `pnpm check:supabase-security` → ✅ 28 迁移、19 张 public 表；对缺撤权的函数失败封闭。
  - `pnpm check:migration-history` → ✅ 28 个本地迁移已应用。
  - `pnpm check:all` → 通过（112 文件 / 1124 测试，较上一批 +14 条）。
  - `pnpm lint`（复杂度门禁经拆分后通过）/ `pnpm type-check` → 通过。
  - `pnpm verify:build` → 通过（production build）。
  - `pnpm test:e2e` → **62/62 通过**（43.6s）。
  - `pnpm check:changelog` → 通过（8 已发布 + 1 Unreleased，含新 `### Security`）。
- 阻塞：无技术阻塞；发布侧为权限边界（LOCAL_ONLY，无 push / PR / merge / deploy 授权）。
- 未验证项：
  - 生产 Supabase 项目上的默认权限与本地是否完全一致未验证（需生产只读凭证）；门禁对迁移文本
    失败封闭，但生产库的 `proacl` 未探测。
  - `anon` 对 RLS 辅助函数（`is_team_*` / `get_*`）仍持有 `EXECUTE`；它们不写数据且受租户参数约束，
    收窄到 `authenticated` 属于后续可选加固，未在本批次冒险调整（避免破坏匿名查询路径）。
  - 真实 `pg_cron` 调度下的清理函数执行未在生产验证（本地未安装 `pg_cron`）。
- 风险与回滚：
  - 风险：若未来新增 RLS 策略引用某个已撤权函数，客户端查询会报 `permission denied`；门禁不会直接
    捕获这种"后加策略引用已撤权函数"的情况，但 `pnpm smoke:supabase-identity` 会在运行时暴露。
  - 风险：门禁豁免触发器函数（返回 `trigger`，PG 拒绝直接调用）；若将来把某个清理函数绑为触发器，
    规则会自动豁免——评审时需人工确认。
  - 回滚：`git revert 5db7c0b`（撤销迁移、门禁改造与文档）。如需在已应用的库上恢复，
    追加迁移 `grant execute on function public.<fn>(...) to anon, authenticated;`；迁移仅追加，
    不改写历史。
- 下一步：继续下一批可本地执行的真实缺口（roadmap 中 H02 上传元数据迁移、I 域 CI/可观测性、
  J 域文档与发布收口等）。
- 最后更新：2026-09-13
