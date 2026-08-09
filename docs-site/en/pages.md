# Pages Overview

The IndieStack app is organized into 6 route groups with 30+ pages and 5 API routes.

## Route Group Architecture

```
src/app/
├── (marketing)/     # Marketing - 11 pages - Public
├── auth/            # Auth - 5 pages - Public (redirects if logged in)
├── dashboard/       # Dashboard - 14 pages - Authenticated only
├── dashboard/admin/ # Admin - 3 pages - admin/super_admin only
└── api/             # API routes - 5 routes
```

## Marketing Pages (Public - 11 pages)

| Page | Path | Description |
|------|------|-------------|
| Home | `/` | Hero, stats, features, tech stack, CTA |
| Features | `/features` | Core features, tech highlights, platform advantages |
| Pricing | `/pricing` | Free/Pro/Enterprise tier comparison |
| Blog | `/blog` | Blog article list |
| Blog Detail | `/blog/[slug]` | Blog article detail |
| Changelog | `/changelog` | Version release timeline |
| FAQ | `/faq` | Accordion FAQ list |
| About | `/about` | Team introduction and project vision |
| Contact | `/contact` | Contact form (server-validated) |
| Privacy | `/privacy` | Legal document |
| Terms | `/terms` | Legal document |

All marketing pages use Server Components with `getTranslations` for i18n.

## Auth Pages (Public - 5 pages)

| Page | Path | Component |
|------|------|-----------|
| Login | `/auth/login` | `LoginForm` (email/password + GitHub + Google OAuth) |
| Register | `/auth/register` | `RegisterForm` (email + OAuth) |
| Forgot Password | `/auth/forgot-password` | `ForgotPasswordForm` |
| Reset Password | `/auth/reset-password` | `ResetPasswordForm` |
| OAuth Callback | `/auth/callback` | Callback handler (completes OAuth flow) |

Auth pages use `Card` layout centered on screen. Authenticated users are redirected to dashboard.

## Dashboard (Protected - 14 pages)

| Page | Path | Content |
|------|------|---------|
| Overview | `/dashboard` | Welcome, 4 stat cards, plan info, recent activity |
| Analytics | `/dashboard/analytics` | Revenue chart, user growth, API calls, response time |
| Profile | `/dashboard/profile` | Profile display + edit form, password change |
| Settings | `/dashboard/settings` | Notification preferences (email, push, marketing) |
| Team | `/dashboard/team` | Team member list, role badges, remove member |
| Invite Member | `/dashboard/team/invite` | Invite form (email + role selection) |
| Create Team | `/dashboard/team/create` | Create new team form |
| Projects | `/dashboard/projects` | Project card grid (name, status, domain, branch) |
| Project Detail | `/dashboard/projects/[id]` | Single project detail |
| Notifications | `/dashboard/notifications` | Notification list (type badge, read/unread) |
| Integrations | `/dashboard/integrations` | Third-party integrations (GitHub, Slack, Vercel, Stripe) |
| Billing | `/dashboard/billing` | Current plan, usage stats, upgrade button |
| API Keys | `/dashboard/api-keys` | Key list (name/key/created/last used), create/delete/copy |
| Edit Profile | `/dashboard/profile/edit` | Profile edit form |

All dashboard pages use `export const dynamic = "force-dynamic"` for real-time data.

## Admin Panel (Protected - super_admin / admin only - 3 pages)

| Page | Path | Content |
|------|------|---------|
| Admin Console | `/dashboard/admin` | Stats cards, role distribution chart, system status |
| User Management | `/dashboard/admin/users` | User list search, role switching |
| Audit Logs | `/dashboard/admin/audit-logs` | Operation history, filter by action/user/time |

> Admin panel is hidden from regular users. Only `super_admin` and `admin` roles can access it via sidebar.

## API Routes (Public/Protected - 5 routes)

| Route | Method | Description | Auth |
|-------|--------|-------------|------|
| `/api/health` | GET | Health check (DB, Supabase, memory) | Public |
| `/api/auth/callback` | GET | Auth callback | Public |
| `/api/user` | GET/PUT | Get/update user info | Required |
| `/api/teams` | POST/GET | Create/get teams | Required |
| `/api/invitations` | POST | Send invitation email | Admin |

## Documentation Site (Public - 13 pages)

Independent VitePress project (`docs-site/`), deployable separately to Vercel or Docker:

Quick Start, Architecture, Mock Mode, Auth Flow, Project Structure, Tech Stack, Supabase, Components, Configuration, Scripts, Deployment, Pages Overview + Home

> The docs site supports Chinese/English bilingual, dark/light theme switching, and local search.
