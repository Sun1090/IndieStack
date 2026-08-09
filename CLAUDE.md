# IndieStack 项目指南

> IndieStack SaaS 启动模板的 AI 助手指南。
> 随着项目演进保持此文件更新。

## 项目概述

面向独立开发者的生产级 SaaS 启动模板。

**技术栈**: Next.js 15 + TypeScript + Tailwind CSS + shadcn/ui + Supabase (PostgreSQL + Auth) + Sentry + Vercel + GitHub Actions + Alibaba Cloud OSS + Appark + Zod + Stripe-ready。

## 架构

### 路由分组

| 分组 | 路径 | 访问权限 | 页面数 |
|------|------|----------|--------|
| `(marketing)` | `/`, `/features`, `/pricing`... | 公开 | 11 页 |
| `auth` | `/auth/*` | 公开（已登录则重定向） | 5 页 |
| `dashboard` | `/dashboard/*` | 需登录 | 17 页 |
| `dashboard/admin` | `/dashboard/admin/*` | Admin 及以上 | 3 页 |
| `api` | `/api/*` | 程序化 | 3 路由 |

### 路由结构

```text
src/app/
├── (marketing)/     # 11 个公开页面
├── auth/            # 5 个认证页面
├── dashboard/       # 17 个仪表盘页面
├── dashboard/admin/ # 3 个管理页面
├── api/             # 3 个 API 路由
├── layout.tsx       # 根布局
├── providers.tsx    # Theme + Supabase + Toaster
├── not-found.tsx    # 404 页面
├── error.tsx        # 错误边界
├── sitemap.ts       # SEO
├── robots.ts        # robots.txt
└── globals.css      # Tailwind + CSS 变量
```

### 关键规则

- 所有仪表盘页面使用 `export const dynamic = "force-dynamic"`
- Server Actions 在 `src/lib/actions/` 中，配合 Zod 校验
- Supabase 客户端：`server.ts`（Server Components）、`client.ts`（浏览器）、`admin.ts`（Service Role）
- 路由常量在 `src/lib/constants.ts`——始终使用 `ROUTES.*` 进行导航
- 默认使用 Server Components，仅在需要时使用 Client Components
- shadcn/ui 组件在 `src/components/ui/` —— 通用无应用逻辑

## RBAC 权限系统

### 角色（Role）
- `super_admin` (100) - 系统管理员，全部权限
- `admin` (80) - 团队管理员
- `member` (50) - 普通成员
- `viewer` (10) - 只读用户

### 权限（Permission）
格式: `<domain>:<action>`。域: user/team/project/billing/settings/analytics/integration/notification/system/audit
Action: read/write/create/delete/manage/invite/remove/export

### 守卫函数 (guards.ts)
- `requireAuth()` - 服务端，未登录 => redirect
- `requireRole(minRole)` - 要求最低角色
- `requirePermission(perm)` - 要求具体权限
- `safelyRequireAuth()` - API Route 安全版本
- `safelyRequireRole()` - API Route 安全角色检查
- `safelyRequirePermission()` - API Route 安全权限检查

### 客户端权限门
```tsx
<PermissionGate requirePermission={PERMISSIONS.team.invite}>
  <Button>邀请成员</Button>
</PermissionGate>
```

## 共享组件 (components/shared/)
- `PermissionGate` - 权限条件渲染
- `ConfirmDialog` - 确认对话框
- `Breadcrumbs` - 面包屑导航
- `SearchInput` - 防抖搜索
- `LoadingState / LoadingPage` - 加载状态
- `ErrorState` - 错误展示
- `PageContainer` - 标准页面容器
- `PageHeader` - 页面标题区
- `EmptyState` - 空状态

## API 密钥管理 (dashboard/api-keys)
- 创建/查看/吊销 API 密钥
- 支持只读和全部权限范围
- 密钥创建后只显示一次
- 独立页面入口，所有登录用户可用

## Admin 管理后台 (dashboard/admin)
- 仅 admin / super_admin 可访问，Layout 层做角色校验
- **管理概览**: 平台统计数据（用户数、团队数、角色分布、系统状态）
- **用户管理**: 搜索用户、修改角色（member/admin/viewer）
- **审计日志**: 按操作类型筛选、搜索、刷新

## i18n 国际化
- 中英双语: `zh-CN` (默认) 和 `en`
- 使用 `next-intl` v4，配置在 `src/i18n/`
- 翻译文件在 `messages/` 目录（JSON 格式）
- 服务端: `getTranslations(namespace)` from `next-intl/server`
- 客户端: `useTranslations(namespace)` from `next-intl`
- 命名空间: common/nav/home/features/pricing/about/auth/dashboard/docs/blog/faq/contact/errors
- Cookie 名: `app-locale`
- 中间件自动检测浏览器语言偏好
- 切换语言: 设置 Cookie 后 `router.refresh()` 无刷新更新

### 组件组织

| 目录 | 数量 | 内容 |
|------|------|------|
 | `src/components/ui/` | 23 | shadcn/ui 原语 |
| `src/components/auth/` | 2 | LoginForm, RegisterForm |
| `src/components/layout/` | 3 | SiteHeader, SiteFooter, ThemeToggle |
| `src/components/dashboard/` | 3 | Sidebar, StatsCard, RemoveMemberButton |
| `src/components/forms/` | 4 | ProfileEdit, Password, NotificationSettings, InviteMember |
| `src/components/shared/` | 9 | Breadcrumbs, ConfirmDialog, EmptyState, ErrorState, LoadingState, PageContainer, PageHeader, PermissionGate, SearchInput |
| `src/components/charts/` | 1 | AreaChart (Recharts) |
| `src/components/providers/` | 2 | ThemeProvider, SupabaseProvider |

### 校验模式 (Zod, 8 个)

| Schema | 文件 | 用途 |
|--------|------|------|
| `loginSchema` | `auth.ts` | 邮箱+密码登录 |
| `registerSchema` | `auth.ts` | 注册含姓名 |
| `forgotPasswordSchema` | `auth.ts` | 忘记密码邮箱 |
| `resetPasswordSchema` | `auth.ts` | 密码重置 |
| `profileSchema` | `profile.ts` | 个人资料编辑 |
| `settingsSchema` | `settings.ts` | 通知偏好 |
| `createTeamSchema` | `team.ts` | 创建新团队 |
| `inviteMemberSchema` | `team.ts` | 邀请团队成员 |

### 数据库

- Supabase PostgreSQL，所有 9 个表启用 RLS
- 表: profiles, teams, team_members, subscriptions, user_sessions, api_usage, audit_logs, api_keys, team_invitations
- 用户注册时自动创建 profile + 个人团队（数据库触发器）
- 类型从数据库生成: `src/lib/supabase/database.types.ts`
- 种子数据: `supabase/seed.sql`

### 认证流程

1. 中间件在每个请求检查 session cookie
2. 受保护路由在无 session 时重定向到登录页
3. 认证路由在有 session 时重定向到仪表盘
4. 服务端组件: `await createClient()` → `getUser()`
5. 客户端组件: `useUser()` hook
6. OAuth 回调: API 路由用 code 换取 session

### 配置

所有环境变量在 `.env.example` 中有文档说明：
- **必需**: Supabase URL + anon key + service role key
- **可选**: Sentry DSN, Stripe keys, Alibaba Cloud OSS, Appark

关键配置文件: `next.config.ts`, `tailwind.config.ts`, `tsconfig.json`, `src/lib/constants.ts`, `src/middleware.ts`

### 新功能开发模式

1. 添加 DB 迁移 → `supabase/migrations/`
2. 添加校验 schema → `src/lib/validations/`
3. 添加 Server Actions → `src/lib/actions/`
4. 添加页面 → `src/app/{route}/page.tsx`
5. 添加路由常量 → `src/lib/constants.ts`
6. 添加导航链接 → sidebar 或 header
7. 添加组件 → `src/components/`
8. 更新文档 → `docs/` 和 `docs-site/`（VitePress）

### 脚本

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 启动开发服务器 |
| `pnpm build` | 生产构建 |
| `pnpm lint` | 运行 ESLint |
| `pnpm type-check` | TypeScript 检查 |
| `pnpm format` | Prettier 格式化 |
| `pnpm test` | 运行全部测试 (Vitest) |
| `pnpm test:watch` | 监听模式运行测试 |
| `pnpm test:coverage` | 运行测试并生成覆盖率报告 |
| `pnpm db:migrate` | 推送数据库迁移 |
| `pnpm db:seed` | 填充种子数据 |
| `pnpm db:types` | 生成 TS 类型 |
| `bash scripts/dev.sh start` | 启动开发服务器（环境检查） |
| `bash scripts/dev.sh db:up` | 启动 PostgreSQL（Docker） |
| `bash scripts/dev.sh check` | 运行 lint + type-check + test |

### Supabase 查询模式

```typescript
// .single() 查询时做类型转换以处理 RLS 类型问题
const { data: item } = await supabase
  .from("table")
  .select("*")
  .eq("id", id)
  .single() as unknown as { data: T | null; error: null };
```

### 错误处理

- Server Components: try/catch 包裹 Supabase 查询，提供回退 UI
- Client Components: 错误边界，Server Action 错误通过 toast 提示
- API Routes: try/catch 配合正确的 HTTP 状态码
- Sentry: 在 catch 块中调用 `Sentry.captureException()`
- 表单: Zod 校验错误内联显示，Server Action 错误通过 toast

### 项目文件参考

| 文件 | 用途 |
|------|------|
 | `.env.example` | 所有环境变量文档 |
 | `docker-compose.yml` | 本地 PostgreSQL + pgAdmin |
 | `scripts/setup.sh` | 一键项目设置 |
 | `scripts/dev.sh` | 开发辅助脚本 |
 | `supabase/seed.sql` | 示例开发数据 |
 | `Dockerfile` | 多阶段生产构建（Node.js standalone） |
 | `.github/ISSUE_TEMPLATE/bug_report.md` | Bug 报告模板 |
 | `.github/ISSUE_TEMPLATE/feature_request.md` | 功能请求模板 |
 | `.github/PULL_REQUEST_TEMPLATE.md` | PR 模板 |
 | `.github/SECURITY.md` | 安全策略 |
 | `.github/workflows/ci.yml` | CI 工作流（lint + type-check + test） |
 | `.github/workflows/deploy.yml` | 部署工作流（Vercel App + Docs） |
 | `CHANGELOG.md` | 发布历史 |
 | `CONTRIBUTING.md` | 贡献指南 |
 | `docs-site/` | VitePress 独立文档站（13 章节，中英双语，主题切换） |
 | `.nvmrc` | Node.js 版本 (22) |
 | `.prettierrc` | 代码格式化配置 |
 | `.vscode/settings.json` | 编辑器推荐配置 |

### Claude Code 常用命令

```bash
# 开发
pnpm dev                    # 启动开发服务器
pnpm build                  # 生产构建
pnpm type-check             # TypeScript 类型检查
pnpm lint                   # 代码检查

# 测试
pnpm test                   # 运行测试
pnpm test:watch             # 监听模式

# 数据库
pnpm db:types               # 生成 Supabase TS 类型

# Git
git checkout -b feature/xxx    # 新建功能分支
git add -A && git commit -m "feat: xxx"  # 提交

# 部署
npx vercel                     # 部署到 Vercel
```

 ### 文档位置
 
 - `docs-site/` — VitePress 独立文档站（13 章节，中英双语，深色/浅色主题切换，可单独部署到 Vercel / Docker）
 - `.github/` — GitHub 模板和 CI/CD 工作流
 - `README.md` — 项目简介
 - `CONTRIBUTING.md` — 贡献指南
 - `CHANGELOG.md` — 发布历史
 - `CLAUDE.md` — 本文件，AI 助手指南
