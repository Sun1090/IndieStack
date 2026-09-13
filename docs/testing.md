# 测试指南

> 项目测试体系总览。写代码前先读本文，选对测试层级。

## 测试金字塔

```
      E2E（Playwright，62 用例）        ← 关键路径冒烟
    ┌──────────────────────────┐
   │ 组件测试（jsdom + Testing Library）│ ← 交互组件
  │──────────────────────────────│
 │ 单元测试（Vitest node 环境，300+）  │ ← actions/工具/守卫
└────────────────────────────────┘
```

## 命令

| 命令                                 | 说明                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------- |
| `pnpm test`                          | 全部单元+组件测试                                                               |
| `pnpm test:coverage`                 | 含覆盖率报告（核心逻辑门禁 ≥90%）                                               |
| `pnpm test:e2e`                      | Playwright 冒烟（自动起 Mock dev server）                                       |
| `pnpm test:visual`                   | 对比 Linux Chromium 视觉基线（CI 自动执行）                                     |
| `pnpm test:visual:update`            | 在 Linux 容器中更新视觉基线，不从 macOS 直接生成                                |
| `pnpm smoke:supabase-identity`       | 本地/staging Supabase 真实身份矩阵（anon/authenticated/service_role + Storage） |
| `pnpm verify`                        | check（类型/lint/i18n/rls/a11y/agents/docs）+ test + bundle 门禁                |
| `pnpm check:all` / `pnpm verify:all` | 上述全部校验聚合入口（两个命令同义）                                            |

## 双项目结构

vitest.config.ts 定义两个 project：

- **node**：`src/**/*.test.ts` — Server Actions、纯函数、路由处理器
- **jsdom**：`src/**/*.test.tsx` 与 `*.dom.test.ts` — 需要DOM 的组件

Vitest 每个项目最多 2 个 worker，避免本机高并发创建 jsdom 导致交互测试超时。

## 编写规范

1. 测试文件与源码同目录：`foo.ts` → `foo.test.ts`；组件 → `foo.test.tsx`
2. mock next-intl：`vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }))`
3. Radix 组件需要 ResizeObserver —— 已在 `src/test/setup.ts` 全局 stub
4. Server Action 测试断言 ActionResult 形状：`{ ok: false, error: "key" }`

## 覆盖率门禁

`src/lib/**`（除 mock/stripe/supabase 客户端胶水层）：
statements/functions/lines ≥ 90%，branches ≥ 90%。CI 强制。

## E2E

- 运行于 Mock 模式（`NEXT_PUBLIC_MOCK_ENABLED=true`），无需真实 Supabase
- 默认单 worker 串行执行，避免多个 spec 通过同一个 dev server 互相清理/覆盖可变 Mock 状态；仅隔离实验可设置 `PW_FULLY_PARALLEL=true`
- 新页面至少加一条"可渲染"断言到 `e2e/smoke.spec.ts`
- 安全头、trace-id、CSP nonce 断言集中在「安全与容错」组
- `e2e/a11y.spec.ts` 使用 `@axe-core/playwright` 对首页、功能页、定价页、登录页、注册页执行 WCAG 2.1 A/AA 自动审计；新增或修改公共页面时必须同步评估覆盖范围
- 语言切换同时覆盖 Cookie 持久化与键盘操作：Tab 聚焦触发按钮、Enter 打开菜单、`aria-current` 标识当前语言、Escape 关闭并归还焦点
- 通知 Realtime 的 Mock 测试在服务端 seed 后派发 `indiestack:mock-realtime` 事件；测试覆盖 event/schema/table/user filter 契约、合并刷新和无需 reload 的 UI 更新
- Push 持久化重试链路由 `e2e/push-retry.spec.ts` 驱动真实 `/api/cron/push-retry`：mock 模式下
  `src/lib/mock/push-transport.ts` 只替换 `web-push` 的底层 HTTP 传输（保留端点 `/ok`、`/transient`、
  `/timeout`、`/gone`），适配器契约与错误映射仍走真实代码；种子数据由 mock-only 的
  `/api/e2e/push-queue` 端点写入。它不是真实 push service 验证。

## 视觉回归

`e2e-visual/visual.spec.ts` 对首页、功能页、定价页和登录页执行桌面端全页截图，与
`e2e-visual/visual.spec.ts-snapshots/` 中的 Linux Chromium PNG 对比。CI 在常规 E2E
之后自动运行 `pnpm test:visual`，像素差异门禁为 0.1%。

基线必须使用与 CI 相同的 Linux 容器生成，不要在 macOS 直接运行 `--update-snapshots`：

```bash
docker run --rm --ipc=host --platform linux/amd64 \
  -v "$PWD":/work -w /work \
  -v indiestack-visual-node-modules:/work/node_modules \
  -v indiestack-visual-next:/work/.next \
  mcr.microsoft.com/playwright:v1.63.0-noble \
  bash -lc 'corepack enable && pnpm install --frozen-lockfile && pnpm test:visual:update'
```

容器镜像的 Playwright 版本必须与 `@playwright/test` 保持一致。视觉配置固定单 worker、
UTC、浅色主题、关闭动画，并隐藏仅用于开发的 Next.js 指示器；版权年份在截图前遮罩，避免
时间变化造成假失败。

## 数据库身份矩阵（本地 Supabase）

`pnpm smoke:supabase-identity` 是**真实运行时**回归，不是静态检查：它登录 `seed.sql`
里的确定性账号，用 anon / authenticated / service_role 三种身份打 PostgREST 与 Storage
API，验证租户隔离、`profiles` 可见范围、私有项目不可读，以及 `avatars` 前缀写权限。

前置条件：

```bash
pnpm exec supabase start
pnpm exec supabase db reset        # 25 个迁移 + seed
pnpm smoke:supabase-identity -- --output /tmp/indiestack-identity-matrix.json
```

- 只有在本地/staging 才运行：seed 账号密码是公开固定值。
- 可用 `--url` / `--anon-key` / `--service-role-key` 覆盖目标（例如受控 staging）。
- 脚本结束时清理自己创建的临时对象；失败项会在 JSON 的 `checks[].passed=false` 中列出。
- 覆盖范围与局限见 [db/security-audit.md](./db/security-audit.md)。

## CI 门禁

push/PR 触发八道关卡：Lint & Type Check（含 i18n/RLS 校验）· Build · E2E · Build Docs · CodeQL · gitleaks。
任何一道失败即阻塞合并。

## Mock fixture 隔离策略（F02/F03）

默认 E2E 不使用 file-backed fixture。Playwright 的浏览器测试与 Next.js dev server 可能跨 worker、跨模块 chunk 运行；把可变 fixture 写入仓库文件会带来并发覆盖、残留状态、工作区污染和 CI artifact 泄露风险，也无法保证多个 server worker 看到同一份原子状态。

推荐按以下优先级选择状态容器：

1. **request-scoped store**：需要并行请求彼此隔离时，使用 `createMockRequestStore()` 创建 scope，并把它注入 mock adapter/client。
2. **globalThis mock cache**：仅用于现有 dev server 的跨 chunk 闭环；测试必须通过受保护的 reset endpoint 或 `resetMockCache()` 清理。
3. **file-backed fixture（仅离线快照）**：只允许用于只读、脱敏的 fixture 生成/调试，不作为运行时数据库，不从用户输入写入，不提交包含 token、cookie、邮件正文或个人数据的文件。

F03 评估结论：运行时 file-backed fixture 暂不引入；request-scoped store 解决隔离问题且不增加 IO/锁语义。若未来需要跨进程复现，必须单独设计临时目录、原子 rename、worker 唯一命名、TTL 清理和 CI artifact 脱敏校验。

## 发布文档门禁

`pnpm check:release-docs` 校验发布 checklist、发布/回滚 runbook、生产 smoke 矩阵、CHANGELOG 和双语 README 的关键内容与命令。它只证明文档产物结构完整，不证明生产部署、冒烟或回滚演练已经执行；这些必须附带实际命令输出和时间记录。

`pnpm check:changelog` 在结构层面校验 `CHANGELOG.md`（I05）：`[Unreleased]` 必须排第一且非空、版本标题形如 `## [x.y.z] — YYYY-MM-DD`、版本按降序排列且不重复、每个版本至少一个 `### 章节` 且章节内至少一个顶层条目、条目不得为空或超长。规则实现位于 `src/lib/changelog/parse-changelog.ts`（纯函数，单测覆盖），由 `scripts/check-changelog.js` 包装成 CLI，`pnpm check:all` 与 CI 的 Lint & Type Check job 均会执行。它只覆盖文档结构，不校验文案质量或发布事实。

### ADR 治理门禁（I04）

`pnpm check:adr` 校验 `docs/adr/` 的决策记录不会在新增或迭代时漂移：文件名必须为
`adr-NNN-kebab-title.md`，编号连续且不重复；正文首行编号与文件名一致；`状态` 只允许
“提议 / 已接受（附注）/ 已废弃（被 ADR-NNN 取代）”；`日期` 必须为合法且非未来的
`YYYY-MM-DD`；每篇至少包含“背景 / 决策 / 影响（或后果）”章节。README 索引必须与目录双向一致，
标题和状态逐字匹配且按编号升序；被取代的 ADR 必须指向存在、并在正文中显式引用它的后继 ADR。

规则实现位于 `src/lib/adr/adr-rules.ts`（纯函数），IO/CLI 位于 `scripts/lib/adr-check.js`，
由 `scripts/check-adr.js` 经 Node 原生 type stripping 调用；`pnpm check:all` 与 CI 的
Lint & Type Check job 均会执行。门禁只验证治理结构和引用完整性，不判断技术决策本身是否正确。

### 门禁接线审计（I06 / J01）

`pnpm check:gates` 解决的是「写了门禁脚本，但门禁从不执行」这类静默失效：`package.json` 里
每个 `check:*` 脚本都必须出现在 `scripts/check-all.sh`（本地聚合）或某个 GitHub workflow（CI）里，
否则必须登记豁免理由。规则包括：

1. 门禁缺本地聚合 → `GATE_UNWIRED_LOCAL`；缺 CI 执行 → `GATE_UNWIRED_CI`；
2. `check-all.sh` 调用了 `package.json` 里不存在的脚本 → `AGGREGATE_UNKNOWN_SCRIPT`；
3. 豁免表登记了不存在的门禁、没有理由、或理由已过期（其实已经接线）→ `EXCEPTION_STALE` / `EXCEPTION_EMPTY`；
4. `.github/RELEASE_CHECKLIST.md` 逐字引用的 workflow / job 名必须真实存在 → `CHECKLIST_WORKFLOW_UNKNOWN`；
5. 检查清单「打标签」章节的 `git tag vX.Y.Z` 必须与 `package.json` 版本一致 → `CHECKLIST_TAG_VERSION`。

当前豁免只有三条，且都写明替代覆盖方式：`check:migration-history`（需要本地 Supabase）、
`check:bundle`（需要完整生产构建）、`check:perf`（本地需要 `.next` 产物，CI 由 Build job 执行）。
规则实现位于 `src/lib/release/gate-wiring.ts`（纯函数，28 条单测），IO/CLI 位于
`scripts/lib/gate-wiring-check.js`，由 `scripts/check-gates.js` 经 Node 原生 type stripping 调用；
`pnpm check:all` 与 CI 的 Lint & Type Check job 均会执行。它只证明门禁被接线，不证明门禁本身的强度。

## Tailwind v4 原生主题门禁（G01）

`pnpm check:tailwind` 把 ADR-013 的「不再有 JS 配置」从一次性迁移变成可持续约束。规则分两层：

1. **仓库结构层**：仓库根不得再出现 `tailwind.config.*`；任何 CSS 不得出现 `@config` 指令（注释里提到不算）；`package.json` 不得重新引入 `tailwindcss-animate`；必须存在 `@theme` 块；每个 `@keyframes` 必须被至少一个 `--animate-*` token 整词认领（`spin-slow` 不会被 `--animate-spin` 认领）。
2. **应用层写法**（`src/**` 去掉 `src/components/ui/**`）：禁用任意值动画 `animate-[...]`（必须先在 `@theme` 登记 token），以及 v4 已更名或改语义的 v3 工具类：`bg-gradient-to-*` → `bg-linear-to-*`、`outline-none` → `outline-hidden`（v4 的 `outline-none` 会连 forced-colors 下的可见轮廓一起移除）、`flex-shrink*` / `flex-grow*` → `shrink-*` / `grow-*`、`overflow-ellipsis` → `text-ellipsis`、`decoration-slice|clone` → `box-decoration-slice|clone`。

`src/components/ui/**` 是 shadcn 上游基元的落点，写法跟随上游版本更新，因此只统计成一条非阻断 warning（收口进度可见，但不会为了改类名手改上游文件）。`shadow` / `rounded` / `blur` 这类「裸名」**不在**禁用列表：本项目 `@theme inline` 把 radius 刻度显式映射回 shadcn 语义，实测 `.rounded` 与 `.rounded-sm` 都解析为 4px，改名只会制造无收益 diff。

规则实现位于 `src/lib/tailwind/native-theme.ts`（纯函数，24 条单测覆盖），IO/CLI 位于 `scripts/lib/tailwind-native-check.js`（支持传入临时仓库根做反例测试），由 `scripts/check-tailwind.js` 经 Node 原生 type stripping 调用；`pnpm check:all` 与 CI Lint & Type Check job 均会执行。该门禁只证明类名与主题写法合规，不替代视觉回归（`pnpm test:visual`）对像素结果的验证。

## 设计 token 门禁（G02）

`pnpm check:tokens` 把「语义色只有一套来源」变成可持续约束。token 清单集中在 `src/lib/design/tokens.ts`
的 `DESIGN_TOKENS`（单一事实源），门禁读取 `src/app/globals.css` 做双向核对：

1. 注册表里的每个 token 必须真的定义在 `:root`（`TOKEN_MISSING_ROOT`）；
2. 标记 `dark: true` 的 token 必须在 `.dark` 里有覆盖（`TOKEN_MISSING_DARK`）——否则深色模式下会静默沿用浅色值；
3. 标记 `utility: true` 的 token 必须有对应的 `--color-*` 映射（`THEME_MAPPING_MISSING`）——这条正对应历史上的
   `--chart-*` 缺口：`:root` 里定义了 5 个图表变量却没有 `@theme` 映射，`text-chart-1` / `fill-chart-1` 其实并不存在；
4. 每条 `--color-*` 映射引用的 `var()` 必须真的存在（`THEME_MAPPING_DANGLING`），防拼写错误或「删变量不删映射」；
5. `@theme` 里不得出现未登记进注册表的 `--color-*`（`THEME_MAPPING_UNREGISTERED`）；
6. 应用层不得用 Tailwind 原生调色板表达状态语义（`RAW_STATUS_PALETTE`），必须走 `success` / `warning` / `info` /
   `destructive`。装饰性多色调色板（`initial-avatar` 的头像底色、changelog 的分类徽标、admin 的统计卡）在
   `STATUS_PALETTE_ALLOWLIST` 里显式白名单，改白名单要在同一提交里说明理由。

G02 同时补齐了状态语义 token：`--success` / `--warning` / `--info` 各带 `-foreground`，浅色与深色两套取值，
并把 11 个文件里散落的状态提示（`bg-green-500`、`text-amber-600`、`text-emerald-500` …）迁到语义 token。
`--chart-1..5` 补上 `--color-chart-*` 映射以对齐 shadcn 上游；图表组件仍以 `hsl(var(--chart-N))` 消费原始变量，
因为 `@theme inline` 只把值内联进工具类、并不会在运行时输出 `--color-*` 自定义属性，SVG `<stop stopColor>` 拿不到它。

规则实现位于 `src/lib/design/tokens.ts`（纯函数，28 条单测覆盖），IO/CLI 位于 `scripts/lib/design-token-check.js`
（支持传入临时仓库根做反例测试），由 `scripts/check-tokens.js` 经 Node 原生 type stripping 调用；
`pnpm check:all` 与 CI Lint & Type Check job 均会执行。该门禁只证明 token 层自洽，不校验像素结果，
视觉回归仍由 `pnpm test:visual` 负责。

## 共享表单字段门禁（G03）

`pnpm check:fields` 把「字段四件套只有一套接线」变成可持续约束。`FormField` 通过 context 同时提供
`htmlFor` / `id` / `aria-describedby` / `aria-invalid`，`FormFieldControl` 再把它们注入子控件；描述与错误
文本有稳定 id，错误以 `role="alert"` 播报。原生下拉统一下沉到 `NativeSelect`，控件外观类名不再抄进业务表单。

门禁规则实现位于 `src/lib/ui/form-field-rules.ts`（纯函数），扫描 `src/app` 与 `src/components` 下的非测试
`.tsx`，三类规则码分别是：

1. `RAW_SELECT`：业务文件不得直接写原生 `<select>`，使用 `NativeSelect` 才能共享 disabled / focus 态；
2. `RAW_CONTROL_CLASSES`：业务文件不得复制 `border-input bg-background px-3 py-2 text-sm` 这类控件类名长串；
3. `DIRECT_LABEL_IMPORT`：业务文件不得直接 `import "@/components/ui/label"`，标签统一经 `FormField` /
   `FormFieldLabel`，由字段上下文注入 `htmlFor`，避免 label 与控件 id 对不上。

`src/components/ui/**` 是上游 shadcn 基元，不参与扫描；`native-select.tsx` 与 `form-field.tsx` 只豁免各自职责
对应的规则，其他规则仍会被检查。IO/CLI 位于 `scripts/lib/form-field-check.js`，由 `scripts/check-fields.js`
经 Node 原生 type stripping 调用，`pnpm check:all` 与 CI 均会执行。该门禁只证明静态写法合规，运行时 ARIA
行为由 `form-field.test.tsx` / `native-select.test.tsx` 覆盖，不能替代浏览器级键盘与 a11y 回归。

## 共享状态门禁（G04）

`pnpm check:states` 把「加载 / 空 / 错误三种状态各自只有一个落脚点」变成可持续约束。三种语义分别对应
`src/components/shared/page-loading.tsx`（`PageLoading` / `LoadingIndicator`，容器带 `aria-busy="true"`、
骨架内嵌 `role="status"` 的 `sr-only` 文案并走 next-intl）、`src/components/shared/empty-state.tsx`
（`EmptyState`）与 `src/components/shared/error-state.tsx`（`ErrorState`，默认 `role="alert"`）。

门禁规则实现位于 `src/lib/ui/state-rules.ts`（纯函数），扫描 `src/app` 与 `src/components` 下的非测试
`.tsx`，四类规则码分别是：

1. `RAW_ROUTE_SKELETON`：每个 `src/app/**/loading.tsx` 必须渲染共享 `PageLoading`，手写 `Skeleton` 会重新丢掉
   `aria-busy` / `role="status"`；
2. `LEGACY_LOADER_MODULE`：G04 删除的重复加载组件 `page-loader.tsx` / `loading-state.tsx` 不得重新出现；
3. `RAW_SPINNER`：`animate-spin` 只允许出现在白名单（加载原语自身与 `confirm-dialog` 的按钮内联 spinner），
   其余场景走 `LoadingIndicator`；
4. `BARE_PLACEHOLDER`：不得再写「居中（`text-center`）+ 固定纵向内边距（`py-6/8/10/12/16`）」的裸占位符，
   空态走 `EmptyState`、错误走 `ErrorState`。

`src/components/ui/**` 是上游 shadcn 基元，不参与扫描；`EmptyState` / `ErrorState` 只豁免第 4 条规则（它们
本身就是裸占位符的唯一落脚点）。IO/CLI 位于 `scripts/lib/state-check.js`，由 `scripts/check-states.js` 经 Node
原生 type stripping 调用，`pnpm check:all` 与 CI 均会执行。该门禁只证明静态写法合规，运行时 ARIA 行为由
`page-loading.test.tsx` / `empty-state.test.tsx` / `error-state.test.tsx` / `query-error-state.test.tsx` 覆盖，
不能替代浏览器级视觉回归。

## 迁移漂移门禁（H09）

`pnpm check:migrations` 是离线门禁：校验 `supabase/migrations/` 的文件命名、编号连续性与无重复、空文件、UTF-8 BOM、CRLF 行尾、结尾换行，并把每个文件的 SHA-256 与提交在 `supabase/migration-manifest.json` 的基线比对。规则实现位于 `src/lib/migrations/migration-drift.ts`（纯函数，单测覆盖），由 `scripts/check-migrations.js` 经 Node 原生 type stripping 包装成 CLI，`pnpm check:all` 与 CI 的 Lint & Type Check job 均会执行。

关键约束：**已建立基线的迁移不可改写**。新增迁移后执行 `pnpm update:migrations-manifest` 做仅追加的重新定基线；如果改动已基线化文件的内容，更新命令会拒绝并提示补充新的前向迁移，从而避免用“重跑基线”掩盖历史被篡改。

`pnpm check:migration-history` 是本地数据库历史门禁：读取 `supabase migration list --local --output-format json`，对未应用到数据库的迁移（`HISTORY_MIGRATION_PENDING`）和只存在于数据库的版本（`HISTORY_VERSION_MISSING_LOCAL`）报错。它只读本地 Supabase，需要先 `supabase start`，因此**不纳入** `check:all`/CI 的离线聚合；linked/production 历史校验属于发布步骤，需显式凭据与审批，见发布 Runbook。

## 依赖与 secrets 扫描门禁（H10）

`pnpm check:security` 是仓库级安全配置门禁：读取 git 索引并拒绝被跟踪的 `.env*`（`.env.example` 除外）和私钥类文件；检查已有环境文件权限不得宽于 `0600`；拒绝 `.env.development` 中的服务端密钥；扫描带真实 `"use client"` 指令的源码，拦截 `process.env.X` / `process.env["X"]` 形式的服务端变量泄漏（包含 `RESEND_API_KEY`、`VAPID_PRIVATE_KEY`）；要求所有 workflow 显式声明 permissions 且禁止 `write-all`。

除静态仓库检查外，它还会校验 `secrets-scan.yml`、`security-config.yml`、`codeql.yml` 和 `dependabot.yml` 的关键扫描配置没有漂移，包括 PR/main/develop 触发、gitleaks/codeql action 版本、full git history、只读权限、定时依赖审计、security-extended 查询和 Dependabot 的 npm/GitHub Actions 跟踪。依赖审计读取 `pnpm audit --json`，high/critical 任一大于 0 即失败；输入缺失、不可读或 JSON 形状异常时 fail-closed。

规则实现位于 `src/lib/security/security-config.ts`（纯函数），IO/CLI 位于 `scripts/lib/security-config-check.js`，由 `scripts/check-security-config.js` 经 Node 原生 type stripping 调用。专项测试 54 条覆盖策略函数与 CLI 退出码；`pnpm check:all`、CI Lint & Type Check job 和独立的 `Security and configuration checks` workflow 均会执行。该门禁只证明当前工作树和扫描配置满足策略，不替代 gitleaks 对历史提交的扫描，也不证明历史中不存在已泄露密钥。
