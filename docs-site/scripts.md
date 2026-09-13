 # Scripts
 
 IndieStack provides npm scripts to streamline development, testing, and deployment.
 
 ## Development
 
 | Command | Description |
 |--------|------------|
 | `pnpm dev` | Start Next.js dev server (HMR) |
 | `pnpm dev:mock` | Start in mock mode (`NEXT_PUBLIC_MOCK_ENABLED=true`) |
 | `pnpm dev:supabase` | Start Supabase local services + dev server |
 | `pnpm preview` | Preview production build (port 4173) |
 
 ## Build & Deploy
 
 | Command | Description |
 |--------|------------|
 | `pnpm build` | Production build (Next.js + Sentry) |
 | `pnpm start` | Start production server |
 | `pnpm sentry:sourcemaps` | Upload source maps to Sentry |
 
 ## Code Quality
 
 | Command | Description |
 |--------|------------|
| `pnpm lint` | ESLint (with Next.js rules) |
| `pnpm type-check` | TypeScript check (`tsc --noEmit`) |
| `pnpm format` | Prettier format (TS, TSX, CSS, JSON) |
| `pnpm check` | Type-check + lint together |
| `pnpm check:security` | Verify secrets/env policy and security-scanner configuration |
| `pnpm check:changelog` | Validate CHANGELOG.md structure (versions, sections, entries) |
| `pnpm check:adr` | Validate ADR numbering, status, index, sections, and supersession links |
| `pnpm check:gates` | Audit that every `check:*` gate is wired into `check-all.sh` and CI, or exempt with a reason |
| `pnpm check:workflows` | Audit CI workflow hygiene: pinned actions, job timeouts, `needs` targets, PR concurrency, real script names, and the ci.yml parallel/cache contract |
| `pnpm check:codeql` | Audit CodeQL scan strength and alert triage policy: action major, languages, query suite, SARIF category, permissions, timeout, branch/schedule coverage, path filters, and runbook facts |
| `pnpm check:mock-docs` | Audit that the Mock docs match the Mock client tables and E2E endpoints |
| `pnpm check:test-matrix` | Audit that the contributor test matrix documents every change area and real script |
| `pnpm check:provider-docs` | Audit that both provider diagnostics guides document every provider and environment key |
| `pnpm provider:doctor` | Print a credential-free provider configuration report and fail on partial setups |
| `pnpm check:tailwind` | Enforce Tailwind v4 native theme usage (no JS config, `@theme` tokens, renamed utilities) |
| `pnpm check:tokens` | Enforce design token registry ↔ `globals.css` consistency and ban raw status palettes |
| `pnpm check:fields` | Enforce shared `FormField` / `NativeSelect` usage and ban raw selects, copied control classes, and direct label imports |
| `pnpm check:states` | Enforce shared `PageLoading` / `EmptyState` / `ErrorState` usage and ban raw route skeletons, legacy loaders, and bare spinners |
 
 ## Testing
 
 | Command | Description |
 |--------|------------|
| `pnpm test` | Run all tests (Vitest) |
| `pnpm test:watch` | Watch mode |
| `pnpm test:coverage` | Test with coverage report |
| `pnpm test:e2e` | Run Playwright E2E smoke tests |
| `pnpm test:visual` | Compare Linux Chromium visual regression baselines |
 
 ## Database
 
 | Command | Description |
 |--------|------------|
| `pnpm db:migrate` | Push migrations to Supabase |
| `pnpm db:seed` | Run seed data script |
| `pnpm db:types` | Generate TypeScript types from Supabase |
| `pnpm db:status` | Check Supabase local service status |
| `pnpm check:migrations` | Enforce immutable migration checksums + filename/ordering rules |
| `pnpm update:migrations-manifest` | Re-baseline the migration checksum manifest (append-only) |
| `pnpm check:migration-history` | Compare local Supabase migration history (needs `supabase start`) |
| `pnpm check:migration-runbook` | Audit that the migration rollback runbook matches the migration manifest |
 
 ## Helper Scripts
 
 ### `/scripts/setup.sh`
 
 One-click project setup:
 
 1. Check Node.js version (18.17+)
 2. Install dependencies
 3. Copy env template (if `.env.local` missing)
 4. Initialize Git hooks (husky)
 
 ### `/scripts/dev.sh`
 
 Dev helper script:
 - Start Supabase local services (Docker)
 - Apply database migrations
 - Start Next.js dev server
 
 ## Git Hooks (husky)
 
 - **pre-commit**: lint-staged (auto format + ESLint fix staged files)
 - **commit-msg**: Conventional Commits validation
 
 ## Docker
 
 ```bash
 docker compose up -d    # PostgreSQL + pgAdmin
 docker build -t indiestack . && docker run -p 3000:3000 indiestack
 ```
| `pnpm check:locales` | Verify en/zh-CN translation key symmetry |
| `pnpm check:agents` | Verify AGENTS.md index consistency |
| `pnpm check:rls` | Static check of RLS migrations (USING/WITH CHECK) |
| `pnpm check:bundle` | Client bundle size gate (build + baseline compare) |
| `pnpm dep:health` | Dependency health report (major/minor breakdown) |
