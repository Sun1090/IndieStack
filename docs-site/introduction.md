# Introduction

**IndieStack** is a production-ready SaaS starter template for independent developers. It ships everything you need to launch a paid product: authentication, multi-tenant teams, subscription billing, error monitoring, CI/CD, and bilingual documentation — so you can focus on your idea instead of boilerplate.

## What's Inside

| Capability | How It Works |
|---|---|
| 🔐 Authentication | Supabase Auth with Email / GitHub / Google OAuth, SSR session management, middleware route protection |
| 👥 Multi-tenant Teams | Owner / admin / member roles, invitations, per-team data isolation enforced by Postgres RLS |
| 💳 Subscription Billing | Stripe checkout, webhook-driven subscription sync, customer portal self-management |
| 📊 Analytics Dashboard | Request metrics, error rates, timeline charts powered by Recharts |
| 🛡️ Monitoring | Sentry across client / server / edge runtimes, structured logging, security headers (CSP nonce) |
| 🌐 Internationalization | Built-in English & Chinese (next-intl), cookie-driven locale, 733 symmetric translation keys |

## Tech Stack

- **Framework**: [Next.js 15](https://nextjs.org) App Router — Server Components by default, Server Actions for mutations
- **Database**: [Supabase](https://supabase.com) (PostgreSQL) with Row Level Security on every table
- **UI**: [Tailwind CSS](https://tailwindcss.com) + [shadcn/ui](https://ui.shadcn.com) components, dark/light themes
- **Validation**: [Zod v4](https://zod.dev) schemas shared between client forms and server actions
- **Testing**: Vitest (270+ unit/component tests, coverage-gated ≥90%) + Playwright E2E smoke suite
- **CI/CD**: GitHub Actions (lint, type-check, i18n symmetry, tests, build, CodeQL, gitleaks) + Vercel deploys

## Design Principles

1. **Secure by default** — every database table has RLS policies; auth guards run at middleware, page, and action levels.
2. **Server-first** — mutations go through Server Actions; API routes exist only for external callbacks (Stripe webhooks, OAuth).
3. **Type-safe end to end** — generated database types flow through clients, actions, and UI.
4. **Test what matters** — core business logic is coverage-gated in CI; every release runs the full matrix automatically.

## Next Steps

- Follow [Quick Start](/quickstart) to run the project locally
- Understand the request lifecycle in [Auth Flow](/auth-flow)
- Deploy your own instance with [Deployment](/deployment)
