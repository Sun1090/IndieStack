# 贡献者测试矩阵

> 按改动领域给出必须通过的门禁。本页由 `pnpm check:test-matrix` 校验：命令在 `package.json` 里
> 已不存在、或某个领域没有登记，CI 会直接失败。

全量跑当然最保险，但很慢。下表给出每个改动领域的**最小**门禁集；`pnpm check:all`（等价于
`pnpm verify:all`）是本地聚合入口，`.husky/pre-push` 通过 `pnpm verify:build` 强制执行——前提是
这个克隆装过钩子（`pnpm install` 会装），否则这一页的规则就退化成纯靠自觉。

## 改动领域

| 领域           | 覆盖路径                                               | 必须运行的门禁                                                                                                                                                              |
| -------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ui`           | `src/components`, `src/app`, `src/lib/styling`                            | `pnpm check:tailwind` · `pnpm check:tokens` · `pnpm check:fields` · `pnpm check:states` · `pnpm check:direction` · `pnpm check:a11y` · `pnpm test` · `pnpm test:visual`                              |
| `server-actions` | `src/lib/actions`, `src/lib/repositories`            | `pnpm test` · `pnpm test:coverage` · `pnpm type-check` · `pnpm check:rls` · `pnpm check:trace-coverage`                                                                                                   |
| `api-routes`   | `src/app/api`                                          | `pnpm test` · `pnpm test:e2e` · `pnpm check:trace-coverage` · `pnpm check:cron-contract`                                                                                                                  |
| `auth-mfa`     | `src/lib/auth`, `src/app/auth`                         | `pnpm test` · `pnpm test:e2e` · `pnpm check:security`                                                                                                                      |
| `database`     | `supabase/migrations`, `supabase/migration-manifest.json`, `src/lib/supabase/database.types.ts` | `pnpm check:migrations` · `pnpm check:migration-history` · `pnpm check:query-columns` · `pnpm update:migrations-manifest` · `pnpm db:types` · `pnpm smoke:supabase-identity`                          |
| `rls-security` | `src/proxy.ts`, `src/lib/security`                     | `pnpm check:rls` · `pnpm check:security` · `pnpm check:supabase-security`                                                                                                   |
| `i18n`         | `messages`, `src/i18n`, `src/lib/i18n`, `src/lib/constants.ts`, `src/lib/notifications` | `pnpm check:locales` · `pnpm check:i18n` · `pnpm check:dynamic-keys` · `pnpm check:action-errors` · `pnpm check:glossary`                                                                                                                                   |
| `providers`    | `src/lib/providers`, `docs-site/provider-diagnostics.md` | `pnpm check:provider-docs` · `pnpm provider:doctor`                                                                                                                      |
| `mock`         | `src/lib/mock`, `src/app/api/e2e`                      | `pnpm check:mock-docs` · `pnpm test:e2e`                                                                                                                                   |
| `ci-tooling`   | `.github/workflows`, `scripts`, `package.json`         | `pnpm check:gates` · `pnpm check:workflows` · `pnpm check:codeql` · `pnpm check:secrets-scan` · `pnpm check:release-tag` · `pnpm lint` · `pnpm type-check` · `pnpm test` · `pnpm check:all` |
| `docs`         | `docs`, `docs-site`                                    | `pnpm check:docs` · `pnpm check:adr` · `pnpm check:changelog` · `pnpm check:release-docs` · `pnpm check:bilingual-docs`                                                                                  |

## 说明

- 只有 `ui` 领域需要 `pnpm test:visual`；视觉基线必须取**CI runner 自己产出的截图**（见
  [测试指南](/zh-CN/testing)——Playwright 容器并不等价于 `ubuntu-latest`），不要在 macOS 上直接生成。
- `database` 与 `rls-security` 在 `supabase/migrations` 上重叠：改 schema 既过迁移漂移门禁，也过 RLS 覆盖门禁。
- `pnpm check:migration-history` 与 `pnpm smoke:supabase-identity` 需要本地 Supabase，CI 不跑，归属发布 runbook。
- 改动跨越多个领域时取门禁并集；拿不准就跑 `pnpm check:all`，这正是 pre-push 已经强制的那一套。

## 为什么这页有门禁

`pnpm check:test-matrix` 读取 `src/lib/testing/test-matrix.ts`，对中英两份矩阵文档做校验：

1. 注册表里的每个领域 id 都必须作为表格首列出现，登记了不存在的领域 id 即失败
   （`MATRIX_MISSING_AREA` / `MATRIX_UNKNOWN_AREA`）；
2. 每条必需门禁必须出现在**该领域自己的那一行**里，形式为 `` `pnpm <script>` ``
   （`MATRIX_MISSING_COMMAND`）；
3. 每条覆盖路径都必须出现在文档里（`MATRIX_MISSING_PATH`）；
4. 文档引用的每个 `pnpm <script>` 都必须真实存在于 `package.json`，内置命令白名单除外，
   例如 `pnpm install`（`MATRIX_UNKNOWN_COMMAND`）；
5. 抽取为空时失败封闭（`MATRIX_SOURCE_EMPTY`）。

IO 层另外校验每个登记路径在磁盘上仍然存在，因此「改了目录名却没更新矩阵」会被同一道门禁拦住。
