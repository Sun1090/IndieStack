# Project Structure

```
indiestack/
├── src/
│   ├── app/                      # Next.js App Router
│   │   ├── (marketing)/          # Marketing pages (public)
│   │   ├── auth/                 # Auth pages (public)
│   │   ├── dashboard/            # Dashboard (protected)
│   │   ├── api/                  # API routes
│   │   ├── page.tsx              # Home page
│   │   ├── layout.tsx            # Root layout
│   │   ├── globals.css           # Global styles
│   │   ├── not-found.tsx         # 404
│   │   └── error.tsx             # Error boundary
│   ├── components/
│   │   ├── ui/                   # 23 shadcn/ui components
│   │   ├── auth/                 # Auth forms
│   │   ├── layout/               # Header/Footer/Theme
│   │   ├── dashboard/            # Dashboard components
│   │   ├── forms/                # Form components
│   │   ├── providers/            # Providers
│   │   └── shared/               # Shared components
│   ├── hooks/                    # Custom hooks
│   ├── i18n/                     # next-intl config (routing/request/navigation)
│   ├── lib/                      # Utilities
│   └── middleware.ts
├── messages/                     # i18n messages ({locale}/{namespace}.json)
├── docs-site/                    # VitePress docs
└── .env.example
```
