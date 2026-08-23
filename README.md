# IndieStack

> A production-ready IndieStack for independent developers.

Built with **Next.js 16**, **Tailwind CSS**, **shadcn/ui**, **Supabase**, **PostgreSQL**, **Sentry**, **Vercel**, **GitHub Actions**, **Alibaba Cloud OSS**, and **Appark**.

## Features

### 🏗️ Architecture
- Next.js 15 App Router with Route Groups
- React Server Components with Server Actions
- Supabase SSR authentication (Email, GitHub, Google)
- PostgreSQL with Row Level Security
- Multi-tenant team management
- Stripe-ready subscription billing

### 🎨 UI/UX
- shadcn/ui component library (fully customizable)
- Dark/Light mode with system detection
- Responsive design (mobile-first)
- Toast notifications
- Loading skeletons & error boundaries

### 📊 Dashboard
- Overview with stats and activity feed
- Analytics with usage metrics
- Profile management with edit form
- Team management with roles and invites
- Billing with subscription tiers
- Notification preferences

### 🛡️ Production Ready
- Sentry error monitoring (client + server + edge)
- Security headers (XSS, CSRF, clickjacking)
- Rate limiting infrastructure
- GitHub Actions CI/CD
- Alibaba Cloud OSS for file storage

## Quick Start

```bash
# Clone
git clone <repo-url> indiestack
cd indiestack

# Install
pnpm install

# Configure
cp .env.example .env.local
# Edit .env.local with your Supabase credentials

# Run
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

> 线上演示：https://indie-stack-theta.vercel.app · 文档：https://indie-stack-docs-site.vercel.app

## Documentation
项目包含两套文档体系：

### 1. 内联文档 `/docs/`
项目内 `/docs` 目录包含 7 个 Markdown 文件，覆盖架构、设置、技术栈、Supabase、部署、配置等核心主题。

| 文件 | 说明 |
|------|------|
| `architecture.md` | 项目架构、数据流、路由设计 |
| `setup.md` | 本地开发设置、环境变量说明 |
| `tech-stack.md` | 每项技术的深度介绍 |
| `supabase.md` | 数据库 Schema、认证、RLS 策略 |
| `deployment.md` | Vercel、阿里云、Sentry、GitHub Actions 部署指南 |
| `configuration.md` | 所有环境变量和配置说明 |

### 2. 独立文档站 `docs-site/`（VitePress）
基于 VitePress 的独立文档网站，支持中英文双语、深色/浅色主题切换，可脱离主应用单独部署。

包含 12 个文档章节，覆盖所有技术主题：

```bash
cd docs-site
pnpm install
pnpm dev        # 启动本地开发服务器（默认 http://localhost:5173）
pnpm build      # 构建静态站点（输出到 .vitepress/dist/）
pnpm preview    # 本地预览构建结果
```

**部署方式**：
- **Vercel**: 在 Vercel 中导入 `docs-site/` 目录，或 `cd docs-site && vercel --prod`
- **Docker**: `cd docs-site && docker build -t indiestack-docs . && docker run -d -p 8080:80 indiestack-docs`

## Project Structure

```
src/
├── app/                  # Next.js App Router
│   ├── (marketing)/      # Public pages
│   ├── auth/             # Auth pages
│   ├── dashboard/        # Dashboard pages
│   └── api/              # API routes
├── components/
│   ├── ui/               # shadcn/ui components
│   ├── auth/             # Auth forms
│   ├── layout/           # Header, footer, theme
│   ├── dashboard/        # Dashboard components
│   ├── forms/            # Form components
│   └── shared/           # Shared components
├── hooks/                # Custom hooks
├── lib/
│   ├── supabase/         # Supabase clients
│   ├── validations/      # Zod schemas
│   ├── actions/          # Server actions
│   ├── constants.ts      # App constants
│   └── utils.ts          # Utilities
└── middleware.ts          # Auth middleware
```

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start development server |
| `pnpm build` | Build for production |
| `pnpm start` | Start production server |
| `pnpm lint` | Run ESLint |
| `pnpm type-check` | TypeScript type check |
| `pnpm format` | Format code with Prettier |
| `pnpm check` | type-check + lint + i18n 对称性校验 |
| `pnpm check:locales` | 校验 en/zh-CN 翻译 key 对称性 |
| `pnpm db:migrate` | Push database migrations |
| `pnpm db:types` | Generate TypeScript types from DB |
| `pnpm test` | Vitest 单元 + 组件测试（253+ 用例） |
| `pnpm test:e2e` | Playwright E2E 冒烟测试 |

## Testing

- **单元/组件**: Vitest 双项目（node + jsdom），覆盖率门禁核心逻辑 ≥90%
- **E2E**: Playwright 冒烟测试（`pnpm test:e2e`，本地 Mock 模式无需 Supabase）
- **CI**: GitHub Actions 五道关卡 —— Lint & Type Check / Build / E2E / Build Docs / CodeQL + gitleaks 安全扫描

## Agent 体系

项目内置 10 个专业化协作 Agent（见 [AGENTS.md](./AGENTS.md)）：代码编写、代码审查、项目审查、架构师、测试工程师、文档编写、数据库管理、DevOps、UI/UX 设计、提交与发布。

## Tech Stack

| Category | Technology |
|----------|-----------|
| Framework | Next.js 15 (App Router, RSC) |
| Styling | Tailwind CSS + shadcn/ui |
| Auth | Supabase Auth (Email, GitHub, Google) |
| Database | PostgreSQL (via Supabase) |
| Storage | Alibaba Cloud OSS |
| Monitoring | Sentry |
| CI/CD | GitHub Actions |
| Hosting | Vercel |
| APM | Appark |
| Payments | Stripe (ready) |
| Validation | Zod |


## Standalone Docs Site (`docs-site/`)

项目附带一个基于 **VitePress** 的独立文档站（`docs-site/`），包含 12 个文档章节，支持中英文双语、深色/浅色主题切换，可脱离主应用单独部署。

### 本地开发

```bash
cd docs-site
pnpm install
pnpm dev        # 启动本地开发服务器（默认 http://localhost:5173）
```

### 构建静态站点

```bash
pnpm build      # 输出到 .vitepress/dist/
pnpm preview    # 本地预览构建结果
```

### Vercel 部署

在 Vercel 中导入 `docs-site/` 目录，或使用 CLI：

```bash
cd docs-site
vercel --prod
```

Vercel 会自动识别 `vercel.json` 配置使用 `@vercel/static-build` 构建器。

### Docker 部署

```bash
cd docs-site
docker build -t indiestack-docs .
docker run -d -p 8080:80 indiestack-docs
# 访问 http://localhost:8080
```

## License

MIT
