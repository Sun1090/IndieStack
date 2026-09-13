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

## v0.8.0 后续 / H09_AUDIT_LOG_WRITE_LOCKDOWN（审计日志写入面收口，本地完成）

- 状态：DONE
- 里程碑与发布目标：v0.8.0 已发布后的安全加固续（H09/H07 相邻域），变更归入 `[Unreleased]`
- 分支/PR：`feat/visual-regression-baseline`（LOCAL_ONLY，未 push、未开 PR）
- 本地提交：`af956aa`（fix(db): block client writes to audit logs）
- Base：`origin/main`@`15b05ebe8e93725e16698e8b66fc9c43e3733965`（本周期未 fetch 前进，未执行 rebase）
- 目标：`002_rbac_audit.sql` 遗留的策略
  `"Audit logs insertable by authenticated users"` 只判断 `auth.role() = 'authenticated'`，
  对写入行内容零约束。Supabase 把 `public` 表暴露到 PostgREST，因此**任意登录用户可直写
  `audit_logs` 伪造审计记录，并把 `user_id` 指向任意已存在用户**，污染审计与事后取证。
  目标是关掉该伪造面且不破坏服务端写入路径，并把判定固化进门禁。
- 已完成：
  - **改前复现（本地 Supabase 真实 PostgREST）**：用登录态 JWT 以
    `Prefer: return=minimal` POST `/rest/v1/audit_logs`，伪造一条
    `{"user_id":"<victim>","action":"team.delete","entity_id":"victim-team"}` → **HTTP 201**，
    行落入表中（复现后已 `delete` 清理）。同批次对照：`anon` 插入 → HTTP 401（FK 与 SELECT 策略
    曾掩盖现象，改用 `return=minimal` 并指向真实用户后复现）。
  - 新增迁移 `029_audit_logs_write_lockdown.sql`：`drop policy if exists` 删除该 INSERT 策略，
    并 `revoke insert, update, delete, truncate on public.audit_logs from anon, authenticated`
    作为纵深防御。`SELECT` 不动，仍由 `"Audit logs viewable by super_admin"` 限定给 super_admin。
  - 新增可测规则模块 `src/lib/security/client-write-policies.ts`：按版本顺序应用
    `create policy` / `drop policy` 得到**生效策略集合**（`drop` 会移除早先定义，等价数据库终态），
    然后两类判定——(1) `SERVER_ONLY_WRITE_TABLES`（现为 `public.audit_logs`）上任何对
    `public` / `anon` / `authenticated` 生效的 INSERT/UPDATE/DELETE/ALL 策略失败封闭；
    (2) `FOR INSERT` 策略缺失 `WITH CHECK`（PostgreSQL 默认按 `true`）或 `WITH CHECK (true)`
    失败封闭。语句切分跳过字符串字面量、`--` 注释、`$tag$` 块与嵌套括号，避免被迁移中的
    `$do$ ... $do$` 块截断。
  - 门禁接入 `scripts/lib/supabase-security-check.js`：新增 `inspectClientWritePolicies()` 与
    `extractEffectivePolicies()`，失败时输出定向 hint，成功行追加生效策略计数。
  - 测试：`src/lib/security/client-write-policies.test.ts` 13 条（引号名/schema 限定/命令/角色解析、
    省略 `to`/`for` 的默认值、`$do$` 块不截断、`drop policy` 移除早先定义且不误伤同表其它策略、
    旧 `audit_logs` INSERT 策略被判定为伪造面、UPDATE/DELETE 同样命中、super_admin SELECT 放行、
    修复后零发现、缺 `WITH CHECK`、恒真 `WITH CHECK`、ownership 约束放行、仅 `service_role` 放行）。
  - 文档：`docs/db/security-audit.md` 新增“客户端写入策略”章节（两类判定的规则说明、加固前后对照表、
    真实 REST 证据、`has_table_privilege` 矩阵、静态分析已知边界）；
    `CHANGELOG.md` `[Unreleased] → ### Security` 追加条目。
- 变更文件：`supabase/migrations/029_audit_logs_write_lockdown.sql`、
  `supabase/migration-manifest.json`（29 文件）、`src/lib/security/client-write-policies.ts`、
  `src/lib/security/client-write-policies.test.ts`、`scripts/lib/supabase-security-check.js`、
  `docs/db/security-audit.md`、`CHANGELOG.md`、`docs/progress.md`。
- 验证命令与结果：
  - 门禁先于修复运行 → **失败封闭**：
    `[SERVER_ONLY_TABLE_CLIENT_WRITE_POLICY] 002_rbac_audit.sql: public.audit_logs: policy
    "Audit logs insertable by authenticated users" grants INSERT to public but the table is
    server-only`，证明新规则确实能发现该真实缺陷。
  - `pnpm update:migrations-manifest` → 29 文件；`pnpm check:migrations` → ✅ 29 个不可变迁移与
    SHA-256 基线一致。
  - `pnpm exec supabase migration up` → 本地应用 `029_audit_logs_write_lockdown.sql` 成功。
  - 真实 PostgREST 复测（本地 `http://127.0.0.1:54321`）：
    authenticated 伪造 INSERT → **HTTP 403 `42501 permission denied for table audit_logs`**；
    anon INSERT → **HTTP 401**；authenticated UPDATE → **HTTP 403**；
    service_role INSERT → **HTTP 201**（服务端写入路径不变）；
    service_role `rpc/log_audit_action` → **HTTP 200**；service_role SELECT → HTTP 200。
  - 权限矩阵（`has_table_privilege` / `pg_policies`）：`audit_logs` 只剩 `Audit logs viewable by
    super_admin` 一条 SELECT 策略；anon/authenticated 的 insert/update/delete/truncate 全为 `f`
    （select 仍 `t`）；service_role 全为 `t`。
  - `pnpm smoke:supabase-identity -- --url http://127.0.0.1:54321 ...` → **20/20 通过**
    （`/tmp/indiestack-identity-029.json`），确认收口未破坏任何合法 authenticated 路径。
  - `pnpm check:supabase-security` → ✅ 29 迁移、19 张 public 表、39 条生效策略。
  - `pnpm check:rls` → ✅ 29 迁移 / 19 张表 / 23 条最终策略均符合规范。
  - `pnpm check:migration-history` → ✅ 29 个本地迁移已应用。
  - `pnpm check:all` → 通过（**113 文件 / 1137 测试**，较上一批 +13 条）。
  - `pnpm lint`（`statementEnd` 复杂度 19 → 拆出 `skipStringLiteral`/`skipLineComment`/
    `dollarTagAt` 后通过）/ `pnpm type-check` → 通过。
  - `pnpm verify:build` → 通过（production build）。
  - `pnpm test:e2e` → **62/62 通过**（52.0s）。
  - `pnpm check:changelog` → 通过（8 已发布 + 1 Unreleased，含追加的 `### Security` 条目）。
- 阻塞：无技术阻塞；发布侧为权限边界（LOCAL_ONLY，无 push / PR / merge / deploy 授权）。
- 未验证项：
  - 生产 Supabase 项目的 `pg_policies` / `has_table_privilege` 未探测（需生产只读凭证）；
    迁移文本已由门禁失败封闭，但线上是否仍有手工改动的策略无法从这里确认。
  - 从未被登录态覆盖过的直连路径（例如自带 PostgREST 之外的工具）未验证；本批次只覆盖 REST。
  - 静态规则不解析 `alter policy`、动态 SQL 与 Dashboard 手工改动，已在文档中显式标注边界。
- 风险与回滚：
  - 风险：若后续有客户端页面需要直读审计日志，仍应走服务端（`listAuditLogsPage()` 已是 service_role）；
    把审计表重新开放给客户端写会再次引入伪造面，门禁会拦下。
  - 风险：`revoke ... truncate` 只影响 `anon` / `authenticated`；`service_role` 与属主不受影响。
  - 回滚：`git revert af956aa`（撤销迁移、规则模块、门禁接入与文档）。已应用的库上若需恢复旧行为，
    追加迁移 `grant insert on public.audit_logs to authenticated` 并重建策略（会重新引入缺陷，不建议）；
    迁移只追加，不改写历史。
- 下一步：继续下一批可本地执行的真实缺口（roadmap I/J 域的 CI/可观测性与发布文档收口、
  H02 上传元数据迁移、H07 审计日志索引复核等）。
- 最后更新：2026-09-13

## v0.8.0 后续 / H07_AUDIT_LOG_INDEX_REVIEW（审计日志索引复审与精确计数收口，本地完成）

- 状态：DONE（本地）
- 里程碑与发布目标：v0.8.0 后续补强，进入下一里程碑（v0.9.0）候选清单；本项不改版本号。
- 分支/PR：`feat/visual-regression-baseline`（本地分支，无 PR）；base `origin/main@15b05ebe`（本轮未 fetch/rebase）。
- 本地提交：`ca0770b`（perf(db): stop requesting exact audit log counts）、
  本进度条目的 docs 提交。
- 目标：roadmap H07「审计日志索引复审」——用真实 `EXPLAIN ANALYZE` 确认 `audit_logs`
  的实际查询面是否缺索引，并处理唯一随表无限增长的开销。
- 已完成：
  - 全仓 grep 确认 `public.audit_logs` 只有**一条**服务端读路径：
    `listAuditLogsPage()` → `order by created_at desc limit N offset M`；
    管理页的关键词/动作过滤全部在客户端完成，**不下推** `user_id` / `action` / `entity` 条件。
    写入面只有 `appendAuditLog()`（service_role）。
  - 本地 Supabase 合成 **200,000 行**（约 18 个月、200 种 action、3 类实体、500 用户），
    全程在事务内 `insert → analyze → explain → rollback`，不污染本地库；表体积 39 MB。
  - 测量结论：
    - Q1 `order by created_at desc limit 50`（**唯一生产路径**）→ Index Scan
      `idx_audit_logs_created_at`，**0.082 ms / 53 buffers**；
    - Q2 同查询 `offset 5000` → 3.607 ms / 9,897 buffers（OFFSET 分页固有代价，无调用方用深页）；
    - Q3 `select count(*)`（原 `count: "exact"` 下发）→ **Parallel Seq Scan，12.987 ms / 6,956 buffers**；
    - Q4b `where user_id = ? order by created_at desc limit 50`（现有单列索引）→
      Bitmap Index Scan + top-N Sort，0.999 ms；Q4c 加 `(user_id, created_at desc)` 后 0.131 ms（~7.6×）；
    - Q5 `where action = ?` → Bitmap Index Scan `idx_audit_logs_action`，1.770 ms；
    - Q6 `where entity_type = ? and entity_id = ?` → Index Scan `idx_audit_logs_entity`，0.039 ms。
  - 处置 1：**生产分页已命中索引，不新增索引。**
  - 处置 2：**移除默认的精确计数**。`listAuditLogsPage(page, pageSize, options)` 新增
    `AuditLogPageOptions { withExactTotal?: boolean }`，默认 `false` → 不下发 `count: "exact"`、
    返回 `total: null`；`Paginated<T>.total` 类型改为 `number | null`。原调用方
    `listAllAuditLogs()` / `listActions` 不读 `total`（管理页显示 `filteredLogs.length`），
    行为无变化。JSDoc 记录了 20 万行实测数字与「优先用 `count: "planned"`」的替代方案。
  - 处置 3：**暂不加 `(user_id, created_at desc)` 复合索引**，并在
    `docs/db/index-review.md` 写明**触发条件**：一旦把「按用户过滤审计日志」下推到服务端即补迁移。
  - 文档：`docs/db/index-review.md` 重写为含 H07 章节（测量方法、结果表、四条结论）并保留 2026-08-23 首轮表；
    `CHANGELOG.md` `[Unreleased] → ### Changed` 追加条目。
- 变更文件：`src/lib/repositories/audit-logs.ts`、`src/lib/repositories/audit-logs.test.ts`、
  `docs/db/index-review.md`、`CHANGELOG.md`、`docs/progress.md`。
- 验证命令与结果：
  - `pnpm vitest run src/lib/repositories/audit-logs.test.ts` → **8/8 通过**
    （默认不下发 count 且 `select("*", {})`、`range(10,19)` 断言；`withExactTotal: true` → `{count:"exact"}` 且 `total: 5`；
    count 为 null 时退回 0；错误路径抛错）。
  - `pnpm lint` → 通过；`pnpm type-check` → 通过。
  - `pnpm check:all` → 通过（**113 文件 / 1139 测试**，较上一批 +2 条）。
  - `pnpm verify:build` → 通过（production build）。
  - `pnpm check:changelog` → 通过（8 已发布 + 1 Unreleased）。
  - `pnpm check:docs` → 通过。
- 阻塞：无技术阻塞；发布侧为权限边界（LOCAL_ONLY，无 push / PR / merge / deploy 授权）。
- 未验证项：
  - 生产库的真实表体积与计划未测量（需生产只读凭证）；本批复测全部在本地 Supabase 完成。
  - 200k 行是合成数据，`action` 基数（200 种）与真实分布可能不同；结论对「Q1 走索引」不敏感，
    对 Q3「全表计数随行数线性变慢」同样成立。
  - `count: "planned"` 替代方案未接入代码（当前无调用方需要总量，仅在 JSDoc 记录）。
- 风险与回滚：
  - 风险：若将来有调用方依赖 `total`，`number` → `number | null` 是编译期可见的破坏性变更，
    调用方必须显式传 `withExactTotal: true`；类型系统会拦住漏改。
  - 风险：默认不带 count 的响应更小、更快，无行为回归（管理页原本就不显示 `total`）。
  - 回滚：`git revert ca0770b`（恢复始终下发 `count: "exact"` 的旧行为）；无迁移、无 schema 变更，
    不需要数据库侧回滚。
- 下一步：继续 roadmap 中可本地执行的缺口（I04 ADR 状态、I06 release checklist v0.8.0、
  I07 本地 mock 开发指南、I08 provider 诊断指南、I09 贡献者测试矩阵、I10 迁移回滚 runbook、
  H02 上传元数据迁移、H03 RLS 全表回归、H04 service-role 最小权限审计、H06 webhook 幂等约束、
  J02 E2E shard 策略、J03 CI 缓存、J07 tag/release 自动化等）。
- 最后更新：2026-09-13

## v0.8.0 后续 / H03_RLS_FULL_TABLE_REGRESSION（RLS 全表回归门禁补齐漏检，本地完成）

- 状态：DONE（本地）
- 里程碑与发布目标：v0.8.0 后续补强（安全门禁），进入下一里程碑（v0.9.0）候选清单；本项不改版本号。
- 分支/PR：`feat/visual-regression-baseline`（本地分支，无 PR）；base `origin/main@15b05ebe`（本轮未 fetch/rebase）。
- 本地提交：`d1ab460`（fix(security): close rls coverage gate blind spot）、本进度条目的 docs 提交。
- 目标：roadmap H03「RLS 全表回归」——原有 `pnpm check:rls` 存在**真实漏检**，
  需要让门禁按数据库最终态校验每一张表与每一条策略。
- 已完成：
  - **缺陷复现**：`scripts/check-rls.js` 用 `/CREATE\s+POLICY\s+"?([\w-]+)"?[\s\S]*?on\s+([\w.]+)[^;]*;/gi`
    捕获策略名，`[\w-]+` 只允许**单个单词**。本仓库策略几乎全部命名为带空格的句子
    （`"Users can view own profile"`），名字被截断成 `Users`，于是**同一张表上的多条策略在
    最终态 `Map` 里互相覆盖**。旧门禁只收敛出 **24** 条策略，而本地 `pg_policies` 实际是
    **35** 条 public 策略——漏掉的 11 条从未被校验 `USING` / `WITH CHECK`。
  - 新增纯函数模块 `src/lib/security/rls-coverage.ts`：自带的语句切分跳过字符串字面量、
    `--` 注释、`/* */` 块与 `$tag$` 美元引用块；按迁移版本顺序收敛表/RLS/策略最终态；
    规则为 `TABLE_MISSING_RLS`（含后迁移 `disable row level security`）、`TABLE_UNCLASSIFIED`、
    `SERVER_ONLY_TABLE_HAS_POLICY`、`POLICY_MISSING_USING`（select/delete）、
    `POLICY_MISSING_WITH_CHECK`（insert/update/all，PostgreSQL 缺省为 `true`）。
  - 新增 **server-only 白名单** `SERVER_ONLY_TABLES`：`email_worker_runs`、`mfa_recovery_codes`、
    `push_delivery_attempts`、`webhook_events`——RLS 开启且必须**零策略**（仅 `service_role`
    走 `BYPASSRLS`）。任何新表若既无策略又未登记，直接 `TABLE_UNCLASSIFIED` 失败封闭，
    强制做一次显式分类决定。
  - `PolicyStatement` 增加 `using` 字段（在 `with check` 之前读取切片，避免谓词里出现
    `using` 时误判）；`src/lib/security/client-write-policies.ts` 新增可复用的
    `splitSqlStatements()`。
  - `scripts/check-rls.js` 改为 type-stripping 包装器 → `scripts/lib/rls-coverage-check.js`；
    `scripts/lib/supabase-security-check.js` 的 `checkTableRls()` 删除自带正则，改为委托
    `inspectRlsCoverage()`（只取表级失败码），两个门禁共用一套最终态模型，避免再次漂移。
  - `tsconfig.json` 打开 `allowImportingTsExtensions`（`noEmit` 已开启），使 `src` 侧模块可被
    Node 原生 type stripping 直接执行（此前只有 `scripts/lib/*.js` 能带 `.ts` 后缀导入）。
  - 文档：`docs/db/security-audit.md` 新增「RLS 全表回归（2026-09-13 加固）」章节（规则表、
    白名单、与线上目录的交叉验证 SQL、失败封闭证据、已知边界）；
    `CHANGELOG.md` `[Unreleased] → ### Fixed` 追加条目。
- 变更文件：`src/lib/security/rls-coverage.ts`、`src/lib/security/rls-coverage.test.ts`、
  `src/lib/security/client-write-policies.ts`、`scripts/check-rls.js`、
  `scripts/lib/rls-coverage-check.js`、`scripts/lib/supabase-security-check.js`、
  `tsconfig.json`、`docs/db/security-audit.md`、`CHANGELOG.md`、`docs/progress.md`。
- 验证命令与结果：
  - `pnpm check:rls` → ✅ 29 个迁移、19 张 public 表、**35** 条生效策略（旧实现为 24 条）。
  - **与线上目录交叉验证**：把静态收敛结果与
    `select 'public.'||tablename, policyname, cmd, array_to_string(roles,',') from pg_policies
    where schemaname='public'` 做集合比较 → **35/35 完全一致，双向零差集**（不多算、不漏算）。
  - **失败封闭验证**（临时 `099_probe_rls.sql`，验证后立即删除）：
    `create table public.probe_widgets (...)` 不开 RLS → `TABLE_MISSING_RLS`，退出码 1；
    在 `public.teams` 上追加 `"Probe can write"`（UPDATE，只有 `USING`）+
    `"Probe can read"`（SELECT）→ 新门禁报 `POLICY_MISSING_WITH_CHECK`，
    而**同一份文本在旧正则下"无问题"**（两条名字都截断成 `Probe`，后者覆盖前者）——
    这正是漏检路径的端到端复现。
  - `pnpm vitest run src/lib/security/rls-coverage.test.ts` → **14/14 通过**
    （含"名字同首词不塌陷"的回归用例：UPDATE 缺 `WITH CHECK` 必须被报出）。
  - `pnpm check:supabase-security` → ✅ 29 迁移、19 张表、39 条生效策略（含 storage）。
  - `pnpm lint` / `pnpm type-check` → 通过。
  - `pnpm check:all` → 通过（**114 文件 / 1153 测试**，较上一批 +14 条）。
  - `pnpm verify:build` → 通过（production build，确认 `allowImportingTsExtensions` 不破坏构建）。
  - `pnpm test:e2e` → **62/62 通过**（40.5s）。
  - `pnpm check:docs` / `pnpm check:changelog` → 通过。
- 阻塞：无技术阻塞；发布侧为权限边界（LOCAL_ONLY，无 push / PR / merge / deploy 授权）。
- 未验证项：
  - 生产库的 `pg_policies` 未探测（需生产只读凭证）；交叉验证只在本地 Supabase 完成。
  - `USING` / `WITH CHECK` 的**谓词语义**（是否真正按 `auth.uid()` / 团队边界约束）不在静态
    门禁能力内，仍需运行时身份矩阵（20/20）与代码评审；已在文档中标注边界。
  - 不解析 `alter policy` 与动态 SQL；`storage` schema 的策略不在本门禁范围（由
    `check:supabase-security` 的 storage 规则覆盖）。
- 风险与回滚：
  - 风险：新增的 `TABLE_UNCLASSIFIED` 会让**未来任何新表**在未分类时直接红，属于有意的失败封闭；
    正确做法是补策略或显式登记进 `SERVER_ONLY_TABLES` 并写明理由。
  - 风险：`tsconfig.json` 新开关只放宽导入书写形式（`noEmit` 前提下），不改变产物。
  - 回滚：`git revert d1ab460`（恢复旧正则门禁、移除新模块与 tsconfig 开关）；
    无迁移、无 schema 变更，不需要数据库侧回滚。
- 下一步：继续 roadmap 中可本地执行的缺口（H02 上传元数据迁移、H04 service-role 最小权限审计、
  H05 storage policy 复审、H06 webhook 幂等约束、I04 ADR 状态、I06/I07/I08/I09/I10 文档与
  runbook、J02 E2E shard 策略、J03 CI 缓存、J07 tag/release 自动化等）。
- 最后更新：2026-09-13

## v0.8.0 后续 / H04_SERVICE_ROLE_LEAST_PRIVILEGE（service_role 调用点清点门禁，本地完成）

- 状态：DONE（本地）
- 里程碑与发布目标：v0.8.0 后续补强（安全门禁），进入下一里程碑（v0.9.0）候选清单；本项不改版本号。
- 分支/PR：`feat/visual-regression-baseline`（本地分支，无 PR）；base `origin/main@15b05ebe`（本轮未 fetch/rebase）。
- 本地提交：`ec8a7dc`（fix(security): inventory every service-role admin client call site）、
  `b3b1549`（docs(security): document the service-role least-privilege inventory）、本进度条目的 docs 提交。
- 目标：roadmap H04「service-role 最小权限审计」——`service_role` 带 `BYPASSRLS`，
  每个 `createAdminClient()` 调用点都是一次信任边界决策，但此前**没有任何门禁**证明这个集合稳定：
  新路由只要 `import` 一次 admin client 就能悄悄读写真表，RLS 门禁与静态检查都不会报警。
- 已完成：
  - 新增 `src/lib/security/admin-client-boundary.ts`：基于 TypeScript Compiler API 的 AST 清点器。
    逐模块记录**外层调用点路径**（如 `supabaseDriver.put`、`markEmailSent`）+ 该模块触达的
    PostgREST 表、RPC、storage bucket、`auth.admin` 方法与 `use client` 标记；
    注释与字符串里的 `createAdminClient()` 不计入（含"模块内对象方法要带上 owner 路径"的回归用例）。
  - `ADMIN_CLIENT_INVENTORY` 收录 **29 个模块 / 80 个调用点**，每条含 `surface`（10 类）、
    `trust.kind`（7 类）、`trust.evidence`（**必须保持存在的源码字面量**）与 `rationale`。
    分布：data-access 12、e2e-mock-route 6、server-action 3、request-handler 2、
    trusted-worker / webhook-handler / server-component / auth-bridge / server-internal /
    storage-adapter 各 1；14 个模块带字面量授权证据。
    触达面：14 张表、1 个 bucket（`avatars`）、0 个 RPC、5 个 `auth.admin` 方法
    （`deleteUser` / `generateLink` / `getUserById` / `listFactors` / `deleteFactor`）。
  - 9 条失败封闭规则：`ADMIN_CLIENT_UNCLASSIFIED`、`ADMIN_CLIENT_STALE_INVENTORY`、
    `ADMIN_CLIENT_CALL_SITE_DRIFT`、`ADMIN_CLIENT_TABLE_NOT_ALLOWED`、
    `ADMIN_CLIENT_RPC_NOT_ALLOWED`、`ADMIN_CLIENT_STORAGE_BUCKET_NOT_ALLOWED`、
    `ADMIN_CLIENT_AUTH_ADMIN_NOT_ALLOWED`、`ADMIN_CLIENT_CLIENT_MODULE`、
    `ADMIN_CLIENT_TRUST_EVIDENCE_MISSING`。`mock-bearer` 类入口要求 `isMockEnabled` 与
    `E2E_BEARER_TOKEN` **同时**存在，避免只留 mock 开关就暴露跨用户读写。
  - 接入 `scripts/lib/supabase-security-check.js`（因此 `pnpm check:all` 也强制），
    失败时输出 `hint:` 指向 `ADMIN_CLIENT_INVENTORY`；通过时打印已分类调用点数。
  - **配套收口**：`/api/health` 不再持有 service_role。未鉴权的公开端点改用 anon key
    （`auth: { autoRefreshToken: false, persistSession: false }`）证明 PostgREST 可达；
    readiness 仍要求三个 Supabase 凭据齐全（server 端 webhook / cron / 跨用户写入依赖
    `service_role`，缺它属于部署配置错误），新增用例锁定"缺 key 时不发起探测且报 503"。
  - 修复两处真实的误报路径：`checkClientServiceRole` 与新的 boundary 清点都会误伤测试文件
    （测试固件里印着 `"use client"`、或 mock `@/lib/supabase/admin`），现统一排除
    `*.test.*` / `*.spec.*`（测试文件从不进入客户端 bundle）；`Buffer.from("x")` /
    `Array.from(...)` 这类内建 `.from()` 曾被当成 PostgREST 表访问，现按内建接收者豁免，
    未知接收者仍保守计入。
  - 文档：`docs/db/security-audit.md` 新增「service_role 最小权限清单（2026-09-13 加固）」章节
    （清点结果表、规则表、失败封闭证据、信任证据模型、已知边界、健康检查收口）；
    `CHANGELOG.md` `[Unreleased] → ### Security` 追加条目。
- 变更文件：`src/lib/security/admin-client-boundary.ts`、`src/lib/security/admin-client-boundary.test.ts`、
  `src/app/api/health/route.ts`、`src/app/api/health/route.test.ts`、
  `scripts/lib/supabase-security-check.js`、`docs/db/security-audit.md`、`CHANGELOG.md`、
  `docs/progress.md`。
- 验证命令与结果：
  - `pnpm check:supabase-security` → ✅ 29 迁移、19 张表、39 条生效策略、
    **29 classified service-role call sites**。
  - **AST 清点自检**（`src/**` 递归，排除测试文件）→ 29 文件 / 80 调用点 / 0 issue。
  - **失败封闭验证**（临时探针，验证后已清理，退出码均为 1）：
    新增 `src/app/api/__gate-probe/route.ts` 调用 `createAdminClient()` → `ADMIN_CLIENT_UNCLASSIFIED`；
    在 `cron/digest` 已分类模块内追加 `admin.from("secret_table")` →
    `ADMIN_CLIENT_TABLE_NOT_ALLOWED`（只报未登记项，已登记项不误报）。
  - `pnpm vitest run src/lib/security/admin-client-boundary.test.ts src/app/api/health/route.test.ts`
    → **21/21 通过**（含"已提交清单自校验"用例：29 文件 / 80 调用点 / 0 issue）。
  - `pnpm lint`（复杂度 ≤ 15：清点器重构为 `collectAdminClientCall` / `collectFromCall` /
    `collectAuthAdminCall` / `collectSupabaseOperation` 四个纯函数，visitor 复杂度降为 1）
    / `pnpm type-check` → 通过。
  - `pnpm check:all` → 通过（**115 文件 / 1168 测试**，较上一批 +15 条）。
  - `pnpm build` → 通过（production build）。
  - `pnpm check:docs` / `pnpm check:changelog` → 通过。
- 阻塞：无技术阻塞；发布侧为权限边界（LOCAL_ONLY，无 push / PR / merge / deploy 授权）。
- 未验证项：
  - 生产 `pg_roles` / `proacl` / `has_table_privilege` 未探测（需生产只读凭证）；
    本项为**静态**门禁，不替代运行时权限检查。
  - `trust.evidence` 是字面量存在性检查，**不评估谓词语义**（`if (!isCronAuthorized)` 也能通过）；
    真正约束仍由代码评审 + 运行时身份矩阵（20/20）保证。
  - `surface` / `rationale` 是审计文档字段，不参与判定；运行期拼接的表名与动态 SQL 不在范围内。
  - `/api/health` 的 anon 探测未对真实 Supabase 端点跑通（仅 mock 断言调用参数）。
- 风险与回滚：
  - 风险：新增门禁会让**未来任何** service_role 调用点直接红，属有意的失败封闭；
    正确做法是在 `ADMIN_CLIENT_INVENTORY` 补一条并写明授权证据与理由（而不是放宽规则）。
  - 风险：操作按**模块**而非变量收集，模块内只要有一次 admin client 调用，
    其余 `.from(...)` 也要求登记，会多要一次评审。
  - 回滚：`git revert b3b1549 ec8a7dc`（移除清点器与新门禁、恢复 health 的 service_role 探测）；
    无迁移、无 schema 变更，不需要数据库侧回滚。
- 下一步：继续 roadmap 中可本地执行的缺口（H02 上传元数据迁移、H05 storage policy 复审、
  H06 webhook 幂等约束、I04 ADR 状态、I06 release checklist v0.8.0、I07 本地 mock 开发指南、
  I08 provider 诊断指南、I09 贡献者测试矩阵、I10 迁移回滚 runbook、J02 E2E shard 策略、
  J03 CI 缓存、J07 tag/release 自动化等）。
- 最后更新：2026-09-13

## v0.8.0 后续 / H06_WEBHOOK_IDEMPOTENCY（Stripe webhook 幂等占位，本地完成）

- 状态：DONE（本地）
- 里程碑与发布目标：v0.8.0 后续补强（安全与数据一致性），归入 M1「安全与测试基建」；
  进入下一里程碑（v0.9.0）候选清单；本项不改版本号。
- 分支/PR：`feat/visual-regression-baseline`（本地分支，**无 PR**）；base `origin/main@15b05ebe`
  （本轮未 fetch/rebase）。权限边界 LOCAL_ONLY：未 push / 未建 PR / 未 merge / 未 deploy。
- 本地提交：`d2c8f06`（fix(mock): fill notification column defaults）、
  `d85b7ef`（fix(webhooks): claim webhook events before running side effects）、
  `90f8f5b`（docs(webhooks): document the webhook idempotency contract）、
  本进度条目的 docs 提交。
- 目标：roadmap H06「webhook 幂等约束」。`webhook_events` 此前只是"最后写一行日志"的记录表：
  处理器**先执行全部副作用**（写订阅状态、发"付款成功"通知）再 upsert，而 Stripe 是
  at-least-once 投递且对非 2xx 主动重试，因此同一 `event.id` 反复投递会**重复执行副作用**；
  F05 的"重复 event id 幂等"用例只断言日志行数，结构上发现不了重放。
- 已完成：
  - `supabase/migrations/030_webhook_event_idempotency.sql`：新增 `attempts integer not null
    default 1` 与 `last_attempt_at timestamptz not null default now()`；把 `event_id` 单列唯一
    收窄为 `(provider, event_id)` 复合唯一（`webhook_events_provider_event_id_key`）；
    新增 `claim_webhook_event(p_provider, p_event_id, p_event_type)`，`security definer` +
    `set search_path = ''`，`insert … on conflict do nothing` 命中即 `claimed/1`，否则
    `select … for update` 加行锁后判定：`status='failed'` 或（`received` 且
    `last_attempt_at < now() - 15 minutes`）→ 重新占位并 `attempts+1`，其余 → `duplicate`；
    末尾 `revoke all … from public, anon, authenticated` + `grant execute … to service_role`。
  - `src/lib/repositories/webhook-events.ts`：`claimWebhookEvent()` 走
    `createAdminClient().rpc("claim_webhook_event", …)`，**失败封闭**——RPC 报错或返回
    未知/缺失结论一律抛错，绝不降级成 `duplicate`（否则数据库故障会被伪装成"已处理"，
    Stripe 收 200 停止重试而静默丢失状态同步）；新增 `finalizeWebhookEvent()`；
    **删除** `upsertWebhookEvent()`（先写日志的旧模型）；`listRecentWebhookEvents` 增选 `attempts`。
  - `src/app/api/webhooks/stripe/route.ts`：签名校验后**先占位**。`duplicate` ⇒ 200
    `{received:true, duplicate:true}` 且零副作用；占位失败 ⇒ 500；`applyEvent()` 归一为
    `"processed" | "skipped"`；副作用失败 ⇒ `markEventFailed()`（`status='failed'`）+ 500
    让 Stripe 重试可重新占位；副作用**成功之后**的 `finalizeWebhookEvent` 放在独立
    try/catch，失败只记日志、响应保持 200（此时回 500 会让下次重试必然重放副作用）。
  - `src/lib/mock/index.ts`：`claimMockWebhookEvent()` 镜像 030 的状态机（含 15 分钟租约与
    `attempts` 累加），`MockSupabaseClient.rpc` 改为真正的 `async` 方法（非 async 且返回
    `then` 会触发 TS1320）。**另修** `persistInsert()` 未补 `notifications` 列默认值
    （`is_read=false` / `email_sent=false`）导致按这两列过滤时漏行的 mock 与真实库不一致问题；
    `src/app/api/e2e/seed-notifications/route.ts` 的 GET 新增 `includeSent=true`
    （默认行为不变，仅放开待发队列过滤，供断言"已实时单发"的通知）。
  - 测试：新增 `src/app/api/webhooks/stripe/route.test.ts`（10 条）、
    `src/lib/repositories/webhook-events.test.ts`（15 条）、mock 状态机与列默认值用例（6 + 1 条）、
    E2E「重复投递不重放副作用（付款通知只写一次）」（0 → 1 → 1 计数 + `status=skipped`/`attempts=1`）。
  - 门禁清点同步：`src/lib/security/admin-client-boundary.ts` 的 `webhook-events.ts` 条目更新为
    `calls: [claimWebhookEvent, countWebhookEvents, finalizeWebhookEvent, listRecentWebhookEvents]`、
    `rpc: [claim_webhook_event]`，调用点总数 80 → **81**；
    `pnpm db:types` 与 `pnpm update:migrations-manifest` 重生成（030 sha256
    `47cbb985e38f158efd73610ab880870c1a1c3743e1a67a96b1778a1146182b70`）。
  - 文档：新增 `docs/db/webhook-idempotency.md`（必要性、旧/新行为对照、协议与状态机、
    运维自查 SQL、回滚步骤）；`docs/db/security-audit.md` 计数 29→30 迁移、80→81 调用点、
    RPC 暴露面 0→1 并补 `SECURITY DEFINER` 行；`CHANGELOG.md` 记录 Changed + Fixed。
- 变更文件：`supabase/migrations/030_webhook_event_idempotency.sql`（新增）、
  `supabase/migration-manifest.json`、`src/lib/supabase/database.types.ts`、
  `src/lib/repositories/webhook-events.ts` + 测试、`src/app/api/webhooks/stripe/route.ts` + 测试（新增）、
  `src/lib/mock/index.ts` + `src/lib/mock.test.ts`、`src/app/api/e2e/seed-notifications/route.ts`、
  `e2e/webhook-events.spec.ts`、`src/lib/security/admin-client-boundary.ts` + 测试、
  `docs/db/webhook-idempotency.md`（新增）、`docs/db/security-audit.md`、`CHANGELOG.md`、
  `docs/progress.md`。
- 验证命令与结果：
  - **本地 Supabase 真库验证**（`docker exec -i supabase_db_indiestack psql -U postgres -d postgres`）：
    030 应用成功（共 30 个迁移）；顺序投递 1 次 `claimed`、重投 `duplicate`；
    **8 路并发**同一 event_id → 恰好 1 个 `claimed` + 7 个 `duplicate`；
    权限矩阵 `anon=f`、`authenticated=f`、`service_role=t`。
  - `pnpm lint` → 通过（复杂度 ≤ 15）。
  - `pnpm type-check` → 通过。
  - `pnpm test` → **116 文件 / 1191 测试**全部通过（上一批基线 115 文件 / 1168 测试）。
  - `pnpm test:e2e` → **63/63 通过**（41.0s，上一批基线 62/62）。
  - `pnpm check:supabase-security` → ✅ **30 迁移、19 表、39 条生效策略、29 个已分类
    service-role 调用点（81 个调用点）**。
  - `pnpm check:migrations` → ✅ 30 个迁移与 manifest 一致；`pnpm check:migration-history` → ✅ 对齐。
  - `pnpm check:all` → 通过（locales 972/972、i18n 837、agents、rls 30/19/35、
    migrations、supabase-security、security 708 文件 / 416 源文件 / 8 workflow、
    release-docs v0.8.0 7 件、changelog 8 released + 1 Unreleased、docs、a11y、type-check、lint、test）。
  - `pnpm build` → 通过（production build，动态 dashboard 路由与静态 sitemap/robots 正常产出）。
  - `pnpm check:docs` / `pnpm check:changelog` → 通过。
- 阻塞：无技术阻塞；发布侧为权限边界（LOCAL_ONLY，无 push / PR / merge / deploy 授权）。
- 未验证项：
  - 生产库的 `proacl` / `has_function_privilege` 未探测（需生产只读凭证）；权限矩阵仅在本地 Supabase 验证。
  - Stripe **真实重试链路**（Stripe 侧按非 2xx 自动重投）未验证：本地用签名重放模拟同一 `event.id`。
  - 进程崩溃后 `received` 行超过 15 分钟被回收的路径只做了 SQL/mock 单测，未做长时间真实挂起演练。
  - `finalizeWebhookEvent` 失败的"响应仍 200 + 只记日志"分支只做单测，未在生产观测 `status` 停留
    `received` 超过租约后由 Stripe 重试救回的实际轨迹。
- 风险与回滚：
  - 风险：`duplicate` 一律回 200 会让 Stripe 停止重试；若某次投递**副作用失败但状态被错误写成
    非 `failed`**，该事件将永久停留在重复结论。当前靠 `failed` 标记 + 15 分钟租约兜底，
    但要求 `markEventFailed()` 自身成功（它失败时仅记日志）。
  - 风险：`claim_webhook_event` 是 `SECURITY DEFINER`，权限一旦误授予 `anon`/`authenticated`
    即可伪造占位或置 `failed` 触发重放；`check:supabase-security` 已按（固定 `search_path`
    + 仅 `service_role`）纳入门禁。
  - 回滚：见 `docs/db/webhook-idempotency.md` 的回滚步骤——**先回应用**（恢复先执行副作用、
    后写日志的旧路径），**再回 DDL**（删函数、删 `(provider, event_id)` 唯一约束、可选删两列）；
    回滚期间必须接受同一 `event.id` 重投会重放副作用。
  - 代码层回滚：`git revert 90f8f5b d85b7ef`（`d2c8f06` 是独立的 mock 与真实库一致性修复，
    不应随本项回滚）。
- 下一步：继续 roadmap 中可本地执行的缺口（H02 上传元数据迁移、H05 storage policy 复审、
  I04 ADR 状态、I06 release checklist v0.8.0、I07 本地 mock 开发指南、I08 provider 诊断指南、
  I09 贡献者测试矩阵、I10 迁移回滚 runbook、J02 E2E shard 策略、J03 CI 缓存、
  J07 tag/release 自动化等）。
- 最后更新：2026-09-13

## v0.8.0 后续 / H05_STORAGE_POLICY_INVENTORY（对象存储 bucket 清点门禁，本地完成）

- 状态：DONE（本地）
- 里程碑与发布目标：v0.8.0 后续补强（安全门禁）；H05 完成后 M1「安全与测试基建」仅剩 H02 上传元数据迁移。
- 分支/PR：`feat/visual-regression-baseline`（本地分支，无 PR）；base `origin/main@15b05ebe`（本轮未 fetch/rebase）。
- 本地提交：`90f0071`（feat(security): audit storage buckets from code instead of a hardcoded name）、
  `docs(security): document the storage bucket policy audit`、本进度条目的 docs 提交。
- 目标：roadmap H05「storage policy 复审」。旧门禁把 bucket 名写死成字面量
  `avatars`，只在 `src/lib/storage/index.ts` 里找 `storage.from("avatars")`，再按 4 个
  **policy 名字符串**做正则匹配。两个盲区：
  (a) 任何第二个 bucket（写在别的模块、别的写法）都不会被检查、也没有对应迁移或策略就上线；
  (b) 只要旧 policy 名字还留在迁移语料里，重命名/重写策略依然能通过。
- 已完成：
  - 新增 `src/lib/security/storage-policies.ts`：按**代码**发现 bucket，再与迁移里的
    bucket 行、生效策略集交叉核对。
    - `discoverStorageBuckets(appSources)`：正则 `\.storage\s*\.\s*from\s*\(\s*["'`]([a-z0-9][a-z0-9_-]*)["'`]\s*\)`
      （大小写不敏感，兼容 admin/supabase 等任意接收者，去重排序）。
    - `collectVersionedBuckets(migrations)`：逐语句（`splitSqlStatements`）解析
      `insert into storage.buckets ... values ('<id>', …)`。
    - `collectStoragePolicies(migrations)`：复用 `extractEffectivePolicies`，因此后续
      migration 的 `drop policy` 会正确移除覆盖。
    - `STORAGE_BUCKET_INVENTORY`（当前仅 `avatars`：`read:"public"`、
      `tenantScopedWrites:true` + 理由），每条都是一次人工复审决策。
    - 7 条失败封闭规则：`STORAGE_BUCKET_UNDECLARED`、`STORAGE_BUCKET_UNVERSIONED`、
      `STORAGE_BUCKET_UNPOLICED`、`STORAGE_WRITE_POLICY_UNSCOPED`（需同时含
      `bucket_id` + `storage.foldername` + `auth.uid()`）、`STORAGE_READ_POLICY_UNSCOPED`、
      `STORAGE_PRIVATE_BUCKET_PUBLIC_READ`、`STORAGE_PUBLIC_BUCKET_UNREADABLE`；
      另有非阻断 warning：inventory 条目已无任何代码引用（可能是过期决策）。
    - 入口 `inspectStoragePolicies({migrations, appSources, inventory?}) → {issues, warnings}`。
      因 `scripts/lib/supabase-security-check.js` 在 Node type-stripping 下运行，跨目录导入
      必须显式写 `.ts` 扩展名。
  - `scripts/lib/supabase-security-check.js`：删除写死的 `STORAGE_POLICY_RULES` /
    `checkStoragePolicies`；新增 `readAppSources(srcDir, root)`（非测试 `src/**` 的
    `.ts/.tsx`，仓库相对路径，排序）并被 `checkAdminClientBoundary` 复用；
    接入 `inspectStoragePolicies(...)`，issue 统一输出 `[CODE] message`，warning 照旧打印。
  - 测试：`src/lib/security/storage-policies.test.ts` 新增 20 条，含一条**仓库全量回归**
    （`fs.readdirSync(dir, {recursive:true})` + `entry.parentPath` 读真实迁移与真实
    `src/**`，断言零 issue、零 warning），保证门禁与仓库现状绑定。
- 变更文件：`src/lib/security/storage-policies.ts`（新增）+ 测试（新增）、
  `scripts/lib/supabase-security-check.js`、`docs/db/storage-policy-audit.md`（新增）、
  `docs/db/security-audit.md`、`CHANGELOG.md`、`docs/roadmap-0.6.0.md`、`docs/progress.md`。
- 验证命令与结果：
  - `pnpm vitest run src/lib/security/storage-policies.test.ts` → **20/20 通过**。
  - **失败封闭实证**：临时新建 `src/lib/security/__storage-probe.ts` 写入
    `admin.storage.from("project-attachments")` → 门禁 exit 1，且恰好报出
    `STORAGE_BUCKET_UNDECLARED` + `STORAGE_BUCKET_UNVERSIONED` + `STORAGE_BUCKET_UNPOLICED`
    三条；删除探针后门禁恢复绿色。（教训：正则不能在文档注释里写出真实 bucket 名，
    否则注释本身会被计入发现结果。）
  - **本地 Supabase 运行时交叉核对**（`docker exec -i supabase_db_indiestack psql -U postgres -d postgres`）：
    `select id,name,public from storage.buckets` → 仅 `avatars|avatars|t` 一行；
    `pg_policies` 查 `storage.objects` → 4 条（SELECT/INSERT/UPDATE/DELETE），谓词与
    迁移 `024` 一致（写策略均为 `(bucket_id='avatars') AND ((storage.foldername(name))[1] = (SELECT (auth.uid())::text))`）。
  - **身份矩阵**（逐条 `psql -c` 单跑并读 printed error / `exit=$?`，多语句脚本只会报告最后一条状态）：
    anon INSERT 被拒；authenticated 写他人目录被拒；authenticated 写自己目录 `INSERT 0 1`；
    写未登记 bucket 被拒；authenticated UPDATE 他人行 `UPDATE 0`；anon SELECT 允许（`count = 0`）。
    注：`storage.objects` 的直接 `DELETE` 被 Supabase `storage.protect_delete()` 触发器拦截，
    因此行级范围用 UPDATE 取证。
  - `pnpm check:supabase-security` → ✅ **30 迁移、19 张公开表、server-only service role 检查、
    39 条生效 RLS 策略、29 个已分类 service-role 调用点**。
  - `pnpm lint` → 通过；`pnpm type-check` → 通过；`pnpm check:docs` → 通过；`pnpm check:changelog` → 通过。
  - `pnpm check:all` → 通过（**117 文件 / 1211 测试**，上一批基线 116 文件 / 1191 测试）。
  - `pnpm build` → 通过（production build 正常完成）。
- 阻塞：无技术阻塞；发布侧为权限边界（LOCAL_ONLY，无 push / PR / merge / deploy 授权）。
- 未验证项：
  - 生产库的 `storage.buckets` / `pg_policies` 未探测（需生产只读凭证）；运行时交叉核对仅在本地
    Supabase 完成。
  - 未做真实浏览器端的 Storage-API 上传链路验证（本次仅静态门禁 + psql 授权矩阵）。
  - `readAppSources` 只覆盖 `src/**`；若未来有 bucket 引用出现在 `src/` 之外（例如
    `scripts/`、`supabase/functions/`），需扩大扫描范围——当前仓库无此情况。
- 风险与回滚：
  - 风险：门禁靠**约定**而非运行时强制——新增 bucket 必须同时改 `src` 引用与
    `STORAGE_BUCKET_INVENTORY`，否则 `STORAGE_BUCKET_UNDECLARED` 会让 CI 红。
    这是有意的失败封闭设计；若某次紧急发版需要临时 bypass，只能改 inventory 并留下复审记录。
  - 风险：写策略只校验"含 `bucket_id` + `storage.foldername` + `auth.uid()`"这三个标记，
    更复杂但仍正确的谓词（例如按 team 共享目录）会被误报，需要用 inventory 的模型显式表达。
  - 回滚：`git revert 90f0071`（纯静态门禁 + 文档，无 schema 变更、无数据迁移）；
    回滚后旧的字面量 `avatars` 门禁恢复，安全覆盖面退回到 H05 之前。
- 下一步：继续本地可执行缺口——H02 上传元数据迁移（与 `src/lib/uploads/service.ts` 当前直接写
  `profiles.avatar_url` / `projects.cover_url` 的行为需要协同设计）、I04 ADR 状态、I06 v0.8.0
  release checklist、I07 mock 开发指南、I08 provider 诊断指南、I09 贡献者测试矩阵、
  I10 迁移回滚 runbook、J02 E2E shard、J03 CI 缓存、J07 tag/release 自动化。
- 最后更新：2026-09-13

## v0.8.0 后续 / H02_UPLOAD_METADATA（上传元数据迁移，本地完成）

- 状态：DONE（本地）
- 里程碑与发布目标：v0.8.0 后续补强（安全与测试基建）；**H02 完成后 M1「安全与测试基建」的可本地执行项全部完成**，进入 RELEASE_FREEZE 评估（见条目末尾「下一步」）。
- 分支 / PR：`feat/visual-regression-baseline`（本地分支，无 PR）；base `origin/main@15b05ebe8e93725e16698e8b66fc9c43e3733965`；**未 push / 未 merge / 未 deploy**。
- 本地提交：`ee94266 feat(uploads): record upload object metadata for orphan detection`（代码 + 迁移 + 测试）、本进度条目的 docs 提交。
- 目标：把只以 URL 字符串存在的上传对象变成可审计、可枚举的登记行，堵住「回写失败/进程被杀/替换头像留下永久公开孤儿对象」的治理盲区。
- 已完成：
  - 迁移 `031_upload_objects.sql` 新增 `public.upload_objects`：`bucket` / `object_key` / `owner_id`
    （`references auth.users(id) on delete cascade`）/ `byte_size`（`> 0`）/ `content_type` /
    `checksum`（`^[0-9a-f]{64}$`）/ `status`（`active|deleted`）/ 时间戳；
    `unique (bucket, object_key)`，`(owner_id,status)` 与 `(bucket,status)` 两条索引，
    `handle_updated_at` 触发器。RLS 打开且**零策略**，并 `revoke insert, update, delete, truncate
    ... from anon, authenticated`（即使将来误加策略，表级写权限仍缺失）。
  - 访问边界：新增 `src/lib/repositories/upload-objects.ts`（`createAdminClient()`，
    `recordUploadObject` 走 `upsert(..., { onConflict: "bucket,object_key" })` 并复位 `status='active'`，
    `markUploadObjectDeleted` 标记删除、行不存在是 no-op）；同时登记进
    `src/lib/security/admin-client-boundary.ts`（`data-access`，表 `upload_objects`）与
    `src/lib/security/rls-coverage.ts` 的 `SERVER_ONLY_TABLES`，门禁保持失败封闭。
  - 上传协议（`src/lib/uploads/service.ts`）：抽出 `stageUploadObject()` 统一「put → 落元数据 → 失败即回滚」，
    头像与项目封面共用；元数据写失败 → 删对象 + `uploadFailed`；业务表回写失败 → 删对象 + 标记 deleted；
    替换旧对象仅在 `cleanupStorageObject` 返回 `true` 时把旧行标记 `deleted`，删除失败不标记（避免漏报）；
    `markDeletedQuietly()` 让"删除后再标记失败"只记日志，不触发多余回滚。
    保留 `manager bucket` 的既有事实：封面与头像同在 `avatars` bucket，靠 `covers/<projectId>/…`
    与 `avatars/<userId>/…` 前缀区分。
  - 新增 `src/lib/uploads/checksum.ts`（`node:crypto` sha256 十六进制）与 mock 支持
    （`_mockUploadObjects` 缓存、`upload_objects` 读写分支、`status` 默认 `active`，
    并把 `upsert()` 的 `onConflict` 扩展为支持逗号分隔复合列，单列行为不变）。
  - 测试：`src/lib/repositories/upload-objects.test.ts`（4）、`src/lib/uploads/checksum.test.ts`（3）、
    `src/lib/uploads/service.test.ts`（17，新增"元数据写入失败回滚对象"「顺序 put→元数据→业务表」
    「旧对象删除失败不标记 deleted」等）、`src/lib/mock.test.ts`（41，新增 5 条复合键/跨 bucket/默认值）。
  - 回归修正：`src/lib/security/admin-client-boundary.test.ts` 的调用点预算由 81 上调到 83
    （新增 2 个调用点），并加注释说明该数字必须与清单、文档同步更新。
  - 文档：新增 `docs/db/upload-metadata.md`（盲区 → 数据模型 → 访问边界 → 写入协议 → 孤儿巡检 SQL →
    已知边界 → 回滚 → 验证命令）；`docs/db/security-audit.md` 计数更新（31 迁移 / 20 张 public 表 /
    30 个模块 83 个调用点 / 15 张表 / server-only 白名单加入 `upload_objects`）并加互链；
    `CHANGELOG.md` Unreleased/Added、`docs/roadmap-0.6.0.md` H02 标记完成。
- 变更文件：`supabase/migrations/031_upload_objects.sql`（新增）、`supabase/migration-manifest.json`、
  `src/lib/supabase/database.types.ts`、`src/lib/uploads/checksum.ts`（新增）+ 测试、
  `src/lib/repositories/upload-objects.ts`（新增）+ 测试、`src/lib/uploads/service.ts` + 测试、
  `src/lib/mock/index.ts` + 测试、`src/lib/security/admin-client-boundary.ts` + 测试、
  `src/lib/security/rls-coverage.ts`、`docs/db/upload-metadata.md`（新增）、
  `docs/db/security-audit.md`、`CHANGELOG.md`、`docs/roadmap-0.6.0.md`、`docs/progress.md`。
- 验证命令与结果：
  - `pnpm exec supabase migration up --local` → 031 应用成功（本地共 31 个迁移）；
    `pnpm db:types`、`pnpm update:migrations-manifest` → 生成物与迁移一致。
  - **本地 psql 运行时核对**（`docker exec -i supabase_db_indiestack psql -U postgres -d postgres`）：
    `relrowsecurity = t`、`pg_policies` 计数 `0`、列数 `10`；`role_table_grants` 显示 anon /
    authenticated 只剩 `REFERENCES, SELECT, TRIGGER`（insert/update/delete 已收回），service_role 全权限。
  - **身份矩阵**（逐条 `psql -c` 单跑，`set local role` + `set local request.jwt.claims` + `rollback`）：
    anon SELECT **0 行**、authenticated SELECT **0 行**、service_role SELECT **1 行**；
    anon / authenticated 的 INSERT、UPDATE、DELETE 六条路径全部
    `ERROR: permission denied for table upload_objects`。探针行与探针用户已删除（`upload_objects` 0 行、`auth.users` 仍为 3 行）。
  - **约束与级联**（同上 psql）：非法 checksum → `upload_objects_checksum_check`；
    重复 `(bucket, object_key)` → `upload_objects_bucket_key_unique`；
    UPDATE 后 `updated_at > created_at`（触发器生效）；删除 `auth.users` 行后元数据行级联消失（回滚事务内验证）。
  - `pnpm check:rls` → ✅ **31 迁移、20 张 public 表、35 条生效策略，全部已分类**。
  - `pnpm check:supabase-security` → ✅ **31 迁移、20 张 public 表、39 条生效 RLS 策略、
    30 个已分类 service-role 调用点**（清单实际 30 模块 / 83 调用点）。
  - `pnpm lint` → 通过（先修掉 `getData` 31 > 30、两个上传函数 16 > 15 的复杂度超限：
    mock 抽出 `readTable()`，服务层抽出 `stageUploadObject()`；`src/lib/mock/index.ts`
    的存量豁免仍然必要，其余 8 个函数仍 > 15）。
  - `pnpm type-check` → 通过；`pnpm check:all` → 通过（**119 文件 / 1228 测试**，上一批基线 117 文件 / 1211 测试）；
    `pnpm build` → 通过（production build 正常完成）。
- 阻塞：无技术阻塞；能力边界为 LOCAL_ONLY（无 push / PR / merge / deploy 授权）。
- 未验证项：
  - 生产库的 `upload_objects` 未探测（需生产只读凭证）；运行时身份矩阵仅在本地 Supabase 完成。
  - 真实浏览器端的 Storage-API 上传链路未重跑（本次为静态门禁 + psql 授权矩阵 + 服务层单测）。
  - 反向孤儿巡检（bucket 列表 → 元数据差集）尚未实现为定时任务/worker，本批次只落数据；
    没有真实 provider 列表权限，无法在本地做端到端孤儿清理验证。
  - `owner_id` 级联删除只在回滚事务内验证，未在生产删除流程上跑过。
- 风险与回滚：
  - 风险：新增一次元数据写会让上传路径多一次数据库往返；元数据故障现在会**让上传失败**
    （有意的失败封闭取舍——宁可上传失败也不留无登记的公开对象）。
  - 风险：表是旁路记录，`status='deleted'` 只代表"应用认为已删除"；绕过应用直写 bucket 的对象
    不会出现在表里，需要巡检侧做反向差集。
  - 回滚：先 `git revert ee94266` 恢复服务层与仓储（停止写元数据），再 `drop table if exists public.upload_objects;`
    + `notify pgrst, 'reload schema';`。**顺序不能反**——先删表会导致每次上传写不存在的表。
    详细步骤见 `docs/db/upload-metadata.md` 的「回滚」。
- 下一步：H02 收尾即触发 **RELEASE_FREEZE**：M1「安全与测试基建」的 H02–H10 可本地执行项已全部完成，
  按语义化版本评估下一版本号（新增功能 + 安全加固 → minor）、写 CHANGELOG 与发布说明、确认迁移/回滚方案、
  跑全量 `pnpm verify:build` 与 release 文档门禁，并把 tag/PR 准备到 LOCAL_ONLY 允许的最后一步（本地提交 + exit report）。
- 最后更新：2026-09-13

## v0.9.0 / RELEASE_FREEZE（M1「安全与测试基建」收口，本地完成）

- 状态：DONE（本地范围）／发布已准备到 LOCAL_ONLY 允许的最后一步
- 里程碑与发布目标：M1「安全与测试基建」（C、F、H 任务域）退出条件达成 → v0.9.0 RELEASE_FREEZE
- 分支/PR：`feat/visual-regression-baseline`（本地）；**无 PR**（未获创建 PR 授权）
- 本地提交：`b26a953`（发布准备）；本里程碑代码提交见 `5db7c0b`、`af956aa`、`ca0770b`、`d1ab460`、
  `ec8a7dc`、`b3b1549`、`d85b7ef`、`90f8f5b`、`a908662`、`90f0071`、`406c8fb`、`ee94266`、`dea198d`
- 版本号：0.8.0 → **0.9.0**（minor：新增功能 + 安全加固 + 5 个追加式迁移）
- 目标：把 v0.8.0 之后发现的权限、上传登记与幂等缺口收口，并把发布从「打 tag」变成可审计、
  可暂停、可回滚的操作；产出版本号、CHANGELOG、发布/回滚/smoke runbook、双语 README 与 docs-site 版本页。

### 包含任务

| 任务 | 内容                                     | 提交                          |
| ---- | ---------------------------------------- | ----------------------------- |
| H02  | 上传对象元数据迁移（031）                | `ee94266` + `dea198d`         |
| H05  | Storage bucket 策略审计跟随代码          | `90f0071` + `406c8fb`         |
| H06  | Stripe webhook 幂等占位（030）           | `d85b7ef` + `90f8f5b`/`a908662` |
| H03  | RLS 全表回归门禁修复（35 条策略漏检）    | `d1ab460`                     |
| H04  | service_role 调用点清单门禁              | `ec8a7dc` + `b3b1549`         |
| H07  | 审计日志索引复审 + 精确计数收口          | `ca0770b`                     |
| H09  | 审计日志写入面收口（029）                | `af956aa`                     |
| H09  | SECURITY DEFINER 执行权限收口（028）     | `5db7c0b`                     |
| H08  | 邮件 worker 运行记录保留期（027）        | `9331c1d`                     |
| —    | Push 重试链路 mock-only E2E 覆盖         | `5c76873` + `67fdab8`         |
| —    | 发布产物（CHANGELOG/runbook/README/docs） | `b26a953`                     |

### 发布产物

- `package.json` 0.9.0、`.env.example` `NEXT_PUBLIC_APP_VERSION=0.9.0`
- `CHANGELOG.md`：`[Unreleased]` 转为 `## [0.9.0] — 2026-09-13`（主题：安全与权限边界收口 +
  测试与发布门禁加固；Added 4 / Changed 3 / Fixed 2 / Security 3），并新开 `[Unreleased] / ### Planned`
  指向下一里程碑（G01–G07 UI 系统收口）
- `docs/operations/release-runbook-v0.9.0.md`（73 行，含 027–031 部署顺序与新增观察项）
- `docs/operations/rollback-runbook-v0.9.0.md`（101 行，含 030/031 顺序陷阱与「不可先用回滚恢复权限」）
- `docs/operations/production-smoke-v0.9.0.md`（60 行，干净「未执行」基线，新增迁移基线/上传元数据/
  客户端 rpc 越权/匿名审计写入/webhook 幂等与重试共 6 行）
- `docs/operations/release-gap-audit-v0.9.0.md`（75 行缺口表与可复现验证）
- `README.md`、`README.zh-CN.md`、`.github/RELEASE_CHECKLIST.md` 指向 v0.9.0 产物
- `docs-site/v0.9.0.md`、`docs-site/zh-CN/v0.9.0.md` 并注册进两侧「Releases / 版本动态」侧边栏

### 验证命令与结果

- `pnpm check:release-docs` → ✅ release documentation checks passed (v0.9.0, 7 artifacts)
- `pnpm check:changelog` → ✅ 9 个已发布版本，1 个 Unreleased 章节
- `pnpm check:docs` → ✅ docs-site scripts 文档与 package.json 同步
- `pnpm check:migrations` → ✅ 31 个不可变迁移与 SHA-256 清单一致
- `pnpm check:migration-history` → ✅ migration history is aligned: 31 local migrations applied
- `pnpm check:all` → ✅ 全部校验通过（locales / i18n / agents / rls / migrations / supabase-security /
  security / release-docs / changelog / docs / a11y / type-check / lint / **119 文件 1228 测试**）
- `pnpm verify:build` → ✅ （`pnpm verify` + `next build` 全绿，路由表正常产出）
- `pnpm test:coverage` → ✅ statements 96.12% / **branches 90.72%** / functions 95.91% / lines 97.21%
  （branches 门禁 90% 以上）
- `pnpm test:e2e` → ✅ **63 passed (42.3s)**（含 `e2e/push-retry.spec.ts` 10 条 mock-only 用例）
- `pnpm audit --audit-level high` → ✅ No known vulnerabilities found
- `pnpm --filter indiestack-docs build` → ✅ build complete in 3.52s

### 发布状态

- 版本号：**v0.9.0**
- base SHA：`15b05ebe8e93725e16698e8b66fc9c43e3733965`（`origin/main`，本会话 fetch 后未变）
- 发布 PR：**无**（LOCAL_ONLY，未获创建/更新 PR 授权）
- 合并方式：未合并（授权后按 rebase 策略合并）
- tag / release：**未创建**（本地仅存在历史 tag `v0.6.0`；v0.7.0/v0.8.0 同样未打）
- 部署：**未部署**（未获 deploy 授权）
- smoke：**未执行**，`docs/operations/production-smoke-v0.9.0.md` 保持「未执行」基线
- 迁移：027–031 已在**本地** Supabase 全部应用并通过历史门禁；生产未应用

### 未验证项（需外部权限）

- 生产 smoke（v0.8.0 与 v0.9.0 两份矩阵均未执行）：需部署授权 + `PRODUCTION_URL`。
- 生产迁移 027–031 与生产 `pg_policies` / `proacl` / `has_table_privilege` / `storage.buckets` /
  `upload_objects` 回读：需生产只读凭证。
- 真实浏览器 Push 投递、真实 `CRON_SECRET` 触发 `/api/cron/push-retry`：需生产 secrets + HTTPS。
- Stripe test-mode 签名生成器与隔离租户，用于生产 webhook 幂等/重试行。
- 反向孤儿巡检（bucket 列表 → 元数据差集）尚无 worker，仅落数据与巡检 SQL。
- `pnpm test:visual` 未在本批次重跑（基线文件未受本次改动影响）。

### 风险与回滚

- 风险：030 与 031 改变了应用与 schema 的耦合方式，**迁移与代码的先后顺序不能反**。发布必须
  「先迁移、再部署」；回滚必须「先回滚代码、再决定 schema」。
- 风险：028/029 的权限收窄会让仍在使用客户端密钥越权路径的调用方收到 `permission denied`——
  这是预期结果，不应回滚权限，而应把调用方改到 service_role 路径。
- 风险：上传路径多一次数据库往返，且元数据写失败会让上传失败（有意的失败封闭取舍）。
- 回滚：见 `docs/operations/rollback-runbook-v0.9.0.md`。代码层面 `git revert b26a953` 即可撤销发布
  产物；应用层面按 runbook 回退 deployment；数据库默认保持向前 schema，只在 DBA 与发布负责人共同
  批准后做破坏性操作（`drop table public.upload_objects`），且禁止用回滚恢复已收回的权限。

### 下一里程碑

- M2「上传与通知」剩余 UI 任务域：**G01–G07 UI 系统收口**（Tailwind v4 试点页迁移、design token
  收口、shared form field 统一、loading/empty/error 状态统一、暗色模式回归、移动端断点回归、
  键盘与 screen reader 交互），随后按路线图推进 I04/I06–I10 与 J02–J10。
- 已写入 `CHANGELOG.md` 的 `[Unreleased] / ### Planned` 作为对外承诺。

- 最后更新：2026-09-13

## v0.9.0 后续 / G05_DARK_MODE_REGRESSION（暗色模式首屏与持久化回归，本地完成）

- 状态：DONE（本地提交完成，未 push / 未 PR）
- 里程碑与发布目标：M2「UI 系统收口」G05，归入 v0.10.0（功能批次 → minor）
- 分支：`feat/visual-regression-baseline`（LOCAL_ONLY，base `origin/main@15b05ebe8e93725e16698e8b66fc9c43e3733965`）
- 本地提交：`000c35d fix(theme): apply the saved theme before first paint`（本文件为随后 docs 提交）
- 目标：让已保存/系统偏好主题在 hydration 之前生效，并修掉主题持久化完全失效的问题

### 已完成

- 复现（先红后绿）：`e2e/theme.spec.ts` 6 条用例在修复前 **5 failed / 1 passed**。
- 缺陷 1「首屏闪烁」：根布局没有阻塞脚本，主题只在 `ThemeProvider` 的 `useEffect` 里写入 `<html>`，
  服务端 HTML 出的是无 class 的浅色 → 深色用户先看到一帧浅色再跳成深色。
  修复：`src/app/layout.tsx` 在 `<head>` 注入带 CSP nonce（`NONCE_HEADER`）的内联脚本，
  读 `localStorage` → 回退 `prefers-color-scheme`，同步写 `light`/`dark` class 与 `color-scheme`；
  `localStorage` 与 `matchMedia` 各自 try/catch 兜底（隐私模式/老浏览器退化为系统偏好）。
- 缺陷 2「持久化失效」：`src/app/providers.tsx` 传 `storageKey="ui-theme"`，而 E2E 与文档约定的键是 `theme`，
  写入与读取位置不一致 → 刷新后主题丢失。修复：键名与解析规则收口到 `src/lib/theme/theme.ts`
  （`THEME_STORAGE_KEY` / `resolveTheme` / `buildThemeScript`），Provider、根布局、E2E 共用同一份定义，
  禁止再出现字面量漂移。
- 顺带收敛：`ThemeProvider` 在 system 模式下监听 `prefers-color-scheme` 实时跟随；设置主题写存储失败时
  仍切换当前会话；解析后的主题同时写 `color-scheme`，使原生控件/滚动条跟随。
- 回归加固：`e2e/smoke.spec.ts` 的主题切换用例原先能“靠 hydration 后 class 从无到有”假通过，
  现在必须由真实点击驱动（并用重试吸收 dev server 冷编译导致的 hydration 延迟）。

### 变更文件

- `src/lib/theme/theme.ts`（新增）、`src/lib/theme/theme.test.ts`（新增）、
  `src/lib/theme/theme.dom.test.ts`（新增）
- `src/app/layout.tsx`、`src/app/providers.tsx`、`src/components/providers/theme-provider.tsx`
- `e2e/theme.spec.ts`（新增，6 条）、`e2e/smoke.spec.ts`
- `CHANGELOG.md`（`[Unreleased] / ### Fixed`）、`docs/roadmap-0.6.0.md`（G05 完成说明）

### 验证命令与结果

- `pnpm exec vitest run src/lib/theme/theme.test.ts src/lib/theme/theme.dom.test.ts src/components/layout/theme-toggle.test.tsx`
  → ✅ 3 文件 15 测试通过
- `pnpm exec playwright test e2e/theme.spec.ts` → ✅ **6 passed**（首屏 4 条阻断 `/_next/static/**`，
  证明主题不依赖 React；切换 2 条覆盖持久化与 `color-scheme`）
- `pnpm lint` → ✅ `eslint .` 无告警
- `pnpm type-check` → ✅ `tsc --noEmit` 无错误
- `pnpm test` → ✅ **121 文件 1241 测试**（G05 前 119 文件 1228 测试）
- `pnpm test:e2e` → ✅ **69 passed (40.2s)**（G05 前 63 passed）
- `pnpm check:all` → ✅ 全部校验通过（含 31 迁移 / 39 条有效 RLS 策略 / changelog / a11y / lint / 单测）
- `pnpm verify:build` → ✅ `pnpm verify` + `next build` 全绿

### 阻塞

- 无本地阻塞。

### 风险与回滚

- 风险：内联脚本必须在 `<head>` 且同步执行，后续若有人把它挪到 `next/script` 的 `afterInteractive`，
  闪烁会回归——`e2e/theme.spec.ts` 的首屏断言会立刻失败（阻断 `/_next/static/**` 仍要求 class 正确）。
- 风险：CSP 由 `strict-dynamic` 生效，内联脚本依赖 `nonce`；若中间件被绕过（无 `x-nonce`），
  该脚本会被浏览器拦截。首屏 E2E 在真实 Chromium 中执行同一路径，可覆盖此回归。
- 回滚：`git revert 000c35d` 即可回到「无首屏脚本 + `ui-theme` 键」状态；无数据/迁移影响。

### 下一步

- G06 移动端断点回归（375/768/1280 断点导航与卡片布局 + Playwright 断点断言）。

- 最后更新：2026-09-13

## v0.9.0 后续 / G06_MOBILE_BREAKPOINT_REGRESSION（移动端断点回归，本地完成）

- 状态：DONE（本地验证完成；未 push / 未开 PR / 未 merge / 未 deploy）
- 里程碑与发布目标：M2「UI 系统收口」（[docs/roadmap-0.6.0.md](roadmap-0.6.0.md) G01–G10），
  退出后进入下一里程碑 release freeze；当前版本仍是 `0.9.0`，本任务不升版本。
- 分支 / PR：`feat/visual-regression-baseline`（LOCAL_ONLY，无 PR）；base
  `origin/main@15b05ebe8e93725e16698e8b66fc9c43e3733965`
- 本地提交：`d042310`（fix）
- 目标：用真实浏览器的断点断言证明三类视口（375 / 768 / 1280）下公共页与仪表盘都可导航、无横向溢出。

### 已完成

- 新增 `e2e/responsive.spec.ts`（11 条）作为回归入口：视口元信息、375px 汉堡菜单可展开并跳转、
  `/` `/features` `/pricing` `/dashboard` 无横向溢出、375px 仪表盘移动导航可达、
  768px 汉堡菜单 + 侧边栏可见、1280px 完整导航与侧边栏宽度。溢出断言会打印实际越界元素，
  失败信息可直接定位组件，而不是只报 `scrollWidth` 数字。
- 缺陷 1（横向溢出）：`@utility container` 恒为 `padding-inline: 2rem`，在 375px 视口里占掉 17% 宽度，
  页头右侧操作区被推出视口（`scrollWidth=428 > innerWidth=375`，越界元素为页头
  `div.flex.items-center.gap-3`）。改为默认 1rem、`@media (width >= 40rem)` 恢复 2rem；
  1280px 桌面渲染不变（视觉基线验证）。
- 缺陷 2（导航不可达）：`DashboardSidebar` 是 `hidden md:block`，手机上整个导航消失，
  用户只能手改地址栏才能到达分析 / 团队 / 设置等页面。新增 `MobileDashboardNav`
  （`ui/sheet` 左抽屉，`md:hidden`，带未读 badge 与管理员入口，路径变化后自动关闭）。
- 页头断点 md→lg：768px 下导航链接会挤压页头，改为窄屏统一用汉堡菜单，并补齐
  `aria-label`（common.menu）/ `aria-expanded` / `aria-controls="site-mobile-menu"`；
  触屏没有物理键盘，快捷键入口只在 `md` 以上渲染。
- 去重（防止两侧漂移）：导航链接收口到 `src/components/dashboard/dashboard-nav-links.ts`
  （`buildDashboardNavLinks` / `ADMIN_NAV_LINK` / `isNotificationsLink`），角色与未读状态抽成
  `use-is-admin` / `use-unread-notifications` 两个 hook，桌面侧边栏与移动抽屉共用同一份定义
  与同一个 `QUERY_KEYS.unreadCount`（react-query 自动去重，不会因两个入口翻倍轮询）。
- 新增 i18n 键 `common.menu` / `common.dashboardMenu`（en/zh-CN 同步）。
- 顺带修掉两处 lint 硬门禁违规：`use-is-admin` 与移动抽屉原先在 effect 体内同步 `setState`
  （`react-hooks/set-state-in-effect`），前者改为把结果与 userId 绑定存储后由返回值判定，
  后者改用 render 期间同步 state 的官方模式。

### 变更文件

- `e2e/responsive.spec.ts`（新增，11 条）
- `src/components/dashboard/mobile-dashboard-nav.tsx`（新增）、`mobile-dashboard-nav.test.tsx`（新增，8 条）
- `src/components/dashboard/dashboard-nav-links.ts`（新增）、`dashboard-nav-links.test.ts`（新增，6 条）
- `src/components/dashboard/dashboard-sidebar.test.tsx`（新增，4 条）
- `src/hooks/use-is-admin.ts`（新增）、`src/hooks/use-unread-notifications.ts`（新增）
- `src/components/dashboard/dashboard-sidebar.tsx`、`src/components/layout/site-header.tsx`
- `src/app/dashboard/layout.tsx`、`src/app/globals.css`
- `messages/en/common.json`、`messages/zh-CN/common.json`
- `CHANGELOG.md`（`[Unreleased] / ### Fixed`）、`docs/roadmap-0.6.0.md`（G06 完成说明）

### 验证命令与结果

- `pnpm exec playwright test e2e/responsive.spec.ts` → ✅ **11 passed (10.8s)**
- `pnpm test` → ✅ **124 文件 1259 测试**（G06 前 121 文件 1241 测试）
- `pnpm test:e2e` → ✅ **80 passed (46.7s)**（G06 前 69 passed；页头断点改动未破坏既有 smoke / a11y 用例）
- `pnpm lint` → ✅ `eslint .` 无告警
- `pnpm type-check` → ✅ `tsc --noEmit` 无错误
- `pnpm check:all` → ✅ 全部校验通过（en/zh-CN 各 974 key 一致、31 迁移、39 条 RLS 策略、a11y 静态审计、changelog）
- `pnpm verify:build` → ✅ `pnpm verify` + `next build` 全绿
- `pnpm test:visual`（`mcr.microsoft.com/playwright:v1.63.0-noble` 容器内，按
  [docs/testing.md](testing.md) 的 Linux 基线流程）→ ✅ **4 passed**，1440×900 桌面全页截图无像素变化

### 阻塞

- 无本地阻塞。

### 风险与回滚

- 风险：`@utility container` 的 1rem 内边距只在 <640px 生效，若后续有人把它改回固定 2rem，
  375px 溢出会立刻回归——`e2e/responsive.spec.ts` 的三条溢出断言会失败并打印越界元素。
- 风险：导航定义现在只有一份，`dashboard-nav-links.test.ts` 锁定了顺序与 `ROUTES` 引用；
  新增页面时若只改 mock 或只改一侧，单测会先失败。
- 风险：页头断点从 md 提升到 lg 后，768–1023px 区间用户改用汉堡菜单（多一次点击，但避免了页头挤压）。
  这是有意取舍，已由 768px 用例固定。
- 回滚：`git revert d042310` 即回到「container 恒 2rem + 侧边栏 md 起显示 + 无移动抽屉」状态；
  无数据 / 迁移影响。

### 下一步

- G07 键盘与 screen reader 交互（侧边栏折叠按钮缺 `aria-label` / `aria-expanded`、图标链接折叠后
  的可访问名称、Esc 关闭移动菜单与快捷键对话框的焦点回归）。

- 最后更新：2026-09-13
