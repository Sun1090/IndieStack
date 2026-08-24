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
 
 ## Testing
 
 | Command | Description |
 |--------|------------|
 | `pnpm test` | Run all tests (Vitest) |
 | `pnpm test:watch` | Watch mode |
 | `pnpm test:coverage` | Test with coverage report |
 
 ## Database
 
 | Command | Description |
 |--------|------------|
 | `pnpm db:migrate` | Push migrations to Supabase |
 | `pnpm db:migrate` | Push schema changes |
 | `pnpm db:seed` | Run seed data script |
 | `pnpm db:types` | Generate TypeScript types from Supabase |
 | `pnpm db:status` | Check Supabase local service status |
 
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
