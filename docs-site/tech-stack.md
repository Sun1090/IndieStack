# Tech Stack

IndieStack integrates a modern 2026 frontend tech stack covering framework, styling, backend, monitoring, and deployment.

## Framework & Language

| Technology | Version | Usage | Key Features |
|-----------|---------|-------|-------------|
| Next.js | 15.5.x | React full-stack framework | App Router, Server Components, Server Actions, Streaming SSR |
| TypeScript | 5.7.x | Type safety | Strict mode, compile-time checking, type generation |
| React | 19.x | UI library | Server Components, Taint APIs, use hook, Actions |

Next.js 15's App Router provides file-system routing, nested layouts, loading states, and error boundaries.
Server Components reduce client JS by default, Server Actions provide end-to-end type safety for forms and data mutations.

## Styling & UI

| Technology | Version | Usage | Key Features |
|-----------|---------|-------|-------------|
| Tailwind CSS | 3.4.x | Utility CSS | JIT compilation, dark mode class strategy, responsive breakpoints |
| shadcn/ui | Latest | Component library | Radix UI based, 24 customizable components, Copy-paste pattern |
| Lucide React | 0.477.x | Icon library | 1000+ open source icons, Tree-shaking optimized |

shadcn/ui components are copied directly into `src/components/ui/` — fully under your control.
The project uses `cn()` (clsx + tailwind-merge) for class merging. CSS variables in `globals.css` with `.dark` class enable theme switching.

## Backend & Database

| Technology | Version | Usage | Key Features |
|-----------|---------|-------|-------------|
| Supabase | 2.x | BaaS | Managed PostgreSQL, Auth with RLS, Realtime subscriptions |
| PostgreSQL | 15+ | Relational DB | RLS, JSON/JSONB, full-text search, index optimization |
| Zod | 3.24.x | Schema validation | Shared types across frontend/backend, parse-time validation |

### Supabase Client Architecture

Four client types for different scenarios:

| Client | Scenario | Feature |
|--------|---------|---------|
| `server.ts` | Server Components, Route Handlers | Cookie-based session |
| `client.ts` | Client Components | Browser-side queries |
| `admin.ts` | Server privileged ops | Service Role, bypass RLS |
| `middleware.ts` | Next.js Middleware | Request-level session refresh |

### Mock Mode

When `NEXT_PUBLIC_MOCK_ENABLED=true`, all Supabase queries use `@faker-js/faker` mock data:

- Auto-detects missing Supabase env vars and enables mock mode
- Generates realistic user, team, project, notification, audit log data
- Data is consistent within a single request
- Supports eq/order/range/limit/single query methods

## Monitoring & Operations

| Technology | Usage | Configuration |
|-----------|-------|--------------|
| Sentry | Error tracking + performance | Client/Edge/Server configs, auto source map upload |
| Appark | APM (planned) | Not wired; module removed |
| Stripe | Payment processing | Subscription billing, Webhook handling, price plan management |

## Deployment

| Platform | Usage | Method |
|---------|-------|--------|
| Vercel | Frontend + API hosting | GitHub auto-deploy (`vercel --prod`) |
| GitHub Actions | CI/CD | PR auto lint + type-check + test, main merge auto deploy |
| Docker | Containerized deployment | Multi-stage build (Node → Nginx), Docker Compose for local dev |
| Alibaba Cloud OSS | File storage + CDN (planned) | Not wired; see architecture docs |

## Version Management

- **Code Quality**: ESLint (Next.js ruleset) + Prettier + husky (pre-commit + commit-msg hooks)
- **Commit Convention**: Conventional Commits (`feat`/`fix`/`docs`/`chore`/`refactor`/`test`)
- **Branch Strategy**: `main` (production) → `develop` → `feature/*`
- **CI Pipeline**: PR → lint + type-check + test → merge → auto deploy
