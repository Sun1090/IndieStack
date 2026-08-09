# Configuration Guide

## Core Environment Variables

### Required Configuration

| Variable | Description | How to Get |
|----------|-------------|------------|
| `NEXT_PUBLIC_APP_URL` | App deployment URL (`http://localhost:3000` for dev) | Set manually |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Supabase Dashboard → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key | Supabase Dashboard → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-side only) | Supabase Dashboard → Settings → API |
| `SUPABASE_DB_URL` | Supabase database connection string | Supabase Dashboard → Settings → Database |

```bash
# Required — Minimum to start
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIs...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIs...
SUPABASE_DB_URL=postgresql://postgres:password@db.your-project.supabase.co:5432/postgres
```

### Mock Mode

```bash
# Enable mock mode for local development without Supabase
NEXT_PUBLIC_MOCK_ENABLED=true
```

### Monitoring (Recommended)

| Variable | Description | How to Get |
|----------|-------------|------------|
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry DSN | Sentry Dashboard → Project Settings |
| `SENTRY_ORG` | Sentry org name | Sentry Dashboard |
| `SENTRY_PROJECT` | Sentry project name | Sentry Dashboard |
| `SENTRY_AUTH_TOKEN` | Sentry auth token | Sentry Dashboard → Auth Tokens |
| `NEXT_PUBLIC_APPARK_API_KEY` | Appark APM API Key | Appark Dashboard |

```bash
# Sentry error tracking
NEXT_PUBLIC_SENTRY_DSN=https://your-dsn@sentry.io/project
SENTRY_ORG=your-org
SENTRY_PROJECT=your-project
SENTRY_AUTH_TOKEN=your-auth-token

# Appark application monitoring
NEXT_PUBLIC_APPARK_API_KEY=your-api-key
```

### File Storage (Alibaba Cloud OSS)

| Variable | Description | How to Get |
|----------|-------------|------------|
| `ALIYUN_ACCESS_KEY_ID` | Alibaba Cloud AccessKey ID | Alibaba Cloud RAM Console |
| `ALIYUN_ACCESS_KEY_SECRET` | Alibaba Cloud AccessKey Secret | Alibaba Cloud RAM Console |
| `ALIYUN_BUCKET` | OSS Bucket name | OSS Console |
| `ALIYUN_REGION` | OSS region (default `oss-cn-hangzhou`) | OSS Console |
| `ALIYUN_CDN_DOMAIN` | CDN domain (optional) | CDN Console |

```bash
# Alibaba Cloud OSS
ALIYUN_ACCESS_KEY_ID=your-key
ALIYUN_ACCESS_KEY_SECRET=your-secret
ALIYUN_BUCKET=your-bucket
ALIYUN_REGION=oss-cn-hangzhou
ALIYUN_CDN_DOMAIN=https://static.yourdomain.com
```

### Payments (Stripe)

| Variable | Description | How to Get |
|----------|-------------|------------|
| `STRIPE_SECRET_KEY` | Stripe secret key (starts with `sk_`) | Stripe Dashboard → Developers → API Keys |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret (starts with `whsec_`) | Stripe Dashboard → Developers → Webhooks |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Publishable key (starts with `pk_`) | Stripe Dashboard → Developers → API Keys |
| `STRIPE_PRO_PRICE_ID` | Pro plan price ID | Stripe Dashboard → Products |
| `STRIPE_ENTERPRISE_PRICE_ID` | Enterprise plan price ID | Stripe Dashboard → Products |

```bash
# Stripe payments
STRIPE_SECRET_KEY=sk_test_xxxxxxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxx
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_xxxxxxxxx
STRIPE_PRO_PRICE_ID=price_pro_monthly
STRIPE_ENTERPRISE_PRICE_ID=price_enterprise_monthly
```

### Deployment (Vercel / GitHub Actions)

```bash
# Vercel
VERCEL_TOKEN=your-vercel-token
VERCEL_ORG_ID=your-org-id
VERCEL_PROJECT_ID=your-project-id
VERCEL_DOCS_PROJECT_ID=your-docs-project-id

# GitHub Actions
GITHUB_TOKEN=your-github-token
```

## App Constant Configuration

Core configuration lives in `src/lib/constants.ts`:

### `SITE_CONFIG` — Site Information

```typescript
export const SITE_CONFIG = {
  name: process.env.NEXT_PUBLIC_APP_NAME?.trim() || "IndieStack",
  description:
    process.env.NEXT_PUBLIC_APP_DESCRIPTION?.trim() ||
    "A full-stack IndieStack for independent developers. Next.js, Tailwind, shadcn/ui, Supabase, PostgreSQL.",
  url: process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000",
  docsUrl: process.env.NEXT_PUBLIC_DOCS_URL?.trim() || "https://indiestack-docs.vercel.app",
  // ...
};
```

### `AUTH_CONFIG` — Auth Configuration

```typescript
export const AUTH_CONFIG = {
  providers: ["email", "github", "google"] as const,
  redirectAfterLogin: "/dashboard",
  redirectAfterLogout: "/",
};
```

Supported providers: `email`, `github`, `google`, `wechat`, `apple`.

### `ROUTES` — Route Map

Centralized route management:

- Marketing: `/features`, `/pricing`, `/about`, `/blog`, `/faq`, etc.
- Auth: `/auth/login`, `/auth/register`, `/auth/forgot-password`, etc.
- Dashboard: `/dashboard`, `/dashboard/analytics`, `/dashboard/team`, etc.
- Admin: `/dashboard/admin`, `/dashboard/admin/users`, etc.
- Docs: Points to standalone VitePress docs site (`NEXT_PUBLIC_DOCS_URL`)

### `SUBSCRIPTION_TIERS` — Plan Tiers

```typescript
export const SUBSCRIPTION_TIERS = {
  free: { name: "Free", price: 0, features: ["3 projects", "Basic analytics"] },
  pro: { name: "Pro", price: 29, features: ["Unlimited projects", "Advanced analytics"] },
  enterprise: { name: "Enterprise", price: 99, features: ["Unlimited members", "Dedicated support"] },
};
```

### `RATE_LIMIT` — Rate Limiting

```typescript
export const RATE_LIMIT = {
  maxRequests: 100,    // Max requests per minute
  windowMs: 60 * 1000, // Window size (1 minute)
};
```

## Theme Configuration

### Tailwind CSS

Custom colors and CSS variables in `tailwind.config.ts`:

```typescript
export default {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
      },
    },
  },
};
```

### CSS Variables

Theme variables in `src/app/globals.css`:

```css
@layer base {
  :root { /* Light theme variables */ }
  .dark { /* Dark theme variables */ }
}
```

## i18n Configuration

Multi-language config at `src/i18n/routing.ts`:

```typescript
export const routing = defineRouting({
  locales: ["zh-CN", "en"],
  defaultLocale: "zh-CN",
  localePrefix: "never",
});
```

- Language preference stored in `app-locale` cookie (1 year expiry)
- Translation files split by namespace as `messages/{locale}/{namespace}.json` (e.g. `messages/zh-CN/common.json`)
- Server: `getTranslations(namespace)` from `next-intl/server`
- Client: `useTranslations(namespace)` from `next-intl`

## Permissions & Roles

Auth system at `src/lib/auth/`:

| File | Purpose |
|------|---------|
| `permissions.ts` | 28 permission constants, grouped by domain |
| `roles.ts` | 4 roles (super_admin / admin / member / viewer), role-to-permission mapping |
| `guards.ts` | Route guards: requireAuth(), requireRole(), requirePermission() |

## Complete Configuration Example

```bash
# ===== Required =====
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIs...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIs...

# ===== Mock Mode =====
NEXT_PUBLIC_MOCK_ENABLED=true

# ===== Monitoring =====
NEXT_PUBLIC_SENTRY_DSN=https://your-dsn@sentry.io/project
SENTRY_ORG=your-org
SENTRY_PROJECT=your-project

# ===== File Storage =====
ALIYUN_ACCESS_KEY_ID=your-key
ALIYUN_ACCESS_KEY_SECRET=your-secret
ALIYUN_BUCKET=your-bucket
ALIYUN_REGION=oss-cn-hangzhou
ALIYUN_CDN_DOMAIN=https://static.yourdomain.com

# ===== Payments =====
STRIPE_SECRET_KEY=sk_test_xxx
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_xxx
STRIPE_PRO_PRICE_ID=price_pro_monthly
STRIPE_ENTERPRISE_PRICE_ID=price_enterprise_monthly

# ===== Deployment =====
VERCEL_TOKEN=your-vercel-token
VERCEL_ORG_ID=your-org-id
VERCEL_PROJECT_ID=your-project-id
VERCEL_DOCS_PROJECT_ID=your-docs-project-id
GITHUB_TOKEN=your-github-token

# ===== APM =====
NEXT_PUBLIC_APPARK_API_KEY=your-api-key
```
