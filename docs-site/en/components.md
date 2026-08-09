# Components

IndieStack provides a three-layer component architecture: base UI (shadcn/ui), shared business components, and page-level components.

## Directory Structure

```
src/components/
├── ui/             # Base UI (shadcn/ui, 24 components)
├── shared/         # Shared business components (11)
├── layout/         # Layout components (5)
├── auth/           # Auth components (2)
├── dashboard/      # Dashboard components
├── charts/         # Charts (Recharts)
├── forms/          # Form components (5)
├── data-tables/    # Tables (@tanstack/react-table)
└── providers/      # React Context Providers
```

## shadcn/ui (24 components)

All built on Radix UI primitives with accessibility and theme support.

| Component | Usage | Radix Base |
|-----------|-------|------------|
| Button | 6 variants | `@radix-ui/react-slot` |
| Card | Card container | - |
| Dialog | Modal dialog | `@radix-ui/react-dialog` |
| DropdownMenu | Dropdown | `@radix-ui/react-dropdown-menu` |
| Input | Text input | - |
| Select | Select with search | `@radix-ui/react-select` |
| Tabs | Tab switching | `@radix-ui/react-tabs` |
| Table | Data table | - |
| Toast | Notifications | `@radix-ui/react-toast` |
| Tooltip | Tooltip | `@radix-ui/react-tooltip` |
| Avatar | Avatar | `@radix-ui/react-avatar` |
| Badge | Badge | - |
| Switch | Toggle | `@radix-ui/react-switch` |
| Checkbox | Checkbox | `@radix-ui/react-checkbox` |
| Alert | 5 variants | - |
| Sheet | 4 directions | `@radix-ui/react-dialog` |
| Skeleton | Loading | - |
| Separator | Divider | `@radix-ui/react-separator` |
| Textarea | Text area | - |
| Toggle | Toggle button | `@radix-ui/react-toggle` |
| Progress | Progress bar | `@radix-ui/react-progress` |
| Label | Label | `@radix-ui/react-label` |
| Popover | Popover | `@radix-ui/react-popover` |
| Collapsible | Collapsible | `@radix-ui/react-collapsible` |

## Custom Components

| Component | Directory | Usage |
|-----------|-----------|-------|
| SiteHeader | `layout/` | Responsive navbar with auth state, theme + locale switcher |
| SiteFooter | `layout/` | Page footer with links and copyright |
| DashboardSidebar | `layout/` | Collapsible sidebar with role-based menu |
| ThemeToggle | `layout/` | Light/dark theme toggle |
| LocaleSwitcher | `layout/` | Chinese/English language switcher |
| PermissionGate | `shared/` | Role-based permission guard for UI elements |
| ConfirmDialog | `shared/` | Generic confirmation dialog |
| Breadcrumbs | `shared/` | Auto breadcrumb navigation |
| EmptyState | `shared/` | Empty state (icon + title + desc + action) |
| LoadingState | `shared/` | Generic loading skeleton |
| ErrorState | `shared/` | Error state with retry button |
| SearchInput | `shared/` | Debounced search input |
| PageContainer | `shared/` | Uniform page container |
| PageHeader | `shared/` | Page header with action slot |
| PageLoader | `shared/` | Full-screen loading indicator |
| Section | `shared/` | Content section wrapper |
| StatsCard | `dashboard/` | Stats card with trend indicator |
| DataTable | `data-tables/` | Generic table (sort/search/pagination) |
| AreaChart | `charts/` | Area chart (Recharts) |
| LoginForm | `auth/` | Email + OAuth login form |
| RegisterForm | `auth/` | Registration form |
| ProfileEditForm | `forms/` | Profile edit form |
| InviteMemberForm | `forms/` | Invite team member form |
| PasswordForm | `forms/` | Change password form |
| NotificationSettingsForm | `forms/` | Notification preferences form |

## Component Principles

1. **UI** (`ui/`): Presentational only, no business logic
2. **Shared** (`shared/`): Reusable, page-agnostic common logic
3. **Business** (`forms/`, `dashboard/`): Domain-specific, uses shared components
4. **Pages** (`app/`): Composes business + UI components
5. Use `useTranslations` (client) or `getTranslations` (server) for i18n
6. Theme support via `cn()` utility and Tailwind CSS variables
