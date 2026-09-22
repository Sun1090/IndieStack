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
| `pnpm check:secrets-scan` | Audit gitleaks scan strength and leak response policy: action major, full-history fetch depth, trigger coverage, token wiring, write permissions, allowlist entries, and runbook facts |
| `pnpm check:trace-coverage` | Audit that every route handler and server action logs errors through the trace-aware `logApiError` / `logActionError` funnels, and that the `x-request-id` contract in `src/lib/trace-id.ts` and `src/proxy.ts` has not drifted |
| `pnpm check:bilingual-docs` | Compare scheduling facts (cron expressions, `HH:MM UTC` times) between each `docs-site` page and its `zh-CN` counterpart; one-sided edits fail |
| `pnpm check:cron-contract` | Audit Vercel cron schedules, route methods, rejection observability, documented metrics, that every conditional skip in a worker route reports a counter, and that every cron expression / `/api/cron/*` path quoted in `docs-site` and `docs` actually exists in the repository |
| `pnpm check:release-tag` | Verify a `vX.Y.Z` tag matches `package.json`, the CHANGELOG has a dated release section, and `release.yml` publishes reviewed notes only after all gates |
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
| `pnpm check:query-columns` | Check every literal column name in a Supabase query chain against the generated row types |
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
| `pnpm check:locales` | Verify en/zh-CN key symmetry and that values are actually translated |
| `pnpm check:agents` | Verify AGENTS.md index consistency |
| `pnpm check:rls` | Static check of RLS migrations (USING/WITH CHECK) |
| `pnpm check:bundle` | Client bundle size gate (build + baseline compare) |
| `pnpm dep:health` | Dependency health report (major/minor breakdown) |
