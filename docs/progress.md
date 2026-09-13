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

## v0.9.0 后续 / G07_KEYBOARD_A11Y（键盘与 screen reader 交互，本地完成）

- 状态：DONE（本地验证完成；未 push / 未开 PR / 未 merge / 未 deploy）
- 里程碑与发布目标：M2「UI 系统收口」（[docs/roadmap-0.6.0.md](roadmap-0.6.0.md) G01–G10），
  退出后进入下一里程碑 release freeze；当前版本仍是 `0.9.0`，本任务不升版本。
- 分支 / PR：`feat/visual-regression-baseline`（LOCAL_ONLY，无 PR）；base
  `origin/main@15b05ebe8e93725e16698e8b66fc9c43e3733965`
- 本地提交：`2ac6933`（fix）
- 目标：用真实键盘操作的 E2E 证明公共外壳（跳过导航、页头移动菜单、仪表盘侧边栏、快捷键对话框）
  在没有鼠标的情况下可用，且可访问名称与状态对屏幕阅读器可见。

### 已完成

- 新增 `e2e/keyboard.spec.ts`（6 条），全部基于角色与可访问名称断言（`getByRole` / `aria-expanded` /
  `toHaveFocus`），而不是 CSS 类名或文本快照。覆盖：跳过导航后焦点落入主内容、页头移动菜单
  Esc 关闭并归还焦点、仪表盘折叠按钮的状态暴露、折叠后图标链接仍有可访问名称、
  输入框内 `?` 不误触发帮助、快捷键对话框本身可开可关。
- 缺陷 1（跳过导航无效）：`#main-content` 不是可聚焦元素，激活「跳到主要内容」后焦点仍停在链接上，
  屏幕阅读器不会切换朗读上下文。四处 `<main>` 补 `tabIndex={-1}`
  （`src/app/auth/layout.tsx`、`src/app/(marketing)/layout.tsx`、`src/app/page.tsx`、`src/app/dashboard/layout.tsx`），
  现在激活后焦点确实落到主内容，下一次 Tab 直接进入正文。
- 缺陷 2（Esc 关闭移动菜单）：`site-header.tsx` 里移动端菜单只能再点一次按钮关闭，Esc 无反应且焦点丢失。
  新增 `useEffect` 监听 Esc 关闭菜单并把焦点交还汉堡按钮（`mobileMenuButtonRef`）。
- 缺陷 3（侧边栏折叠无可访问名称/状态）：`dashboard-sidebar.tsx` 折叠按钮缺少 `aria-label` 与展开状态，
  折叠后图标链接只剩 `title`（屏幕阅读器可能读不到）。现在按钮带
  `aria-label={collapsed ? t("expandSidebar") : t("collapseSidebar")}` / `aria-expanded={!collapsed}` /
  `aria-controls="dashboard-sidebar-nav"`，`<nav id="dashboard-sidebar-nav">` 与之对应，
  折叠链接与管理员入口补 `aria-label`，不再依赖 `title`。
- 缺陷 4（`?` 快捷键误触发）：`shortcuts-dialog.tsx` 原先只挡 input/textarea/select，在 contenteditable
  与 `role="textbox"`（命令面板输入框）里输入 `?` 会误弹帮助；同时带修饰键的组合（`⌘?` / `Ctrl+?` / `Alt+?`）
  未排除。现在一并拦截：检测 `input`/`textarea`/`select`、`isContentEditable`、`closest('[role="textbox"]')`
  与 modifier 组合后直接返回。
- 新增 i18n 键 `common.collapseSidebar` / `common.expandSidebar`（en / zh-CN 同步）。

### 变更文件

- `e2e/keyboard.spec.ts`（新增，6 条）
- `src/components/layout/shortcuts-dialog.tsx`、`shortcuts-dialog.test.tsx`（新增 7 条）
- `src/components/layout/site-header.tsx`、`site-header.test.tsx`（新增 4 条）
- `src/components/dashboard/dashboard-sidebar.tsx`、`dashboard-sidebar.test.tsx`（+2 条，共 6 条）
- `src/app/auth/layout.tsx`、`src/app/(marketing)/layout.tsx`、`src/app/page.tsx`、`src/app/dashboard/layout.tsx`
- `messages/en/common.json`、`messages/zh-CN/common.json`
- `CHANGELOG.md`（`[Unreleased] / ### Fixed`）、`docs/roadmap-0.6.0.md`（G07 完成说明）

### 验证命令与结果

- `pnpm exec playwright test e2e/keyboard.spec.ts` → ✅ **6 passed**
- `pnpm test` → ✅ **126 文件 1272 测试**（G07 前 124 文件 1259 测试）
- `pnpm test:e2e` → ✅ **86 passed (59.0s)**（G07 前 80 passed；键盘改动未破坏既有 smoke / a11y 用例）
- `pnpm lint` → ✅ `eslint .` 无告警
- `pnpm type-check` → ✅ `tsc --noEmit` 无错误
- `pnpm check:all` → ✅ 全部校验通过（en/zh-CN key 一致、迁移 / RLS / a11y 静态审计、changelog）
- `pnpm verify:build` → ✅ `pnpm verify` + `next build` 全绿
- `pnpm test:visual`（`mcr.microsoft.com/playwright:v1.63.0-noble` 容器内，按
  [docs/testing.md](testing.md) 的 Linux 基线流程）→ ✅ **4 passed**，1440×900 桌面全页截图无像素变化

### 阻塞

- 无本地阻塞。

### 风险与回滚

- 风险：`tabIndex={-1}` 让四处 `<main>` 可获得程序化焦点；若后续有人去掉它，
  `e2e/keyboard.spec.ts` 的跳过导航断言会立刻失败。
- 风险：折叠侧边栏的可访问名称依赖 `common.collapseSidebar` / `common.expandSidebar` 两个键，
  `check:i18n` 与组件单测同时锁住，缺键会先失败。
- 风险：`?` 快捷键现在对 `role="textbox"` 与带修饰键组合一律让路；若未来新增非输入类
  `role="textbox"` 元素，需要评估是否仍应拦截（当前保守放行是安全侧）。
- 回滚：`git revert 2ac6933` 即回到「main 不可聚焦 + Esc 不关闭 + 折叠按钮无 aria + `?` 仅挡表单控件」状态；
  无数据 / 迁移影响。

### 下一步

- G01 Tailwind v4 试点页迁移（M2 里程碑下一项）。

- 最后更新：2026-09-13

## v0.9.0 后续 / G01_TAILWIND_V4_NATIVE（Tailwind v4 原生主题收口，本地完成）

- 状态：DONE（本地验证完成；未 push / 未开 PR / 未 merge / 未 deploy）
- 里程碑与发布目标：M2「UI 系统收口」（[docs/roadmap-0.6.0.md](roadmap-0.6.0.md) G01–G10），
  退出后进入下一里程碑 release freeze；当前版本仍是 `0.9.0`，本任务不升版本。
- 分支 / PR：`feat/visual-regression-baseline`（LOCAL_ONLY，无 PR）；base
  `origin/main@15b05ebe8e93725e16698e8b66fc9c43e3733965`
- 本地提交：`2a75e87`（feat）
- 目标：把仓库里最后一批 v3 时代的 Tailwind 写法迁到 v4 原生机制，并用一个构建门禁把规则锁死，
  避免 `@config` / JS 配置 / v3 重命名工具类再次回潮。

### 已完成

- 自持动画收口到 v4 原生 theme token：`src/app/globals.css` 的 `@theme` 里新增
  `--animate-progress-indeterminate`（`progress-indeterminate 1.5s ease-in-out infinite`）与
  `--animate-navprogress`（`navprogress 0.8s ease-in-out infinite`），两段 `@keyframes` 内联进同一块；
  使用处回到 `animate-<token>` 工具类，宽度这类非动画声明由使用方用普通工具类表达。
- 删除死代码：`@layer utilities` 里的 `.step` / `.step:before`（全仓库与 docs-site 均无引用）以及
  手写的 `.animate-progress-indeterminate` 类，还有尾部的裸 `@keyframes navprogress`。
- 使用处更新：`src/components/ui/progress.tsx` 改为 `w-[30%] animate-progress-indeterminate`；
  `src/components/layout/navigation-progress.tsx` 的 `animate-[navprogress_0.8s_ease-in-out_infinite]`
  改为 `animate-navprogress`。
- v3 语义类名升级：试点页 `src/app/page.tsx` 的 `bg-gradient-to-b` → `bg-linear-to-b`；
  `outline-none` → `outline-hidden` 扫过 3 个文件共 4 处：`src/app/(marketing)/faq/faq-list.tsx`（1 处）、
  `src/components/forms/invite-member-form.tsx`（1 处）、`src/components/forms/profile-edit-form.tsx`（2 处，focus-visible 场景）。
- 新增构建门禁 `pnpm check:tailwind`：
  - `src/lib/tailwind/native-theme.ts`（纯规则，~280 行）定义 7 类规则码：
    `TW_CONFIG_FILE_PRESENT`、`TW_CONFIG_DIRECTIVE`、`TW_ANIMATE_PLUGIN_DEP`、`TW_THEME_MISSING`、
    `TW_KEYFRAME_UNTOKENED`、`TW_ARBITRARY_ANIMATE`、`TW_RENAMED_UTILITY`；导出
    `auditTailwindNative` / `findUntokenedKeyframes` / `findRenamedUtilities` / `formatTailwindNativeIssues` /
    `stripCssComments` / `RENAMED_UTILITIES` / `ARBITRARY_ANIMATE_PATTERN`。
  - 结构层：不允许 `tailwind.config.*`、不允许真实 `@config`（先剥注释）、不允许 `tailwindcss-animate` 依赖、
    `@theme` 必须存在、每个 `@keyframes` 必须被某个 `--animate-*` token 整词认领。
  - 应用层（`src/**` 去掉 `src/components/ui/**`、规则文件自身与测试）：禁止 `animate-[...]` 与 v3 名称
    `bg-gradient-to-*` / `outline-none` / `flex-shrink*` / `flex-grow*` / `overflow-ellipsis` / `decoration-slice|clone`。
  - `shadow` / `rounded` / `blur` 刻意不禁止——已在构建产物 CSS 里确认本仓库 `@theme inline` 把 `.rounded` 与
    `.rounded-sm` 都映射到 4px，重命名只是无意义 diff。
  - `src/components/ui/**` 是上游 shadcn 领地，仅输出一条非阻断告警（当前「25 处 v3 类名待跟随上游收口」）。
  - `scripts/lib/tailwind-native-check.js` 提供 `buildSnapshot` / `runTailwindNativeCheck`（接受 repo root 参数，
    供临时目录单测使用）；`scripts/check-tailwind.js` 用 Node `--experimental-strip-types` 运行 ESM。
- 门禁接线：`package.json` 新脚本、`scripts/check-all.sh`（紧跟 `check:changelog`）、CI workflow
  `lint-and-type-check` job 新增 "Check Tailwind v4 native theme usage" 步骤。
- 文档：`docs/testing.md` 新增「Tailwind v4 原生主题门禁（G01）」小节；`docs-site/scripts.md` 与
  `docs-site/zh-CN/scripts.md` 各补一行 `pnpm check:tailwind`。

### 变更文件

- `src/app/globals.css`、`src/app/page.tsx`
- `src/components/ui/progress.tsx`、`src/components/layout/navigation-progress.tsx`
- `src/components/forms/invite-member-form.tsx`、`src/components/forms/profile-edit-form.tsx`
- `src/app/(marketing)/faq/faq-list.tsx`
- `src/lib/tailwind/native-theme.ts`、`native-theme.test.ts`（新增 16 条）、`tailwind-check.test.ts`（新增 8 条）
- `scripts/check-tailwind.js`、`scripts/lib/tailwind-native-check.js`（新增）
- `package.json`、`scripts/check-all.sh`、`.github/workflows/ci.yml`
- `docs/testing.md`、`docs-site/scripts.md`、`docs-site/zh-CN/scripts.md`
- `CHANGELOG.md`（`[Unreleased] / ### Fixed`）、`docs/roadmap-0.6.0.md`（G01 完成说明）

### 验证命令与结果

- `pnpm check:tailwind` → ✅ 通过（无 `@config`/JS 配置，1 个样式文件、272 个应用层文件写法合规；1 条非阻断 ui 告警）
- `pnpm test` → ✅ **128 文件 1296 测试**（G07 前 126 文件 1272 测试）
- `pnpm lint` → ✅ `eslint .` 无告警
- `pnpm type-check` → ✅ `tsc --noEmit` 无错误
- `pnpm build` → ✅ 成功；已复核构建产物 CSS：`.animate-navprogress`（`0.8s ease-in-out infinite navprogress`）、
  `.animate-progress-indeterminate`、`.bg-linear-to-b`、`.outline-hidden`（含 `@media (forced-colors:active)`）、
  `.w-[30%]` 均落盘
- `pnpm test:e2e` → ✅ **86 passed (1.0m)**
- `pnpm check:all` → ✅ 全部校验通过（含新增 `check:tailwind`）
- `pnpm test:visual`（`mcr.microsoft.com/playwright:v1.63.0-noble` 容器内，按
  [docs/testing.md](testing.md) 的 Linux 基线流程）→ ✅ **4 passed**，1440×900 桌面全页截图无像素变化

### 阻塞

- 无本地阻塞。

### 风险与回滚

- 风险：`--animate-progress-indeterminate` / `--animate-navprogress` 是自持 token，若后续有人把 keyframes 移出
  `@theme` 或改名，`check:tailwind` 的 `TW_KEYFRAME_UNTOKENED` 会立刻失败。
- 风险：`check:tailwind` 应用层规则会拦住 `animate-[...]` 任意值与 `bg-gradient-to-*` 等 v3 名称，
  新代码写完未跑 `check:all` 时可能在 CI 才发现（本地 `pnpm check:tailwind` 可先自查）。
- 风险：`src/components/ui/**` 仍留 25 处 v3 类名（上游 shadcn 领地），当前降级为非阻断告警；
  跟随上游升级时再收口。
- 回滚：`git revert 2a75e87` 即回到「动画走 `@layer utilities` 手写类 + 试点页 `bg-gradient-to-b` + 无 Tailwind 门禁」状态；
  纯样式与门禁改动，无数据 / 迁移影响。

### 下一步

- G02 design token 收口（M2 里程碑下一项）。

- 最后更新：2026-09-13

## v0.9.0 后续 / G02_DESIGN_TOKENS（design token 收口与门禁，本地完成）

- 状态：DONE（本地验证完成；未 push / 未开 PR / 未 merge / 未 deploy）
- 里程碑与发布目标：M2「UI 系统收口」（[docs/roadmap-0.6.0.md](roadmap-0.6.0.md) G01–G10），
  退出后进入下一里程碑 release freeze；当前版本仍是 `0.9.0`，本任务不升版本。
- 分支 / PR：`feat/visual-regression-baseline`（LOCAL_ONLY，无 PR）；base
  `origin/main@15b05ebe8e93725e16698e8b66fc9c43e3733965`
- 本地提交：`ce5dbcb`（feat）
- 目标：把散落在业务代码里的颜色写法收口成单一事实来源——`:root` / `.dark` 原始变量、`@theme inline`
  映射、以及使用方工具类三者必须一一对应，并用门禁把这条规则锁死，避免原生调色板再次回潮。

### 已完成

- 新增 design token 单一事实来源 `src/lib/design/tokens.ts`（纯规则，~400 行）：
  - `DESIGN_TOKENS` 登记 **39 个 token**，按 `surface` / `status` / `chart` / `sidebar` / `radius` 分组，
    每项带 `name` / `group` / `utility` / 可选 `utilityName` / `dark`（是否需要深色覆盖）。
  - `THEME_COLOR_TOKENS` 描述 `@theme inline` 里每个颜色 token 对应的原始变量与来源；
    `STATUS_PALETTE_FAMILIES` 列出 8 个禁止直接使用的状态调色板族
    （red / green / emerald / amber / yellow / orange / blue / sky）。
  - 8 类规则码：`TOKEN_ROOT_BLOCK_MISSING`、`TOKEN_THEME_BLOCK_MISSING`、`TOKEN_MISSING_ROOT`、
    `TOKEN_MISSING_DARK`、`THEME_MAPPING_MISSING`、`THEME_MAPPING_DANGLING`、`THEME_MAPPING_UNREGISTERED`、
    `RAW_STATUS_PALETTE`。
  - 解析辅助（含注释剥离与花括号配对）：`braceMatch` / `extractRuleBody` / `extractDeclarations` /
    `extractVarReferences` / `escapeRegExp`；报告出口 `auditDesignTokens` / `formatDesignTokenIssues`。
  - `auditDesignTokens` 按职责拆成 `auditRegistryTokens` / `auditThemeMappings` / `auditPaletteUsage`，
    规避 ESLint `complexity: max 15`。
- `src/app/globals.css` 补齐缺口：
  - `@theme inline` 新增 `--color-success/-foreground`、`--color-warning/-foreground`、`--color-info/-foreground`，
    以及 **`--color-chart-1..5` 映射**（此前只有 `:root`/`.dark` 的 `--chart-*` 原始变量，
    `text-chart-N` / `fill-chart-N` 这类工具类实际并不存在）。
  - `:root` 新增 `--success` / `--success-foreground` / `--warning` / `--warning-foreground` /
    `--info` / `--info-foreground`；`.dark` 同步补一份对应色值（浅色 142/38/217 色相，深色提亮）。
- 使用方迁移（11 个文件，原生调色板 → 语义 token）：
  - `src/app/dashboard/page.tsx`：`bg-green-500`→`bg-success`、`bg-yellow-500`→`bg-warning`、
    `bg-red-500`→`bg-destructive`、`bg-blue-500`→`bg-info`。
  - `src/components/shared/password-strength.tsx`：强度 1→`bg-destructive`、2→`bg-warning`、3→`bg-info`、4→`bg-success`。
  - `src/components/dashboard/notifications-live.tsx`：`bg-emerald-500`→`bg-success`、`bg-amber-500`→`bg-warning`。
  - `src/components/layout/offline-banner.tsx`：`bg-amber-500 … text-white` → `bg-warning … text-warning-foreground`。
  - `src/components/dashboard/two-factor-section.tsx`：`text-emerald-500`→`text-success`、
    `text-amber-500` / `text-amber-600`→`text-warning`。
  - `src/components/dashboard/stats-card.tsx`：`text-green-600`→`text-success`、`text-red-600`→`text-destructive`。
  - `src/app/dashboard/analytics/analytics-page.tsx`：`bg-red-500` / `bg-green-500` → `bg-destructive` / `bg-success`，
    `text-red-600`→`text-destructive`。
  - `src/app/auth/forgot-password/forgot-password-form.tsx`、`src/app/(marketing)/pricing/pricing-cards.tsx`、
    `src/app/page.tsx`、`src/app/dashboard/billing/page.tsx`：green / emerald → `text-success`。
- 新增门禁 `pnpm check:tokens`：
  - `scripts/lib/design-token-check.js` 提供 `buildSnapshot(repoRoot)` / `runDesignTokenCheck(repoRoot)`
    （接受仓库根参数，供临时目录反例单测使用）；`scripts/check-tokens.js` 用 Node
    `--experimental-strip-types` 运行 ESM 规则模块。
  - 扫描范围 `src/{app,components,hooks,lib}`，排除 `src/components/ui/**`（上游 shadcn 领地）、测试文件与
    规则文件自身；白名单 `STATUS_PALETTE_ALLOWLIST` 只放 3 处有真实语义的用法
    （`initial-avatar.tsx`、`(marketing)/changelog/page.tsx`、`dashboard/admin/page.tsx`）。
  - 当前结果：39 个已登记 token（38 个深色覆盖、38 条 `@theme` 映射），273 个应用层文件无原生状态调色板。
- 单测：`src/lib/design/tokens.test.ts` **20 条**（解析辅助 + 8 类规则码各自的正反例）、
  `src/lib/design/design-token-check.test.ts` **8 条**（CLI 通过路径 + 临时目录反例，含缺失映射 / 深色覆盖 /
  白名单外调色板），另在 `password-strength.test.tsx` 补 4 条 `it.each`（强度 → 语义类名一一对应）、
  在 `notifications-live.test.tsx` 补 1 条状态点语义类名断言。本批共 28 条新单测。
- 门禁接线：`package.json` 新增 `check:tokens`；`scripts/check-all.sh` 紧随 `check:tailwind` 执行；
  CI workflow `lint-and-type-check` job 新增 "Check design token consistency" 步骤。
- 文档：`docs/testing.md` 新增「设计 token 门禁（G02）」小节（含 chart 为何仍用 `hsl(var(--chart-N))` 的说明——
  `@theme inline` 会把值内联、不产出运行时可读的 `--color-*` 自定义属性，SVG `<stop stopColor>` 拿不到）；
  `docs-site/scripts.md` 与 `docs-site/zh-CN/scripts.md` 各补一行 `pnpm check:tokens`。

### 变更文件

- `src/lib/design/tokens.ts`、`tokens.test.ts`、`design-token-check.test.ts`（新增）
- `scripts/check-tokens.js`、`scripts/lib/design-token-check.js`（新增）
- `src/app/globals.css`
- `src/app/page.tsx`、`src/app/dashboard/page.tsx`、`src/app/dashboard/billing/page.tsx`、
  `src/app/dashboard/analytics/analytics-page.tsx`、`src/app/(marketing)/pricing/pricing-cards.tsx`、
  `src/app/auth/forgot-password/forgot-password-form.tsx`
- `src/components/shared/password-strength.tsx`、`password-strength.test.tsx`
- `src/components/dashboard/notifications-live.tsx`、`notifications-live.test.tsx`、
  `src/components/dashboard/stats-card.tsx`、`src/components/dashboard/two-factor-section.tsx`
- `src/components/layout/offline-banner.tsx`
- `package.json`、`scripts/check-all.sh`、`.github/workflows/ci.yml`
- `docs/testing.md`、`docs-site/scripts.md`、`docs-site/zh-CN/scripts.md`
- `CHANGELOG.md`（`[Unreleased] / ### Fixed`）、`docs/roadmap-0.6.0.md`（G02 完成说明）

### 验证命令与结果

- `pnpm check:tokens` → ✅ 39 个已登记 token（38 个深色覆盖、38 条 `@theme` 映射），273 个应用层文件无原生状态调色板
- `pnpm lint` → ✅ `eslint .` 无告警（`complexity` 拆分后复跑）
- `pnpm type-check` → ✅ `tsc --noEmit` 无错误
- `pnpm test` → ✅ **130 文件 1329 测试**
- `pnpm build` → ✅ 成功（路由表正常输出）
- `pnpm check:all` → ✅ 全部校验通过（含新增 `check:tokens`）
- `pnpm test:e2e` → ✅ **86 passed (1.7m)**
- `pnpm test:visual`（`mcr.microsoft.com/playwright:v1.63.0-noble` 容器内，按
  [docs/testing.md](testing.md) 的 Linux 基线流程）→ ✅ **4 passed**，1440×900 桌面全页截图无像素变化
  （语义 token 的色值刻意取成与迁移前原生调色板等值，因此无需重生成基线）

### 阻塞

- 无本地阻塞。

### 风险与回滚

- 风险：`--success` / `--warning` / `--info` 是自持 token，若后续有人只改 `.dark` 漏改 `:root`（或反之），
  `check:tokens` 的 `TOKEN_MISSING_ROOT` / `TOKEN_MISSING_DARK` 会失败。
- 风险：新语义色与迁移前的原生调色板等值，属于「等价替换」；若产品后续调整品牌色，应改 `:root`/`.dark`
  原始变量而不是使用方工具类，视觉基线届时需要重生成。
- 风险：白名单 `STATUS_PALETTE_ALLOWLIST` 是显式豁免，新增条目需要在 code review 时确认确有语义理由。
- 回滚：`git revert ce5dbcb` 即回到「状态色散落原生调色板 + 无 `check:tokens`」状态；纯样式与门禁改动，
  无数据 / 迁移影响。

### 下一步

- G03 shared form field 统一（M2 里程碑下一项）。

- 最后更新：2026-09-13

## v0.9.0 后续 / G03_SHARED_FORM_FIELD（DONE，本地完成）

- 状态：DONE（本地提交完成；未 push / PR / merge / deploy）
- 里程碑与发布目标：M2「UI 系统收口」（roadmap `docs/roadmap-0.6.0.md` G01–G10）；本项为 G03，版本目标随 v0.9.0 之后的下一 UI 收口版本统一发布
- 分支 / PR：`feat/visual-regression-baseline`；base `origin/main@15b05ebe8e93725e16698e8b66fc9c43e3733965`；本地提交 `21e5501`；无 PR
- 目标：统一「标签 / 控件 / 描述 / 错误」DOM 与 ARIA 接线，把原生 select 与控件类名收口到共享原语，并增加防回退门禁
- 已完成：
  - 新增 `src/components/shared/form-field.tsx`：`FormField` context 统一提供 `htmlFor`/`id`、`aria-describedby`、错误 `aria-invalid`，描述/错误稳定 id，错误 `role="alert"`；支持 `stack` / `inline`、描述前置或后置。
  - 新增 `src/components/shared/native-select.tsx`：`NATIVE_SELECT_CLASSES` 单一来源，补齐 `disabled:` 与 focus-visible 外观。
  - 迁移认证页、联系表单、资料/密码/通知/主题/邀请/头像/封面上传、项目与团队创建、项目设置等 15+ 处表单字段到共享原语；reset-password 密码可见性按钮补 `aria-label` / `aria-pressed`，MFA 保留 sr-only label。
  - `globals.css` 为 `[aria-invalid="true"]` 提供统一可见红边。
  - 新增 `src/lib/ui/form-field-rules.ts` 与 `scripts/check-fields.js` / `scripts/lib/form-field-check.js` 门禁：扫描 `src/app` + `src/components` 非测试 `.tsx`，排除 `src/components/ui/**`，检查 `RAW_SELECT` / `RAW_CONTROL_CLASSES` / `DIRECT_LABEL_IMPORT` 三类回退；接入 `package.json`、`scripts/check-all.sh` 与 CI。
- 变更文件：见 commit `21e5501`；含共享原语与 25 条新增单测、15+ 表单迁移、门禁接线、`docs/testing.md` G03 小节、`docs/roadmap-0.6.0.md` G03 完成说明、`CHANGELOG.md` Unreleased 条目、双语脚本文档行。
- 验证命令与结果：
  - `pnpm check:fields` → ✅ 133 个应用层文件通过，无原生 select / 复制控件类名 / label 直引
  - `pnpm lint` → ✅ `eslint .` 无告警
  - `pnpm type-check` → ✅ `tsc --noEmit` 无错误
  - `pnpm test` → ✅ **133 文件 1354 测试**
  - `pnpm build` → ✅ Next.js 16.3.5 生产构建成功
  - `pnpm check:all` → ✅ 全部校验通过（含新增 `check:fields`）
  - `pnpm test:e2e` → ✅ **86 passed (2.8m)**
  - Docker Linux visual baseline → ✅ **4 passed**（home / features / pricing / login 无像素变化）
- 阻塞：无本地阻塞。
- 风险与回滚：
  - 风险：`FormFieldControl` 会以注入 id 覆盖子控件自带 id；这是「label 不可能指错」的刻意约束，新增调用方不应再同时写 id。
  - 风险：门禁是静态写法审计，ARIA 运行时行为由原语组件测试覆盖；复杂第三方控件需确认 `cloneElement` 合并 props 是否符合预期。
  - 回滚：`git revert 21e5501` 可回到各表单自行接线状态，同时移除 `check:fields` 门禁；无数据库 / 迁移 / 外部数据影响。
- 下一步：G04 loading / empty / error 状态统一（M2 里程碑），继续按检查 → 实现 → 测试 → 门禁 → commit → 更新进度循环推进。
- 最后更新：2026-09-13

## v0.9.0 后续 / G04_SHARED_STATES（DONE，本地完成）

- 状态：DONE（本地提交完成；未 push / PR / merge / deploy）
- 里程碑与发布目标：M2「UI 系统收口」（roadmap `docs/roadmap-0.6.0.md` G01–G10）；本项为 G04，也是 G 段最后一项，
  完成后 M2（A / B / G 三段）全部收口，具备进入 RELEASE_FREEZE 的条件
- 分支 / PR：`feat/visual-regression-baseline`；base `origin/main@15b05ebe8e93725e16698e8b66fc9c43e3733965`；本地提交 `f5c7451`；无 PR
- 目标：把「加载 / 空 / 错误」三种状态各自收敛到唯一落脚点，统一 ARIA 语义与文案来源，并加防回退门禁
- 已完成：
  - 新增 `src/components/shared/error-state.tsx`：`ErrorState`（`code` / `icon` / `title` / `description` / `action` /
    `size` / `role` / `className`），默认 `role="alert"`，不声明 `"use client"` 以便服务端错误页直接复用。
  - `src/components/shared/page-loading.tsx` 重写：`PageLoading`（`cards` / `dashboard` / `stats` / `list` / `spinner` 五种骨架 +
    `rows`）与 `LoadingIndicator` 成为加载态单一来源；容器 `aria-busy="true"`，骨架内嵌 `role="status"` 的 `sr-only` 文案，
    文案走 next-intl `common.loading`（此前 3 个手写骨架没有 `aria-busy`，加载文案硬编码中文）。
  - `query-error-state.tsx` 保留客户端边界（`onRetry`），展示下沉到 `ErrorState`，`className` 真正生效。
  - 删除零引用的重复加载组件 `src/components/shared/page-loader.tsx` 与 `src/components/shared/loading-state.tsx`。
  - 迁移：12 个 `loading.tsx` 中 3 个手写 `Skeleton` 收敛（仪表盘首页 60 行手写骨架 → `variant="dashboard"`，
    admin → `stats`，admin/messages → `list`）；10 处裸 `<p>` 空态改用带图标的 `EmptyState`
    （audit-logs / contact-messages / admin-users / webhook-events / analytics ×2 / dashboard overview /
    settings devices / team / blog-list / faq-list）；4 个错误边界（`src/app/error.tsx`、`dashboard/error.tsx`、
    `global-error.tsx`、`not-found.tsx`）统一走 `ErrorState`；`data-table` 内联 loading/empty、`reset-password`、
    `auth/callback`、`site-header` 头像骨架（补 `role="status"`）一并迁移。
  - 顺带修掉 `faq-list` 硬编码英文：search placeholder 与 no-results 改为 props，`faq/page.tsx` 传翻译值，
    `messages/{en,zh-CN}/faq.json` 各补 2 个 key（en/zh 各 980 key）。
  - 新增 `src/lib/ui/state-rules.ts`（纯函数审计，4 类规则码 `RAW_ROUTE_SKELETON` / `LEGACY_LOADER_MODULE` /
    `RAW_SPINNER` / `BARE_PLACEHOLDER`）与 `scripts/lib/state-check.js` + `scripts/check-states.js` 门禁，
    扫描 132 个应用层文件与 14 个 `loading.tsx`，排除 `src/components/ui/**` 与测试文件；接入 `package.json`、
    `scripts/check-all.sh` 与 CI（`Check shared state usage`）。
- 变更文件：见 commit `f5c7451`；含 2 个共享原语 + 1 个新组件 + 4 个原语测试文件（14 条）+ 门禁与 13 条门禁单测、
  13 个页面/组件迁移、双语 faq 文案、`docs/testing.md` G04 小节、`docs/roadmap-0.6.0.md` G04 完成说明、
  `CHANGELOG.md` Unreleased 条目、双语脚本文档行、`docs/architecture/09-frontend-components.md` 组件表更新。
- 验证命令与结果：
  - `pnpm check:states` → ✅ 132 个应用层文件、14 个 `loading.tsx` 统一走 `PageLoading` / `EmptyState` / `ErrorState`
  - `pnpm lint` → ✅ `eslint .` 无告警
  - `pnpm type-check` → ✅ `tsc --noEmit` 无错误
  - `pnpm test` → ✅ **138 文件 1381 测试**
  - `pnpm build` → ✅ Next.js 16.3.5 生产构建成功
  - `pnpm check:all` → ✅ 全部校验通过（含新增 `check:states`）
  - `pnpm test:e2e` → ✅ **86 passed (1.7m)**
  - Docker Linux visual baseline → ✅ **4 passed**（home / features / pricing / login 无像素变化）
- 阻塞：无本地阻塞。
- 风险与回滚：
  - 风险：`RAW_SPINNER` 白名单（`page-loading.tsx`、`confirm-dialog.tsx`）是显式豁免，新增 `animate-spin` 需要
    code review 确认确有理由；`BARE_PLACEHOLDER` 只按「同一 className 字面量内同时出现 `text-center` 与固定纵向内边距」
    判定，是写的审计而非语义分析。
  - 风险：`PageLoading` 不再声明 `"use client"`，依赖 next-intl 在 Server Component 中可用；若后续改为客户端渲染需回归 `loading.tsx`。
  - 回滚：`git revert f5c7451` 即回到「每页各写状态 markup + 两个零引用 loader 组件」的状态，同时移除 `check:states` 门禁；
    纯展示层与门禁改动，无数据库 / 迁移 / 外部数据影响。
- 下一步：M2 里程碑（A / B / G 三段）已全部收口，进入 v0.10.0 RELEASE_FREEZE（定版本号、CHANGELOG、发布说明、
  migration/rollback 检查、全量验证、release commit、exit report）；push / tag / PR / merge / deploy 受本地权限边界约束，
  仅输出到可执行边界。
- 最后更新：2026-09-13

## v0.10.0 发布记录（RELEASE_FREEZE 完成，本地；未 push / tag / PR / merge / deploy）

- 状态：发布已准备到当前权限允许的最后一步（本地 release commit 完成）；发布本身未执行
- 版本号：**0.10.0**（minor —— 新增 design token 注册表、共享表单/状态原语与四道写法门禁，无破坏性变更）
- 里程碑：M2「UI 系统收口」（roadmap `docs/roadmap-0.6.0.md` G01–G07）
- 包含任务：G01 Tailwind v4 原生主题收口、G02 design token 收口与门禁、G03 shared form field 统一、
  G04 loading/empty/error 状态统一、G05 暗色模式回归、G06 移动端断点回归、G07 键盘与 screen reader 交互
- 分支 / PR：`feat/visual-regression-baseline`；base `origin/main@15b05ebe8e93725e16698e8b66fc9c43e3733965`；无 PR
- 本地提交：`f5c7451`（G04 功能）→ `ad705e6`（G04 进度）→ `0632dc5`（v0.10.0 release freeze）
- 合并方式：未合并（待授权后按 rebase 策略合并）
- tag / release：**未创建**。项目 runbook 明确「仅在指标稳定后创建 tag」，本地无 deploy/smoke 证据，
  故按 runbook 停在「ready to tag」；现存 tag 仅 `v0.6.0`
- 部署：未部署（无部署权限）
- smoke：`docs/operations/production-smoke-v0.10.0.md` 状态为「未执行」（需生产 URL 与部署权限）
- 迁移：**本版本无新增迁移**，最新仍为 `031_upload_objects.sql`；`pnpm check:migrations` 通过（31 个不可变迁移与
  SHA-256 清单一致），迁移号与 v0.9.0 相同
- 发布产物：
  - `docs/operations/release-runbook-v0.10.0.md`（含 v0.10.0 发布差异：无迁移、深色首屏脚本与 CSP、
    响应式断点语义、旧模块删除、观察窗口新增项）
  - `docs/operations/rollback-runbook-v0.10.0.md`（保持向前 schema、不手工改 CSS token、整包回滚策略）
  - `docs/operations/production-smoke-v0.10.0.md`（干净「未执行」基线，新增深色首屏 / 移动导航 / 状态色行）
  - `docs/operations/release-gap-audit-v0.10.0.md`（exit report：里程碑退出标准核对 + 20 项缺口表 + 恢复步骤）
  - `docs-site/v0.10.0.md`、`docs-site/zh-CN/v0.10.0.md` 并注册到中英导航
  - `.github/RELEASE_CHECKLIST.md`、`README.md`、`README.zh-CN.md` 指向 v0.10.0 产物
  - `package.json` / `.env.example` `NEXT_PUBLIC_APP_VERSION` → 0.10.0；CHANGELOG 新增 `[0.10.0]` 章节
- 验证命令与结果（全部在 release commit `0632dc5` 上复现）：
  - `pnpm check:release-docs` → ✅ `v0.10.0, 7 artifacts`
  - `pnpm check:changelog` → ✅ `10 个已发布版本，1 个 Unreleased 章节`
  - `pnpm check:docs` → ✅ docs-site scripts 与 package.json 同步
  - `pnpm check:locales` → ✅ en/zh-CN 各 980 key
  - `pnpm check:migrations` → ✅ 31 个不可变迁移与 SHA-256 清单一致
  - `pnpm check:all` → ✅ 全部校验通过
  - `pnpm verify:build` → ✅ lint / type-check / 138 文件 1381 测试 / Next.js 16.3.5 生产构建
  - `pnpm test:e2e` → ✅ **86 passed (3.4m)**
  - Docker Linux visual baseline → ✅ **4 passed**（home / features / pricing / login，无像素漂移）
  - `pnpm audit --audit-level high` → ✅ No known vulnerabilities found
  - `pnpm --filter indiestack-docs build` → ✅ vitepress 1.6.4 build complete
- 阻塞（外部权限，非本地可解）：
  - push / tag / PR / merge / deploy / production smoke 均需显式授权；当前权限边界为本地
  - 生产 smoke 另需生产 URL、专用测试账号/租户、Stripe test-mode 签名生成器
- 风险与回滚：
  - 风险：深浅色状态色与动画 token 现由 `globals.css` 独占，后续改色必须改 `:root`/`.dark` 变量而非调用处工具类，
    否则 `pnpm check:tokens` 会失败；新增 `animate-spin` 需加入白名单并说明理由。
  - 风险：`PageLoading` 依赖 next-intl 在 Server Component 中可用；若后续改为客户端组件需回归所有 `loading.tsx`。
  - 回滚：本版本无数据库迁移，回滚只需把 deployment 切回上一个已验证版本并保持向前 schema；
    完整步骤见 `docs/operations/rollback-runbook-v0.10.0.md`。
- 下一里程碑：roadmap `docs/roadmap-0.6.0.md` 的 I / J 段（I04、I06–I10、J02–J10）。
- 最后更新：2026-09-13

## I04 ADR 更新与决策状态（DONE）

- 状态：DONE（M3「文档与发布体验」roadmap `docs/roadmap-0.6.0.md` 第 84 项）
- 里程碑与发布目标：M3 I 段（I01–I10）；不单独升版本，随下一个 minor 里程碑发布
- 分支 / PR：`feat/visual-regression-baseline`；base `origin/main@15b05ebe8e93725e16698e8b66fc9c43e3733965`；无 PR
- 本地提交：`41dedbb`（feat(adr): add ADR governance gate and reconcile decision status）
- 目标：让 ADR 决策状态与 README 索引不再人工漂移，把编号 / 状态 / 必要章节 / 取代关系固化为可执行门禁
- 已完成：
  - 新增纯函数审计模块 `src/lib/adr/adr-rules.ts`（文件名与标题编号一致、`状态`/`日期` 字段、状态枚举
    `提议 / 已接受（附注）/ 已废弃（被 ADR-NNN 取代）`、日期合法且不晚于今天、必要章节
    背景 / 决策 / （影响|后果）、README 索引双向逐字匹配、编号连续、索引升序、后继 ADR 必须显式引用被取代项）
  - 新增 `scripts/lib/adr-check.js` + `scripts/check-adr.js`，注册为 `pnpm check:adr`
  - `scripts/check-all.sh` 在 `check:changelog` 之后执行 `check:adr`；`.github/workflows/ci.yml` 新增
    "Check ADR governance" 步骤
  - 决策状态收口：ADR-005 标记「已废弃（被 ADR-013 取代）」、ADR-009 标记「已废弃（被 ADR-014 取代）」，
    ADR-010–013 的 `accepted` 统一为 `已接受`，ADR-001 的日期附注移出 `日期:` 字段，ADR-007 补齐 `## 背景`
  - 新增 `docs/adr/adr-014-react-table-v9-native.md`（React Table v9 原生 API 取代 legacy 桥）
  - `docs/adr/README.md` 索引重建为 14 行（标题与状态逐字对应正文）
  - `agents/04-architect.md` 删除与 `docs/adr/` 冲突的内嵌 ADR-001–004 副本，改为指向索引并提示跑门禁
  - 文档同步：`docs/testing.md` 新增「ADR 治理门禁（I04）」、`docs-site/scripts.md` 与中文版新增 `check:adr` 行、
    `CHANGELOG.md` `[Unreleased] / Added` 记录该门禁
- 变更文件：`src/lib/adr/adr-rules.ts`、`src/lib/adr/adr-rules.test.ts`、`scripts/lib/adr-check.js`、
  `scripts/check-adr.js`、`scripts/check-all.sh`、`.github/workflows/ci.yml`、`docs/adr/*`（14 篇 + README）、
  `agents/04-architect.md`、`docs/testing.md`、`docs-site/scripts.md`、`docs-site/zh-CN/scripts.md`、
  `docs/roadmap-0.6.0.md`、`CHANGELOG.md`、`package.json`
- 验证命令与结果（提交 `41dedbb` 前后各跑一遍）：
  - `pnpm exec vitest run src/lib/adr/adr-rules.test.ts` → ✅ 21 passed
  - `node scripts/check-adr.js` → ✅ `ADR 治理通过：14 篇（接受 12 / 提议 0 / 已废弃 2），索引 14 条`
  - `node scripts/check-docs-scripts.js` → ✅ docs-site scripts 与 package.json 同步
  - `pnpm lint` → ✅ 无告警（`parseAdrDocument` 拆分为 heading/status/date/sections 四个子审计函数后复杂度回到阈值内）
  - `pnpm type-check` → ✅ 无错误
  - `pnpm check:all` → ✅ 全部校验通过（type-check、lint、139 文件 1402 测试）
  - `pnpm verify:build` → ✅ Next.js 16.3.5 生产构建通过
  - `pnpm check:changelog` → ✅ 10 个已发布版本 + 1 个 Unreleased 章节
- 阻塞：无
- 风险与回滚：
  - 风险：门禁要求 README 索引标题 / 状态与正文逐字一致，改 ADR 正文标题或状态时若忘记同步索引会直接失败；
    这是刻意的回归保护，修复方式是同时改两处。
  - 风险：`DATE_FUTURE` 用注入的 `today`（默认系统 UTC 日期），在时区跨日的 CI 上可能出现仅数小时的边界差异；
    单测已固定 `today`。
  - 回滚：`git revert 41dedbb` 即移除门禁并恢复旧索引 / 状态写法；纯文档与校验脚本改动，无数据库、迁移或运行时影响。
- 下一步：I06 release checklist v0.6.0 语义收口（现有 `check:release-docs` / `.github/RELEASE_CHECKLIST.md` 已覆盖 v0.10.0）。
- 最后更新：2026-09-13

## I06 / J01 发布检查清单与门禁接线审计（DONE）

- 状态：DONE（M4「发布收口」roadmap `docs/roadmap-0.6.0.md` 第 86 项与第 91 项）
- 里程碑与发布目标：M4 I / J 段；不单独升版本，随下一个 minor 里程碑发布
- 分支 / PR：`feat/visual-regression-baseline`；base `origin/main@15b05ebe8e93725e16698e8b66fc9c43e3733965`；无 PR
- 本地提交：`5fdf682`（feat(ci): audit that every gate is actually wired into ci and the local aggregate）
- 目标：消除「写了门禁脚本但门禁从不执行」的静默失效，并让发布检查清单里引用的 workflow / job 名与版本号可回归
- 已完成：
  - 审计发现真实缺口：`check:agents` 与 `check:docs` 只在 `scripts/check-all.sh` 执行，CI 从未覆盖
  - 新增纯函数规则 `src/lib/release/gate-wiring.ts`（28 条单测，语句/函数/行 100%、分支 98.52%）：
    门禁缺本地聚合 `GATE_UNWIRED_LOCAL`、缺 CI 执行 `GATE_UNWIRED_CI`、`check-all.sh` 引用不存在的脚本
    `AGGREGATE_UNKNOWN_SCRIPT`、豁免表登记不存在的门禁 / 理由过期 `EXCEPTION_STALE`、豁免无理由
    `EXCEPTION_EMPTY`、检查清单引用未知 workflow 或 job 名 `CHECKLIST_WORKFLOW_UNKNOWN`、打标签版本与
    `package.json` 不一致或缺失 `CHECKLIST_TAG_VERSION`；`pnpm` 前缀命令带词边界匹配，`pnpm check:migrations`
    不会误判为 `check:migration-history`
  - 新增 `scripts/lib/gate-wiring-check.js` + `scripts/check-gates.js`，注册为 `pnpm check:gates`，
    接入 `scripts/check-all.sh` 与 CI `Lint & Type Check` job
  - CI 补齐 `Check shared agent index`（`pnpm check:agents`）与 `Check docs-site script sync`（`pnpm check:docs`）两步
  - `.github/RELEASE_CHECKLIST.md` 的 CI 行由自由文案改为逐字引用真实名称：`CI`
    （`Lint & Type Check` / `Build` / `Build Docs Site` / `E2E (Playwright)`）、`CodeQL`、`Secrets Scan`、
    `Security and configuration checks`；打标签版本（v0.10.0）纳入门禁核对
  - 豁免表只有三条且写明替代覆盖方式：`check:migration-history`（需本地 Supabase）、`check:bundle`（需完整生产构建）、
    `check:perf`（本地需 `.next` 产物，CI 由 Build job 执行）
  - 文档同步：`docs/testing.md` 新增「门禁接线审计（I06 / J01）」、`docs-site/scripts.md` 与中文版新增 `check:gates` 行、
    `CHANGELOG.md` `[Unreleased] / Added` 记录该门禁、roadmap 第 86 / 91 项标注完成
- 变更文件：`src/lib/release/gate-wiring.ts`、`src/lib/release/gate-wiring.test.ts`、
  `scripts/lib/gate-wiring-check.js`、`scripts/check-gates.js`、`scripts/check-all.sh`、`.github/workflows/ci.yml`、
  `.github/RELEASE_CHECKLIST.md`、`package.json`、`docs/testing.md`、`docs-site/scripts.md`、`docs-site/zh-CN/scripts.md`、
  `docs/roadmap-0.6.0.md`、`CHANGELOG.md`
- 验证命令与结果（提交 `5fdf682`）：
  - `node scripts/check-gates.js` → ✅ `门禁接线审计通过：20 个门禁（本地 17 / CI 18 / 豁免 3），8 个工作流`
  - `pnpm exec vitest run src/lib/release/gate-wiring.test.ts` → ✅ 28 passed
  - `pnpm check:docs` → ✅ docs-site scripts 与 package.json 同步
  - `pnpm check:release-docs` → ✅ v0.10.0, 7 artifacts
  - `pnpm check:all` → ✅ 全部校验通过（140 文件 1430 测试）
  - `pnpm verify:build` → ✅ lint / type-check / test / Next.js 16.3.5 生产构建通过
  - `pnpm lint`、`pnpm type-check` → ✅ 无告警
- 阻塞：无
- 风险与回滚：
  - 风险：新增 CI 步骤会让学生 job 略增耗时（两步都是毫秒级文件校验，不触发额外构建）。
  - 风险：豁免表是「失败封闭」的显式清单，未来若把 `check:bundle` 接进 CI 而不删豁免理由，`check:gates` 会报
    `EXCEPTION_STALE`；这是刻意的，修复即同时更新代码与理由。
  - 回滚：`git revert 5fdf682` 移除门禁、CI 两步与清单校验；纯校验与文档改动，无数据库 / 迁移 / 运行时影响。
- 下一步：I07 本地 mock 开发指南收口（`docs-site/mock.md` 与 `docs/architecture/13-mock-system.md` 对齐并补齐可复现步骤）。
- 最后更新：2026-09-13


## I07 本地 mock 开发指南（DONE）

- 状态：DONE（M3「文档与发布体验」roadmap `docs/roadmap-0.6.0.md` 第 87 项）
- 里程碑与发布目标：M3 I 段（I01–I10）；不单独升版本，随下一个 minor 里程碑发布
- 分支 / PR：`feat/visual-regression-baseline`；base `origin/main@15b05ebe8e93725e16698e8b66fc9c43e3733965`；无 PR
- 本地提交：`0405e2b`（feat(mock): document the mock runtime and gate the docs against drift）
- 目标：把本地 mock 运行时的真实启用条件、状态隔离模型、受支持表、mock-only E2E 端点与已知限制写实，并用可回归门禁阻止文档和实现再次分叉
- 已完成：
  - 新增纯函数规则模块 `src/lib/mock/mock-docs.ts`，双向校验 18 张 mock 表与 9 个 mock-only E2E 端点是否被三份文档完整记录；文档引用了不存在的表 / 端点、表 / 端点未记录、文档源为空均失败封闭
  - 门禁额外要求每份文档包含 7 个必要事实（`NEXT_PUBLIC_MOCK_ENABLED`、`NEXT_PUBLIC_SUPABASE_URL`、`NODE_ENV`、`src/proxy.ts`、`resetMockCache`、`/api/e2e/mock-reset`、`createMockRequestStore`），并禁止 3 条旧错说法回流（进程缓存被误写为 per-request、代理保护被误写为全部失效）
  - 新增 28 条单测 `src/lib/mock/mock-docs.test.ts`，覆盖表清单 / 端点抽取、空输入失败封闭、每条禁用说法、格式化与真实仓库快照
  - 新增 IO / CLI：`scripts/lib/mock-docs-check.js`、`scripts/check-mock-docs.js`，注册为 `pnpm check:mock-docs`，接入 `scripts/check-all.sh` 与 CI `Lint & Type Check` job
  - 重写 `docs-site/mock.md`（英文 240 行）、`docs-site/zh-CN/mock.md`（中文 233 行）、`docs/architecture/13-mock-system.md`（中文 + mermaid）：18 张表、`NEXT_PUBLIC_MOCK_ENABLED=true` 或（非 production 且缺少 `NEXT_PUBLIC_SUPABASE_URL`）的启用规则、`globalThis.__indiestackMockCache__` 进程级缓存、`resetMockCache()`、`createMockRequestStore()` 请求隔离、`src/proxy.ts` 仍生成 CSP nonce / `x-request-id` 并调用 `updateSession()`、9 个 mock-only E2E 端点、Playwright 环境表与限制表
  - 删除仓库零引用的 Apifox 章节；文档同步 `docs/testing.md`「Mock 文档一致性门禁（I07）」、双语 scripts 表、`CHANGELOG.md` `[Unreleased]`、roadmap 第 87 项
- 变更文件：`src/lib/mock/mock-docs.ts`、`src/lib/mock/mock-docs.test.ts`、`scripts/lib/mock-docs-check.js`、
  `scripts/check-mock-docs.js`、`package.json`、`scripts/check-all.sh`、`.github/workflows/ci.yml`、`docs-site/mock.md`、
  `docs-site/zh-CN/mock.md`、`docs/architecture/13-mock-system.md`、`docs/testing.md`、`docs-site/scripts.md`、
  `docs-site/zh-CN/scripts.md`、`CHANGELOG.md`、`docs/roadmap-0.6.0.md`
- 验证命令与结果（提交 `0405e2b`）：
  - `pnpm vitest run src/lib/mock/mock-docs.test.ts` → ✅ 28 passed
  - `pnpm check:mock-docs` → ✅ `Mock 文档一致性通过：18 张表 / 9 个 E2E 端点 × 3 份文档`
  - `pnpm check:gates` → ✅ `21 个门禁（本地 18 / CI 19 / 豁免 3），8 个工作流`
  - `pnpm check:docs`、`pnpm check:changelog` → ✅
  - `pnpm lint`、`pnpm type-check` → ✅ 无告警
  - `pnpm check:all` → ✅ 141 文件 / 1458 测试，全部门禁绿色
  - `pnpm verify:build` → ✅ Next.js 16.3.5 生产构建通过
- 阻塞：无
- 风险与回滚：
  - 风险：新增表或 mock-only 路由后若不同时更新三份文档，CI 会直接失败；这是刻意的防漂移设计。
  - 风险：`docs-site/scripts.md`、`docs-site/zh-CN/scripts.md` 及两份 mock 文档不满足仓库级 Prettier 格式（既有表格约定），
    本次未对这些文件运行 Prettier；新增 / 修改的 TS 文件已通过 Prettier。
  - 回滚：`git revert 0405e2b` 即移除门禁与新文档；纯文档 / 校验脚本改动，无数据库、迁移或运行时影响。
- 下一步：I08 provider 配置诊断指南。
- 最后更新：2026-09-13


## I08 Provider 配置诊断指南（DONE）

- 状态：DONE（M3「文档与发布体验」roadmap `docs/roadmap-0.6.0.md` 第 88 项）
- 里程碑与发布目标：M3 I 段（I01–I10）；不单独升版本，随下一个 minor 里程碑发布
- 分支 / PR：`feat/visual-regression-baseline`；base `origin/main@15b05ebe8e93725e16698e8b66fc9c43e3733965`；无 PR
- 本地提交：`1c80cd0`（feat(providers): add credential-free configuration diagnostics）
- 目标：把 provider 的启用条件、fallback 规则与缺失变量诊断写成可回归的事实，既给出可跑的自检工具，
  又用门禁阻止文档和运行时注册表再次分叉
- 已完成：
  - 新增纯函数模块 `src/lib/providers/diagnostics.ts`：`PROVIDER_REGISTRY` 登记 9 个 provider / 28 个环境变量，
    `diagnoseProviders(env)` 产出 `ready` / `disabled` / `degraded` / `misconfigured` / `missing` 五态报告，
    逐项列出缺失变量名，**从不输出任何凭据值**；`formatProviderReport()` 渲染人类可读文本
  - provider 语义：`supabase`（运行时三键必需、`SUPABASE_DB_URL` 可选否则 degraded）、`storage`
    （OSS 四键 → `oss`、全空 → `supabase` fallback、部分配置 → `misconfigured`、mock 模式 → `mock` `ready`）、
    `email` / `webpush` / `appark` / `stripe` / `sentry`（DSN 与构建期键）、`supabase-restore`
    （token + 显式或从 `<ref>.supabase.co` 推导的 project ref，三者关系细化到 misconfigured）、`cron`（`CRON_SECRET`）
  - 新增 CLI `scripts/lib/provider-doctor.js` + `scripts/provider-doctor.js`（Node 原生 type stripping），
    支持 `--json` / `--help`，存在阻塞问题时退出码 1；注册为 `pnpm provider:doctor`
  - 新增文档一致性门禁 `src/lib/providers/provider-docs.ts` + `scripts/lib/provider-docs-check.js` +
    `scripts/check-provider-docs.js`：拿 `PROVIDER_REGISTRY` 对 `docs-site/provider-diagnostics.md` 与
    `docs-site/zh-CN/provider-diagnostics.md` 做双向校验，缺 provider id 或环境变量即失败，文档源为空时
    失败封闭（`PROVIDER_DOC_SOURCE_EMPTY` / `PROVIDER_DOC_MISSING_PROVIDER` / `PROVIDER_DOC_MISSING_KEY`）；
    注册为 `pnpm check:provider-docs`
  - 新增 24 条单测（`diagnostics.test.ts` 18 + `provider-docs.test.ts` 6），覆盖五态判定、fallback、
    ref 推导、JSON/文本渲染、文档漂移与空文档
  - 重写 `docs-site/provider-diagnostics.md`（英文）与中文版：状态模型、28 键 provider 表、工作流、
    JSON 形状、排障映射与文档门禁说明
  - 接线：`scripts/check-all.sh` 与 CI `Lint & Type Check` job 均执行 `check:provider-docs`；
    双语 `docs-site/scripts.md` 新增 `check:provider-docs` 与 `provider:doctor` 两行；
    `docs-site/.vitepress/config.mts` 双语 nav + sidebar 增加 Provider 诊断入口；
    `CHANGELOG.md` `[Unreleased] / Added` 记录；roadmap 第 88 项与头部进度标注完成
- 变更文件：`src/lib/providers/diagnostics.ts`、`src/lib/providers/diagnostics.test.ts`、
  `src/lib/providers/provider-docs.ts`、`src/lib/providers/provider-docs.test.ts`、
  `scripts/lib/provider-doctor.js`、`scripts/provider-doctor.js`、`scripts/lib/provider-docs-check.js`、
  `scripts/check-provider-docs.js`、`package.json`、`scripts/check-all.sh`、`.github/workflows/ci.yml`、
  `docs-site/provider-diagnostics.md`、`docs-site/zh-CN/provider-diagnostics.md`、`docs-site/scripts.md`、
  `docs-site/zh-CN/scripts.md`、`docs-site/.vitepress/config.mts`、`docs/testing.md`、`CHANGELOG.md`、
  `docs/roadmap-0.6.0.md`
- 验证命令与结果（提交 `1c80cd0`）：
  - `pnpm check:provider-docs` → ✅ `9 个 provider / 28 个环境变量 × 2 份文档`
  - `node scripts/lib/provider-doctor.js` → ✅ `Result: no blocking provider configuration problems`（当前环境 mock 模式，退出码 0）
  - `pnpm vitest run src/lib/providers/diagnostics.test.ts src/lib/providers/provider-docs.test.ts` → ✅ 24 passed
  - `pnpm check:gates` → ✅ `22 个门禁（本地 19 / CI 20 / 豁免 3），8 个工作流`
  - `pnpm check:docs`、`pnpm check:changelog` → ✅
  - `pnpm lint`、`pnpm type-check` → ✅ 无告警
  - `pnpm check:all` → ✅ 143 文件 / 1482 测试，全部门禁绿色
  - `pnpm verify:build` → ✅ Next.js 16.3.5 生产构建通过
- 阻塞：无
- 风险与回滚：
  - 风险：新增 provider 或环境变量而不同步两份文档 / 注册表时，`check:provider-docs` 会直接失败；这是刻意的防漂移设计。
  - 风险：`provider:doctor` 只做变量存在性判断，不校验凭据是否有效；真实连通性仍由各 provider 的 smoke / contract 测试覆盖。
  - 风险：`docs-site/scripts.md`、`docs-site/zh-CN/scripts.md` 不满足仓库级 Prettier 格式（既有表格约定），
    本次未对这些文件运行 Prettier；新增 / 修改的 TS 文件已通过 Prettier。
  - 回滚：`git revert 1c80cd0` 即移除诊断模块、CLI、门禁与两份指南；纯校验 / 文档改动，无数据库、迁移或运行时影响。
- 下一步：I09 贡献者测试矩阵。
- 最后更新：2026-09-13


## I09 贡献者测试矩阵（DONE）

- 状态：DONE（M4「发布收口」roadmap `docs/roadmap-0.6.0.md` 第 89 项）
- 里程碑与发布目标：M4 I 段（I01–I10）；不单独升版本，随下一个 minor 里程碑发布
- 分支 / PR：`feat/visual-regression-baseline`；base `origin/main@15b05ebe8e93725e16698e8b66fc9c43e3733965`；无 PR
- 本地提交：`e6975e8`（feat(docs): add a gated contributor test matrix）
- 目标：把「改了这块要跑哪些门禁」从散文变成按改动领域的最小验证集，并让文档里的命令不可能悄悄失效
- 已完成：
  - 新增单一事实源 `src/lib/testing/test-matrix.ts`：`TEST_MATRIX` 登记 11 个改动领域（`ui`、`server-actions`、
    `api-routes`、`auth-mfa`、`database`、`rls-security`、`i18n`、`providers`、`mock`、`ci-tooling`、`docs`），
    每个领域带中英名称、覆盖路径与必须运行的 `package.json` 脚本
  - 新增纯函数审计 `auditTestMatrix()`：只认首列表头为「领域 / Area」且第二行是分隔线的表格，
    数据行首列为行内代码领域 id；规则码 `MATRIX_SOURCE_EMPTY` / `MATRIX_MISSING_AREA` / `MATRIX_UNKNOWN_AREA` /
    `MATRIX_MISSING_COMMAND` / `MATRIX_MISSING_PATH` / `MATRIX_UNKNOWN_COMMAND`，其中命令必须写在**该领域自己的行内**，
    全文引用的每个 `pnpm <script>` 必须真实存在（内置命令白名单 `PNPM_BUILTINS` 除外），抽取为空时失败封闭
  - 新增双语矩阵页 `docs-site/testing.md`（英文）与 `docs-site/zh-CN/testing.md`（中文）：改动领域表、
    领域重叠说明、需要本地 Supabase / Linux 容器的例外，以及「为什么这页有门禁」
  - 新增 `scripts/lib/test-matrix-check.js` + `scripts/check-test-matrix.js`（Node 原生 type stripping），
    IO 层额外确认每个登记路径在磁盘上仍然存在，注册为 `pnpm check:test-matrix`
  - 新增 14 条单测 `src/lib/testing/test-matrix.test.ts`：覆盖真实仓库快照（两份文档 + `package.json`）、
    空文档 / 无可解析表格失败封闭、缺领域、未知领域、命令未落在本行、覆盖路径消失、未知命令、内置命令白名单、
    行与命令抽取、错误格式化，以及每个登记路径确实存在于磁盘
  - 接线：`scripts/check-all.sh` 与 CI `Lint & Type Check` job 均执行 `check:test-matrix`；
    双语 `docs-site/scripts.md` 新增一行；`docs-site/.vitepress/config.mts` 双语 nav + sidebar 增加
    Contributor Test Matrix 入口（`docs-site` vitepress 构建通过）；`CONTRIBUTING.md` 第 4 步改为先查矩阵再全量验证；
    `docs/testing.md` 增加「贡献者测试矩阵（I09）」小节；`CHANGELOG.md` `[Unreleased] / Added` 记录；
    roadmap 第 89 项与头部进度标注完成
- 变更文件：`src/lib/testing/test-matrix.ts`、`src/lib/testing/test-matrix.test.ts`、
  `scripts/lib/test-matrix-check.js`、`scripts/check-test-matrix.js`、`package.json`、`scripts/check-all.sh`、
  `.github/workflows/ci.yml`、`docs-site/testing.md`、`docs-site/zh-CN/testing.md`、`docs-site/scripts.md`、
  `docs-site/zh-CN/scripts.md`、`docs-site/.vitepress/config.mts`、`CONTRIBUTING.md`、`docs/testing.md`、
  `CHANGELOG.md`、`docs/roadmap-0.6.0.md`
- 验证命令与结果（提交 `e6975e8`）：
  - `pnpm check:test-matrix` → ✅ `11 个领域 / 78 条门禁 × 2 份文档`
  - `pnpm vitest run src/lib/testing/test-matrix.test.ts` → ✅ 14 passed
  - `pnpm check:gates` → ✅ `23 个门禁（本地 20 / CI 21 / 豁免 3），8 个工作流`
  - `pnpm check:docs`、`pnpm check:changelog` → ✅
  - `pnpm lint`、`pnpm type-check` → ✅ 无告警
  - `pnpm check:all` → ✅ 144 文件 / 1496 测试，全部门禁绿色
  - `pnpm verify:build` → ✅ Next.js 16.3.5 生产构建通过
  - `pnpm test:coverage` → ✅ statements 96.41 / branches 90.80 / functions 96.82 / lines 97.50（新增 `lib/testing` 98.59/94.11/100/98.48）
  - `cd docs-site && pnpm build` → ✅ vitepress 1.6.4 构建通过（新增双语页面与 nav/sidebar 无死链）
- 阻塞：无
- 风险与回滚：
  - 风险：矩阵把「最小门禁集」写死进代码，领域新增或门禁改名时 `check:test-matrix` 会失败；这是刻意的防漂移设计。
  - 风险：`MATRIX_MISSING_PATH` 只校验路径字符串出现与磁盘存在，不校验路径与命令的语义匹配度；跨领域改动仍需靠人判断取并集。
  - 风险：`docs-site/scripts.md`、`docs-site/zh-CN/scripts.md` 不满足仓库级 Prettier 格式（既有表格约定），
    本次未对这些文件运行 Prettier；新增 / 修改的 TS 与 JS 文件已通过 Prettier。
  - 回滚：`git revert e6975e8` 即移除矩阵模块、门禁与两份页面；纯文档 / 校验改动，无数据库、迁移或运行时影响。
- 下一步：I10 迁移回滚 runbook。
- 最后更新：2026-09-13

## I10 迁移回滚 Runbook（DONE）

- 状态：DONE（M4「发布收口」roadmap `docs/roadmap-0.6.0.md` 第 90 项）
- 里程碑与发布目标：M4 I 段（I01–I10）；不单独升版本，随下一个 minor 里程碑发布
- 分支 / PR：`feat/visual-regression-baseline`；base `origin/main@15b05ebe8e93725e16698e8b66fc9c43e3733965`；无 PR
- 本地提交：`ee63de3`（feat(db): add a gated migration rollback runbook）
- 目标：把数据库迁移回滚的触发条件、逆向风险、前向修复策略和验证步骤收敛为统一 runbook，并用门禁阻止「最新迁移」和操作命令随仓库演进而过期
- 已完成：
  - 新增 `docs/operations/migration-rollback-runbook.md`：覆盖触发条件、决策树、前向修复优先、迁移类型与回滚配方、操作步骤、回滚后验证、权限与审批、演练记录；明确「不自动回滚数据库」、快照/双人审批前提，以及与 `rollback-runbook-v0.10.0.md` 的职责边界
  - 新增纯函数 `src/lib/db/migration-runbook.ts`：校验八个必备章节、`SUPABASE_ACCESS_TOKEN` / `SUPABASE_PROJECT_REF` / 「不自动回滚数据库」三项事实、机器可读最新迁移标记、文档引用的迁移文件、三条必备操作命令，以及文档内所有 `pnpm <script>` 是否真实注册；清单或文档为空时失败封闭
  - 新增 `scripts/lib/migration-runbook-check.js` + `scripts/check-migration-runbook.js`，注册为 `pnpm check:migration-runbook`
  - 新增 20 条单测，覆盖真实仓库快照、缺章节/事实/标记、陈旧标记、未知迁移、缺必备命令、未知脚本、pnpm 内置命令白名单、辅助函数与失败格式化
  - 接线：`scripts/check-all.sh` 与 CI `Lint & Type Check` job 均执行；双语 `docs-site/scripts.md` 增加命令说明；`docs/testing.md` 增加门禁章节；`CHANGELOG.md` `[Unreleased] / Added` 记录；roadmap 第 90 项与头部进度标注完成
- 变更文件：`src/lib/db/migration-runbook.ts`、`src/lib/db/migration-runbook.test.ts`、`scripts/lib/migration-runbook-check.js`、`scripts/check-migration-runbook.js`、`docs/operations/migration-rollback-runbook.md`、`package.json`、`scripts/check-all.sh`、`.github/workflows/ci.yml`、`docs-site/scripts.md`、`docs-site/zh-CN/scripts.md`、`docs/testing.md`、`CHANGELOG.md`、`docs/roadmap-0.6.0.md`
- 验证命令与结果（提交 `ee63de3`）：
  - `pnpm check:migration-runbook` → ✅ 31 条迁移，最新 `031_upload_objects.sql`
  - `pnpm vitest run src/lib/db/migration-runbook.test.ts` → ✅ 20 passed
  - `pnpm check:gates` → ✅ 24 个门禁（本地 21 / CI 22 / 豁免 3），8 个工作流
  - `pnpm check:docs`、`pnpm check:changelog`、`pnpm check:release-docs` → ✅
  - `pnpm lint`、`pnpm type-check` → ✅ 无告警
  - `pnpm check:all` → ✅ 145 文件 / 1516 测试，全部门禁绿色
  - `pnpm verify:build` → ✅ Next.js 16.3.5 生产构建通过（bundle 2853.1 kB / 基线 2733.8 kB）
- 阻塞：无
- 风险与回滚：
  - 风险：门禁只证明 runbook 与仓库事实一致，不证明备份可用或恢复演练成功；真实回滚仍需快照、DBA 与发布负责人。文档已把该限制写成明确前置条件。
  - 风险：新增迁移后若忘记更新 `<!-- migration-runbook:latest=... -->`，`check:migration-runbook` 会阻断；必须与 `update:migrations-manifest` 同步维护。
  - 回滚：`git revert ee63de3` 即移除 runbook、门禁、单测与接线；纯文档/校验改动，无数据库或运行时影响。
- 下一步：J02 E2E shard/串行策略复审。
- 最后更新：2026-09-13

## J02 E2E Shard / 串行策略复审（DONE）

- 状态：DONE（M4「发布收口」roadmap `docs/roadmap-0.6.0.md` 第 92 项）
- 里程碑与发布目标：M4 J 段（J01–J10）；不单独升版本，随下一个 minor 里程碑发布
- 分支 / PR：`feat/visual-regression-baseline`；base `origin/main@15b05ebe8e93725e16698e8b66fc9c43e3733965`；无 PR
- 本地提交：`ceaf29c`（ci(e2e): shard playwright runs without sharing mock state）
- 目标：在不破坏共享 Mock 状态隔离的前提下缩短 E2E CI 时间，并用配置回归测试把「shard 隔离、单 worker、视觉不重复」策略固定下来
- 已完成：
  - 先量化现状：`pnpm exec playwright test --list` 为 86 条 / 12 个文件；`--shard=1/2` 为 46 条 / 8 个文件，`--shard=2/2` 为 40 条 / 4 个文件
  - `.github/workflows/ci.yml` 的 `E2E (Playwright)` 改为 `shard: [1, 2]` matrix + `fail-fast: false`；每个 shard 是独立 job，各自启动独立 dev server，内部仍为单 worker，避免同进程并发修改 Mock 状态
  - E2E step 使用 `pnpm test:e2e --shard=${{ matrix.shard }}/2`；Playwright report artifact 改为 `playwright-report-shard-${{ matrix.shard }}`，两个 shard 不再互相覆盖证据
  - 4 条视觉基线只在 `matrix.shard == 1` 执行一次，避免重复跑和不必要的视觉噪声
  - 修正 shard 暴露的上传 E2E hydration 时序抖动：新增 `chooseAvatar()`，对「setInputFiles + 等待按钮启用」整组动作重试，避免冷编译时首次 change 事件被未 hydration 的 React 丢弃
  - 新增 `src/lib/testing/e2e-shard-policy.test.ts`（3 条）：锁定默认单 worker / `PW_FULLY_PARALLEL` opt-in、shard matrix、精确运行命令、视觉仅 shard 1、artifact 命名与稳定 job 名
  - `docs/testing.md` 增加 shard 策略、状态隔离边界、46/40 分流与配置回归测试说明；`CHANGELOG.md` `[Unreleased] / Added` 记录；roadmap 第 92 项与头部进度标注完成
- 变更文件：`.github/workflows/ci.yml`、`playwright.config.ts`、`e2e/uploads.spec.ts`、`src/lib/testing/e2e-shard-policy.test.ts`、`docs/testing.md`、`CHANGELOG.md`、`docs/roadmap-0.6.0.md`
- 验证命令与结果（提交 `ceaf29c`）：
  - `pnpm test:e2e --shard=1/2` → ✅ 46 passed（1.0m；仅观察到 Next dev 的 ECONNRESET 噪声，无测试失败）
  - `pnpm test:e2e --shard=2/2` → ✅ 40 passed（46.2s；修正 hydration 抖动后复跑通过）
  - `pnpm exec vitest run src/lib/testing/e2e-shard-policy.test.ts` → ✅ 3 passed
  - `pnpm check:gates` → ✅ 24 个门禁（本地 21 / CI 22 / 豁免 3），8 个工作流
  - `pnpm check:docs`、`pnpm check:changelog`、`pnpm check:release-docs`、`pnpm check:test-matrix` → ✅
  - `pnpm lint`、`pnpm type-check` → ✅ 无告警
  - `pnpm check:all` → ✅ 146 文件 / 1519 测试，全部门禁绿色
  - `pnpm verify:build` → ✅ Next.js 16.3.5 生产构建通过（bundle 2853.1 kB / 基线 2733.8 kB）
- 阻塞：无（真实 GitHub Actions 执行仍需推送权限；本地已验证同一 workflow 配置与两个 shard）
- 风险与回滚：
  - 风险：CI 并行度提高后，若未来 Mock 状态从 dev server 内存迁回跨进程共享存储，shard 隔离假设需要重新评审；当前两个 shard 各自持有 server 内状态。
  - 风险：`chooseAvatar()` 只重试文件选择动作，不掩盖上传接口的真实失败；按钮持续无法启用或上传响应错误仍会在超时后失败。
  - 回滚：`git revert ceaf29c` 即恢复单 job E2E；纯 CI / 测试配置改动，无数据库或运行时接口影响。
- 下一步：J03 CI 并行与缓存优化。
- 最后更新：2026-09-13

## J03 CI 并行与缓存优化（DONE）

- 状态：DONE（M4「发布收口」roadmap `docs/roadmap-0.6.0.md` 第 93 项）
- 里程碑与发布目标：M4 J 段（J01–J10）；不单独升版本，随下一个 minor 里程碑发布
- 分支 / PR：`feat/visual-regression-baseline`；base `origin/main@15b05ebe8e93725e16698e8b66fc9c43e3733965`；无 PR
- 本地提交：`f78e0d5`（ci(workflows): parallelize coverage and cache playwright browsers）
- 目标：让 CI 从「一条串行链」变成「廉价门禁先失败、昂贵作业并行」，并把工作流卫生（action 固定版本、作业超时、`needs` 指向、PR 并发取消、脚本名真实存在、ci.yml 并行/缓存拓扑）固化为可执行门禁，避免墙钟时间与 runner 配额被无声浪费
- 已完成：
  - `.github/workflows/ci.yml` 把覆盖率测试从 `Lint & Type Check` 拆到独立的 `Unit Tests` job（无 `needs`，与静态门禁并行）；`Build` 与 `E2E (Playwright)` 的 `needs` 仍只指向 `Lint & Type Check`，因此构建与 E2E 不再为一次覆盖率运行多等一两分钟
  - `E2E (Playwright)` 新增 `actions/cache@v6` 缓存 `~/.cache/ms-playwright`，键为 `playwright-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }}` + `restore-keys`；Playwright 版本随锁文件变化即自动失效，`playwright install --with-deps` 仍保留以补齐系统依赖
  - 四个触发 `pull_request` 的工作流（`ci.yml` / `codeql.yml` / `secrets-scan.yml` / `security-config.yml`）新增 `concurrency` + `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`：同一分支连续推送立刻取消被取代的运行，而 main/develop 的 push 与 schedule 事件不取消，扫描结果始终保留
  - 新增纯函数 `src/lib/ci/workflow-policy.ts`：作业必须有 `runs-on` / `timeout-minutes`；`uses:` 必须固定在 semver 标签或 40 位 SHA（`@main` / `@latest` / 裸 `@head` 失败）；`needs` 必须指向同一工作流内真实存在的作业；触发 PR 的工作流必须声明非 `false` 的 `cancel-in-progress`；`pull_request_target` 直接禁止；工作流里出现的 `pnpm <a:b>` 必须真实存在于 `package.json`；`ci.yml` 的并行/缓存拓扑必须与 `CI_TOPOLOGY` 契约一致（静态门禁与单元测试均无前置依赖、昂贵作业 `needs` 恰好是静态门禁、覆盖率不得留在静态门禁、e2e 必须按锁文件哈希缓存浏览器）
  - 命令识别按行扫描（`jobRuns()` 同时支持 `- run: pnpm x` 与 `run: |` 块标量），避免 `\s` 吞掉换行后把下游作业的 `run:` 误判进当前作业；抽取结果为空时失败封闭，解析规则失效不会被当成「零问题」
  - 新增 `scripts/lib/workflow-policy-check.js` + `scripts/check-workflows.js`（Node `--experimental-strip-types`），注册为 `pnpm check:workflows`，接入 `scripts/check-all.sh` 与 CI `Lint & Type Check` job
  - 新增 28 条单测：覆盖触发/作业解析、pinning 判定、缺 `runs-on`/`timeout-minutes`、未知 `needs`、缺 `concurrency`、`cancel-in-progress: false`、`pull_request_target`、不存在的 `pnpm <a:b>`、拓扑漂移（缺作业 / 串行化 `needs` / 覆盖率留在静态门禁 / 单元测试缺覆盖率 / 昂贵作业缺失或 `needs` 错误 / 5 种浏览器缓存偏差）、块标量 `run` 识别与跨作业隔离，以及读取真实仓库工作流的端到端断言
  - 文档与接线：双语 `docs-site/scripts.md` 增行、双语 `docs-site/testing.md` 的 `ci-tooling` 行补 `pnpm check:workflows`、`src/lib/testing/test-matrix.ts` 同步；`docs/testing.md` 的「CI 门禁」章节重写并新增「并行与缓存拓扑（J03）」；`.github/RELEASE_CHECKLIST.md` 的 CI job 清单补 `Unit Tests`；`CHANGELOG.md` `[Unreleased] / Added` 记录；roadmap 第 93 项与头部进度标注完成
- 变更文件：`.github/workflows/ci.yml`、`.github/workflows/codeql.yml`、`.github/workflows/secrets-scan.yml`、`.github/workflows/security-config.yml`、`.github/RELEASE_CHECKLIST.md`、`src/lib/ci/workflow-policy.ts`、`src/lib/ci/workflow-policy.test.ts`、`scripts/lib/workflow-policy-check.js`、`scripts/check-workflows.js`、`package.json`、`scripts/check-all.sh`、`src/lib/testing/test-matrix.ts`、`docs-site/scripts.md`、`docs-site/zh-CN/scripts.md`、`docs-site/testing.md`、`docs-site/zh-CN/testing.md`、`docs/testing.md`、`CHANGELOG.md`、`docs/roadmap-0.6.0.md`
- 验证命令与结果（提交 `f78e0d5`）：
  - `pnpm check:workflows` → ✅ 8 个工作流 / 12 个作业 / 35 个 action 引用
  - `pnpm exec vitest run src/lib/ci/workflow-policy.test.ts` → ✅ 28 passed
  - `pnpm check:gates` → ✅ 25 个门禁（本地 22 / CI 23 / 豁免 3），8 个工作流
  - `pnpm check:docs`、`pnpm check:changelog`、`pnpm check:release-docs`、`pnpm check:test-matrix`、`pnpm check:locales` → ✅
  - `pnpm lint`、`pnpm type-check` → ✅ 无告警（`auditCiTopology` 曾触发 complexity 16/15，已拆分为 `auditEntryJobs` / `auditExpensiveJobs` / `auditBrowserCache`）
  - `pnpm check:all` → ✅ 147 文件 / 1547 测试，全部门禁绿色
  - `pnpm verify:build` → ✅ Next.js 16.3.5 生产构建通过（bundle 2853.1 kB / 基线 2733.8 kB）
- 阻塞：无（真实 GitHub Actions 执行仍需推送权限；本地已验证 workflow 配置、拓扑契约与真实仓库快照）
- 风险与回滚：
  - 风险：解析是纯文本缩进分析，没有引入 YAML 依赖；若工作流改用不支持的缩进风格（例如 4 空格缩进作业头），抽取会失败封闭并阻断 CI，而不是静默漏检。
  - 风险：`cancel-in-progress` 只对 `pull_request` 生效；若未来把某些 PR 工作流改成 `push` 触发，需要重新评审是否也取消（当前刻意保留 push/schedule 的历史结果）。
  - 风险：Playwright 浏览器缓存键只含锁文件哈希；Playwright 版本升级但锁文件未变（例如手动改 `package.json` 未跑 install）时会命中陈旧缓存，`install --with-deps` 仍会补齐缺失浏览器，但缓存收益会下降。
  - 回滚：`git revert f78e0d5` 即恢复单 job 覆盖率、移除浏览器缓存与 `concurrency`，并移除 `pnpm check:workflows` 门禁；纯 CI / 校验改动，无数据库或运行时接口影响。
- 下一步：J04 CodeQL 告警零回归。
- 最后更新：2026-09-13

## J04 CodeQL 告警零回归（DONE）

- 状态：DONE（M4「发布收口」roadmap `docs/roadmap-0.6.0.md` 第 94 项）
- 里程碑与发布目标：M4 J 段（J01–J10）；不单独升版本，随下一个 minor 里程碑发布
- 分支 / PR：`feat/visual-regression-baseline`；base `origin/main@15b05ebe8e93725e16698e8b66fc9c43e3733965`；无 PR
- 本地提交：`9061189`（ci(codeql): gate scan strength and alert triage policy）
- 目标：把「CodeQL 告警零回归」从「扫描还开着」细化为可执行契约——扫描强度、触发覆盖、路径范围与告警处置流程四类事实都要能被门禁验证，配置或 runbook 漂移即失败
- 已完成：
  - 新增纯函数模块 `src/lib/security/codeql-alert-policy.ts`（`parseCodeqlWorkflow` / `actionMajorMatches` / `isWeeklyCron` / `pathCovers` / `auditCodeqlAlertPolicy` / `formatCodeqlIssues` + `CODEQL_CONTRACT`），复用 `src/lib/ci/workflow-policy.ts` 的作业与触发解析，抽取为空时失败封闭
  - 扫描强度断言：`init` 与 `analyze` 必须同时存在、固定在 `github/codeql-action@v4`（允许 `@v4.x.y`，跨 major 或换仓库失败）且两者 major 一致；语言必须覆盖 `javascript-typescript`；查询套件必须保持 `security-extended`；SARIF `category` 必须保持 `/language:javascript-typescript`；analyze 作业必须保留 `security-events: write` 与 `timeout-minutes`；禁止 `upload: false`
  - 触发覆盖断言：`push` 必须覆盖 `main`/`develop`，`pull_request` 必须覆盖 `main`，`schedule` 必须有且**每周一次**（cron 的日期与月份字段必须是 `*`，星期字段必须是契约星期，退化成每日或换星期都失败）
  - 路径范围断言：`paths` / `paths-ignore` 只从 `push` / `pull_request` 触发块读取（GitHub 只在该位置支持这两个键，写在作业里既不生效也不该被当成合规）；`paths-ignore` 默认不允许任何条目，`paths` 白名单不得漏掉 `src` / `scripts` / `e2e` / `supabase`
  - 处置流程断言：新增 `docs/operations/codeql-alert-triage.md` 作为告警处置单一事实来源（适用范围、严重度与阻断阈值、分诊流程、Dismissal 规则、零回归的判定、外部依赖六章；阻断阈值 `security-severity >= 7.0`、5 个工作日内完成分诊、只允许 `false positive` / `won't fix` / `used in tests` 三种理由），门禁要求 runbook 存在、非空、章节齐全，且套件名、阈值、SLA 与 dismissal 理由与 `CODEQL_CONTRACT` 同源
  - 新增 `scripts/lib/codeql-policy-check.js`（IO 层：读 `.github/workflows/codeql.yml` 与 runbook，组装快照）+ `scripts/check-codeql.js`（CLI，Node `--experimental-strip-types`），注册为 `pnpm check:codeql`，接入 `scripts/check-all.sh` 与 CI `Lint & Type Check` job
  - 修掉实现阶段发现的三个真实缺陷（由测试与真实快照共同暴露）：① cron 正则用 `[^"'\s]+` 取值，含空格的真实表达式 `"0 6 * * 1"` 永远匹配不到，导致 schedule 断言静默走「缺每周扫描」分支；② `actionMajorMatches` 只比对仓库路径，`@v3` 会被判为合规，major 固定形同虚设；③ `paths` / `paths-ignore` 原先从分析作业正文读取，触发器上的排除规则会被漏检
  - 新增 44 条单测：解析（触发/分支/cron/引用/语言/套件/category/权限/超时/空内容）、`isWeeklyCron`（每周通过、每日失败、星期不符、限定日期或月份、字段不足）、`pathCovers`、`actionMajorMatches`（v4、v4.1.2、v3、v41、换仓库、空串）、18 类规则码反例、契约可注入（换星期）、`formatCodeqlIssues`，以及读取真实工作流与 runbook 断言零问题
  - 文档与接线：双语 `docs-site/scripts.md` 增行、双语 `docs-site/testing.md` 的 `ci-tooling` 行补 `pnpm check:codeql`（行宽保持 255 / 250）、`src/lib/testing/test-matrix.ts` 同步；`docs/testing.md` 新增「CodeQL 扫描强度与告警处置（J04）」章节（含本地无法复现的外部依赖说明）；`CHANGELOG.md` `[Unreleased] / Added` 记录；roadmap 第 94 项与头部进度标注完成
- 变更文件：`.github/workflows/ci.yml`、`scripts/check-all.sh`、`scripts/check-codeql.js`、`scripts/lib/codeql-policy-check.js`、`src/lib/security/codeql-alert-policy.ts`、`src/lib/security/codeql-alert-policy.test.ts`、`src/lib/testing/test-matrix.ts`、`package.json`、`docs/operations/codeql-alert-triage.md`、`docs/testing.md`、`docs-site/scripts.md`、`docs-site/zh-CN/scripts.md`、`docs-site/testing.md`、`docs-site/zh-CN/testing.md`、`CHANGELOG.md`、`docs/roadmap-0.6.0.md`
- 验证命令与结果（提交 `9061189`）：
  - `pnpm check:codeql` → ✅ CodeQL 策略校验通过（`github/codeql-action@v4` / `javascript-typescript` / `security-extended` / 严重度 ≥ 7 阻断 / 分诊 SLA 5 个工作日，21 条契约断言）
  - `pnpm exec vitest run src/lib/security/codeql-alert-policy.test.ts` → ✅ 44 passed
  - `pnpm check:gates` → ✅ 26 个门禁（本地 23 / CI 24 / 豁免 3），8 个工作流
  - `pnpm check:workflows` → ✅ 8 个工作流 / 12 个作业 / 35 个 action 引用
  - `pnpm check:docs`、`pnpm check:changelog`、`pnpm check:release-docs`、`pnpm check:test-matrix`、`pnpm check:locales` → ✅
  - `pnpm lint`、`pnpm type-check` → ✅ 无告警
  - `pnpm check:all` → ✅ 148 文件 / 1591 测试，全部门禁绿色
  - `pnpm verify:build` → ✅ Next.js 16.3.5 生产构建通过（bundle 2853.1 kB / 基线 2733.8 kB）
- 阻塞：无（真实告警列表、与 `origin/main` 基线分支的差异、dismissal 记录都在 GitHub 侧，需要 `security-events: read` 权限，属外部依赖；本门禁只防止扫描强度与处置策略静默漂移）
- 风险与回滚：
  - 风险：解析仍是纯文本缩进分析（未引入 YAML 依赖）。工作流改用不支持的缩进风格时抽取会失败封闭并阻断 CI，而不是静默放过。
  - 风险：`paths` 只读取触发器块；若未来 GitHub 改变该键的合法位置，需要同步调整 `triggerPaths()`，否则会出现漏检。
  - 风险：runbook 事实校验是「子串出现即可」，无法验证语义正确性；真正的零回归结论仍需在有 GitHub 权限的环境（发布负责人或 CI）里确认。
  - 回滚：`git revert 9061189` 即移除门禁、runbook 与文档接线；纯校验/文档改动，无数据库或运行时接口影响。
- 下一步：J05 Secrets Scan 零回归。
- 最后更新：2026-09-13

## J05 Secrets Scan 零回归（DONE）

- 状态：DONE（M4「发布收口」roadmap `docs/roadmap-0.6.0.md` 第 95 项）
- 里程碑与发布目标：M4 J 段（J01–J10）；不单独升版本，随下一个 minor 里程碑发布
- 分支 / PR：`feat/visual-regression-baseline`；base `origin/main@15b05ebe8e93725e16698e8b66fc9c43e3733965`；无 PR
- 本地提交：`517b17a`（ci(secrets): gate gitleaks scan strength and allowlist）
- 目标：把「密钥零回归」从「gitleaks 工作流还在、regex 还能匹配 fetch-depth」推进到可执行契约，重点阻止 allowlist 静默清空扫描结果，并把泄漏响应时限、轮换要求与允许理由纳入同源校验
- 已完成：
  - 新增纯函数 `src/lib/security/secrets-scan-policy.ts`：契约固定 `.github/workflows/secrets-scan.yml` 的 `gitleaks/gitleaks-action@v3`、`gitleaks` 作业、`fetch-depth: 0`、`timeout-minutes`、`contents: read`、`GITHUB_TOKEN` 接线、push `main`/`develop` 与 pull_request 触发，并禁止任何 `: write` 权限
  - allowlist 审计：当 `.gitleaks.toml` 存在时，解析 `[allowlist]` / `[[allowlists]]` 下的 `paths` / `regexes` / `stopwords` / `commits`（含跨行数组），每条值都必须登记在 `allowedAllowlistEntries`（默认空）；解析为空不会跳过，配置缺失时才按可选文件处理
  - 泄漏处置事实：新增 `docs/operations/secrets-leak-response-runbook.md`，包含适用范围、立即响应、影响范围判定、处置与验证、历史记录处理、Allowlist 规则、外部依赖七章，并明确首次响应 `10 分钟`、`24 小时` 内完成轮换、全历史 `fetch-depth: 0`、只允许 `false positive` / `used in tests` 两类 allowlist 理由；门禁同时校验章节与事实同源
  - 复用与抽取：把 workflow 解析所需 helper 抽到 `src/lib/ci/workflow-policy.ts`（`actionRefVersion`、`isVersionAtMajor`、`parseStepRef`、`parseTriggerBlock`、`parseKeyedList`、`parseTriggerBranches`），CodeQL 策略模块改为复用，避免两套正则各自漂移
  - 修复实现阶段发现的边界：write 权限正则从 `\s{0,6}` 改为 `[ \t]{0,6}`，避免跨行吞掉仍被误判；action major 使用共享 helper，`@v2` 不再因只比对仓库路径而通过
  - 新增 48 条单测：解析触发/分支/action/fetch-depth/敏感 env/权限/config 引用，`actionRefMatches`（`@v3`、`@v3.2.1`、`@v2`、`@v31`、换仓库、空串）、`collectSensitiveEnv`、`configReference`、`parseGitleaksAllowlists`（单/多段、跨行、未知键、段外内容），全部 17 类规则码反例、契约注入、格式化输出，以及读取真实工作流与 runbook 断言零问题
  - 新增 `scripts/lib/secrets-scan-policy-check.js`（IO：读 workflow / 可选 `.gitleaks.toml` / runbook）+ `scripts/check-secrets-scan.js`（Node `--experimental-strip-types` CLI），注册为 `pnpm check:secrets-scan`，接入 `scripts/check-all.sh` 与 CI `Lint & Type Check` job
  - 文档与接线：双语 `docs-site/scripts.md` 增行、双语 `docs-site/testing.md` 的 `ci-tooling` 行补 `pnpm check:secrets-scan`（行宽保持 255 / 250）、`src/lib/testing/test-matrix.ts` 同步；`docs/testing.md` 新增「Secrets Scan 扫描强度与泄漏处置（J05）」章节；`CHANGELOG.md` `[Unreleased] / Added` 记录；roadmap 第 95 项与头部进度标注完成
- 变更文件：`src/lib/ci/workflow-policy.ts`、`src/lib/security/codeql-alert-policy.ts`、`src/lib/security/secrets-scan-policy.ts`、`src/lib/security/secrets-scan-policy.test.ts`、`scripts/check-secrets-scan.js`、`scripts/lib/secrets-scan-policy-check.js`、`scripts/check-all.sh`、`.github/workflows/ci.yml`、`package.json`、`src/lib/testing/test-matrix.ts`、`docs/operations/secrets-leak-response-runbook.md`、`docs/testing.md`、`docs-site/scripts.md`、`docs-site/zh-CN/scripts.md`、`docs-site/testing.md`、`docs-site/zh-CN/testing.md`、`CHANGELOG.md`、`docs/roadmap-0.6.0.md`
- 验证命令与结果（提交 `517b17a`）：
  - `pnpm check:secrets-scan` → ✅ Secrets Scan 策略校验通过（`gitleaks/gitleaks-action@v3` / fetch-depth 0 / push main,develop / 首次响应 10 分钟 / 轮换 24 小时，20 条契约断言）
  - `pnpm exec vitest run src/lib/security/secrets-scan-policy.test.ts src/lib/security/codeql-alert-policy.test.ts src/lib/ci/workflow-policy.test.ts` → ✅ 120 passed
  - `pnpm check:gates` → ✅ 27 个门禁（本地 24 / CI 25 / 豁免 3），8 个工作流
  - `pnpm check:workflows` → ✅ 8 个工作流 / 12 个作业 / 35 个 action 引用
  - `pnpm check:docs`、`pnpm check:changelog`、`pnpm check:release-docs`、`pnpm check:test-matrix`、`pnpm check:locales` → ✅
  - `pnpm lint`、`pnpm type-check` → ✅ 无告警
  - `pnpm check:all` → ✅ 149 文件 / 1639 测试，全部门禁绿色
  - `pnpm verify:build` → ✅ Next.js 16.3.5 生产构建通过（bundle 2853.1 kB / 基线 2733.8 kB）
- 阻塞：真实历史扫描结果与 GitHub 告警状态在 gitleaks runner / GitHub 侧，需要推送与 `security-events` 权限；本地门禁只防止扫描强度、allowlist 与处置策略静默漂移
- 风险与回滚：
  - 风险：workflow / TOML 解析仍是纯文本缩进分析，不引入 YAML / TOML 运行时依赖。格式超出支持范围时抽取为空会失败封闭，而不是静默放过。
  - 风险：allowlist 当前允许值由契约逐条登记，新增合法测试 fixture 时需要同步修改契约与文档；这是刻意的摩擦，避免扩大排除范围无人复核。
  - 回滚：`git revert 517b17a` 即移除门禁、runbook 与文档接线；纯校验、CI 与文档改动，无数据库、运行时接口或部署影响。
- 下一步：J07 tag/release 自动化（J06 / J08 仍受生产环境与部署权限阻塞）。
- 最后更新：2026-09-13
