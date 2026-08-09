# IndieStack

> A production-ready IndieStack for independent developers.

Built with **Next.js 15**, **Tailwind CSS**, **shadcn/ui**, **Supabase**, **PostgreSQL**, **Sentry**, **Vercel**, **GitHub Actions**, **Alibaba Cloud OSS**, and **Appark**.

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
| `pnpm db:migrate` | Push database migrations |
| `pnpm db:types` | Generate TypeScript types from DB |

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
