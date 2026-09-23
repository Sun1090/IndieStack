# Components

IndieStack provides a three-layer component architecture: base UI (shadcn/ui), shared business components, and page-level components.

## Directory Structure

```
src/components/
├── ui/             # Base UI (shadcn/ui, 30 components)
├── shared/         # Shared business components (15)
├── layout/         # Layout components (8)
├── auth/           # Auth components (2)
├── dashboard/      # Dashboard components
├── charts/         # Charts (Recharts)
├── forms/          # Form components (7)
├── data-tables/    # Tables (@tanstack/react-table)
└── providers/      # React Context Providers
```

## shadcn/ui

Most rows wrap a Radix UI primitive; the `-` rows are hand-written. All support light/dark theming
through `cn()` and Tailwind CSS variables.

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
| Command | Command palette (`⌘K`) | `cmdk` + `@radix-ui/react-dialog` |
| ContextMenu | Right-click menu | `@radix-ui/react-context-menu` |
| Kbd | Keyboard shortcut hint | - |
| RadioGroup | Radio group | `@radix-ui/react-radio-group` |
| ScrollArea | Custom scroll container | `@radix-ui/react-scroll-area` |
| Toaster | Toast host: renders the queue | - |

## Custom Components

Rows below enumerate every component in `shared/`, `layout/`, `auth/` and `forms/`. The
`dashboard/`, `charts/` and `data-tables/` rows are examples only — those three directories are not
fully enumerated here.

| Component | Directory | Usage |
|-----------|-----------|-------|
| SiteHeader | `layout/` | Responsive navbar with auth state, theme + locale switcher |
| SiteFooter | `layout/` | Page footer with links and copyright |
| ThemeToggle | `layout/` | Light/dark theme toggle |
| LocaleSwitcher | `layout/` | Chinese/English language switcher |
| CommandPalette | `layout/` | `⌘K` / `Ctrl+K` palette that jumps between dashboard routes |
| ShortcutsDialog | `layout/` | Keyboard-shortcut help, opened with `?` |
| NavigationProgress | `layout/` | Top progress bar on route change |
| OfflineBanner | `layout/` | Banner shown when `navigator.onLine` goes false |
| PermissionGate | `shared/` | Role-based permission guard for UI elements |
| ConfirmDialog | `shared/` | Generic confirmation dialog |
| Breadcrumbs | `shared/` | Auto breadcrumb navigation |
| EmptyState | `shared/` | Empty state (icon + title + desc + action) |
| ErrorState | `shared/` | Error state with retry button |
| QueryErrorState | `shared/` | Failed-query card: renders ErrorState plus the retry wiring |
| PageHeader | `shared/` | Page header with action slot |
| Section | `shared/` | Content section wrapper |
| FormField | `shared/` | Label / control / description / error wrapper; `FormFieldControl` wires `id` + `aria` |
| NativeSelect | `shared/` | Styled native `<select>`, pairs with FormField |
| PageLoading | `shared/` | Route-level loading skeleton with `aria-busy`; also exports `LoadingIndicator` |
| PasswordStrength | `shared/` | Client-side password strength bar |
| UploadProgress | `shared/` | Upload percentage bar with cancel |
| InitialAvatar | `shared/` | Letter avatar derived from name/email, no storage dependency |
| GithubIcon | `shared/` | Inline GitHub mark (lucide dropped brand icons) |
| DashboardSidebar | `dashboard/` | Collapsible sidebar with role-based menu |
| StatsCard | `dashboard/` | Stats card with trend indicator |
| DataTable | `data-tables/` | Generic table (sort/search/pagination) |
| AreaChart | `charts/` | Area chart (Recharts) |
| LoginForm | `auth/` | Email + OAuth login form |
| RegisterForm | `auth/` | Registration form |
| ProfileEditForm | `forms/` | Profile edit form |
| AvatarUploadForm | `forms/` | Avatar upload with progress and cancel |
| InviteMemberForm | `forms/` | Invite team member form |
| PasswordForm | `forms/` | Change password form |
| NotificationSettingsForm | `forms/` | Notification preferences form |
| PushNotificationForm | `forms/` | Web Push subscribe/unsubscribe toggle (needs `NEXT_PUBLIC_VAPID_PUBLIC_KEY`) |
| ThemeSettingsForm | `forms/` | Light / dark / system appearance choice |

## Component Principles

1. **UI** (`ui/`): Presentational only, no business logic
2. **Shared** (`shared/`): Reusable, page-agnostic common logic
3. **Business** (`forms/`, `dashboard/`): Domain-specific, uses shared components
4. **Pages** (`app/`): Composes business + UI components
5. Use `useTranslations` (client) or `getTranslations` (server) for i18n
6. Theme support via `cn()` utility and Tailwind CSS variables
