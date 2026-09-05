# Changelog

All notable changes to IndieStack will be documented in this file.

## [0.5.0] — 2026-09-05

> 主题：**邮件通道完善 + 对象存储接入 + 可观测性落地**

### Added

- **邮件通道完善（A 域）**：
  - 摘要同类型折叠：同类型 ≥3 条合并计数、明细截断 5 条 + 溢出提示（A01）
  - 发送失败重试计数与死信：`metadata.email_attempts` ≥3 由拉取侧过滤，不再阻塞队列（A02）
  - 高优先级通知实时单发：security_alert/team_invite/role_changed/payment_succeeded
    经 `notifyUser()` 事件触发即发，cron 兜底重试（A03）
  - digest 按用户时区错峰：本地 08:00 发送，空/非法时区回退 Asia/Shanghai（A04）
  - 营销邮件独立通道（迁移 016）：double opt-in 订阅确认 + 公开确认/退订路由 +
    强制退订页脚（A05）
- **对象存储（B 域，ADR-010）**：`StorageDriver` 双驱动抽象——默认 Supabase Storage，
  `OSS_*` 四项齐备切换阿里云 OSS（`ali-oss` 动态加载）；服务端中转上传
  （≤2MB，类型白名单/扩展名映射防穿越）；头像上传（B02）与项目封面（B03，复用
  `projects.logo_url`）接入
- **可观测性（C 域）**：Appark APM 轻量接入（ADR-011，无厂商 SDK、默认旁路关闭，
  checkout/cron 埋点）；cron worker 运行记录表（迁移 017，pulled/sent/failed/duration）；
  待发队列积压超阈值 Sentry 告警
- **认证安全（D 域）**：登录失败锁定收口进 rate-limit 键控滑窗并新增 IP 维度（D03）；
  会话设备列表与单设备吊销（迁移 018，GoTrue session id 登记心跳 + 设置页 UI，D02）；
  WebAuthn/Passkey 试点（迁移 019，feature flag 门控，注册/验证闭环，ADR-012，D01）
- **其他**：环境变量校验扩展（OSS/Appark 部分配置告警）

### Changed

- **TanStack Query 缓存策略统一（E02）**：`QUERY_KEYS` 单一来源 +
  `dashboardQueryOptions` 三档缓存档位（live/standard/admin），8 个调用点迁移
- **前端性能复审（E03）**：Supabase preconnect 补 `crossOrigin`（CORS TLS 复用修正），
  基线入档 `docs/operations/perf-baseline.md`

### Fixed

- 邮件模板 `String.replace` 特殊模式（`$&`）可能损坏用户内容 HTML 的隐患
- digest 空队列响应统一为 `{ sent, groups, failed }`
- dev 端 `components.json` 残留对已删除 `tailwind.config.ts` 的引用（`next build` 不读，
  `next dev` 会炸）
- `/(marketing)/contact` 表单 4 个 input 缺 `name` 属性（`id` 有但 server action 读 `formData.get(...)` 永远 null → submit 永远 `invalidInput` 失败；F02 E2E 复测发现并修复）

### Testing

- **E2E 邮件全链路（F01）**：`e2e/mail-flow.spec.ts` 覆盖 happy path（设置页开启营销邮件 →
  捕获 double opt-in 确认邮件 → 种通知 → 触发 digest cron → 断言摘要邮件主题含「N 条」
  + `email_worker_runs` 落表 pulled/sent/groups/failed）与 failure path（`?failNext=1`
  注入失败 → digest 返回 `failed=1` + `email_worker_runs.failed>0`）。
  Mock 端补：`MockQueryBuilder` 新增 `.or()/.not()/.contains()/.lt()/.is()/.upsert()`
  与 JSON 字段路径（`metadata->>email_attempts`）解析；`email_worker_runs` /
  `marketing_subscriptions` 表接入 mock 读写；mock profile `notification_settings`
  字段对齐真实 schema；`sendResendEmail` 支持 `RESEND_API_URL` 端点覆盖；
  E2E 专用路由（仅 mock 启用 + Bearer 校验）`/api/e2e/email-inbox`、
  `/api/e2e/seed-notifications`、`/api/e2e/email-worker-runs`、
  `/api/e2e/profile-timezone`（动态写入本机时区以命中 digest 错峰门控）。
  Playwright 配置注入 `RESEND_API_URL/KEY` + `CRON_SECRET` + `NEXT_PUBLIC_APP_URL` +
  `E2E_BEARER_TOKEN`；`pnpm test:e2e` 24/24 全绿（含 v0.4.0 既有 22 例 + F01 新增 2）。
- **E2E：admin / contact / MFA 页面（F02）**：`e2e/admin-contact-mfa.spec.ts` 覆盖 admin 概览页（统计卡片渲染）、admin/users 用户列表（mock 用户行可见）、admin/messages 消息列表可达、contact 表单 UI 流程（可达 + 字段填写 + submit 后无运行时错误）、mock contact_messages POST → GET 字段对齐（name/email/subject/message 全字段校验）。
  Mock 端补：mock 缓存切到 `globalThis.__indiestackMockCache__`，解决 Next.js 16 + Turbopack dev 将 server action 与 route handler 拆分到不同 chunk 时模块级 `let` 缓存不共享的问题（v0.5.0 F02 contact-messages 闭环踩到的真根因）；新增 `getMockContactMessages()` + `case "contact_messages"` 读写双路径；`/api/e2e/contact-messages` 提供 POST 端点（仅 mock + Bearer 校验）绕过 server action 跨进程不可见的限制；DELETE 走 admin client。Playwright 配置 `fullyParallel: false`（多 worker 并发会触发 DELETE/PATCH 互相覆盖），`pnpm test:e2e` 29/29 全绿（F01 24 + F02 5）。

### 质量

- 覆盖率门禁上调：branches 78 → 85（statements 91 / functions 93 / lines 92），
  实测 92.9 / 85.7 / 95.3 / 93.9；单测 556 → 668 个
- ADR 增补：ADR-010（对象存储）/ ADR-011（APM）/ ADR-012（Passkey）/ ADR-013（Tailwind v4 原生主题）
- **Tailwind v4 原生主题迁移（E01）**：移除 `@config` 桥接与 `tailwind.config.ts`，
  `@theme inline` + `@custom-variant dark` + `@utility container`；动画插件换成
  CSS-only 的 `tw-animate-css`（移除 tailwindcss-animate 依赖）
- 新增依赖：`ali-oss`（OSS 驱动，动态加载）、`@simplewebauthn/*`（Passkey 校验）

## [0.4.0] — 2026-09-05

> 主题：**Admin 运营闭环 + 数据层测试 + 集成接线**

### Added

- **两步验证（TOTP/MFA）全流程**：注册二维码/验证码确认/解除、登录挑战页 `/auth/mfa`（已验证因子强制 aal2）、备用恢复码（生成/兑换 + 前后端单测）
- **通知体系扩展**：通知类型常量（deployment/security_alert 等）、邀请/角色变更/支付成功的跨用户触发、邮件偏好联动矩阵（`notification-prefs`）、侧边栏未读 badge 轮询、单条/全部已读、读取失败错误态与空态引导
- **通知邮件 Worker**：`POST /api/cron/digest`（`CRON_SECRET` 鉴权）拉取待发通知 → Resend 发送 → `markEmailSent` 回执；按用户合并为摘要邮件，CTA 链接取 `NEXT_PUBLIC_APP_URL`（设计见 `docs/design/email-templates.md`）
- **联系消息运营闭环**：迁移 012/015（contact_messages + 处理状态机单向流转）、admin 收件箱（搜索/状态筛选/分页）、垃圾启发式拒收、联系页结构化数据
- **Admin 后台增强**：聚合看板（联系消息/webhook 事件统计）、用户列表服务端分页、webhook payload 查看、审计元数据 details 查看
- **登录安全**：失败分级锁定（邮箱滑窗 5 次/15 分钟）、登录审计日志（成功/失败/MFA/兑换/OAuth）、邮箱未确认时重发确认邮件、OAuth/MFA/会话丢失错误码 i18n 全覆盖
- **会话管理**：当前会话信息聚合 + 退出其他设备
- **数据保留策略**：迁移 014（pg_cron 守卫调度 + webhook 事件清理函数 + 策略文档 `docs/db/retention.md`）
- **API 质量**：错误格式统一收敛 `jsonNoStore`、日志 trace-id 统一（api-log）、health DB 自检、checkout 幂等/重复订阅拦截、og 缓存校验、未知 webhook 事件类型 Sentry 告警
- **环境变量校验模块**（zod 风格诊断 + 单测）
- **SEO/营销**：博客动态 OG 分享图、twitter card、sitemap 文章真实 lastmod、博客分类过滤、FAQ 搜索过滤、RSS feed、PWA manifest
- **UX 组件**：⌘K 命令面板（cmdk）+ 最近页面历史、面包屑导航铺开、QueryErrorState 错误重试铺开、EmptyState 统一空态、资料完整度卡片、离线横幅、路由进度条、定价页月/年切换（8 折年付）
- **测试覆盖**：repository 层 7 模块单测全覆盖、API 路由/actions 单测补齐（health/checkout/notifications/mfa/contact/webhooks）、safe-redirect fuzz/date 边界/CSV 注入变体、a11y 与 trace-id/CSP nonce E2E 断言

### Changed

- **TanStack Table v9 原生迁移**：移除 legacy 桥，显式 features + 行模型槽位（ADR-009）；DataTable 全面国际化（dataTable.* 751 键）、v9 排序表头自动接线
- bundle 基线 2467kB → 2603kB（admin 收件箱/恢复码/会话管理等功能增量，无新依赖）
- 硬编码路由收敛到 `ROUTES` 常量（invite-member/logout-all/notifications/blog 等）
- `.env.example` 补齐 CONTACT_EMAIL/APP_VERSION/VERBOSE_LOGGING

### Fixed

- webhook events action 补 admin 守卫（防绕过入口越权读取）
- 年付节省金额浮点精度取整；三页面面包屑改用 common 命名空间（修复 `dashboard.dashboard` 缺键）
- RECOVERY_CODE_COUNT 移出 use server 文件；recovery action node:crypto 改动态导入（修客户端代理导出分析失败）
- standalone 输出条件化（DOCKER_BUILD 门控）
- 迁移 011 补 profiles lower(email) 函数索引（EXPLAIN 复审发现 Seq Scan）

## [0.3.0] — 2026-08-23

### Changed（大版本升级专项）

- **Next.js 15 → 16**：Turbopack 构建默认化、middleware→proxy 约定迁移、eslint-config-next 16 原生 flat config、favicon.ico RGBA 问题修复、react-hooks/purity 合规
- **Tailwind CSS 3 → 4**：`@tailwindcss/postcss` 替代双插件、`@config` 桥接既有 JS 配置、移除 autoprefixer
- **TanStack Table 8 → 9**：经官方 `useLegacyTable` 桥迁移（v8 API / v9 内核），原生 features API 列为后续任务
- **lucide-react 0.x → 1.x**：品牌图标移除 → 内联 GithubIcon SVG 组件
- **zod 3 → 4**：error.errors → error.issues 迁移
- eslint 复杂度门禁（≤15 报错，存量文件显式豁免登记）
- Bundle 基线门禁适配 Turbopack 输出（客户端静态资源总量 2467kB）

### Added

- Profiles Repository 数据访问层试点（/api/user 与 inviteMember 已收口）
- ActionResult 判别联合类型 + notifications Action 迁移试点
- 审计日志 CSV 导出（feature flag 门控）
- 通知"全部标为已读"（Server Action + 双语翻译键）
- Webhook 事件日志表迁移（010_webhook_events.sql，待应用）
- skip-to-content 无障碍链接
- 索引复审清单、环境/Staging 规范、API 路由文档、ADR ×4、邮件模板设计、Sentry 告警指南
- 依赖健康报告脚本（pnpm dep:health）、Agent 索引一致性校验

## [0.2.0] — 2026-08-23

### Added

- **Playwright E2E 冒烟测试**（8 用例：营销页/认证流/Mock dashboard）并进 CI 独立 job
- **组件测试基础设施**（jsdom + Testing Library 双项目结构）+ CheckoutButton / RemoveMemberButton / InviteMemberForm 共 10 个用例
- **覆盖率阈值门禁**：核心逻辑 statements/functions/lines ≥90%、branches ≥78%
- **Middleware 路由守卫单测**（7 用例）
- **Stripe webhook 纯函数测试**（mapStatus/mapPlan，10 用例）
- **CodeQL 安全扫描** + **gitleaks 密钥扫描** + **Dependabot** 自动依赖跟进
- **i18n 翻译对称性 CI 校验**（`scripts/check-locales.js`，733 key 双语对齐门禁）
- **Agent 体系补全**：新增 10 号提交与发布管理 Agent（编码→审查→提交→部署角色链闭环）

### Changed

- **默认语言改为英文**（应用 `defaultLocale=en`；文档站英文提升为根路径，中文移至 `/zh-CN/`）
- CSP 安全头新增（覆盖 Supabase/Sentry 域名），加 Permissions-Policy，移除废弃的 X-XSS-Protection
- 数据通道约定入 CLAUDE.md：写操作走 Server Actions，API Routes 仅限外部回调
- Stripe webhook 移除内存 rate limit（防事件重试 429 丢失），纯函数抽离至 `lib/stripe/webhook-mappers`
- 文档站首页恢复 VitePress 标准布局，GitHub 占位链接修正为 Sun1090/IndieStack
- 依赖区间内小版本升级（Radix 全家桶、React 19.2、stripe 22.5 等），Stripe apiVersion 跟随 SDK 默认
- pnpm 固定 11.22.0（packageManager 字段 + Dockerfile corepack 对齐）
- engines.pnpm 提升 ≥11

### Fixed

- mapPlan 在 priceId 与环境变量同为 undefined 时误匹配为 pro 的边界 bug
- pnpm/action-setup 与 packageManager 版本声明冲突导致 CI 失败
- vercel.json 旧版 builds/public 字段被 Vercel 导入 API 拒绝；显式声明 outputDirectory=.vitepress/dist
- 文档链接指向已下线的旧文档站域名 → 更新为 indie-stack-docs-site.vercel.app
- 删除死路由 `/api/teams`（无调用方）、死 hooks ×5、零消费的 SupabaseProvider、未使用的 usehooks-ts 依赖
- Dockerfile 冗余 node_modules 复制与 next.config/package.json 多余复制
- CI 孤儿 docs artifact 上传步骤移除；PR 触发补 develop 分支

## [0.1.0] — 2026-07-19

### Added

- **Next.js 15 App Router** with Route Groups, Server Components, Server Actions
- **Authentication** — Supabase SSR auth with Email, GitHub, Google OAuth
- **Marketing site** — Landing page, Features, Pricing, About, Blog, FAQ, Changelog, Contact, Privacy, Terms
- **Dashboard** — Overview, Analytics, Projects, Notifications, Integrations, Profile, Settings, Team management, Billing
- **Supabase integration** — PostgreSQL database with RLS, Realtime subscriptions
- **Sentry error monitoring** — Client, Server, and Edge runtime config
- **Stripe-ready billing** — Subscription tiers (Free, Pro, Enterprise) with checkout flow
- **Team management** — Multi-tenant with roles (owner, admin, member), invites
- **Responsive UI** — shadcn/ui components, dark/light mode, mobile-first
- **CI/CD** — GitHub Actions workflows for linting, type-checking, building, deploying to Vercel
- **Alibaba Cloud OSS** integration for file storage
- **Appark APM** instrumentation
- **i18n-ready** architecture with zh-CN default locale
- **VitePress documentation site** — Bilingual (zh-CN/en) standalone documentation website with dark/light theme at `docs-site/`
- **Docker compose** — Local PostgreSQL development environment

### Technical Details

- TypeScript strict mode across the entire codebase
- Zod validation for all forms and API inputs
- Server Components by default, client components only where interactivity is needed
- Row Level Security on all database tables
- Auto-creation of profiles and personal teams on user signup
- Security headers (X-Frame-Options, XSS Protection, CSP-ready)
- Rate limiting infrastructure via `api_usage` table
- Image optimization with AVIF/WebP support

### Notes

- `docs/` directory contains complete architecture, setup, deployment, and configuration documentation
- Open `docs-site/` to view the interactive VitePress documentation website: `cd docs-site && pnpm dev`
