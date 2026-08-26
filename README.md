# IndieStack

**English** | [中文](README.zh-CN.md)

[![CI](https://github.com/Sun1090/IndieStack/actions/workflows/ci.yml/badge.svg)](https://github.com/Sun1090/IndieStack/actions/workflows/ci.yml)

> A production-ready SaaS starter for independent developers.

Built with **Next.js 16**, **Tailwind CSS**, **shadcn/ui**, **Supabase**, **PostgreSQL**, **Sentry**, **Vercel**, **GitHub Actions**, **Alibaba Cloud OSS**, and **Appark**.

## Features

### 🏗️ Architecture
- Next.js 16 App Router with Route Groups
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

> Live demo: https://indie-stack-theta.vercel.app · Docs: https://indie-stack-docs-site.vercel.app

## Documentation

The project ships two documentation systems:

### 1. Inline docs `/docs/`
The `/docs` directory contains 7 Markdown files covering architecture, setup, tech stack, Supabase, deployment, and configuration.

| File | Description |
|------|-------------|
| `architecture.md` | Project architecture, data flow, route design |
| `setup.md` | Local dev setup, environment variables |
| `tech-stack.md` | Deep dive into each technology |
| `supabase.md` | DB schema, auth, RLS policies |
| `deployment.md` | Vercel, Alibaba Cloud, Sentry, GitHub Actions guides |
| `configuration.md` | All environment variables and config |

### 2. Standalone docs site `docs-site/` (VitePress)
A VitePress docs site supporting bilingual (zh/en) content and dark/light themes; deployable independently.

```bash
cd docs-site
pnpm install
pnpm dev        # dev server (default http://localhost:5173)
pnpm build      # build static site (output to .vitepress/dist/)
pnpm preview    # preview the build locally
```

**Deployment**: Vercel — import the `docs-site/` directory, or `cd docs-site && vercel --prod`. Docker — `cd docs-site && docker build -t indiestack-docs . && docker run -d -p 8080:80 indiestack-docs`.

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
| `pnpm check` | type-check + lint + i18n symmetry check |
| `pnpm check:locales` | Verify en/zh-CN translation key symmetry |
| `pnpm db:migrate` | Push database migrations |
| `pnpm db:types` | Generate TypeScript types from DB |
| `pnpm test` | Vitest unit + component tests (253+ cases) |
| `pnpm test:e2e` | Playwright E2E smoke tests |

## Testing

- **Unit/Component**: Vitest dual projects (node + jsdom), coverage gate ≥90% on core logic.
- **E2E**: Playwright smoke tests (`pnpm test:e2e`; local Mock mode needs no Supabase).
- **CI**: GitHub Actions — Lint & Type Check / Build / E2E / Build Docs / CodeQL + gitleaks security scan.

## Agent System

The project ships 10 specialized collaboration agents (see [AGENTS.md](./AGENTS.md)): Code Writer, Code Reviewer, Project Auditor, Architect, Test Engineer, Documentation Writer, DBA, DevOps, UI/UX, Release Manager.

## Tech Stack

| Category | Technology |
|----------|-----------|
| Framework | Next.js 16 (App Router, RSC) |
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

A VitePress-based standalone docs site (`docs-site/`), bilingual, dark/light theme, independently deployable.

```bash
cd docs-site
pnpm install
pnpm dev        # dev server (default http://localhost:5173)
pnpm build      # build to .vitepress/dist/
pnpm preview    # preview locally
```

## Sponsor

If you find this project helpful, consider buying the author a coffee to support ongoing development ☕

<table>
  <tr>
    <td align="center"><img src="public/donate-alipay.jpg" width="200" alt="Alipay QR" /><br/>Alipay</td>
    <td align="center"><img src="public/donate-wechat.jpg" width="200" alt="WeChat QR" /><br/>WeChat</td>
  </tr>
</table>

## License

MIT
