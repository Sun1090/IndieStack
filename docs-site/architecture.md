# Architecture

## Multi-Layer Architecture

```
┌─────────────────────────────────────────────┐
│              Presentation Layer              │
│  Server Components  Client Components        │
│  Route Groups  Layouts  Templates            │
├─────────────────────────────────────────────┤
│              Application Layer              │
│  Server Actions  API Routes  Middleware      │
│  Auth Guard  i18n  Rate Limiting             │
├─────────────────────────────────────────────┤
│                 Data Layer                  │
│  Supabase Clients  Zod Validations          │
│  Server Actions  RLS Policies               │
├─────────────────────────────────────────────┤
│              Infrastructure                 │
│  Supabase  PostgreSQL  Vercel  Sentry       │
│  Alibaba OSS  Stripe  Docker  GitHub CI    │
└─────────────────────────────────────────────┘
```

## Request Flow

```
Request → Middleware (locale + auth)
        → Route Group Match
        → Layout (Theme + Provider)
        → Page Server Component
```

## Route Design

| Group | Routes | Access |
|-------|--------|--------|
| Marketing | `/`, `/features`, `/pricing`, `/blog` | Public |
| Auth | `/auth/login`, `/auth/register` | Public |
| Dashboard | `/dashboard`, `/dashboard/team` | Protected |
| Docs | `https://indiestack-docs.vercel.app` | Standalone VitePress docs site |
