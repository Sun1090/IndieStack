# Changelog

All notable changes to IndieStack will be documented in this file.

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
