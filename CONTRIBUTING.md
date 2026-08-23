# Contributing to IndieStack

## Development Workflow

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Make your changes
4. Run the full verification: `pnpm verify:all`（校验/测试）+ `pnpm build`
5. Commit with conventional commit messages（commitlint 强制校验，规范详见 [agents/10-release-manager.md](./agents/10-release-manager.md)）
6. Push and open a Pull Request（PR 目标分支：`develop` 或 `main`）

## Agent 协作

本项目维护 10 个专业化协作 Agent（编码、审查、测试、发布等），任务分工与协作流程见 [AGENTS.md](./AGENTS.md)。提交前建议按对应 Agent 的清单自检。

## Code Standards

- **TypeScript**: Strict mode. No `any` types unless absolutely necessary.
- **Components**: Server Components by default. Add `"use client"` only when interactivity is needed (useState, useEffect, event handlers).
- **Styling**: Tailwind CSS with shadcn/ui conventions. Use CSS variables for theming.
- **Data Fetching**: Use Supabase server client in Server Components. Use `useUser()` hook in client components.
- **Forms**: Use Server Actions with Zod validation. Shared schemas in `src/lib/validations/`.
- **Routes**: Always reference routes via `ROUTES.*` constants from `@/lib/constants`.
- **Commits**: Follow [Conventional Commits](https://www.conventionalcommits.org/):
  - `feat:` — New feature
  - `fix:` — Bug fix
  - `docs:` — Documentation
  - `refactor:` — Code restructuring
  - `chore:` — Tooling, config, dependencies

## Adding a New Page

1. Add Zod schema in `src/lib/validations/` (if form/page has input)
2. Add Server Action in `src/lib/actions/` (if form submission needed)
3. Create page file in `src/app/{route}/page.tsx`
4. Add route constant in `src/lib/constants.ts` under `ROUTES`
5. Add navigation link in sidebar or header as appropriate
6. Add database migration in `supabase/migrations/` (if new table needed)
7. Update docs in `docs/` and `docs-site/index.html`

## Adding a Database Migration

```bash
# Create migration
npx supabase migration new your_migration_name

# Apply locally
npx supabase db push

# Generate TypeScript types
pnpm db:types
```

## Pull Request Process

1. Ensure all checks pass (lint, type-check, build)
2. Update documentation if adding/changing features
3. Add comments for non-obvious logic
4. Squash commits before merging

## Getting Help

- Open an issue for bugs or feature requests
- Check `docs/` for architecture and setup guides
- Review `CLAUDE.md` for AI-assisted development patterns
