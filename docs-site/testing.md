# Contributor Test Matrix

> Which checks must pass for the area you touched. The matrix is verified by `pnpm check:test-matrix`,
> so a command that no longer exists in `package.json` — or an area that is not listed here — fails CI.

Running everything is always safe but slow. The table below gives the **minimum** gate set for each
change area; `pnpm check:all` (same as `pnpm verify:all`) runs the full local aggregate and is what
`.husky/pre-push` enforces through `pnpm verify:build`.

## Change areas

| Area                | Covered paths                                          | Required checks                                                                                                                                                              |
| ------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ui`                | `src/components`, `src/app`, `src/lib/styling`                            | `pnpm check:tailwind` · `pnpm check:tokens` · `pnpm check:fields` · `pnpm check:states` · `pnpm check:direction` · `pnpm check:a11y` · `pnpm test` · `pnpm test:visual`                                |
| `server-actions`    | `src/lib/actions`, `src/lib/repositories`              | `pnpm test` · `pnpm test:coverage` · `pnpm type-check` · `pnpm check:rls` · `pnpm check:trace-coverage`                                                                                                     |
| `api-routes`        | `src/app/api`                                          | `pnpm test` · `pnpm test:e2e` · `pnpm check:trace-coverage` · `pnpm check:cron-contract`                                                                                                                    |
| `auth-mfa`          | `src/lib/auth`, `src/app/auth`                         | `pnpm test` · `pnpm test:e2e` · `pnpm check:security`                                                                                                                        |
| `database`          | `supabase/migrations`, `supabase/migration-manifest.json`, `src/lib/supabase/database.types.ts` | `pnpm check:migrations` · `pnpm check:migration-history` · `pnpm check:query-columns` · `pnpm update:migrations-manifest` · `pnpm db:types` · `pnpm smoke:supabase-identity`                            |
| `rls-security`      | `src/proxy.ts`, `src/lib/security`                     | `pnpm check:rls` · `pnpm check:security` · `pnpm check:supabase-security`                                                                                                     |
| `i18n`              | `messages`, `src/i18n`, `src/lib/i18n`, `src/lib/constants.ts`, `src/lib/notifications` | `pnpm check:locales` · `pnpm check:i18n` · `pnpm check:dynamic-keys` · `pnpm check:action-errors` · `pnpm check:glossary`                                                                                                                                     |
| `providers`         | `src/lib/providers`, `docs-site/provider-diagnostics.md` | `pnpm check:provider-docs` · `pnpm provider:doctor`                                                                                                                        |
| `mock`              | `src/lib/mock`, `src/app/api/e2e`                      | `pnpm check:mock-docs` · `pnpm test:e2e`                                                                                                                                     |
| `ci-tooling`        | `.github/workflows`, `scripts`, `package.json`         | `pnpm check:gates` · `pnpm check:workflows` · `pnpm check:codeql` · `pnpm check:secrets-scan` · `pnpm check:release-tag` · `pnpm lint` · `pnpm type-check` · `pnpm test` · `pnpm check:all` |
| `docs`              | `docs`, `docs-site`                                    | `pnpm check:docs` · `pnpm check:adr` · `pnpm check:changelog` · `pnpm check:release-docs` · `pnpm check:bilingual-docs`                                                                                    |

## Notes

- The `ui` area is the only one that needs `pnpm test:visual`; baselines must come from the **CI runner's
  own screenshot** (see [Testing](/testing) — the Playwright container is not equivalent to `ubuntu-latest`, and
  never generate them on macOS).
- `database` and `rls-security` overlap on `supabase/migrations`: schema changes need both the migration
  drift gate and the RLS coverage gate.
- `pnpm check:migration-history` and `pnpm smoke:supabase-identity` need a local Supabase instance; they are
  skipped in CI and belong to the release runbook.
- Anything touching more than one area runs the union of the required checks; when in doubt run
  `pnpm check:all`, which is the aggregate the pre-push hook already enforces.

## Why this page is gated

`pnpm check:test-matrix` reads `src/lib/testing/test-matrix.ts` and validates both this page and its
Chinese counterpart:

1. every registered area id must appear as the first column of a row in the matrix table, and a row that
   references an unknown area id fails (`MATRIX_MISSING_AREA` / `MATRIX_UNKNOWN_AREA`);
2. every required check must appear **inside that area's own row** as `` `pnpm <script>` ``
   (`MATRIX_MISSING_COMMAND`);
3. every covered path must appear in the document (`MATRIX_MISSING_PATH`);
4. every referenced `pnpm <script>` must exist in `package.json`, except allow-listed built-ins such as
   `pnpm install` (`MATRIX_UNKNOWN_COMMAND`);
5. empty sources fail closed (`MATRIX_SOURCE_EMPTY`).

The IO layer additionally asserts that each registered path still exists on disk, so renaming a directory
without updating the matrix fails the same gate.
