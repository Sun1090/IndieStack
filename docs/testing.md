# 测试指南

> 项目测试体系总览。写代码前先读本文，选对测试层级。

## 测试金字塔

```
      E2E（Playwright）                 ← 关键路径冒烟
    ┌──────────────────────────┐
   │ 组件测试（jsdom + Testing Library）│ ← 交互组件
  │──────────────────────────────│
 │ 单元测试（Vitest node 环境）        │ ← actions/工具/守卫
└────────────────────────────────┘
```

本文**不写用例条数**（也包括「某个规则文件有多少条单测」这类局部计数）：条数每加一次测试就会变，写进文档就一定追不上——README 的 `pnpm test` 行写下时是
准确的（进度日志里记着当天的 106 文件 / 1,034 用例），之后用例翻了一倍，它就一直是旧的。当前数量以
`pnpm test` 与 `pnpm exec playwright test --list` 的输出为准。

## 命令

| 命令                                 | 说明                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------- |
| `pnpm test`                          | 全部单元+组件测试                                                               |
| `pnpm test:coverage`                 | 含覆盖率报告（核心逻辑阈值见下方「覆盖率门禁」）                                   |
| `pnpm test:e2e`                      | Playwright 冒烟（自动起 Mock dev server）                                       |
| `pnpm test:visual`                   | 对比 Linux Chromium 视觉基线（CI 自动执行）                                     |
| `pnpm test:visual:update`            | 在 Linux 容器中更新视觉基线，不从 macOS 直接生成                                |
| `pnpm smoke:supabase-identity`       | 本地/staging Supabase 真实身份矩阵（anon/authenticated/service_role + Storage） |
| `pnpm verify`                        | check（类型/lint/i18n/rls/a11y/agents/docs）+ test + bundle 门禁                |
| `pnpm check:production-smoke`       | 校验 Production Smoke workflow 的手动/定时入口、URL、cron、证据留存契约，以及「读 inputs 的手动作业必须排除 schedule 触发」与两个作业各自的 artifact 名 |
| `pnpm check:query-columns`         | 校验查询链里每个字面量列名都存在于生成的行类型中（C07）                          |
| `pnpm check:query-errors`          | 校验 awaited 查询结果没有被断言抹掉 `error` 通道；债务台账按文件按数量对账（C08） |
| `pnpm check:all` / `pnpm verify:all` | 上述全部校验聚合入口（两个命令同义）                                            |

## 贡献者测试矩阵（I09）

按改动领域选最小门禁集，见 [docs-site/testing.md](../docs-site/testing.md)（中文版
[docs-site/zh-CN/testing.md](../docs-site/zh-CN/testing.md)）：11 个领域（UI、Server Actions、Route Handlers、
认证 MFA、数据库迁移、RLS 安全、多语言、Provider、Mock、CI 脚本、文档）各自列出覆盖路径与必须运行的门禁。
矩阵的单一事实源是 `src/lib/testing/test-matrix.ts`，`pnpm check:test-matrix` 校验两份文档登记了全部领域、
每条命令都写在该领域行内、引用的 `pnpm <script>` 真实存在于 `package.json`，并在 IO 层确认覆盖路径仍存在；
抽取为空时失败封闭。改动跨越多个领域时取并集，拿不准就跑 `pnpm check:all`。

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

`src/lib/**`（除 mock/stripe/supabase 客户端胶水层）的阈值只写在 `vitest.config.ts` 的
`coverage.thresholds` 里，CI 用 `pnpm test:coverage` 强制（不达标即非零退出）。本文不复述这四个数字——
调阈值只需要改配置，文档跟着改只会多一处会过期的地方；当前值看 `vitest.config.ts` 或门禁输出。

## E2E

- 运行于 Mock 模式（`NEXT_PUBLIC_MOCK_ENABLED=true`），无需真实 Supabase
- 默认单 worker 串行、一台 dev server，避免多个 spec 通过同一份可变 Mock 状态互相清理/覆盖
- **全量并行的可复跑基线**：`.github/workflows/e2e-parallel.yml`（手动 `workflow_dispatch` +
  每周一 07:30 UTC 定时，`30 7 * * 1`）跑**全量**（不带 `--shard`），条件是
  `PW_FULLY_PARALLEL=true` + `E2E_SERVERS=3`：config 按这个数起**同样多**的 dev server，`workers`
  也取它，于是一个 worker 一台服务器。这不是退让而是首跑量出来的结论——默认 store 是**进程级**的
  （`docs/architecture/13-mock-system.md`），「一台服务器上开多 worker」的首跑
  （run `35727094401`）红了 4 条，逐条归因见 `docs/roadmap-0.12.0.md` 的 C02；而把运行时默认 store
  改成请求级会重演 v0.5.0 的「Action 写进去、RSC 读不到」，所以禁止。
  其中 `e2e/mail-flow.spec.ts` 那条最反直觉：清理写在文件顶层的 `beforeAll`/`beforeEach`，而
  `fullyParallel` 下这类钩子是**每个 worker 各跑一次**，不是每个文件一次——同文件三条用例被拆到
  不同 worker 后互相删对方的数据，它既是受害者也是加害者。把用例拆开不会让文件级清理获得文件级作用域。
  基线强制 `--retries=0`：CI 默认 `retries: 2`，而重跑会换 `workerIndex`、也就是换一台干净的服务器，
  「第二次成功」测的已经不是同一份状态。
  **它是测量，不是门禁**：不在必需检查里、`ci.yml` 也不依赖它，红了的含义是「按报告记下哪一份共享状态
  在冲突」，而不是「这个 PR 不能合」。默认 CI 的 `[1, 2]` shard 各自独立 dev server、内部单 worker，
  测的是分片是否正确，**测不出**并发冲突，两者互补，不能互相替代。
  `src/lib/testing/e2e-shard-policy.test.ts` 钉住：全量（无 `--shard`）、`workers` 等于服务器数、
  不接 `pull_request`/`push`、报告即使通过也留档、artifact 名字全局唯一（#68 的教训：两个作业写同一个
  名字，后跑的把先跑的悄悄盖掉，「证据」就变成另一件事了），以及下面那条地址约定。
  共享状态清零后又红过两轮（106/107、105/107），三条各不相同，共同点只是「第一个打到某台服务器的
  用例」在付冷编译——`globalSetup`（`e2e/support/warm-up.ts`）先替每台服务器 GET 一遍关键路由，
  第三轮 107/107 全绿。**并行的红要先分诊是「状态」还是「计时」再动手**，两者都不需要放宽断言。
- **`next dev` 是按路由冷编译的**：并行基线里每个 worker 一台新服务器，第一个用例替整台服务器付这个钱；
  预热把它挪到 `globalSetup`，串行模式不预热（`E2E_SERVERS>1` 才生效）。同理，`pnpm lint` 必须忽略
  `.next-e2e-*/**`——那是 Next 生成的 chunk 目录，否则跑过一次并行，lint 就永久红。
- **本机跑 E2E 前先确认端口空闲**：Playwright 只在 `webServer.url` 真能应答时才复用已有 server；
  端口被别的项目占着且应答不了时，它会试图自启、以 `EADDRINUSE` 退出，而**一条用例都没跑**。
  外层 shell 仍可能报 0——判定「跑过了」的依据是输出里的用例数，不是退出码。
  被占用时换基准端口即可：`E2E_BASE_PORT=3101 pnpm test:e2e`。
- **E2E 里的应用地址一律走 `appUrl()`（`e2e/support/base-url.ts`）**：它按 `TEST_WORKER_INDEX` 选端口，
  所以第二个 worker 打到自己那台服务器上。写死 `localhost:3100`、或者用裸相对路径 `page.goto("/x")`
  借 `baseURL` 解析，都会把并发的 worker 全指回 slot 0，隔离只剩形式。**「相对」不必是字面量**——
  `page.goto(pageInfo.path)` 与 `request.get("/api/health")` 同样落在 `baseURL` 上，却躲得过按字面量写的
  规则（这两类真实存在过，见 2026-09-23 那条修复），所以门禁是**逐行看调用点**：`page.goto(` 与
  `request.get|post|put|delete(` 后面必须出现 `appUrl()`。与端口无关的 glob
  （`waitForURL("**/dashboard")`、`page.route("**/api/...")`）仍然写相对形式。
- **组件级用例会把 mock 客户端的缺口藏起来**：`src/app/auth/mfa/page.test.tsx` 桩掉整个 Supabase client，
  `auth.refreshSession` 在 mock 里不存在这件事它看不见——只有真跑 mock 客户端的 E2E 撞得到（C03 就是这样
  发现「验证码对了、页面报通用登录失败」的）。所以认证链路的用例要两层都有：组件层管交互分支，
  E2E 管「mock 客户端到底有没有这个方法」。这条约束由 `src/lib/mock/auth-surface.test.ts` 兜底：
  它扫全仓库的 `<client>.auth.<路径>(` 调用点，逐个对回 mock 客户端的真实对象形状，缺一段就点名到文件；
  带理由的豁免放在 `KNOWN_GAPS`，并有反向断言——补上实现却不删豁免同样会红。
- CI 使用 **Playwright shard 隔离并行**：`E2E (Playwright)` job 的 `[1, 2]` matrix 各自启动独立 dev server，
  在 job 内继续单 worker；因此跨 shard 不共享 Mock 状态，全部 E2E 由两个 job 分担（具体条数由
  `--shard` 在运行时划分，随用例增减），而不是在同一条进程里提高 worker 数。视觉基线必须单 worker，
  不做 shard，只在 shard 1 运行一次。
- 上述策略由 `src/lib/testing/e2e-shard-policy.test.ts` 读取 workflow/config 做回归；如果移除 shard、把
  `PW_FULLY_PARALLEL` 改成默认开启，或让两个 job 上传同名 artifact，Vitest 会失败。
- E2E 跑在 `next dev` 上：首屏 HTML 服务端就渲染好了，但 React 要等冷编译 + hydration 才挂上事件监听。
  此时 `toBeVisible()` 早已通过，点下去却因监听器还不存在被**静默丢弃**——症状是"断言超时、DOM 完整、
  控制台零报错"，很容易被误判成产品 Bug。所以依赖客户端事件的用例必须重试「动作 + 断言」整体，而不是
  只重试断言（`e2e/keyboard.spec.ts` 的 `retry()`、`e2e/theme.spec.ts` 的 `toggleThemeTo()` 都是这个形状）；
  对「切换」型按钮，每一轮重试要先读当前状态再决定点不点，否则第二次点击会把已经切好的值翻回去。
  本机复现：CDP `Emulation.setCPUThrottlingRate`（`rate: 25`）后 reload 并立刻点击，慢 runner 上必现。
- 新页面至少加一条"可渲染"断言到 `e2e/smoke.spec.ts`
- 安全头、trace-id、CSP nonce 断言集中在「安全与容错」组
- `e2e/a11y.spec.ts` 使用 `@axe-core/playwright` 对首页、功能页、定价页、登录页、注册页执行 WCAG 2.1 A/AA 自动审计；新增或修改公共页面时必须同步评估覆盖范围
- 语言切换同时覆盖 Cookie 持久化与键盘操作：Tab 聚焦触发按钮、Enter 打开菜单、`aria-current` 标识当前语言、Escape 关闭并归还焦点
- `e2e/retention.spec.ts` 只打 `/api/cron/retention` 的**入口**：401 归因、错误 secret 不回显、
  带凭据时路由可达且响应只有脱敏计数。它证明部署里没有 404——`check:cron-contract` 能证明文件存在、
  已调度、指标接线，但看不见运行时 404。mock 模式不执行 SQL，所以本文件不证明过期行真被删掉
- 通知 Realtime 的 Mock 测试在服务端 seed 后派发 `indiestack:mock-realtime` 事件；测试覆盖 event/schema/table/user filter 契约、合并刷新和无需 reload 的 UI 更新
- Push 持久化重试链路由 `e2e/push-retry.spec.ts` 驱动真实 `/api/cron/push-retry`：mock 模式下
  `src/lib/mock/push-transport.ts` 只替换 `web-push` 的底层 HTTP 传输（保留端点 `/ok`、`/transient`、
  `/timeout`、`/gone`），适配器契约与错误映射仍走真实代码；种子数据由 mock-only 的
  `/api/e2e/push-queue` 端点写入。它不是真实 push service 验证。

## 视觉回归

`e2e-visual/visual.spec.ts` 对首页、功能页、定价页和登录页执行桌面端全页截图，与
`e2e-visual/visual.spec.ts-snapshots/` 中的 Linux Chromium PNG 对比。CI 在常规 E2E
之后自动运行 `pnpm test:visual`，像素差异门禁为 0.1%。

**基线只能由 CI 那个 runner 自己产出**，不要在 macOS 直接运行 `--update-snapshots`
（会生成 `-darwin.png` 并「通过」，那是自造证据）。

也不要以为 `mcr.microsoft.com/playwright` 容器等价于 CI：CI 的视觉步骤跑在
`ubuntu-latest` 宿主机上（`actions/setup-node` + `playwright install`），**不在该容器里**。
两者的 FreeType 子像素抗锯齿设置不同，实测同一份代码在容器与 runner 下每个字形边缘
都会差 1 个通道，定价页一次就累计 16353 px（约 1.0%），超过 0.1% 的像素阈值而失败——
而容器内部自己比对永远是 4/4，看不出问题。

正确流程：改动会影响像素时，先推分支让 CI 跑一次，从失败 job 的
`playwright-report-shard-1` artifact 里取 `test-results/**/<name>-actual.png`
（那就是 runner 对本次代码的渲染），存成 `e2e-visual/visual.spec.ts-snapshots/<name>-chromium-visual-linux.png`
再提交。容器命令可以保留作**本地冒烟**（确认页面能渲染、没有布局崩塌），但不能当作基线来源：

```bash
docker run --rm --ipc=host --platform linux/amd64 \
  -v "$PWD":/work -w /work \
  -v indiestack-visual-node-modules:/work/node_modules \
  -v indiestack-visual-next:/work/.next \
  mcr.microsoft.com/playwright:v1.63.0-noble \
  bash -lc 'corepack enable && pnpm install --frozen-lockfile && pnpm test:visual'
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
pnpm exec supabase db reset        # 全部迁移 + supabase/seed.sql
pnpm smoke:supabase-identity -- --output /tmp/indiestack-identity-matrix.json
```

- 只有在本地/staging 才运行：seed 账号密码是公开固定值。
- 可用 `--url` / `--anon-key` / `--service-role-key` 覆盖目标（例如受控 staging）。
- 脚本结束时清理自己创建的临时对象；失败项会在 JSON 的 `checks[].passed=false` 中列出。
- 覆盖范围与局限见 [db/security-audit.md](./db/security-audit.md)。

## CI 门禁

push/PR 触发以下关卡：`Lint & Type Check`（一道 `pnpm check:all`：lint / type-check / 单测与全部
i18n/RLS/工作流等静态门禁）· `Unit Tests`（覆盖率门禁）·
`Build` · `Build Docs Site` · `E2E (Playwright)`（`[1, 2]` shard）· `CodeQL` · `Secrets Scan` ·
`Security and configuration checks`。任何一道失败即阻塞合并。

### 并行与缓存拓扑（J03）

`ci.yml` 按「廉价门禁先失败、昂贵作业并行」分层，改动这层结构等于改动 CI 的墙钟时间与失败代价：

- **静态门禁只有一份清单**（C04）：`Lint & Type Check` job 跑的是 `pnpm check:all`，而不是逐个
  `check:*` 步骤。过去本地聚合与 CI 是两份各自手工维护的清单，仓库里确实出现过「只在本地」或
  「只在 CI」的门禁。这件事**不能**交给 `check:gates` 把关：它按「任意 workflow」判定接线，
  而 `release.yml` 也跑聚合——把 `pnpm check:all` 从 `ci.yml` 删掉，它仍然全绿，PR 上却一道门禁都不跑
  （变异核对量出来的）。约束因此落在 CI 拓扑门禁上：静态作业正文里必须出现 `pnpm check:all`，
  删掉即 `CI_TOPOLOGY_DRIFT`，逐个写 `check:*` 不算替代。代价两条：CI 界面少了一层「哪一步红了」，
  靠 `check-all.sh` 每步前的 `==> <门禁>` 与出错时的 `❌ 门禁失败：<命令>` 找回来；
  单测在本 job 与 `Unit Tests`（覆盖率）各跑一次，多花约一分钟，换两处的判定完全同源；
- `Lint & Type Check` 与 `Unit Tests` 都**没有前置依赖**，因此 lint/type-check/`check:*` 与
  `pnpm test:coverage` 同时开跑；覆盖率不再排在静态门禁后面；
- `Build` 与 `E2E (Playwright)` 的 `needs` **只**指向 `Lint & Type Check`：静态门禁一绿就开始构建与 E2E，
  不会为一次覆盖率运行再多等一两分钟；
- `E2E` 用 `actions/cache` 缓存 `~/.cache/ms-playwright`，键为
  `playwright-<runner.os>-<hashFiles('pnpm-lock.yaml')>`：Playwright 版本随锁文件变化即自动失效，
  `playwright install --with-deps` 仍会补齐系统依赖，缓存只省去重复下载浏览器；
- 触发 `pull_request` 的工作流声明 `concurrency` + `cancel-in-progress`，同一分支连续推送时旧运行立即取消；
  main/develop 的 push 与 schedule 事件不取消，扫描结果始终保留。

这些约束由 `pnpm check:workflows` 与 `src/lib/ci/workflow-policy.test.ts` 双重回归：每个作业必须有
`runs-on` / `timeout-minutes`，每个 `uses:` 必须固定在 semver 标签或 40 位 SHA（`@main` / `@latest` 直接失败），
`needs` 必须指向真实作业，触发 PR 的工作流必须声明非 `false` 的 `cancel-in-progress`，
`pull_request_target` 禁止使用，工作流里出现的 `pnpm <a:b>` 脚本必须真实存在于 `package.json`，
且上述并行/缓存拓扑必须与契约一致。

### CodeQL 扫描强度与告警处置（J04）

`CodeQL` 工作流决定「告警零回归」是否成立，因此它的配置与处置流程都进了门禁：

- `pnpm check:codeql` 校验 `.github/workflows/codeql.yml` 的扫描强度：`init` / `analyze` 必须同时存在且固定在
  `github/codeql-action@v4`、语言覆盖 `javascript-typescript`、查询套件保持 `security-extended`、
  SARIF `category` 不漂移、`security-events: write` 与 `timeout-minutes` 都在、`push` 覆盖 `main`/`develop`、
  `pull_request` 覆盖 `main`、`schedule` 仍是每周一一次（退化成每日会失败）；
- `paths` / `paths-ignore` 只从 `push` / `pull_request` 触发块读取：`paths-ignore` 默认不允许排除任何路径
  （契约登记之外一律失败），`paths` 白名单不得漏掉 `src` / `scripts` / `e2e` / `supabase`；
- 同一门禁还校验告警处置 runbook [operations/codeql-alert-triage.md](./operations/codeql-alert-triage.md) 存在、
  章节完整，且套件名、阻断严重度阈值（`security-severity >= 7.0`）、分诊 SLA（5 个工作日）与三个允许的
  dismissal 理由（`false positive` / `won't fix` / `used in tests`）与契约同源——改工作流不改文档即失败；
- 规则本体是纯函数（`src/lib/security/codeql-alert-policy.ts`），由
  `src/lib/security/codeql-alert-policy.test.ts` 覆盖，并用真实仓库文件断言零问题。

**局限**：真实告警列表、与基线分支的差异、dismissal 记录都在 GitHub 侧，需要 `security-events: read`
权限（见 runbook 的「外部依赖」），本地无法复现；本门禁只防止扫描强度与处置策略静默漂移。

### Secrets Scan 扫描强度与泄漏处置（J05）

`Secrets Scan` 工作流决定密钥是否能在进入历史前被发现，因此扫描强度、allowlist 与响应流程都进了门禁：

- `pnpm check:secrets-scan` 校验 `.github/workflows/secrets-scan.yml`：`gitleaks/gitleaks-action` 固定在
  `v3`，`checkout` 必须使用 `fetch-depth: 0`（只扫最新提交会漏掉历史泄漏），作业有 `timeout-minutes`，
  `GITHUB_TOKEN` 确实接线且只声明 `contents: read`，任何 `: write` 权限都失败；
- `push` 必须覆盖 `main` / `develop`，`pull_request` 触发保留；自定义 gitleaks 配置只能指向
  `.gitleaks.toml`，配置路径漂移即失败；
- 当 `.gitleaks.toml` 存在时，`[allowlist]` / `[[allowlists]]` 下的每条 `paths` / `regexes` / `stopwords` /
  `commits` 都必须登记在 `SECRETS_SCAN_CONTRACT.allowedAllowlistEntries`（默认空）；用宽泛目录或正则
  静默扩大排除范围会直接阻断 CI；
- 同一门禁还校验泄漏响应 runbook
  [operations/secrets-leak-response-runbook.md](./operations/secrets-leak-response-runbook.md) 存在、章节完整，
  且首次响应 `10 分钟`、凭据轮换 `24 小时`、全历史 `fetch-depth: 0`、允许的 `false positive` /
  `used in tests` allowlist 理由与契约同源——改工作流或契约不改 runbook 即失败；
- 规则本体是纯函数（`src/lib/security/secrets-scan-policy.ts`），由
  `src/lib/security/secrets-scan-policy.test.ts` 覆盖，并用真实仓库工作流与 runbook 断言零问题。

**局限**：真实历史扫描结果与 GitHub 告警状态由 gitleaks 在 runner / GitHub 侧产生，需要推送与环境权限；
本地门禁只防止扫描强度、allowlist 和处置策略静默漂移。

### 发布标签与 Release Notes 自动化（J07）

`.github/workflows/release.yml` 是 `v*` 标签进入 GitHub Release 的唯一入口。`pnpm check:release-tag` 把它
固化为可执行契约，避免「标签推了但 CHANGELOG 没写」或绕过人工审核的自动 notes：

- 标签必须是 `v<package.json version>`，且版本严格为 `x.y.z`；标签与包版本不一致直接失败；
- `CHANGELOG.md` 必须存在同版本的已发布章节，章节必须有合法 `YYYY-MM-DD` 日期和非空正文；
- 校验通过时用 `--notes-output` 将对应 CHANGELOG 正文写成 Release Notes 文件；工作流再用
  `gh release create --notes-file` 发布。`--generate-notes` 被明确禁止；
- workflow 必须由 `v*` 标签触发、保留 `contents: write`、`fetch-depth: 0` 与 `timeout-minutes`，并在创建
  Release 前执行 `pnpm install --frozen-lockfile`、`pnpm check:all` 和显式带 `--tag "$GITHUB_REF_NAME"`
  的 `pnpm check:release-tag`；
- 规则本体位于 `src/lib/release/release-tag-policy.ts`，IO/CLI 位于
  `scripts/lib/release-tag-check.js` / `scripts/check-release-tag.js`，由 `pnpm check:all` 与 CI 执行。

**局限**：本地门禁验证的是标签、版本、CHANGELOG 与 workflow 的静态一致性，不会创建 tag，也不替代
GitHub 侧 Release 创建结果、发布审批和生产 smoke；这些仍由发布负责人按 release runbook 完成。

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
`check:bundle`（本地需要完整生产构建，由 `pnpm verify:build` 覆盖；CI 的 Build job 在
`pnpm build` 之后直接跑 `node scripts/check-bundle.js`，复用同一份产物，不需要再构建）、
`check:perf`（本地需要 `.next` 产物，CI 由 Build job 执行）。
规则实现位于 `src/lib/release/gate-wiring.ts`（纯函数，单测覆盖），IO/CLI 位于
`scripts/lib/gate-wiring-check.js`，由 `scripts/check-gates.js` 经 Node 原生 type stripping 调用；
`pnpm check:all` 与 CI 的 Lint & Type Check job 均会执行。它只证明门禁被接线，不证明门禁本身的强度。

## Mock 文档一致性门禁（I07）

`pnpm check:mock-docs` 解决的是「Mock 文档没人维护」：Mock 客户端每次扩表、`proxy` 改名、
E2E 端点新增，`docs-site/mock.md`、`docs-site/zh-CN/mock.md` 与
`docs/architecture/13-mock-system.md` 都会悄悄过期。此前三份文档只描述最早的六个表、把缓存
说成「请求级」，并把路由分支写成已随 ADR-007 退役的 `middleware.ts`。

门禁按实现事实做双向校验：

1. 客户端 `switch (this.table)` 的每个表名必须出现在每份文档的「表名清单」里，反之亦然
   → `MOCK_TABLE_UNDOCUMENTED` / `MOCK_TABLE_UNKNOWN`；
2. `src/app/api/e2e/*/route.ts` 的每个端点必须被文档登记，文档不得引用已删除端点
   → `MOCK_ENDPOINT_UNDOCUMENTED` / `MOCK_ENDPOINT_UNKNOWN`；
3. 每份文档必须覆盖开启开关、自动降级边界（`NODE_ENV` + `NEXT_PUBLIC_SUPABASE_URL`）、
   `src/proxy.ts` 接入点、`resetMockCache()` 与 `/api/e2e/mock-reset`、`createMockRequestStore()`
   → `MOCK_REQUIRED_FACT_MISSING`；
4. 已核验为错的旧表述不得回流（`STALE_DOC_CLAIMS`：请求级缓存、路由保护全部失效）
   → `MOCK_STALE_CLAIM`；
5. 抽不到表名/端点/文档时失败封闭 → `MOCK_DOC_SOURCE_EMPTY`。

「表名清单」只认首列表头为 `Table` / `表名` 且数据行首列是行内代码的 markdown 表格，示例代码里的
表名不计入登记。规则实现位于 `src/lib/mock/mock-docs.ts`（纯函数，单测覆盖），IO/CLI 位于
`scripts/lib/mock-docs-check.js`，由 `scripts/check-mock-docs.js` 经 Node 原生 type stripping 调用；
`pnpm check:all` 与 CI 的 Lint & Type Check job 均会执行。它只证明文档与代码的事实一致，
不判断文案质量，也不替代人工复核。

## Provider 配置诊断（I08）

`pnpm check:provider-docs` 解决的是「provider 配置指南与运行时注册表脱节」：新增一个 provider
或环境变量后，`docs-site/provider-diagnostics.md` 与 `docs-site/zh-CN/provider-diagnostics.md`
会悄悄过期，运维照文档配下去仍然起不来。

诊断能力本身是一个纯函数模块 `src/lib/providers/diagnostics.ts`，读取 `process.env`（或注入的
env 对象）产出 `ProviderReport`：

1. 覆盖 9 个 provider：`supabase`（运行时三键 + 可选 `SUPABASE_DB_URL`）、`storage`
   （OSS 四键 → `oss`，全空 → `supabase` fallback，部分配置 → `misconfigured`，mock 模式 → `mock`）、
   `email`（Resend）、`webpush`（VAPID 密钥对）、`appark`（密钥对 + 可选采样率）、`stripe`（五键）、
   `sentry`（DSN 与构建期键）、`supabase-restore`（`SUPABASE_ACCESS_TOKEN` + 可推导或显式的
   `SUPABASE_PROJECT_REF`）、`cron`（`CRON_SECRET`）；
2. 状态机为 `ready` / `disabled` / `degraded` / `misconfigured` / `missing`，逐项给出缺失变量名，
   **从不输出任何凭据值**，只输出 provider id 与变量名；
3. `formatProviderReport()` 渲染人类可读文本，`scripts/lib/provider-doctor.js` 提供 `--json` /
   `--help`，发现阻塞问题时以退出码 1 结束。

文档一致性门禁 `src/lib/providers/provider-docs.ts` 拿 `PROVIDER_REGISTRY` 做双向校验：注册表里
每个 provider id 与每个环境变量都必须出现在两份文档里，文档源为空或抽不到 provider 时失败封闭。
规则码为 `PROVIDER_DOC_SOURCE_EMPTY` / `PROVIDER_DOC_MISSING_PROVIDER` /
`PROVIDER_DOC_MISSING_KEY`。规则实现由 `src/lib/providers/diagnostics.ts` 与
`src/lib/providers/provider-docs.ts` 的单测覆盖，
IO/CLI 位于 `scripts/lib/provider-doctor.js` 与 `scripts/lib/provider-docs-check.js`，
`pnpm check:all` 与 CI 的 Lint & Type Check job 均会执行。文档门禁只证明「文档覆盖了注册表事实」，
不判断文案质量，也不校验真实凭据是否有效。

## Tailwind v4 原生主题门禁（G01）

`pnpm check:tailwind` 把 ADR-013 的「不再有 JS 配置」从一次性迁移变成可持续约束。规则分两层：

1. **仓库结构层**：仓库根不得再出现 `tailwind.config.*`；任何 CSS 不得出现 `@config` 指令（注释里提到不算）；`package.json` 不得重新引入 `tailwindcss-animate`；必须存在 `@theme` 块；每个 `@keyframes` 必须被至少一个 `--animate-*` token 整词认领（`spin-slow` 不会被 `--animate-spin` 认领）。
2. **应用层写法**（`src/**` 去掉 `src/components/ui/**`）：禁用任意值动画 `animate-[...]`（必须先在 `@theme` 登记 token），以及 v4 已更名或改语义的 v3 工具类：`bg-gradient-to-*` → `bg-linear-to-*`、`outline-none` → `outline-hidden`（v4 的 `outline-none` 会连 forced-colors 下的可见轮廓一起移除）、`flex-shrink*` / `flex-grow*` → `shrink-*` / `grow-*`、`overflow-ellipsis` → `text-ellipsis`、`decoration-slice|clone` → `box-decoration-slice|clone`。

`src/components/ui/**` 是 shadcn 上游基元的落点，写法跟随上游版本更新，因此只统计成一条非阻断 warning（收口进度可见，但不会为了改类名手改上游文件）。`shadow` / `rounded` / `blur` 这类「裸名」**不在**禁用列表：本项目 `@theme inline` 把 radius 刻度显式映射回 shadcn 语义，实测 `.rounded` 与 `.rounded-sm` 都解析为 4px，改名只会制造无收益 diff。

规则实现位于 `src/lib/tailwind/native-theme.ts`（纯函数，单测覆盖），IO/CLI 位于 `scripts/lib/tailwind-native-check.js`（支持传入临时仓库根做反例测试），由 `scripts/check-tailwind.js` 经 Node 原生 type stripping 调用；`pnpm check:all` 与 CI Lint & Type Check job 均会执行。该门禁只证明类名与主题写法合规，不替代视觉回归（`pnpm test:visual`）对像素结果的验证。

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

规则实现位于 `src/lib/design/tokens.ts`（纯函数，单测覆盖），IO/CLI 位于 `scripts/lib/design-token-check.js`
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

## 迁移回滚 Runbook（I10）

`pnpm check:migration-runbook` 把数据库迁移的回滚决策从版本发布文档里的散落描述，收敛为一份可执行且可校验的
统一 runbook：[docs/operations/migration-rollback-runbook.md](operations/migration-rollback-runbook.md)。规则实现位于
`src/lib/db/migration-runbook.ts`（纯函数，单测覆盖），IO/CLI 位于 `scripts/lib/migration-runbook-check.js`，由
`scripts/check-migration-runbook.js` 经 Node 原生 type stripping 调用，`pnpm check:all` 与 CI 的
`Lint & Type Check` job 均会执行。

门禁要求 runbook 同时满足四类事实：

1. 必须包含触发条件、决策树、前向修复优先、迁移类型与回滚配方、操作步骤、回滚后验证、权限与审批、演练记录
   八个章节，并明确写出 `SUPABASE_ACCESS_TOKEN`、`SUPABASE_PROJECT_REF` 与「不自动回滚数据库」；
2. 必须用 `<!-- migration-runbook:latest=... -->` 登记当前最新迁移，且与
   `supabase/migration-manifest.json` 的最高版本一致；文档里提到的每个 `NNN_name.sql` 都必须真实存在；
3. 必须给出 `pnpm check:migrations`、`pnpm check:migration-history`、`pnpm update:migrations-manifest`
   三条操作命令，且文档内引用的每个 `pnpm <script>` 都必须真实存在（常用 pnpm 内置命令除外）；
4. runbook 或迁移清单为空时失败封闭，避免正则失效或清单缺失被误判为通过。

该门禁验证的是 runbook 与仓库事实一致，**不替代真实恢复演练**。生产数据库逆向操作与备份恢复仍需 DBA、发布负责人
和可用快照；自动化只负责阻止文档悄悄过期。

## 查询列名一致性门禁（C07）

`pnpm check:query-columns` 校验代码里每一个字面量列名都存在于 `src/lib/supabase/database.types.ts` 的 `Row` 类型里。
动机是一个真实缺陷：`src/app/api/e2e/email-worker-runs/route.ts` 一直按 `.order("started_at", …)` 排序，而
`email_worker_runs` 从建表（迁移 017）起就没有这一列，只有 `created_at`。它之所以能活这么久：类型系统只约束查询
**结果**，过滤与排序参数在类型上只是字符串；单测里查询链是 mock 的；Mock 客户端的 `order()` 对未知列静默 no-op。
于是「拼错的列名」成为唯一一类没有任何自动化保护的数据库缺陷——只有打上真库才会变成 400。

规则实现位于 `src/lib/db/query-columns.ts`（TypeScript AST、纯函数、单测覆盖），IO/CLI 位于
`scripts/lib/query-columns-check.js` 与 `scripts/check-query-columns.js`，`pnpm check:all` 与 CI 均会执行。

判定范围刻意收窄，但**每一处收窄都计数并随结果打印**，所以「范围本来就窄」和「范围被调空」在输出里一眼可分：

- 只判断 `.from("<表名>")` 的字面量表名、且该表（或视图）出现在生成类型里的链；名字不在类型里报
  `QUERY_TABLE_UNKNOWN`。视图与表一样按读侧寻址，所以 `Views` 的 `Row` 同样算合法列集合；`Row` 展开不出任何列的
  关系（例如写成 `Record<string, never>`）直接丢掉，而不是把它的每一列都判成错误。
- 只判断 `eq/neq/gt/gte/lt/lte/is/in/like/ilike/order` 的首参与 `select` 列表里的**纯标识符**。`*`、
  `metadata->>role`、`amount::text`、`count()` 这类 PostgREST 寻址方式在行类型里本就不存在，跳过并计入
  `skippedArguments`。
- `select("alias:column")` 判断的是冒号右边的真实列，别名不能用来藏拼写错误。
- 含关联嵌入的链（`select("id, profiles:user_id (email)")`）整条跳过：一旦展平关联，基表 `Row` 就不再是合法寻址集合。
- `client.storage.from("avatars")` 是桶不是表，即便桶名与表名同名也不参与判断。
- 读不出任何表报 `QUERY_TYPES_UNREADABLE`，一条列名都没判断报 `QUERY_COLUMN_GATE_VACUOUS`。收窄范围可以，
  把范围调空后报绿不行。

`.filter()` / `.or()` 与 `insert`/`update` 的 payload 键不在门禁内：前者的参数是一门小表达式语言（`and(col.eq.x)`），
后者由生成的行类型直接约束。

## 查询错误通道门禁（C08）

`pnpm check:query-errors` 校验**没有任何一处 awaited 的 Supabase 查询结果被断言成不含 `error` 的类型**。
动机是本仓库连续修过的同一类缺陷：查询结果是 `{ data, error, count }`，而

```ts
const { data: profile } = (await supabase
  .from("profiles")
  .select("role")
  .eq("id", user.id)
  .single()) as { data: { role: string } | null };
```

不只是「关掉了告警」，它断言了「这一行不可能有 error」。于是下面的代码可以放心地把**读失败**当成
**查不到这一行**来回答：`src/lib/auth/guards.ts` 在一次数据库抖动后把管理员降级成 `member`，
`src/lib/actions/admin.ts` 对一次根本没跑完的查询回答「用户不存在」，日志里什么都没有——
看起来是用户在撒谎，系统很健康。类型系统拦不住它，因为断言本来就比推断更权威。

规则实现位于 `src/lib/security/query-error-channel.ts`（TypeScript AST、纯函数、单测覆盖），IO/CLI 位于
`scripts/lib/query-error-channel-check.js` 与 `scripts/check-query-error-channel.js`，`pnpm check:all` 与 CI 均会执行。

判定范围与它的自我证明：

- 只判断**外层** `as`，且括号与 `as unknown` 会被穿透（`x as unknown as T` 是一处而不是两处）；
  被断言的东西必须是 `await` 下来的 `.from()` / `.rpc()` 链结果。未 await 的构造器断言
  （`const query = admin.from("x").select(...) as unknown as FilterChain`）是给 builder 定形状，不在射程内。
- 断言类型里仍带 `error:` 的写法合规——门禁要的是「错误通道还在」，不是某种特定写法。
- `ERROR_CHANNEL_EXEMPTIONS` 是**按文件计数**的台账，两种条目含义不同：`justified`（客户端组件
  `permission-gate.tsx`，读角色失败时故意回落到最低权限，客户端无法 5xx）与 `debt (C08-b)`
  （代码确实在撒谎，等待按影响面从大到小偿还）。台账**双向对账**：新增一处抹除报错，
  修好一处不改数字也报错（`QUERY_ERROR_CHANNEL_EXEMPT_STALE`），所以它不会悄悄长胖，也不会悄悄烂成永久豁免表。
- 语法树不完整的文件报 `QUERY_ERROR_CHANNEL_PARSE` 而不是安静地贡献 0 处——解析不动的文件在门禁眼里
  不存在，是最坏的一种「绿」。这条是被自己的测试 fixture 证出来的：`as` 换行会被 ASI 截断成语法错误。
- 扫不到文件报 `QUERY_ERROR_CHANNEL_NO_SOURCES`，文件全空报 `QUERY_ERROR_CHANNEL_SOURCE_EMPTY`，
  扫到了文件却一处 awaited 查询结果都没判到报 `QUERY_ERROR_CHANNEL_VACUOUS`。

规模**不在这里抄数字**——台账会随清偿一处处变小，把计数抄进文档就是造一条会过期的断言（v0.12.0 D04）。
现量用 `node --experimental-strip-types scripts/lib/query-error-channel-check.js`（输出即「文件数 / awaited
断言数 / 台账数」），逐条债务读 `src/lib/security/query-error-channel.ts` 里的 `ERROR_CHANNEL_EXEMPTIONS`，
每条都写明「这一处把读失败答成了什么事实」；清偿顺序与已完成部分写在 roadmap C08-b。
门禁先落地是为了**止住新增**，不是为了宣称问题已清完。

**不在门禁内**：解构时压根不取 `error`（`const { data } = await supabase.from(...)`，接线时实测有一批，
清单记在 `docs/progress.md` 的 C08 条目里）与 `.single()` 的「零行即错误」语义。前者不看断言就看不到，
是本门禁的邻居而非子集；后者由调用方的 `error` 处理决定，属于 Code Reviewer 的检查项。

邻居那条（C08-c）**已经能量，但还不是门禁**：

```bash
node --no-warnings --experimental-strip-types scripts/lib/query-error-channel-check.js --unbound
```

它打印「解构 awaited 查询结果时压根不绑 `error`」的清单，以及因语法诊断被跳过的文件数
（跳过不为 0 时整份报告不可信）。射程内有三种写法：直接一条链、`cond ? await chain : { … }`、
`await Promise.all([chain, …])` 配数组解构（元素上再盖 `as unknown as { data }` 也认）。
还漏的两件事报告页脚会一并打印：`Promise.all` 之外自造的并发 helper（`allSettled` 等）与数组元素里
再套三元，以及「绑了 `error` 却从不使用」那一档**刻意没测**（要作用域分析，全文数同名标识符会把
`catch (error)` 也算进去，是个只会漏报的假指标）。非字面量表名（`.from(TABLE)`）**在**射程内，
只标成 `<非字面量>`。什么时候接进门禁、以及为什么排在清偿之后，写在 roadmap C08-c。

## 依赖与 secrets 扫描门禁（H10）

`pnpm check:security` 是仓库级安全配置门禁：读取 git 索引并拒绝被跟踪的 `.env*`（`.env.example` 除外）和私钥类文件；检查已有环境文件权限不得宽于 `0600`；拒绝 `.env.development` 中的服务端密钥；扫描带真实 `"use client"` 指令的源码，拦截 `process.env.X` / `process.env["X"]` 形式的服务端变量泄漏（包含 `RESEND_API_KEY`、`VAPID_PRIVATE_KEY`）；要求所有 workflow 显式声明 permissions 且禁止 `write-all`。

依赖审计这一段现在会区分两件完全不同的事：`pnpm audit --json` 在注册表请求失败时退出码为 1，并打印
`{"error":{"code":"pnpm","message":"fetch failed"}}`——合法 JSON、只是没有 `metadata`。过去两种情况都报
`report is missing metadata`，于是「网络抖了一下」看起来像「仓库配置坏了」，而正确的响应其实是重跑。
现在前者报 `advisory request failed (code=…, message=…)`，后者把实际拿到的顶层键一并列出。
**两种都仍然失败封闭**：读不到审计结果不等于没有漏洞，也永远不该靠放宽审计强度让它变绿。

除静态仓库检查外，它还会校验 `secrets-scan.yml`、`security-config.yml`、`codeql.yml` 和 `dependabot.yml` 的关键扫描配置没有漂移，包括 PR/main/develop 触发、gitleaks/codeql action 版本、full git history、只读权限、定时依赖审计、security-extended 查询和 Dependabot 的 npm/GitHub Actions 跟踪。依赖审计读取 `pnpm audit --json`，high/critical 任一大于 0 即失败；输入缺失、不可读或 JSON 形状异常时 fail-closed。

规则实现位于 `src/lib/security/security-config.ts`（纯函数），IO/CLI 位于 `scripts/lib/security-config-check.js`，由 `scripts/check-security-config.js` 经 Node 原生 type stripping 调用。专项测试覆盖策略函数与 CLI 退出码：
`src/lib/security/security-config.test.ts`（31 条）与 `security-config-check.test.ts`（5 条）；
`pnpm check:all`、CI Lint & Type Check job 和独立的 `Security and configuration checks` workflow 均会执行。该门禁只证明当前工作树和扫描配置满足策略，不替代 gitleaks 对历史提交的扫描，也不证明历史中不存在已泄露密钥。

## 请求链路追踪覆盖门禁（E02）

`x-request-id` 由 `src/proxy.ts` 生成并注入很容易，难的是它不会随时间退化：新增一个 Server Action
时顺手 `console.error`、新写一个 Route Handler 时直接 `logger.error`，请求关联就会静默丢失，而此前没有任何
门禁能发现。`pnpm check:trace-coverage` 把这条约定固化为可执行规则：

- 服务端边界（`src/app/api` 子树下的 `route.ts` 与 `src/lib/actions/*.ts`）不得使用裸 `console.*`；
- 服务端边界不得直接调用 `logger.error`，错误必须经 `logApiError` / `logActionError` 这两个带 trace 的入口；
  非错误级别的 `logger.warn` / `logger.info` 仍允许直接使用；
- `src/lib/api-log.ts` 必须同时导出两个入口并读取 `getTraceId()`；`getTraceId` 缺失即失败；
- `src/lib/trace-id.ts` 必须保留 `TRACE_HEADER`、`MAX_TRACE_ID_LENGTH`、`normalizeTraceId`、
  `createTraceId`、`resolveTraceId` 五个导出，避免 header 名或归一化语义漂移；
- `src/proxy.ts` 必须用 `resolveTraceId()` 解析上游 ID、把 trace 注入下游请求头，并在放行与重定向分支
  各回写一次响应头；绕过契约直接调用 `crypto.randomUUID()` 或不经 `@/lib/trace-id` 取 header 名都会失败；
- 扫描到的边界文件为空时失败封闭（glob 写错不会被当成零问题），登记豁免的文件如果已不再使用裸日志
  同样失败，避免豁免表掩盖后续漂移。

规则本体位于 `src/lib/observability/trace-coverage.ts`（纯函数），IO/CLI 位于
`scripts/lib/trace-coverage-check.js` / `scripts/check-trace-coverage.js`，由 `pnpm check:all` 与 CI
`Lint & Type Check` job 执行。专项测试 58 条覆盖 trace-id 契约、错误入口、proxy 契约、边界扫描、豁免
过期与真实仓库快照：`src/lib/trace-id.test.ts`（11）、`src/lib/api-log.test.ts`（5）、
`src/lib/trace.test.ts`（3）、`src/lib/observability/trace-coverage.test.ts`（18）、
`src/lib/observability/trace-coverage-check.test.ts`（6），另有 `src/proxy.test.ts`（15，含 7 条既有 CSP
守卫回归与 8 条 trace 注入/回写用例）。

**局限**：门禁只判断错误日志是否走了带 trace 的通道，不判断日志文案质量，也不校验上游调用方是否回传
我们的 trace-id；跨服务串联依赖接入方复用响应头中的 `x-request-id`。

## Cron 调度与指标契约门禁（E03）

`pnpm check:cron-contract` 把 cron worker 的「会不会真的被调用」和「失败时有没有指标」变成可执行契约。
此前 `/api/cron/digest` 的路由、业务测试和文档都存在，但 `vercel.json` 从未登记调度，生产环境每天 09:00 UTC 摘要邮件实际上永远不会启动；
普通单测只覆盖请求进入后的行为，因而完全看不到这类静默失效。

门禁以 `src/lib/observability/cron-contract.ts` 的注册表为单一事实源，校验：

- `vercel.json` 中每个 cron worker 的路径与五字段调度表达式必须逐字匹配注册表，表达式非法、重复或只存在于文档都会失败；
- worker 路由文件必须真实存在，并导出注册表中声明的全部 HTTP 方法；`src/app/api/cron` 下新增但未登记的路由也会失败；
- 每轮运行指标与鉴权拒绝指标必须出现在路由源码中，同时必须**占 `docs/operations/sentry-alerts.md` 指标表的一行**；指标改名但不改告警文档会失败，删掉表行、只在别的表或散文里提一次同样算未登记（`CRON_METRIC_UNDOCUMENTED`）。「必须占一行」这颗牙齿是 2026-09-23 补的：当时一次编辑把 `cron.digest.failed` 的表行整行删掉，而该指标仍出现在调度表与告警规则里，只要求「文档里出现过一次」的门禁全程绿灯；接线前先量过——注册表 16 个指标在真实文档里都有表行，所以收紧之后当前仓库仍然通过，删掉任一行即红；
- **带条件的 `continue` 跳过必须留下计数证据**（A04）：证据可以是上报该 worker 注册的 skip 指标
  （`skipMetrics`，且必须带 `reason` 维度），或累加进本轮返回对象里已上报的计数器；
  两者都没有就报 `CRON_SKIP_UNCOUNTED`。规则用 TypeScript 解析器读源码，只认「同一函数、同一 if 分支」里的证据，
  无法解析的源码按 `CRON_SKIP_UNPARSEABLE` 失败封闭；
- **文档里的调度事实必须能在仓库里找到对应**（D01）：扫描 `docs-site/**` 与 `docs/**`（带日期的快照除外——发布页、runbook、roadmap 记录的是当时的事实，改它们等于伪造证据），抽出合法的 5 字段 cron 表达式与 `/api/cron/*` 路径，逐个对回「worker 注册表 ∪ `vercel.json` ∪ GitHub workflow 的 `schedule`」：文档教一条仓库里不存在的调度报 `CRON_DOC_STALE_SCHEDULE`，提到一条没人调度的路由报 `CRON_DOC_UNREGISTERED_PATH`（E03 就是后者的形状），收集不到任何文档则报 `CRON_DOC_NO_SOURCES` 失败封闭。故意**不**核对「路径 ↔ 表达式」的同行配对：那要求解析表格行与句子，会把散文式引用全部误伤，所以「digest 写成 push-retry 的表达式」这类错不在本规则射程内，由注册表与告警文档那一层负责；
- 非 worker 的 `/api/health` 与 `/api/ops/supabase-restore` 使用带理由的显式豁免，避免把平台保活任务误当成 worker；
- 注册表、路由集合、调度表或指标文档为空时失败封闭。

两条 cron 路由统一使用 `checkCronAuth()`：`CRON_SECRET` 未配置、缺失凭据与无效凭据会以稳定原因上报
`cron.auth.rejected`，但不会记录请求头或密钥内容。摘要 worker 的 `cron.digest.completed` 现在覆盖完整运行时长，
500 路径会写入 `email_worker_runs.error` 并上报 `cron.digest.failed`；失败运行记录自身的写入失败只记日志，不覆盖原始错误。
失败轮次的记录同样带上**已经发生**的进度（`pulled` / `sent` / `groups` / `failed` 照实累加），回执写不写得进去与
投递是否成功分属两条事实，后者单独上报 `cron.digest.receipt_failed{stage}`（语义见 `docs-site/email.md`）。

规则本体位于 `src/lib/observability/cron-contract.ts`（跳过证据判定拆在同目录的
`cron-skip-coverage.ts`），IO/CLI 位于 `scripts/lib/cron-contract-check.js` /
`scripts/check-cron-contract.js`，由 `pnpm check:all` 与 CI 的 `Lint & Type Check` job 执行。专项测试覆盖
表达式校验、路由发现、方法/指标/文档漂移、豁免过期、鉴权拒绝原因、失败运行记录，以及跳过的
四类判定（未计数 / 缺 reason / 指标未登记 / 源码不可解析）。成功日志会打印「N 处条件跳过均有计数证据」，
让「核对过多少条」本身可核对。

**局限**：门禁证明仓库内的调度与指标接线一致、且文档没有教一条仓库里不存在的调度，但不证明 Vercel 平台已实际部署该配置，也不替代线上 cron 执行历史与告警投递验收。「文档与代码一致」这件事分两步测：D02 管中英两边说同一件事，D01 管它们说的是不是代码里的那件事——只上任意一边都会漏掉另一类漂移。

## 双语调度事实门禁（D02）

`pnpm check:bilingual-docs` 逐页比对 `docs-site/<page>.md` 与 `docs-site/zh-CN/<page>.md` 里
**可机器核对的调度事实**：5 字段 cron 表达式与 `HH:MM UTC` 时刻。两边集合必须完全相等，
一边提到而另一边没有也算失败——「只改一种语言」正是漂移的发生方式。

它拦的是真实发生过的两类事故：v0.6.0 的 I01（EN 写「外部 cron 逐小时调度」、zh 写「每天 09:00 UTC」，
两条互斥陈述长期并存，而 digest 的投递语义恰恰取决于这个频率）；以及本次接线当场查出的
`docs-site/web-push.md`（EN 仍说 `/api/cron/push-retry` 每 15 分钟一次，而 `vercel.json` 早在
2026-09-21 就改成 `0 22 * * *`）。规则只认结构化事实，不比对文案，因此不会退化成翻译质量检查；
cron 表达式是否合法复用 `isValidCronSchedule`，避免把散文里的数字串当成表达式。

失败封闭项：找不到任何配对（`DOC_NO_PAIRS`）、英文页缺中文同名页（`DOC_PAIR_MISSING`）、
文档内容为空（`DOC_SOURCE_EMPTY`，空文件不等于「没有差异」）。

规则本体在 `src/lib/docs/bilingual-facts.ts`，IO/CLI 在 `scripts/lib/bilingual-docs-check.js` /
`scripts/check-bilingual-docs.js`，由 `pnpm check:all` 与 CI 的 `Lint & Type Check` job 执行。
成功日志会报出核对面（多少对文档、多少个 cron 表达式与 UTC 时刻）——数量以命令输出为准，本文不复述，
免得文档比门禁先过期。
**局限**：只覆盖带单位的调度事实，不判断同一事实的其他表述（如 "hourly" 与「每小时」）是否一致。

## 数据保留与账户擦除契约（H08）

保留期、cron 任务名、擦除数据面、`audit_logs.metadata` 的 PII 键与删除确认短语同时存在于
常量（`src/lib/privacy/data-policy.ts`）、迁移 SQL（`003` / `014` / `027` / `028` / `032`）
与 `docs/db/retention.md` 三处，任何一处单独改动都不会有失败信号，而值班与隐私承诺按文档行动。
`src/lib/privacy/data-policy.test.ts` 把三处钉在一起：函数体的时间窗与状态条件、`cron.schedule`
的任务名与调度、`EXECUTE` 撤权与回授、文档表格行里的天数、双语界面提示里的确认短语，
以及生成的 `database.types.ts` 中 RPC 的存在；常量集合与文档提到的函数集合做双向集合比较，
新增函数不登记、或文档承诺一个代码里不存在的保留期，都会失败。

账户删除本身另外验证三件事：

- `src/lib/account/deletion.test.ts`：擦除先于删号、擦除失败不删号、事后审计补记不回滚成功、
  审计行不重建与已擦除身份的连接；
- `src/lib/actions/account.test.ts`：限频、会话归属、服务端独立校验确认短语（客户端只做非空门控）、
  失败时保持登录态；
- `src/lib/mock.test.ts`：Mock 客户端镜像同一套擦除语义（按邮箱大小写/空白不敏感匹配、
  审计匿名化、幂等重放），因此 mock 开发不会比真实库更宽松。

**局限**：Mock 模式的 `admin.deleteUser()` 是刻意 no-op，`e2e/account-deletion.spec.ts` 因此
只覆盖危险区域的两步确认、服务端拒绝与取消路径，**不提交真实删除**（既证明不了删号，
也会把共享 dev server 进程里的 mock 数据擦掉、污染同 shard 的其它用例）。
真实的「哪些行被删/被匿名化」以本地库 SQL 演练为准，步骤见 `docs/db/retention.md`。
同理，门禁与测试都只证明仓库内的迁移与文档一致，不证明目标数据库已安装 pg_cron——
未安装时所有 SQL 侧调度会被守卫静默跳过，保留期不生效。
