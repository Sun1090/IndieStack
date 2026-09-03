# Changelog

All notable changes to IndieStack will be documented in this file.

## [Unreleased] — v0.4.0（主题：Admin 运营闭环 + 数据层测试 + 集成接线）

### Added（计划）

- Repository 层单测全覆盖（7 个数据访问模块 + trace/csp/api-response）
- API 路由单测补齐（health/invitations/checkout/callback/og/stripe-webhook）
- E2E 覆盖 admin 新页面、contact 提交、MFA 流程
- MFA 备用恢复码、会话管理页、登录审计日志
- 联系消息处理状态机、管理端搜索/分页、邮件通道方案

### Changed（计划）

- API 错误格式统一收敛到 `api-response`
- TanStack Query 全局缓存策略统一
- TanStack Table v9 原生 features 迁移、Tailwind v4 `@theme` 渐进重写

### Fixed（计划）

- RLS 回归脚本覆盖 contact_messages/webhook_events 新表
- `pnpm audit` 高危清零、CodeQL/gitleaks 告警清零

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
