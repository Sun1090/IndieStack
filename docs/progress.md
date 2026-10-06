## 2026-09-22 — 把「mock 少一个方法」变成一条会点名的自检（PR #74 的后续）

- 里程碑 / 版本：v0.12.0 C03 的收尾，外加一条新发现的失效模式。
- 状态：DONE。
- 分支 / commit：`test/mock-auth-surface-parity`（基于合并后的 main `e67d383`）。
- 为什么做：PR #74 补 `refreshSession` 时我在命令行里手扫了一遍「应用调了哪些 `auth.*`」。
  那次是靠人肉，靠不住——同一个形状下次还会漏。要么把它变成机器检查，要么这条发现就只是运气。
- 完成内容：
  1. `src/lib/mock/auth-surface.test.ts`：扫 `src/**`（跳过测试文件与 mock 自身）里的
     `<client>.auth.<路径>(` 调用点，沿路径逐段对回 `new MockSupabaseClient().auth` 的**真实对象**
     （不是解析源码，所以改名、漏写都藏不住），缺哪一段就报「文件 → auth.xxx（缺 xxx）」。
     抽取要求「后面紧跟左括号」，否则 `cron.auth.rejected` 这种指标名会被当成调用点——第一版就误报了这条。
  2. 扫描当场又量出四处缺口，全部补齐：`auth.resend`、`auth.verifyOtp`（passkey 会话签发要读
     `user.factors`，所以也走 `getMockAuthUser`）、`auth.exchangeCodeForSession`，
     以及 `auth.admin.mfa.listFactors/deleteFactor`——恢复码自救（`src/lib/actions/recovery-codes.ts:112`）
     先列因子再删 TOTP，缺这段就是「兑换明明成功了、随后就报错」。admin 侧的形状按 GoTrue 的
     `{total, factors[].factor_type}` 来，与用户侧 `{all, totp}` 不是一回事。
  3. 顺手把三处重复的「登录响应带 factors」收进 `getMockAuthUser(store)`，副本语义只有一处。
  4. 两条 passkey magiclink 的 admin 方法（`admin.generateLink` / `admin.getUserById`）没有实现，
     挂在 `KNOWN_GAPS` 里带理由豁免，并配一条**反向断言**：谁实现了它，豁免就因「已不再是缺口」变红。
     豁免清单不设防静默过期，这是这次缺口能活到 E2E 才被发现的根本原因。
  5. **不接 `scripts/check-*`**：这条跑在 `pnpm test` 里，而 `pnpm test` 本来就是 push 的硬性前置
     （AGENTS.md）。再套一层只是把同一条约束抄第三遍，还要多养双语 docs-site。
- 变更文件：`src/lib/mock/index.ts`、`src/lib/mock/auth-surface.test.ts`（新增）、
  `docs/roadmap-0.12.0.md`（C03 ③ 改口径：门禁已落地，且是轻量版）、`docs/testing.md`、`CHANGELOG.md`、本条目。
- 验证命令与结果：`npx vitest run src/lib/mock/auth-surface.test.ts --project node` → 4 通过；
  变异核对：`refreshSession` 改名 → 扫描用例红并点名 `src/app/auth/mfa/page.tsx → auth.refreshSession`；
  把一条豁免换成已实现的 `admin.listUsers` → 反向断言红（同时暴露真实缺口那条也依赖豁免，符合预期）；
  全量 `pnpm lint` / `type-check` / `test` / `build` 与文档门禁见 PR。
- 阻塞 / 风险：`admin.generateLink` / `getUserById` 仍是缺口（E2E 到不了那条路径，缺虚拟 WebAuthn
  认证器），已由 `KNOWN_GAPS` 显式记账，不会悄悄长大。回滚 = revert 本 commit。
- 下一项：C02 的第二半（按 worker 给 store 命名空间）或 C04 剩余部分。
- 更新时间：2026-09-22（UTC 13:55 前后）。

## 2026-09-22 — 并行的第三种红是计时，不是状态：预热之后 107/107（C02 收尾）

- 里程碑 / 版本：v0.12.0 的 C02 **达成**。
- 状态：DONE——全量并行第一次拿到可复跑的绿记录（run `35746785602`，107 passed / 0 failed）。
- 分支 / commit：`test/e2e-per-worker-servers`（PR #77）第三个 commit（当时 3d624e5，落地后 `8c510c84`）。
- 为什么做：上一条记录里 C02 停在 PARTIAL：共享状态清零后仍有 1～2 条红。留着「并行还是红」这句话
  不看下去，就等于把计时问题误记成状态问题。
- 完成内容：
  1. 分诊两轮红的形状：`uploads`（登录后 `waitForURL` 15s）、`smoke`（`page.goto` 60s + `ERR_ABORTED`）、
     `webhook-events`（同 id 第二次投递未认 duplicate）——三条各不相同、换轮次换一批，唯一共同点是
     **第一个打到某台服务器的用例**。这不是并发写表，是在付 `next dev` 的按路由冷编译。
  2. `globalSetup: e2e/support/warm-up.ts`：并行模式下逐台 GET `/`、`/auth/login`、`/dashboard`、
     `/dashboard/settings`，把编译从用例时间里挪出来。`E2E_SERVERS>1` 才生效，串行 CI 一秒不多花；
     预热失败刻意不抛——它只是搬运计时，不该变成新的门禁。
  3. **踩到自己造的新坑并修掉**：`.next-e2e-<slot>` 里是 Next 生成的 chunk，eslint 不忽略它，
     于是跑过一次并行之后 `pnpm lint` 永久红（本次真的红了）。`eslint.config.mjs` 现在和 `.next/**`
     一起忽略 `.next-e2e-*/**`。
  4. `tsconfig.json` 预先把 slot 0..2 的 types 路径写全：Next 只会往 include 里追加、从不回收，
     先写全等于以后每换一次端口少脏一次树（本机验证：预热跑完 `git diff tsconfig.json` 不再增长）。
  5. 契约同步：`e2e-shard-policy` 加两条——config 必须挂 `globalSetup`，且 warm-up 必须有
     `if (SERVERS < 2) return;`（否则有人会把预热变成串行 CI 的固定税）。
- 变更文件：`e2e/support/warm-up.ts`（新增）、`playwright.config.ts`、`eslint.config.mjs`、
  `tsconfig.json`、`src/lib/testing/e2e-shard-policy.test.ts`、`docs/testing.md`、
  `docs/roadmap-0.12.0.md`（C02 改口为达成 + 风险条目结案）、`CHANGELOG.md`（Known Limitations 里
  那条「并行仍不可用」删除）、本条目。
- 验证命令与结果：`pnpm lint`=0（修 ignore 前=1，红因是 `.next-e2e-0/1` 里的生成 chunk）、
  `type-check`=0、`test`=0（194 文件 / 2218 用例）、`build`=0、`check:security`/`check:docs`/
  `check:changelog`/`check:bilingual-docs`/`check:test-matrix`/`check:cron-contract`/`check:mock-docs`/
  `check:gates`/`check:adr` 全 0；本机 `E2E_SERVERS=2` 复跑 `mfa-challenge` + `webhook-events` → 8 passed。
  **CI 三轮并行**：`35742942744` 106/1、`35744080784` 105/2、`35746785602` **107/0**
  （用例总数与本机 `playwright test --list` 的 107 对齐；日志端点仍取不到，计数来自
  check-run 的 🎭 Playwright Run Summary annotation）。
- 阻塞 / 风险：无。风险是有人把这三条红重新当成共享状态去「修 store」——分诊口径已写进
  `docs/testing.md` 与 roadmap C02。回滚 = revert `8c510c84`（预热与 eslint ignore 要一起回退）。
- 下一项：PR #77 合并、清理分支，然后回到 A05 的可观测那一半（队列规模 / 最早一条年龄 /
  `sent=0` 轮次），出队语义仍等用户拍板。
- 更新时间：2026-09-22（UTC 15:55 前后）。

## 2026-09-22 — 并行 E2E 的隔离边界落在 worker 上：共享状态冲突清零，剩下的不是它（C02）

- 里程碑 / 版本：v0.12.0 的 C02 第二半。
- 状态：PARTIAL——共享状态冲突已消除 ✅，「并行全绿」仍 ✗，且挡住它的东西换了（见验证）。
- 分支 / commit：`test/e2e-per-worker-servers`（PR #77，基于 `27165f2`）。
- 为什么做：上一条目记下首跑 4 条红的机制是「一个 next 进程、一份 MOCK_GLOBAL」。C01 已经论证默认
  store 不能改成请求级，那么并行的隔离只剩一条路：让并行单位与进程单位对齐。
- 完成内容：
  1. `PW_FULLY_PARALLEL=true` 时按 `E2E_SERVERS` 起 N 台 dev server，`workers = N`，一个 worker 一台。
  2. **卡点在 Next 自己**：`next dev` 用 `<distDir>/dev/lock` 判断「这个工作副本已经有一个 server」，
     同一份源码起第二台直接退出 1（第一次并行尝试就是这么死的，不是端口冲突）。于是 `next.config.ts`
     支持 `NEXT_DIST_DIR`，每台服务器 `.next-e2e-<slot>`。
  3. distDir 名字**按 slot 编而不是按端口**：Next 会把 `<distDir>/types/**` 追加进 `tsconfig.json`
     且从不回收——按端口编就是每换一次 `E2E_BASE_PORT` 就往 tsconfig 里堆一组死路径（本机实测堆出 6 行）。
  4. spec 侧：新增 `e2e/support/base-url.ts` 的 `appUrl()`（读 `TEST_WORKER_INDEX`），50 处
     `${APP_URL}` 与 58 处裸相对 `page.goto` 全部改走它。裸相对路径以前是「约定」，现在是错的：
     `use.baseURL` 是全局的，会把并发的 worker 全指回 slot 0。
  5. 契约跟上：`e2e-shard-policy` 新增「`workers` 等于服务器数」与「spec 里不得出现 localhost:3100 /
     裸相对 goto」两条；并行 workflow 的作业名与环境变量同步改写。
- 变更文件：`playwright.config.ts`、`next.config.ts`、`.gitignore`、`e2e/support/base-url.ts`（新增）、
  15 个 `e2e/*.spec.ts`、`e2e-shard-policy.test.ts`、`.github/workflows/e2e-parallel.yml`、
  `docs/testing.md`、`docs-site/mock.md` + `docs-site/zh-CN/mock.md`、`docs/roadmap-0.12.0.md`、
  `CHANGELOG.md`、`docs/operations/release-exit-report-v0.6.0.md`（C03 那格过期）、本条目。
- 验证命令与结果：
  - `pnpm lint` / `type-check` / `test`（194 文件 / 2218 用例）/ `build` **逐个取真实退出码**全 0
    （第一次用 `| tail` 把失败吞了，教训重演一次）；文档门禁 7 项全 0。
  - CI 常规路径在本 ref 上全绿：`E2E shard 1`、`E2E shard 2`、`E2E (Playwright)`、Unit、Build、
    Lint & Type Check 全 pass，只有两个 Vercel 检查因项目配额红。
  - **并行基线两轮**（同一 ref 30ec139，落地后 `67d3e53e`；手动 dispatch）：run `35742942744` = 106 passed / 1 failed；
    run `35744080784` = 105 passed / 2 failed（用例总数 107，与本机 `playwright test --list` 一致）。
    红的分别是 `uploads`（登录后 `waitForURL` 15s）、`smoke`（`page.goto` 60s + `ERR_ABORTED`）、
    `webhook-events`（同 id 第二次投递未认 duplicate）。三条各不相同、且都不是上一轮那类
    「别人往我表里种数据」——共享状态冲突清零，剩下的是 `next dev` 冷编译与 route handler 被拆到
    另一进程（dedupe 记录随进程消失）。
  - 本机 `E2E_SERVERS=3` 那轮 20 红 / 14 条是 60s 超时：一台笔记本上三份冷编译互相抢 CPU，
    这个数只能证明「本机不是测并行的地方」，没有拿它下任何结论。
- 阻塞 / 风险：C02 的「并行全绿」仍不成立，下一块要啃的是冷编译/多进程而不是 store；本 PR 不声称
  达成退出标准第 3 条。风险是有人把这三条红重新解释成共享状态冲突——归因写在 roadmap C02。
  回滚 = revert 两个 commit（地址约定要一起回退，否则 spec 又写死端口）。
- 下一项：并行全绿需要处理冷编译（预热或超时预算），或按配额窗口复跑取第三轮证据。
- 更新时间：2026-09-22（UTC 15:20 前后）。

## 2026-09-22 — MFA 挑战流程在 mock 里根本走不完：三处缺口，E2E 一撞就现形（C03）

- 里程碑 / 版本：关闭 v0.12.0 的 C03。
- 状态：DONE（密码那条入口）；passkey 那条另说，见「阻塞」。
- 分支 / commit：`test/e2e-parallel-baseline-first-run` 的第二个 commit（基于 ea9489f，落地后 `46bc2519`）。
- 为什么做：上一条目改掉 C03 的假前置（不是 store 隔离）之后，真阻塞只剩仓库内可验证的几行代码，
  于是接着把那条「真实走一遍挑战流程」的 E2E 写出来。
- 完成内容：
  1. `e2e/mfa-challenge.spec.ts` 三条：已开 2FA 的账号密码登录 → 跳 `/auth/mfa` → 错码留在原页且
     按钮恢复可点 → 正确码进 dashboard；未开 2FA 的账号**不**被送去挑战页；直接访问缺 `factor` 的
     页面给出重新登录入口。
  2. **① mock 的 `signInWithPassword` 补 `user.factors`**（store 里因子的副本）。真实 Supabase 在登录
     响应里带这个字段，而 `login-form.tsx:86` 正是读它决定跳不跳——不带，mock 下 MFA 那条分支永远走不到。
  3. **② mock 客户端补 `auth.refreshSession`**。挑战页 verify 成功后 await 它，方法不存在就是
     TypeError → 被 `catch` 兜住 → 用户看到「登录失败，请稍后重试」，而验证码其实对了。
     这条是首跑撞出来的：那次红在 `waitForURL("**/dashboard")`，页面快照停在挑战页 + 一条 toast。
  4. **③ 种子的位置**：浏览器侧 mock store 挂在 `window.__indiestackMockCache__`，整页导航即重置，
     `/api/e2e/*` 是服务端那份、种不到它。改用 `page.addInitScript` 在页面脚本之前写入已验证因子。
  5. 新 spec 全程用相对路径导航（`baseURL` 决定端口），因此可以在任意空闲端口复跑——本机 3100 正被
     `~/Projects/trade-buty` 的 dev server 占着，没有动它。
- 变更文件：`e2e/mfa-challenge.spec.ts`（新增）、`src/lib/mock/index.ts`（`factors` + `refreshSession`）、
  `src/lib/mock.test.ts`（+1 条，含「返回副本」断言）、`docs/roadmap-0.12.0.md`（C03 按实测改口径，
  并记下 `resend`/`verifyOtp`/`exchangeCodeForSession` 三处未动的同类缺口）、`CHANGELOG.md`、`docs/testing.md`、本条目。
- 验证命令与结果：`npx playwright test e2e/mfa-challenge.spec.ts`（临时把 `baseURL` 指到 3101 的
  一次性 config，跑完删除）→ 3 passed；`npx vitest run src/lib/mock.test.ts --project node` → 53 通过。
  变异核对：摘掉 `factors` → E2E 只有第一条红（停在跳挑战页那步）；去掉 `{...factor}` 拷贝 →
  「返回副本」那条断言恰好在 `listFactors` 长度处失败；`refreshSession` 的缺失状态就是首跑那次超时本身。
- 阻塞 / 风险：passkey 入口需要 Chromium 的虚拟 WebAuthn authenticator，仓库目前没有任何 passkey E2E，
  这条不在本 commit 范围内。风险是有人把 mock 当成「够跑就行」的桩——`auth.*` 少一个方法就少一条真实路径，
  已按 C03 记下的静态门禁方案（应用调用的 auth 方法必须存在于 mock 客户端）留作后续。回滚 = revert 本 commit。
- 下一项：回到 B 域之外可自动推进的部分——检查 PR 状态与远程多余分支，然后把 C04 剩余部分与
  v0.11.0 tag 的两个前置（演练 + 生产 commit 证据）里能推的那个推进。
- 更新时间：2026-09-22（UTC 13:30 前后）。

## 2026-09-22 — 并行基线首跑红了 4 条：逐条对着 artifact 归因，不猜（C02）

- 里程碑 / 版本：关闭 v0.12.0 的 C02 的「可复跑」那一半，并给出首跑的实测结论。
- 状态：PARTIAL（基线可复跑 ✅，全量并行可用 ✗——后者是新设计，不是改配置）。
- 分支 / commit：`test/e2e-parallel-baseline-first-run`（基于 `3fe5d20`）。
- 为什么做：PR #73 把基线接进 CI 之后，第一次真正跑起来（run `35727094401`，job `10674329401`，
  12:25:42Z→12:29:18Z）就红了。红必须留下归因，否则下一次 dispatch 的人只会看到「并行不行」这四个字。
- 完成内容：
  1. **取证据**：workflow 日志端点反复失败，改从 artifact `playwright-parallel-baseline`（12,168 B）
     里读 4 份 `error-context.md`。日志拿不到不等于测不出——报告里就有期望/实际值与页面快照。
  2. **① `webhook-events.spec.ts:114`** 通知数 `toBe(1)` 实读 2；同一用例第 105 行「清空后 `toBe(0)`」是过的，
     所以问题不在清理没做，而在「清理 → 断言」这段窗口不关门，别的 worker 在中间种了数据。
  3. **② `notifications-realtime.spec.ts:53`** 等不到空态；快照里多出的那条标题是「E2E Push 种子通知」，
     按字符串查到 `src/app/api/e2e/push-queue/route.ts:105`，即并行的 `push-retry.spec` 种的——
     归因落到具体端点，而不是「被别人污染」。
  4. **③④ `mail-flow.spec.ts`** 前两条（`:49` 收件箱 `total` 读到 0、`:187` 的 `email_attempts` poll
     停在 0）。凶手在这个文件自己身上：顶层 `beforeAll`（第 27、30 行）与 `beforeEach`（第 41、44 行）
     成对 DELETE `/api/e2e/email-inbox` 与 `/api/e2e/seed-notifications`，而 `fullyParallel` 下这类钩子
     **每个 worker 各跑一次**，同文件三条用例被拆到不同 worker 后互相删数据。
  5. **不夸大结论**：证据只指到 `notifications` 表与本地 email inbox 两处。`webhook_events`（去重断言全过）
     和 `email_worker_runs`（读它的那条用例没红）从「四张表」的说法里划掉，只作为同类风险记着。
  6. **顺手改掉 C03 的假前置**：roadmap 原文说那条 E2E 需要「Mock 的 MFA 状态可隔离」，属 C01 前置。
     实测两处入口（`login-form.tsx:86～92` 密码、`:179～182` passkey）都不需要隔离；真阻塞是 mock 的
     `signInWithPassword`（`src/lib/mock/index.ts:1289`）不返回 `user.factors`（真实 Supabase 会返回），
     以及浏览器 store 挂在 `window` 上、整页导航即重置。
- 变更文件：`docs/roadmap-0.12.0.md`（C02 首跑结论 + C03 阻塞重定）、`docs/testing.md`（并行钩子那条
  反直觉结论）、`CHANGELOG.md`（Known Limitations：全量并行仍不可用）、本条目。
- 验证命令与结果：文档门禁（`check:docs` / `check:changelog` / `check:bilingual-docs` /
  `check:test-matrix` / `check:cron-contract`）与 `pnpm lint`、`pnpm type-check`、`pnpm test`、`pnpm build`；
  本条目只改文档，默认 CI 的 2-shard E2E 不受影响，基线仍按每周一 07:30 UTC 复跑。
- 阻塞 / 风险：并行真正可用需要按 worker 给 store 命名空间（`/api/e2e/*` 与 mock 客户端按 id 选 store），
  是新设计；**不能**为了让基线绿而把运行时默认 store 改成请求级（C01 已论证那会重演 v0.5.0）。
  回滚 = revert 本 commit（纯文档）。
- 下一项：C03——把 `signInWithPassword` 的 `factors` 补成与真实 Supabase 同形，再写那条真走挑战流程的 E2E。
- 更新时间：2026-09-22（UTC 13:20 前后）。

## 2026-09-22 — mock 的「进程全局状态」先测再改：21 个模块级镜像其实是死代码（C01）

- 里程碑 / 版本：关闭 v0.12.0 的 C01，并把 C02 的前置认知写清。
- 状态：DONE。
- 分支 / commit：`feat/mock-request-isolation`（基于 PR #71 合并后的 main `7e07fe7`）。
- 为什么做：roadmap 的 C01 与 v0.6.0 退出报告的 F01 都说「MFA 的 `_mockMfaFactors` /
  `_mockMfaChallenges` 仍是进程全局，且没有任何 MFA 隔离测试」，并要求「把 `createMockRequestStore`
  真正接进 client/query/auth（第二阶段）」。动手前先测，三点都不成立。
- 完成内容：
  1. **接线早就在**：`from()` → `new MockQueryBuilder(table, "*", this.store)`、`rpc()` 传
     `this.store`、整个 `auth.mfa.*` 用 `this.store`。没有「第二阶段」可开工。
  2. **那两个变量不承载状态**：脚本判定 21 个 `_mock*` 模块级变量全部**只写不读**
     （`let` 声明 21 + reset 21 + `= cached` 21 + `= fresh` 21 = 84 行）。真正的进程级状态只有一份，
     就是默认 store `MOCK_GLOBAL`。整体删除，store 自此是唯一来源。
  3. **MFA 隔离测试已有 enroll/list 一条**（「没有任何 MFA 隔离测试」同样过期），缺的是会真正藏 bug
     的那几面，补 4 条：共享 store 的跨 client 可见性（Server Action 写→RSC 读的假数据库契约）、
     challenge 失败计数与锁定跨 store 不串（两侧 id 形状相同，测的就是「按 id 找人」不跨 store）、
     同一 store 内两个 challenge 各自计数、`listFactors` 返回副本。
  4. **定住那条容易被「顺手优化」的设计边界**：运行时默认共享 `MOCK_GLOBAL` 是刻意的，改成请求级会
     重演 v0.5.0 的「Action 写进去、RSC 读不到」。理由与证伪方法写进架构文档的状态模型一节。
- 变更文件：`src/lib/mock/index.ts`（-84）、`src/lib/mock.test.ts`（+4 条）、
  `docs/architecture/13-mock-system.md`（状态模型重写：store 是唯一来源 + 为什么运行时共享 +
  拓扑图两个节点改名）、`docs/roadmap-0.12.0.md`（C01 按实测重定范围、C02 补前置认知、
  退出标准第 3 条改口径）、`CHANGELOG.md`、本条目。
- 验证命令与结果：`pnpm type-check` → 0（若某个镜像真被读过，删除会当场被 tsc 拒绝）；
  `npx vitest run src/lib/mock --project node` → 4 文件 / 86 通过（新增前 82）；
  `check:mock-docs` / `check:docs` / `check:test-matrix` / `check:changelog` / `check:bilingual-docs` /
  `check:gates` / `check:adr` 全 ✅；`pnpm lint` → 0。
  变异核对（跑完还原，`git diff --numstat` 确认只剩预期的 0/84）：
  ① `getMockMfaFactors` 的读改回 `MOCK_GLOBAL` → `5 failed | 7 passed`，红的正是隔离与共享两组；
  ② 去掉 `listFactors` 的 `{...factor}` 拷贝 → 恰好 `listFactors 返回副本` 一条失败。
- 阻塞 / 风险：无外部依赖。风险是有人把「请求级隔离」再当成目标重做一遍——架构文档与 roadmap C02
  现在都写明共享默认 store 是设计。回滚 = revert 本 commit（镜像会回来，但没有人读它们）。
- 下一项：C02（CI 里跑一次全量 `PW_FULLY_PARALLEL` 的可复跑并行基线）。
- 更新时间：2026-09-22（UTC 12:40 前后）。

## 2026-09-22 — `pnpm audit` 的偶发红改成分得清「网络」还是「仓库」

- 里程碑 / 版本：v0.12.0 的 C 域（CI/门禁可靠性），承接上一条目点名的下一项。
- 状态：DONE。
- 分支 / commit：`docs/deployment-identity-evidence` 的第二个 commit（与部署身份文档同 PR，不同主题）。
- 为什么做：当天 `pnpm check:all` 三次停在 `check:security` 的
  `pnpm audit: report is missing metadata`，单跑 `pnpm check:security` 又通过。这条结论把
  「注册表没连上」和「仓库配置坏了」压成同一句话，看的人只会去查配置。
- 完成内容：
  1. **先复现再改**：用 `HTTPS_PROXY=http://127.0.0.1:9 pnpm audit --json` 强制请求失败，拿到真实
     载荷 `{ "error": { "code": "pnpm", "message": "fetch failed" } }` 与退出码 1——合法 JSON、
     没有 `metadata`，正是那条误导结论的来源。顺手否掉一个错误假设：把 `npm_config_registry` 指向
     不存在的域名并不能触发失败，项目级 `.npmrc` 优先于环境变量，那次探针其实跑的是真注册表。
  2. 规则侧（纯函数）新增 `describeUnreadableReport()`：`error` 形状报
     `advisory request failed (code=…, message=…)`，其余报 `report is missing metadata (top-level keys: …)`。
     两种仍然失败封闭，审计强度一字未改。
  3. 补上原来**完全没有**的失败信息断言：真实载荷、`error` 缺字段、`{}`、`{metadata:null}`，
     外加一条「读不到永远不等于审计干净」。`src/lib/security` 9 文件 / 225 用例绿。
- 变更文件：`src/lib/security/security-config.ts`、`src/lib/security/security-config.test.ts`、
  `docs/testing.md`、`CHANGELOG.md`、本条目。
- 验证命令与结果：`HTTPS_PROXY=http://127.0.0.1:9 node scripts/check-security-config.js` → 退出码 1，
  `- pnpm audit: advisory request failed (code=pnpm, message=fetch failed)`（变异核对：仍然红，但说清了是谁）；
  不加代理 → `✅ security/config checks passed: 933 tracked files, 546 source files, 8 workflows`；
  `npx vitest run src/lib/security --project node` → 9 文件 / 225 用例通过；
  `pnpm type-check` / `pnpm lint` → 0。
- 风险 / 回滚：只改结论文案，不改判定阈值，也不引入「读不到就当通过」。回滚 = revert 本 commit。
  没有加重试：CI 侧这道门禁当天始终绿，抖动只发生在本机网络，重试只会把同一件事藏起来。
- 下一项：等 Vercel 配额窗口放行后确认生产 `/api/health` 开始上报 SHA（B 域打 tag 前置之一）。
- 更新时间：2026-09-22（UTC 11:40 前后）。

## 2026-09-22 — 「配额恢复」不等于「`main` 已落地生产」：部署身份改走权威来源

- 里程碑 / 版本：v0.11.0 的发布前置（B 域），同时是 D03 审计方法的一次实际应用。
- 状态：DONE（文档订正）；部署本身仍被平台挡住，属外部阻塞不是本条目的完成条件。
- 分支 / commit：`docs/deployment-identity-evidence`（基于合并 PR #70 之后的 main `ec9d729`）。
- 为什么做：用户要求「解决远程 CI 与 Vercel 部署的错误」。CI 侧没有错误——PR #70 的 11 项 GitHub
  检查全绿，只有两条 **非必需** 的 Vercel 检查因配额失败（`upgradeToPro=build-rate-limit`），
  按定案这类平台拒绝放行不去绕过、也不放宽任何期望。真正的问题是核对过程中发现：**三处文档
  把「配额已恢复」推成「当前 `main` 已落地生产」**，而这一步推理从来不成立。
- 完成内容：
  1. 用权威来源把生产身份查到底：`indie-stack` 生产最后一次**成功**部署是
     `6587025748`（08:56:51Z，commit `a322a4e`），`8037bbd` 与 `ec9d729` 两次推送都被限流、
     连生产部署记录都没产生；10:50:39Z 直读 `/api/health` 仍是 `version=0.11.0` 且**没有**
     `commit` 键，两边互相印证。
  2. 把这条取证路写成命令并**先跑通再写进文档**：两步（最新一条生产部署 → 它的状态）。
     过程中踩到自己埋的坑——`startswith("Production – indie-stack")` 会把
     `Production – indie-stack-docs-site`（另一个项目）一起捞进来，据此得出的 `[0]` 是 `ec9d729`，
     一个根本没上生产的 commit。环境名必须精确匹配，命令改完后实测返回 `6587025748 a322a4e`。
  3. 订正三处措辞并降级旁证：冒烟产物的「目标 commit」不再靠 `uptime=368s` 反推；roadmap B01
     一行不再写「`main` 已部署」；缺口审计结论 2 补上「这句话不包含生产 == 当前 `main`」。
     另在 runbook 写清两个坑：被限流的推送不会产生部署记录；记录存在 ≠ 构建成功。
  4. 把「少踩配额只有两条路」（攒部署 / Ignored Build Step）记进冒烟产物，并写明两者都需要
     dashboard 权限、本机的 `VERCEL_TOKEN` 是占位值，所以这条只是给用户决策的记事，不是待办。
- 变更文件：`docs/operations/production-smoke-v0.11.0.md`、`docs/operations/release-runbook-v0.11.0.md`、
  `docs/operations/release-gap-audit-v0.11.0.md`、`docs/roadmap-0.12.0.md`、`CHANGELOG.md`、本条目。
- 验证命令与结果：`gh api "repos/<owner>/<repo>/deployments?per_page=12"` +
  `gh api .../deployments/<id>/statuses` → `6587025748 a322a4e 2026-09-22T08:56:51Z` / `success`；
  `curl /api/health` → 无 `commit` 键；文档类门禁逐个复跑：`check:docs`、`check:release-docs`
  （v0.11.0, 7 artifacts）、`check:bilingual-docs`、`check:changelog`、`check:test-matrix`、
  `check:gates` 全部 ✅。`check:all` 本次停在 `check:security` 的 `pnpm audit`（见下一条目的根因）。
- 阻塞 / 风险：生产部署被 Vercel 配额挡住（09:31Z 与 10:50Z 各一次，描述为 `retry in 24 hours`），
  本机无 token 不能手动触发；因此「带 `commit` 的构建上过生产」这一条打 tag 前置在窗口放行前无法闭合。
  回滚 = revert 本文档 commit，无运行时影响。
- 下一项：`check:security` 里 `pnpm audit` 的偶发失败（同日两次停在
  `report is missing metadata`，单跑与复跑都通过）——先把失败原因变得可诊断，再决定要不要重试。
- 更新时间：2026-09-22（UTC 11:20 前后）。

## 2026-09-22 — 文档里的调度事实必须对得上仓库（D01）

- 里程碑 / 版本：关闭 v0.12.0 的 D01；退出标准第 6 条（D01、D02 落地）自此满足。
- 状态：DONE。
- 分支 / commit：与 D03 同分支 `docs/release-gap-audit-v0.11.0`（基于 main `8037bbd`）。
- 为什么做：D02 只保证「中英两边说同一件事」，两边一起写错时它永远绿；E03 那次是另一类——
  文档写了一个根本没被调度的路由。两类漂移都需要各自的门禁，而 roadmap 指定的做法是
  给 `check:cron-contract` 加文档来源，不新造一道门禁。
- 完成内容：
  1. 先量再写：把 `docs-site/**` 与 `docs/**` 里所有合法 5 字段表达式与 `/api/cron/*` 路径抽出来
     对回「注册表 ∪ `vercel.json` ∪ workflow `schedule`」，实测**零**存量违规（v0.8.0 发布页那条
     已废弃表达式由「带日期快照」规则排除）。
  2. 规则实现：`auditCronDocs` 三条判定 `CRON_DOC_STALE_SCHEDULE` / `CRON_DOC_UNREGISTERED_PATH` /
     `CRON_DOC_NO_SOURCES`（一篇都没收集到就失败封闭），加 `CRON_DOC_SOURCE_EMPTY`；
     `isCronDocAuditable` 排除 `v0.8.0.md`、`*-runbook-v0.10.0.md`、`production-smoke-v0.11.0.md`、
     `roadmap-*.md`、`progress.md`、`docs/operations/drills/` 这类带日期的证据。
  3. 抽取层共用：`extractCronExpressions` 落在 `cron-contract.ts`，D02 的
     `extractSchedulingFacts` 改为调用它——原来两边各写一份同一条正则，正是漂移的入口。
  4. **删掉一条更严但会误伤的子规则**：第一版要求「文档提到 worker 路径就必须登记它的调度」，
     在真实仓库当场产出 8 条告警，全部是合法陈述（`web-push.md` 顺带引用 digest、`docs/testing.md`
     列举 worker 路径等）。这种门禁只会教会人怎么绕开它，故移除并把「为什么不做」写进规则 docblock。
  5. 明确不做（也写进 roadmap）：环境变量名与表名/迁移号两类核对。前者要能识别
     `flag("PASSKEY")` 组合出来的 `NEXT_PUBLIC_FEATURE_PASSKEY`，后者需要 SQL 关键字与
     `VERCEL_ORG_ID` 这类非文案 token 的停用表——都是先量到误报才有依据的扩展。
- 变更文件：`src/lib/observability/cron-contract.ts`、`src/lib/docs/bilingual-facts.ts`、
  `scripts/lib/cron-contract-check.js`、两份测试、`docs/testing.md`、双语 `docs-site/scripts.md`、
  CHANGELOG、roadmap、缺口审计的 D01 行、本条目。
- 验证命令与结果：
  - `npx vitest run src/lib/observability --project node` → 113 passed；`src/lib/docs` 双语门禁测试同绿；
  - `pnpm check:cron-contract` → `✅ … 84 篇文档里的调度事实都能在仓库里找到对应 …`；
  - 变异核对（真实文档，跑完从 `/tmp` 还原并确认 `git status` 干净）：给 `docs-site/email.md` 追加一条
    仓库里不存在的表达式 → `CRON_DOC_STALE_SCHEDULE`；再追加一条未调度的路由 → 两条各报一次；
  - 复跑全量：`pnpm type-check` → 0；`pnpm lint` → 0；`pnpm test` → 193 文件 / 2,200 用例全绿。
- 风险 / 回滚：新规则会让「文档写一条仓库里不存在的调度」在 PR 阶段失败；已确认现存 84 篇全部通过，
  因此不会挡任何在途工作。回滚 = revert 本 commit（抽取共用一并回退）。
- 下一项：推送本分支（D03 + D01 三个 commit）开 PR；部署侧仍欠一次复核——
  生产 `/api/health` 是否真的开始上报 SHA。
- 更新时间：2026-09-22（UTC 10:15 前后）。

## 2026-09-22 — v0.11.0 缺口审计补档（D03），核对方法落成模板


- 里程碑 / 版本：关闭 v0.12.0 的 D03；产物服务于后续每次发布。
- 状态：DONE。
- 分支 / commit：`docs/release-gap-audit-v0.11.0`（基于 main `8037bbd`）。
- 为什么做：缺口审计系列在 v0.10.0 之后断了，而 v0.11.0 是第一个「有迁移 + 有不可逆用户操作」的版本，
  最需要这份审计。更根本的问题是方法只存在于一次一次的记忆里——v0.6.0 退出报告当时重新核对了
  100 项，但没人写下**怎么核**，所以下一版又得从零开始，或者干脆不核（就是断档的原因）。
- 完成内容：
  1. `docs/operations/release-gap-audit-v0.11.0.md`：按 v0.10.0 的骨架逐条核对，结论是
     「冻结完整、生产已跑 0.11.0、但 tag 不该打」；退出标准表把 A10 / H08 / E01–E09 / J02–J05 / J07 /
     D 域各自指向门禁或执行记录，并单列「冻结之后新发现的缺口」三条（PR #68 两条、PR #69 一条）。
  2. **审计副产物：量出范围口径不一致**。`release-runbook-v0.11.0.md` 声称范围是
     「E01–E10、H07–H10、A10、J02–J07、依赖稳定化」，按 `[0.11.0]` 的 35 条逐项对差集后发现：
     声称在内的 H07 / H09 / H10、E08 / E10 本版章节里根本没有条目（更早就完成了），J06 只做到
     「无副作用 6/6 + 只读 3/6」；反过来整个 D 域（5 道 i18n/a11y 门禁 + 74 处逻辑方向迁移）
     是真交付了却没写进范围段。另外记下一条治理事实：`D01` 这类编号在 v0.6.0 池与 v0.12.0 池
     含义不同，引用必须带池子名。
  3. `docs/operations/release-audit-template.md`：五条硬规则（三档状态要什么证据、「文档已写」不算证据、
     门禁自身要做变异复核、范围由 CHANGELOG 生成、四种状态不得互相冒充）+ 输入清单 + 逐条核对步骤 +
     九节文件骨架 + 「本审计无法核对的部分」清单。
  4. 防断档：`.github/RELEASE_CHECKLIST.md` 文档段新增一条「本版本缺口审计已按模板产出」，
     由人工在冻结时勾选（`check:release-docs` 按版本拼路径校验三份 runbook，管不到这个系列）。
- 变更文件：两份新文档、`CHANGELOG.md`、`.github/RELEASE_CHECKLIST.md`、
  `docs/roadmap-0.12.0.md`（D03 收口）、本条目。
- 验证命令与结果：`pnpm check:release-docs` → `✅ (v0.11.0, 7 artifacts)`；
  `pnpm check:docs` / `check:changelog` / `check:gates` / `check:bilingual-docs` 各自通过；
  `pnpm check:all` → exit 0（`✅ 全部校验通过`，193 文件 / 2,194 用例）。本轮只改 markdown 与新文档，
  未重跑 `verify:build`（构建面由同日合并的 PR #69 覆盖）。
  **一次真实的偶发失败值得记下来**：第一次 `check:all` 停在 `check:security` 的
  `pnpm audit: report is missing metadata`，复跑即通过——`pnpm audit --json` 对注册表的一次瞬时失败
  没有 `metadata` 字段，门禁按「读不懂 ≠ 没有漏洞」失败封闭。看到这条不要当成配置坏了，
  也不要为了让它变绿去放宽审计强度。
  审计里出现的每条命令都要求真实存在（`check:docs` 与 `check:test-matrix` 会拒绝文档引用不存在的脚本）。
- 阻塞 / 风险：审计判定 v0.11.0 **仍未发布**（缺 B03 隔离账号演练与 commit 归属证明），
  这是结论不是本条目的阻塞；模板属纯文档，回滚 = 删除两份文件与两处引用。
- 下一项：D01（docs-site 里 cron 路径 / 环境变量名 / 表名与迁移号纳入门禁，
  需注意 feature flag 名是 `flag("PASSKEY")` 组合出来的、以及 SQL 关键字与 `VERCEL_ORG_ID` 这类
  非文案 token 的停用表）；以及部署后回来复核生产 `/api/health` 是否真的上报 SHA。
- 更新时间：2026-09-22（UTC 09:40 前后）。

## 2026-09-22 — `/api/health` 上报构建 commit，冒烟从此能断言部署身份


- 里程碑 / 版本：v0.12.0 的 B01 残余 + B02 前置；顺带修一处双语文档的事实错误。
- 状态：DONE（代码与文档侧闭环；对生产的有效性要等下一次部署验证）。
- 分支 / commit：`feat/health-build-identity`（基于 main `a322a4e`）。
- 为什么做：上一轮取冒烟证据时撞上硬事实——`/api/health` 只有 `version`，
  而发布 runbook 的停止条件写着「无法证明部署 commit 与验证 commit 相同」。
  0.11.0 之后 main 上又夹了纯文档提交，从外部看它们都是「0.11.0」，回滚不知道该回到哪一个。
- 完成内容：
  1. `src/app/api/health/route.ts`：新增 `commit`，取构建时内联的 `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA`
     （Vercel 自动提供，语义就是「这次构建是哪个 commit」），回落运行时 `VERCEL_GIT_COMMIT_SHA`，
     空串按未知处理，两者皆无 → `null`。
  2. `scripts/production-smoke.js`：`--expected-commit` / `EXPECTED_APP_COMMIT`，按前缀匹配（短 SHA 可用）、
     少于 7 字符拒绝解析、**生产不上报 `commit` 时判失败**；health 的 detail 与证据 JSON 都记录观测值
     （顶层新增 `commit` / `expectedCommit`）。
  3. `scripts/check-production-version.js`：同样接受期望值，但**默认不断言**并写明原因——
     两次部署之间生产落后于 `main` 是常态，硬断言会让定时作业天天红在无关的事上；它只把观测到的
     commit 打进 summary 与证据。
  4. `.github/workflows/production-smoke.yml` 新增 `expected_commit` 输入（手动发布 smoke 用）。
  5. `docs-site/{,zh-CN/}pages.md` 把 `/api/health` 的说明从「数据库连接、Supabase 状态、**内存使用**」
     改成实际有的东西（响应里从来没有内存指标），双语同步。
- 变更文件：health 路由与其单测、两个脚本、workflow、`docs/architecture/07-api-routes.md`、
  `docs/architecture/12-deployment.md`、`.github/RELEASE_CHECKLIST.md`、
  `docs/operations/production-smoke-v0.11.0.md`、`release-runbook-v0.11.0.md`、roadmap、CHANGELOG、
  新增 `src/lib/production-version-drift.test.ts`、本条目。
- 验证命令与结果：
  - `npx vitest run src/lib/production-smoke.test.ts src/lib/production-version-drift.test.ts src/app/api/health --project node`
    → 17 passed（路由 3 条 commit 用例 + 冒烟 4 种组合 + 漂移脚本 3 条）；
  - `pnpm check:production-smoke` / `pnpm check:workflows` → 通过（新增输入与既有触发守卫共存）；
  - `pnpm check:all`、`pnpm type-check`、`pnpm verify:build`、`pnpm test:coverage` → 见下「提交前复跑」。
- 风险 / 回滚：`/api/health` 是只增字段，现有消费者（`health-probe.js`、`check-health.js`、
  Docker HEALTHCHECK、e2e/smoke）都是按字段读取，没有键集合相等断言；回滚 = revert 本 commit。
  **注意 `commit` 在 Vercel 之外恒为 `null`**，自建部署要自己注入同名环境变量。
- 下一项：**合并部署后用 `curl /api/health` 确认生产真的上报 SHA**——这是本条目唯一还没落地的部分；
  随后 D01（docs-site 可机器核对事实）、D03（v0.11.0 缺口审计）。
- 更新时间：2026-09-22（UTC 09:10 前后）。

## 2026-09-22 — 生产冒烟证据落地（B01）+ 手动 smoke 作业其实从未跑过


- 里程碑 / 版本：v0.11.0 发布证据（B01）；顺带修 `Production Smoke` workflow 的一条真实 CI 缺陷。
- 状态：DONE（无副作用 6/6 已入库；tag 仍不打，原因见「阻塞」）。
- 分支 / commit：`fix/production-smoke-schedule-guard`（基于 main `23a2677`）。
- 为什么做：退出标准第 2 条要求「B01 有执行记录（UTC 时间、命令、状态码、artifact 指纹）」。
  09-21 时它被 Vercel 构建配额挡住（生产还是 `0.10.0`），当时把它记成阻塞是对的；
  今天直读 `/api/health` 发现生产已经是 `0.11.0`——前置没了，证据却还挂着「⏳ 待执行」。
- 完成内容：
  1. **取证据**：本地 `node scripts/production-smoke.js https://indie-stack-theta.vercel.app
     --expected-version 0.11.0` → `6/6 passed`（08:05:00Z）；`Production Smoke`
     `workflow_dispatch` run `35702965727` 两作业 success，artifact zip SHA-256
     `7075985c…dbe1dc`；定时 run `35700843878`（07:41:07Z）的 `smoke-main` 也已转绿。
     结果按行写进 `docs/operations/production-smoke-v0.11.0.md`（含状态码、header 快照、JSON 指纹），
     只读一节的迁移基线行改指 runbook 差异 1 的云端复核记录，不再挂「待执行」。
  2. **当场查出并修掉一条 CI 缺陷**：`smoke`（手动）作业与 `smoke-main` 共享同一个 `on:`，
     而它的 URL 与超时取自 `inputs.*`。schedule 触发时 `inputs` 为空，于是这个作业**每次定时运行**
     都以 `Error: --timeout-ms requires a value` 失败、从未访问生产（09-21 与 09-22 两份日志一致）。
     后果不是「多一条红」那么简单：真正在报告版本漂移的是 `smoke-main`，而它此刻已经绿了，
     看红色 workflow 名的人会得出「生产在漂移」的错误结论。
  3. **让它不可能再悄悄发生**：`pnpm check:production-smoke` 新增两条规则——读 `inputs.` 的作业必须有
     作业级 `if:` 排除 schedule（`SMOKE_MANUAL_TRIGGER_GUARD_MISSING`）、每个作业的 artifact 名必须等于
     契约里自己的名字（`SMOKE_ARTIFACT_NAME_DRIFT`）。后者同样是被实测逼出来的：两个作业此前都上传成
     `production-smoke-evidence`，一次 dispatch 留下两份 `production-smoke.json`，
     `gh run download -n production-smoke-evidence` 只落地一份且**不报错**（08:06 那次拿到的是
     `smoke-main` 的 08:06:29 版本，手动作业的 08:06:27 被静默覆盖）。
  4. 契约模块补 docblock（为什么需要触发守卫、为什么 artifact 名是契约的一部分），
     测试夹具改成带 `env: ${{ inputs.* }}` 的真实形状并加 4 项变异用例；
     `docs/testing.md` 门禁表、`docs/architecture/12-deployment.md`、`.github/RELEASE_CHECKLIST.md`
     同步；CHANGELOG 加一条 Fixed 与一条 Known Limitations。
  5. 订正三处已经过期的当前状态断言：runbook「生产仍返回 `0.10.0`／等配额恢复再打标签」、
     冒烟矩阵「生产停留在 `0.10.0` 期间它会每天失败」、以及构建配额段落的「必然失败」措辞。
- 验证命令与结果：
  - `npx vitest run src/lib/deployment/production-smoke-contract.test.ts` → 8 passed；
  - `pnpm check:production-smoke` → `✅ … 8 个工作流`；`pnpm check:workflows` →
    `✅ 8 个工作流 / 14 个作业 / 41 个 action 引用`；
  - 变异核对（真实仓库文件，跑完从 `/tmp` 副本还原，不用 `git checkout`）：删掉 `if:` 行 →
    `❌ [SMOKE_MANUAL_TRIGGER_GUARD_MISSING]`；把定时作业 artifact 名改回同名 →
    `❌ [SMOKE_ARTIFACT_NAME_DRIFT]`；还原后两条规则同时通过；
  - `pnpm check:all` / `pnpm verify:build` / `pnpm test:coverage` 见下方「提交前复跑」。
- 阻塞（不因本 PR 消失）：**tag `v0.11.0` 仍不打**。缺两条前置——①账户删除端到端演练（需可牺牲账号，
  B03）；②`/api/health` 不暴露构建 SHA，`0.11.0` 之后的纯文档提交在生产上不可区分，
  而 runbook 的停止条件正是「无法证明部署 commit 与验证 commit 相同」。②是可修的，已记进
  Known Limitations 作为下一项。
- 风险 / 回滚：workflow 改动只影响 `Production Smoke`（无副作用 GET + 一次故意非法 webhook POST），
  且让定时运行少一个必然失败的作业；回滚 = revert 两个 commit。
- 下一项：把构建 SHA 纳入 `/api/health` 与 smoke 断言（Vercel 注入 `VERCEL_GIT_COMMIT_SHA`），
  让「部署 commit == 验证 commit」成为可机读证据；随后 D01（docs-site 可机器核对事实）。
- 更新时间：2026-09-22（本地 16:20 前后，UTC 08:05–08:20）。

## 2026-09-22 — 文档不再复述会过期的数字（D04）

- 里程碑 / 版本：v0.11.0 之后的 `[Unreleased]`；关闭 v0.12.0 的 D04。
- 状态：DONE。
- 分支 / commit：`docs/drop-volatile-doc-numbers`（基于 main `8b91740`）。
- 为什么做：今天为了 digest 那一条改动，我手工修了 4 处文档里的数字（service-role 87→86、
  指标 15→14、E2E 端点 9→8、任务池三档计数）。**需要人追着改的数字就是错的数字**——
  它们不会自己报错，只会在下一次核对时被重新量出来。D04 就是把这类断言换成指向命令与清单文件。
- 完成内容：
  1. `docs/testing.md`：去掉各门禁小节里的「规则实现有 N 条单测」，统一写成「纯函数，单测覆盖」；
     把文件开头既有的约定「本文不写用例条数」显式扩展到局部计数（某个规则文件有多少条测试）。
  2. `docs/testing.md` 覆盖率小节：不再抄 `coverage.thresholds` 的四个值，改指
     `vitest.config.ts` 与 `pnpm test:coverage` 的不达标即失败。
  3. **扫描当场发现两处已经是错的**：`docs/testing.md` 与 `docs/db/security-audit.md` 的
     `pnpm exec supabase db reset` 示例注释都写着「25 个迁移」，而 `check:supabase-security`
     今天打印的是 33 个迁移。这类数字不会自己报错，正是 D04 要消灭的形态。
  4. `docs/db/security-audit.md`：静态审计状态段改为列类别、不列数量，并写明以
     `pnpm check:supabase-security` 与 `src/lib/security/admin-client-boundary.ts` 为准；
     策略名那段的「35 条策略」去掉条数；service-role 清点表保留（它就是这份文档的内容），
     但标注为「会过期的快照」并给出以谁为准。
- 明确保留：历史版本页 `docs-site/v0.*.md`、`docs/roadmap-*.md`、退出报告、gap 审计与
  runbook/演练记录里的数字——它们是带日期的证据，不是当前断言；改它们等于伪造历史。
- 变更文件：5 个——`docs/testing.md`、`docs/db/security-audit.md`、`docs/roadmap-0.12.0.md`、
  CHANGELOG、本条目。
- 验证命令与结果：
  - `grep` 复扫 living docs 已无「N 条单测 / N 个迁移」形态的断言（命中的只剩带日期的记录类文档）；
  - 纯文档改动，不涉及代码路径；仍按约定复跑 `pnpm check:all` 与 `pnpm verify:build`（结果见提交记录）。
- 风险 / 回滚：无功能影响；回滚 = revert 本 commit。
- 下一项：v0.12.0 的 C01（mock 请求级隔离，顺带解锁 C03 剩下的那条 E2E）。

## 2026-09-22 — 双语调度事实门禁 D02 接线，并修掉它当场查出的三处漂移

- 里程碑 / 版本：v0.11.0 之后的 `[Unreleased]`；关闭 v0.12.0 的 D02。
- 状态：DONE。
- 分支 / commit：`docs/bilingual-schedule-facts`（基于 main `aa64388`）。
- 为什么做：`docs-site/` 与 `docs-site/zh-CN/` 是同一份文档的两种语言，却没有任何门禁保证两边
  说同一件事。v0.6.0 的 I01 就是这么烂掉的（EN 写「外部 cron 逐小时调度」、zh 写「每天 09:00 UTC」，
  两条互斥陈述长期并存，而 digest 的投递语义恰恰取决于这个频率）。这类漂移只有人分别读两种语言
  时才会被发现，所以它实际上不会被发现。
- 完成内容：
  1. `src/lib/docs/bilingual-facts.ts`（纯函数）：抽出每页的 5 字段 cron 表达式与 `HH:MM UTC`
     时刻，要求 EN 与其 zh 配对的**集合完全相等**——一边提到一边没有也算失败，因为「只改一种语言」
     正是漂移的发生方式。cron 合法性复用 `isValidCronSchedule`，避免把散文里的数字串当表达式。
     失败封闭：`DOC_NO_PAIRS`（零配对＝目录被清空）、`DOC_PAIR_MISSING`（删中文页来让门禁闭嘴）、
     `DOC_SOURCE_EMPTY`（空文件不等于没有差异）。**故意不比对文案**：试过用同义词表判
     "hourly" ↔「每小时」，实测 6 处误报（`每日` / `每天` / `一天一次` 表达太散），
     那会把门禁退化成翻译质量检查，故只守结构化事实并在文档里写明这条局限。
  2. IO 与接线：`scripts/lib/bilingual-docs-check.js` + `scripts/check-bilingual-docs.js` +
     `pnpm check:bilingual-docs` + `check-all.sh` + CI 步骤（`check:gates` 当场要求接线，
     未接 CI 会失败）；双语 `docs-site/scripts.md` 与 `docs-site/testing.md` 的 `docs` 行同步登记。
  3. **门禁接线时当场量出三处存量漂移，全部修掉**：
     - `docs-site/web-push.md:79`（EN）说 `/api/cron/push-retry`「scheduled every 15 minutes in
       `vercel.json`」——该表达式在 2026-09-21 的 `67901cc`（PR #32）就改成了 `0 22 * * *`，
       Hobby 也根本不允许每天多次；按代码事实改写，并给中文版补上 `0 22 * * *` 表达式引用；
     - `docs-site/v0.8.0.md`（EN「every 15 minutes」vs zh「每天 22:00 UTC」）：历史发布页各留
       本来的事实，两边加**同一条**带日期勘误（现行调度与它为何不同）；
     - 顺带确认 `docs-site/email.md` 双语在 A01 之后已经对齐（这次是它通过，不是它被修）。
  4. 文档：`docs/testing.md` 新增「双语调度事实门禁（D02）」小节（含为什么不比对文案与
     核对面以命令输出为准、文档不复述的约定）。
- 变更文件：20 个——新规则与其单测、IO 实现、CLI 入口、`package.json`、`scripts/check-all.sh`、
  `.github/workflows/ci.yml`、`docs/testing.md`、双语 `docs-site/scripts.md`、双语
  `docs-site/testing.md`、`docs-site/web-push.md`、双语 `docs-site/v0.8.0.md`、
  `docs-site/zh-CN/web-push.md`、`docs/roadmap-0.12.0.md`、CHANGELOG、本条目。
- 验证命令与结果：
  - 变异核对（真实仓库）：把 `docs-site/zh-CN/email.md` 的 `0 9 * * *` 改成 `0 5 * * *` →
    `❌ [DOC_CRON_MISMATCH] docs-site/email.md cron 表达式与中文版不一致：缺少 0 9 * * *；多出 0 5 * * *`
    （exit 1），改回后 `✅ 双语调度事实一致：27 对文档 / 7 个 cron 表达式 / 3 个 UTC 时刻两边写法相同`；
  - 新增测试 19 条（规则 13 + IO 6），`bilingual-facts.ts` 自身 statements 98.43 / lines 100；
  - `pnpm check:all` → exit 0；`pnpm verify:build` → exit 0（192 文件 / 2,183 用例、
    Bundle 2845.5 kB 在 2733.8 kB 基线内、`✓ Compiled successfully`）；`pnpm test:coverage` → exit 0
    （全局 branches 91.68，地板 90）。
- 风险 / 回滚：新门禁可能因第三方页面新增单语调度事实而失败——这是它的工作方式，报错会指名缺哪一侧；
  若某个事实确实只该出现在一种语言，需要显式改文档结构而不是加豁免。回滚 = revert 本 commit。
- 下一项：v0.12.0 的 C01（mock 请求级隔离，顺带解锁 C03 剩下的那条 E2E）。

## 2026-09-22 — 跳过投递必须留下计数：A04 静态契约接进 cron 门禁

- 里程碑 / 版本：v0.11.0 之后的 `[Unreleased]`；关闭 v0.12.0 的 A04。
- 状态：DONE。
- 分支 / commit：`feat/cron-skip-contract`（基于 main `6ff42ed`）。
- 为什么做：digest 那次 P0 的根因不是错峰门控本身，而是**跳过却不计数**——那一轮在指标上表现为
  `pulled=N, sent=0, failed=0` 的「成功」。A01 修掉的是这一次；没有静态约束时，下一条
  `if (...) continue;` 照样能安静地把一整类用户挡在投递之外。A04 要把这条教训变成 PR 阶段就失败的门禁。
- 完成内容：
  1. 新增 `src/lib/observability/cron-skip-coverage.ts`：用 `typescript` 解析器（与 service-role
     清单同一套做法）找出 worker 路由里**带条件的 `continue`**，要求同一 if 分支内留下证据——
     上报该 worker 注册过的 skip 指标（且带 `reason` 维度），或对该轮返回对象里已上报的计数器做
     `+=`（发送失败走的正是 `failed +=`，那不是静默跳过）。只认这一种形状并在文件头写明边界：
     无条件 `continue`、跨函数的 `if`、提前 `return` 都不归它管，免得规则变成猜谜。
  2. 注册表 `CRON_WORKERS` 增加 `skipMetrics`，三个 worker 全部显式声明（digest 是
     `["cron.digest.skipped"]`，另两个是 `[]`），并校验它必须是 `metrics` 的子集——否则那条指标
     既不会被要求上报也不会进告警文档，等于假登记。新增 4 个规则码：`CRON_SKIP_UNCOUNTED` /
     `CRON_SKIP_REASON_MISSING` / `CRON_SKIP_METRIC_UNDECLARED` / `CRON_SKIP_UNPARSEABLE`
     （源码解析不了时失败封闭，不把语法错误当成「没有跳过」）。
  3. `/api/cron/digest` 补上两处跳过计数：`reason=no_email`（资料没有邮箱）与
     `reason=preference`（用户把队列涉及的类型全关了），`value` 为该用户被跳过的条数；指标 14 → 15。
     这两条分支**此前一条测试都没有**（正是它能静默的原因之一），现各补一条并断言不发信、
     不标已发、也不累加重试计数。
  4. `sentry-alerts.md`：登记指标与两个 reason 取值；新增「摘要整轮没发出」的判定规则
     （`cron.digest.completed{pulled>0, sent=0}` 连续 2 轮 → 按 `reason` 拆分排查）；补去重说明
     （按用户逐条上报，告警看 `reason` 聚合后的条数而不是样本数）。
  5. 文档面同步：`docs/testing.md` 的门禁清单与规则本体位置、双语 `docs-site/scripts.md` 的
     gate 描述、双语 `docs-site/email.md` 的 Digest 小节、`docs/design/email-templates.md`
     的运行可观测小节。成功日志额外自报「N 处条件跳过均有计数证据」，让「核对过多少条」本身可核对。
- 变更文件：19 个——新规则模块与其单测、`cron-contract.ts`、`scripts/lib/cron-contract-check.js`、
  digest 路由与其单测、`cron-contract.test.ts` 与 `cron-contract-check.test.ts`、CHANGELOG、
  退出报告 E03 行、`roadmap-0.12.0` 的 A04 收口、告警文档、设计文档、`docs/testing.md`、
  双语 scripts / email 文档、本条目。
- 验证命令与结果：
  - **变异核对跑在真实仓库上**：删掉 no_email 分支的 `recordMetric` →
    `❌ [CRON_SKIP_UNCOUNTED] digest: src/app/api/cron/digest/route.ts:121 的条件跳过（!profile?.email）
    没有任何计数证据…`（exit 1）；把指标换回但去掉 `reason` → `CRON_SKIP_REASON_MISSING`（exit 1）；
    改回后 `pnpm check:cron-contract` →
    `✅ 3 个 worker / 15 个指标 / 2 处条件跳过均有计数证据 / 调度表达式与 vercel.json 及运维文档一致 / 2 个平台级豁免`；
  - 新增测试：规则本体 14 条（含「显式 key 的返回计数器也算证据」「顶层循环的 continue 不在范围内」
    「源码不可解析失败封闭」）、契约 6 条、CLI/IO 2 条（其中一条证明「fixture 里有未计数跳过 →
    CLI 返回 1」）、digest 路由 2 条；
  - `pnpm test:coverage` → 190 文件 / 2,164 用例通过，全局 statements 96.97 / **branches 91.67** /
    functions 97.71 / lines 97.96（阈值 91/90/93/92，`vitest.config.ts`），新规则自身
    branches 93.93、lines 100；
  - 提交前最后复跑：`pnpm check:all` → exit 0；`pnpm verify:build` → exit 0
    （lint / type-check / 190 文件 2,164 用例 / Bundle 在 2733.8 kB 基线内 / `✓ Compiled successfully`）。
- 风险 / 回滚：只加门禁与指标，不改任何投递判定；新指标的增量是「每轮每个被跳过的用户一条」。
  回滚 = revert 本 commit。已知边界：不看提前 `return`、不看 `if/else` 里的隐式不投递，
  也不覆盖非 cron 路径（实时通道 `email-notify.ts:90-91` 同样按条件早退）——那部分与出队语义
  一起属于 A05。
- 下一项：v0.12.0 的 C01（mock 请求级隔离，顺带解锁 C03 剩的那条 E2E）；A05 需要用户先定出队语义。

## 2026-09-22 — 摘要邮件定案落地：删掉「本地恰好 08:00」门控，改为一轮每人一封

- 里程碑 / 版本：v0.11.0 之后的 `[Unreleased]`；关闭 v0.12.0 的 A01 与 A02。
- 状态：DONE（等待合并后部署到生产观察一轮调度）。
- 分支 / commit：`feat/digest-daily-window`（基于 main `136e6c2`）。
- 决策来源：退出报告核对出的 P0（`isDigestHour` 要求用户本地小时恰好等于 8，而 Hobby plan
  每天只有一个固定 UTC 时刻 → 除 UTC-1 时区带外永不投递）列了三条路，用户选
  **「放宽窗口，接受一天一封」**，而不是按时区带加多条 cron 路径或接外部逐小时调度器。
- 完成内容：
  1. `src/lib/email-digest.ts`：删除 `isDigestHour`、`DIGEST_LOCAL_HOUR`、`DIGEST_DEFAULT_TIMEZONE`
     与只服务于它们的 `localHourInTimeZone`（模块回到「只讲正文折叠规则」这一件事）。
  2. `/api/cron/digest`：去掉门控分支、`forceDigestHour` 调试通道与 `deferred` 计数；
     `profiles` 读取里连 `timezone` 列一起收掉（决策不再看它，留着会误导读者）；
     文件头注释写清新语义与「为什么不能既要每天一次又要贴着本地早晨」。
  3. 契约与告警：`CRON_WORKERS` 摘掉 `cron.digest.deferred`（指标 15 → 14）、cadence 改写；
     `sentry-alerts.md` 删除该指标行、完成指标维度、专属告警规则与去重条目。
  4. 死代码清理：`/api/e2e/profile-timezone` 端点整体删除——它的注释声称「mail-flow.spec
     启动后调一次」，实际**没有任何 spec 调用它**（当时 spec 走的是 `x-e2e-force-digest` 头），
     而它存在的唯一理由就是那道门控。同步移除 service-role 清单条目与 3 份文档里的端点行，
     调用点预算 87 → 86（这条改动被 `accepts the committed service-role inventory` 当场拦下，
     说明预算式断言在起作用）。
  5. 文档按新语义重写：`docs-site/email.md` / `zh-CN/email.md` 的 Digest Worker 小节、
     `docs/design/email-templates.md` 的「调度与时区」小节（旧文本还写着「中国用户在北京时间
     08:00-09:00 收到摘要，其他时区各自错峰」）、注册表 cadence。双语 `v0.5.0.md` 各加一条
     带日期的勘误（历史发布说明保留原文，但读者必须能看到那道门控已不存在），并顺手改掉
     英文页「把 digest cron 改成每小时」的升级建议——Hobby 从来不允许，中文页写的是每天一次，
     两页此前互相矛盾。
  6. 回归钉子：路由测试新增「上海 / 纽约 / 圣保罗三个时区在同一时刻各自收到一封」，
     门控一旦被写回来这条立刻失败；删掉原先 3 条以门控为前提的用例。
     `e2e/mail-flow.spec.ts` 同步去掉 `x-e2e-force-digest` 头——它以前验证的是「强制绕过门控后的发送」，
     与生产配置不是同一条判定；现在 E2E 与生产走完全相同的投递路径。
  7. 复核 skip 分支时发现一个**此前就存在、本次没修**的队列问题，写进代码注释与 A05：
     无邮箱与偏好全关两条 `continue` 既不 `markEmailSent` 也不 `markEmailFailed`，
     `email_attempts` 因此永远到不了死信门槛，这些行会永久占住
     `listUnsentEmailNotifications` 按 `created_at` 升序的前 100 个名额
     （`repositories/notifications.ts:46-59`）；攒够 100 条后可投递的新通知再也拉不到，
     表现为每天 `pulled=100, sent=0` + `email.backlog` 单调增长。出队语义需要决策，
     不在本 PR 里顺手改。
- 变更文件：24 个——`email-digest.ts` 与其单测、digest 路由与其单测、`cron-contract.ts`、
  `sentry-alerts.md`、`mail-flow.spec.ts`、`mock-docs.test.ts`（端点地板 9→8）、
  `admin-client-boundary.ts` 与其测试、删除 `src/app/api/e2e/profile-timezone/route.ts`、
  双语 `docs-site/email.md`、双语 `docs-site/v0.5.0.md`、双语 `docs-site/mock.md`、
  `docs/architecture/13-mock-system.md`、`docs/design/email-templates.md`、
  CHANGELOG、退出报告与两份 roadmap、本条目。
- 验证命令与结果：
  - `npx vitest run src/app/api/cron/digest src/lib/email-digest.test.ts src/lib/security src/lib/observability`
    → 全绿（digest 路由 11 条，含新的三时区用例）；
  - `pnpm check:cron-contract` → `✅ 3 个 worker / 14 个指标`；`check:mock-docs` →
    `✅ 18 张表 / 8 个 E2E 端点 × 3 份文档`；`check:security`/`check:supabase-security`、
    `check:changelog`、`check:docs` 各自通过；
  - `npx playwright test e2e/mail-flow.spec.ts` → **3 passed**（去掉强制头之后仍发出 `sent: 2, groups: 1`，
    死信那两条照旧；证明 E2E 走的是与生产相同的判定）；
  - **提交前复跑**：`pnpm verify:build` → exit 0（lint / type-check / 189 文件 2,140 用例 / `Bundle: 当前 2845.5 kB
    / 基线 2733.8 kB` → `✅ Bundle 体积在基线范围内` / `✓ Compiled successfully`）；其后的改动只剩
    markdown，改完再跑 `pnpm check:all` → exit 0、`✅ 全部校验通过`。
    两份日志里各有若干 `❌ …失败` 行，来自**故意断言失败输出**的门禁单测，不是门禁本身报错。
  - **待补的运行证据**：生产上要看一轮 09:00 UTC 调度后 `cron.digest.completed{sent>0}`
    且 `email.backlog` 不再单调增长——本机没有云端权限（`VERCEL_TOKEN` 是占位值），
    这项留作合并部署后的人工复验，判据与 v0.12.0 的 B01 同型。
- 风险 / 回滚：所有有待发通知的用户会从「几乎收不到」变成「每天 09:00 UTC 一封」，
  对非 UTC-1 用户是**新增**的邮件量（每人每天至多一封，不会翻倍：`markEmailSent` 之后不再拉取）；
  回滚 = revert 本 commit（门控与其测试一起回来）。
- 下一项：v0.12.0 的 A04（把「按用户条件跳过就必须上报跳过计数」固化为契约），
  以及不依赖生产的 C01（mock 请求级隔离）。本次改动另留下两个**需要用户定方向**的点，
  都记在 `docs/roadmap-0.12.0.md`：A05 的不可投递条目出队语义，与 A01 下新增的
  「`profiles.timezone` 失去唯一消费者，资料页却仍在要求填写」。两者都不阻塞 A04 与 C01。

## 2026-09-23 — 先看清积压的形状，再决定怎么出队：管理面板补上待发队列三读数（A05 前半）

- 里程碑 / 版本：v0.12.0 A05 的可观测那一半。
- 状态：PARTIAL（面板读数 ✅；被跳过条目的出队语义 ✗，仍是等产品决策的那一条）。
- 分支 / commit：`feat/admin-email-queue-observability`（基于 `e969035`）。
- 为什么做：A05 的核对结论是「无邮箱 / 偏好全关两类条目永远出不了队，攒够 100 条后新通知再也拉不到」。
  但出队语义有三种做法（复用死信、新增 `email_skipped_reason` 过滤列、拉取侧翻页跳过），三者都会改变
  面板与既有指标口径，属于产品决策，不接受顺手用 `markEmailSent` 掩盖。而**在看清规模之前讨论它等于猜**——
  今天没有任何一个读数能回答「队伍多大、最老一条卡多久、这种轮次出现过几次」。
- 完成内容：
  1. 纯规则模块 `src/lib/notifications/queue-diagnostics.ts`：`pending` / `oldestAgeMs` /
     `emptySendRounds` / `stale`（48h = 两个日调度周期），外加年龄分档 `describePendingAge()`。
     两条刻意的口径选择写进头部注释：① 空发送轮次**只数** `pulled>0 && sent===0 && failed===0`，
     `failed>0` 已经由 A04 的跳过可见性与 `email_attempts` 表达，混进来会让「投递失败」和
     「根本没有可投递对象」两种故障共用一个数字；② 分档只出数值与单位档，不拼字符串——
     单位词属于文案，天档起点必须与 stale 阈值同刻度，否则会出现「显示 1 天却已经 stale」。
  2. 仓储层：新增 `oldestUnsentEmailCreatedAt()`（与 worker 拉取同序、`limit 1`）与
     `listRecentEmailWorkerRuns()`（默认 20 轮）。三处待发队列读法的**一致性是这条改动的全部价值**，
     但 Supabase 的查询链逐列泛型，抽共享函数会把类型压成清单里的第一张表（`pnpm type-check` 当场报），
     于是改成：四段过滤各处写全、只把死信条件收成 `EMAIL_DEAD_LETTER_FILTER` 常量，
     再由测试钉「三个口径的过滤调用逐项相等」。
  3. 面板：admin 概览页新增「邮件待发队列」卡片，值 = 条数，描述 = 最老一条年龄 + 空发送轮次，
     stale 时换成带「已卡住」的另一个键。双语 `overview.stats.*` 新增 9 个键（含分钟/小时/天三档
     与一个「未知时长」兜底，用于两条查询之间条目刚好被发走的竞态）。
     读数拼装放在 `queue-observability.ts` 而不是组件里——`Date.now()` 写在 Server Component
     体内被 `react-hooks/purity` 判为不纯（这条规则是对的：时钟不该在渲染里），而模块顶层取一次
     又会让年龄从进程启动起就不动；拼装另外也只剩一处。
  4. service-role 清单：两个新只读调用点，预算 86 → 88，`docs/db/security-audit.md` 的快照同步
     （模块数不变，仍 31）。
  5. 顺手修掉一个真实缺陷（另见 CHANGELOG Fixed）：`a11y.spec.ts` 的 `page.goto(pageInfo.path)` 与
     `smoke.spec.ts` / `responsive.spec.ts` 的 7 处调用不带 `appUrl()`，靠 `baseURL` 解析＝并行时全打回
     slot 0；C02 那条规则按字面量匹配，正好放过「路径装在变量里」。规则改为逐行看调用点。
- 变更文件：25 个——`queue-diagnostics.ts` / `queue-observability.ts` 各带单测、
  `repositories/notifications.ts` 与其单测、`repositories/worker-runs.ts` 与其单测、
  `admin/page.tsx`、双语 `messages/admin.json`、`admin-client-boundary.ts` 与其测试、
  `docs/db/security-audit.md`、`e2e-shard-policy.test.ts`、`docs/testing.md`、
  `e2e/admin-contact-mfa.spec.ts`、`e2e/a11y.spec.ts`、`e2e/smoke.spec.ts`、`e2e/responsive.spec.ts`、
  CHANGELOG、`roadmap-0.12.0.md`、双语 `docs-site/email.md` 与本条目。
- 验证命令与结果：
  - 变异核对（新断言逐条「故意做坏」）：纯模块 7 项（去掉 `pending>0` 前置、把 `failed>0` 混进空发送、
    `>=`→`>`、去掉负数钳制、小时档改 24h、`null`→`0 分钟`、天档四舍五入）全红；
    仓储 7 项（最老一条忘掉共享过滤 / 去掉 order / 去掉 `?? null`、三列 `select`→`*`、
    排序反向、缺列不补 0、默认 limit 改 5）全红；
    口径一致 4 项（任一消费方少一段 `.eq/.in/.or`、最老一条少 `.limit(1)`）全红；
    组装 4 项（`nowMs` 写死 0、丢掉 recentRuns、丢掉 oldestCreatedAt、pending 硬编码 0）全红；
    隔离规则 4 项（变量式 goto、裸相对 request、裸相对字面量、写死 3100）全红且 `appUrl()` 对照组绿。
  - `CI=true pnpm test` → 全绿（新增 20 条：纯模块 11 + 读数组装 2 + 通知仓储 4 + 运行记录仓储 3）。
  - `E2E_BASE_PORT=3101 pnpm test:e2e e2e/admin-contact-mfa.spec.ts -g "待发队列"` → **1 passed**；
    把卡片值改成 `pending + 2` 复跑 → **1 failed**，证明这条 E2E 抓得住数字口径。
- 风险 / 回滚：面板每次打开多两条只读查询（`count head` + `limit 1` + `limit 20`），量级可忽略；
  不改任何发送/出队行为，生产队列语义与改动前完全一致。回滚 = revert 本分支的两个 commit。
- 下一项：A05 的后半（出队语义）等产品决策；A01 剩下的 `profiles.timezone`、C06 的两条孤儿 Server
  Action 同样等决策。可继续自主推进的是 C04 余下部分与文档事实门禁的收尾。

## 2026-09-23 — CI 与本地从此只有一份门禁清单，而「有没有这份清单」这件事换了个更该待的地方（C04）

- 里程碑 / 版本：v0.12.0 C04 收口（第一半是 2026-09-22 把 `check:bundle` 接进 Build job）。
- 状态：DONE。
- 分支 / commit：`ci/single-gate-list`（基于 `e969035`）。
- 为什么做：roadmap 把剩余部分标成「可选」，但两份手工清单的实际后果已经发生过
  （`check:docs` / `check:agents` 曾只存在于本地聚合，CI 从未跑过）。趁 v0.12.0 把它并成一份。
- 完成内容：
  1. `ci.yml` 的 `Lint & Type Check` job：30 步逐个 `pnpm check:*` + `pnpm lint` + `pnpm type-check`
     → 一步 `pnpm check:all`（净删 102 行）。**作业名一字未改**——分支保护的必需检查按名字匹配，
     改它等于改共享配置，不在本条射程内。
  2. `scripts/check-all.sh` 加一条 `trap … ERR`：失败时补打 `❌ 门禁失败：<命令>`。
     CI 界面由此少了一层「哪一步红了」，这一步把那层找回来。
  3. **变异核对量出一个真实空洞**：把 `pnpm check:all` 从 `ci.yml` 删掉后跑 `pnpm check:gates` →
     仍然全绿。原因写在规则自己的注释里——它按「任意 workflow」判定 CI 侧接线，而
     `release.yml` 也跑 `pnpm check:all`，于是「CI 在跑一份清单」这个前提可以由一个**只在打标签时
     才执行**的工作流满足，PR 上门禁一道都不跑。第一步的探针还把「删除没生效」当成「规则放过」：
     needle 字符串不匹配时 `String.replace` 静默返回原文，所以重做的那版先断言 needle 命中再判定。
  4. 约束搬到它该在的地方：`src/lib/ci/workflow-policy.ts` 的 `auditEntryJobs` 新增一条——静态作业
     正文必须出现 `pnpm check:all`（用现成的 `jobRuns`，认块标量），缺即 `CI_TOPOLOGY_DRIFT`；
     逐个写 `check:*` 不算替代。测试 fixture 的 `STATIC_JOB` 因此同时带 `check:all` 与 `check:docs`
     （后者被三条既有反例用例当锚点用），并加一条「删掉聚合入口→只剩一条 drift」的用例。
  5. 文档：`docs/testing.md` 的 CI 拓扑段新增一条（写清代价：单测在本 job 与覆盖率 job 各跑一次）；
     roadmap C04 标注完成与约束落点；CHANGELOG 新增 `### Changed` 段。
- 变更文件：8 个——`.github/workflows/ci.yml`、`scripts/check-all.sh`、
  `src/lib/ci/workflow-policy.ts` 与其测试、`docs/testing.md`、`docs/roadmap-0.12.0.md`、CHANGELOG、本条目。
- 验证命令与结果：
  - `pnpm check:workflows` / `pnpm check:gates` → 通过；
  - `pnpm vitest run src/lib/ci/workflow-policy.test.ts src/lib/release/gate-wiring.test.ts` → 63 passed；
  - 变异：删 `ci.yml` 里的 `pnpm check:all` → 新规则红（`CI_TOPOLOGY_DRIFT`，job=静态作业）；
    从 `check-all.sh` 摘掉 `check:a11y` → `check:gates` 红并点名该门禁；
  - trap 探针：临时脚本跑到一条不存在的门禁 → exit 1 且末行 `❌ 门禁失败：pnpm --silent check:ghost`，
    探针已删除；
  - 待补：本次改的就是 CI 本身，**PR 上这一步真跑一次的绿才算收口**（本地 `pnpm check:all` 只能证明
    聚合入口自洽，证明不了 GitHub 侧那一步存在）。
- 风险 / 回滚：CI 墙钟多一次单测（约 1 分钟）；失败定位从「步骤名」变成「日志末行」。
  回滚 = revert 本 commit（30 步回到 ci.yml，`check:workflows` 的新规则随之下线）。
- 下一项：v0.12.0 任务池里可自主执行的条目已清空，剩余全部需要产品决策（A05 出队语义、
  A01 的 `profiles.timezone`、C06 两个孤儿 Action）或外部权限（B 域发布证据、C05 provider 侧对账）。

## 2026-09-23 — 并行基线第一次跑在 main 上：108 条、零重跑，绿

- 里程碑 / 版本：v0.12.0 C02 的复跑证据（基线此前只在 topic branch 上量过）。
- 状态：DONE（一次可复跑的绿；这条不是门禁，红了按报告记下共享状态冲突）。
- 分支 / commit：`docs/e2e-parallel-baseline-on-main`（基于 `6ab5c30`，只改文档）。
- 为什么做：#78 改的正是并行 E2E 依赖的东西——`e2e/a11y.spec.ts` 的 `page.goto(pageInfo.path)`、
  `smoke.spec.ts` 的 7 处 `request.get("/…")` 换成 `appUrl()`，并给 admin 概览页加了一条真查询队列的用例。
  用例总数从 107 变成 108（`pnpm test:e2e --list` → `Total: 108 tests in 15 files`），
  而基线的全部意义是「在 main 上可复跑」：改动落地后不复跑一次，之前那轮 107/107 说的就是别的分支。
- 完成内容：
  1. `gh workflow run e2e-parallel.yml --ref main` → run `35757758491`（job `106847752074`），
     `PW_FULLY_PARALLEL=true`、全量不带 `--shard`、`E2E_SERVERS=3`、强制 `--retries=0`；
     `gh run watch --exit-status` → **exit 0，conclusion=success**。
  2. 取「多少条通过」时又撞上同一个坑：`check-runs/<id>/annotations` 端点返回 0 字节（与 C02 那几轮一样，
     日志端点也是反复空响应）。所以这里能负责地说出口的是**作业结论 + 零重跑 + 本机 `--list` 的 108 条**，
     而不是从一份拿不到的报告里抄「108 passed / 0 failed」。缺哪句证据就写缺哪句。
- 验证命令与结果：
  - `gh workflow run e2e-parallel.yml --ref main` → run `35757758491`；
  - `gh run watch 35757758491 --exit-status` → exit 0；
  - `gh run view 35757758491 --json conclusion,jobs` → `conclusion=success`，作业
     `Fully parallel E2E, one dev server per worker: success`；
  - `pnpm test:e2e --list` → `Total: 108 tests in 15 files`。
- 风险 / 回滚：无代码改动。回滚 = revert 本 commit。
- 下一项：v0.12.0 池内可自主执行的条目已清空（A05 出队语义、A01 的 `profiles.timezone`、C06 两个孤儿
  Action 等产品决策；B02–B05 与 C05 要外部权限）。生产仍停在 `0.11.0` 且 `/api/health` 不报 `commit`
  （2026-09-22T17:00Z 实测），因此 `smoke:production --expected-commit` 依旧无法闭环——Vercel 侧
  「Deployment rate limited — retry in 24 hours」是平台限制，按既定口径忽略，不绕开任何门禁。

## 2026-09-23 — 三个 patch 依赖落地，peer 冲突确认是存量而不是新伤

- 里程碑 / 版本：v0.12.0 期间的依赖维护（不改功能面）。
- 状态：DONE。
- 分支 / commit：`chore/stabilize-patch-deps`。
- 完成内容：`@sentry/nextjs` 10.75.0→10.75.1、`@tanstack/react-query` 5.103.1→5.103.2、
  `next-intl` 4.14.5→4.14.6，同一 caret 范围内的 patch 版本，package.json 的下限随之上移。
  三个 major 级 dev 依赖（`@types/node` 26、`eslint` 10、`typescript` 7）**刻意不动**：
  它们要的是单独的迁移评估，不是顺手 `update`。
- 一条需要记下的核对：`pnpm install` 报 `@docsearch/react@3.8.2` 要求 `react <19`。
  先怀疑是这次引入的，回去查 `git show main:pnpm-lock.yaml` —— 该包在 main 的锁文件里已有 3 处，
  属 VitePress 搜索链路的**存量** peer 冲突，与本次三个包无关，也不该靠降 React 去「修」。
- 验证命令与结果：
  - `CI=true pnpm verify:build` → exit 0（196 文件全绿、`Bundle 2846.3 kB / 基线 2733.8 kB` 在范围内、
    生产构建 Compiled successfully）；
  - `E2E_BASE_PORT=3101 pnpm test:e2e` → **108 passed**（next-intl 是这次唯一会动到运行时 i18n 的包，
    构建只能证明 `MISSING_MESSAGE`，浏览器侧要真跑）；
  - `pnpm audit --audit-level high --registry=https://registry.npmjs.org` → `No known vulnerabilities found`
    （镜像源没有 audit 端点，必须显式指公有源，否则读到的「零漏洞」是假的）。
- 风险 / 回滚：patch 版本、行为面为零；回滚 = revert 本 commit（锁文件与 package.json 一起回去）。
- 下一项：等依赖审计与通知链路审计的结果，按发现修复。

## 2026-09-23 — 通知链路审计：三处「记录说假话」修掉，另一处记成待决口径

- 里程碑 / 版本：v0.12.0 A 域（投递语义）的缺陷收口 + A05 的第二条静默出队路径登记。
- 状态：PARTIAL（两处代码缺陷已修 ✅；「站内已读即不再寄信」是待决口径，只补了文档与登记 ✅）。
- 分支 / commit：`fix/email-receipt-attribution`（基于 `c6d49ef`）。
- 为什么做：v0.12.0 池内没有可自主执行的条目了，于是改成主动量缺陷——让一个只读代理沿
  digest 路由、实时通知、仓储队列口径、push 重试与新加的队列读数走一遍，要求每条结论带 file:line。
  报告里两条我复核后确认是真缺陷，一条复核后**否掉**，一条是新的口径事实。
- 完成内容：
  1. `email-notify.ts`：`markEmailSent` 原本和 `sendResendEmail` 共用一个 `try`，回执写失败会被
     catch 成「发送失败（留待 cron 重试）」。改成发送与回执各自上报（`push-retry.ts` 早就是这个形状）。
     重复投递是 at-least-once 的既有代价，本轮修的是**文案说谎**。
  2. `cron/digest/route.ts`：`recordFailedRun` 写死 `pulled: 0` → 提到 `try` 外记真实值；
     并修失败原因抽取（PostgREST 抛的是普通对象，`String(error)` = `"[object Object]"`），
     新增 `failureText()` 认 `Error` / 带 `message` 对象 / 其余 `String()`。
  3. 文档与登记：双语 `docs-site/email.md` 补上队列条件含 `is_read=false` 的后果；
     roadmap A05 记下这是**第二条静默出队路径**——站内先读过就不再寄，且该行从 `email.backlog`
     消失，也就是说它会**掩盖**第一条积压（队列越堵读数越小）；A05 定夺时必须两条一起判。
  4. 复核后否掉的审计结论（记下以免下次又照抄）：报告说 `push-retry.ts` 成功分支与 email 同罪——
     实际它是 `markSent` 单独一个 `try` 且无论如何 `return "sent"`，不会重复投递；真正可疑的是
     `scheduleRetry` 里 `markRetry` 写失败后 `attempt_count` 冻结（行会反复重试而不进死信），
     本轮**没有动**它，需要的是重试写路径的设计而不是补一句日志。
- 变更文件：9 个——`email-notify.ts` 与其单测、`cron/digest/route.ts` 与其单测、
  `docs-site/email.md` 双语两份、`docs/roadmap-0.12.0.md`、CHANGELOG、本条目。
- 验证命令与结果：
  - 变异核对 4 项全红：回执写回原来的 `try` / 失败轮次记 `pulled: 0` / 不 hoist 计数 /
    换回 Error-only 抽取；恢复后逐文件比对与备份一致。
  - `pnpm vitest run src/lib/email-notify.test.ts src/app/api/cron/digest/route.test.ts` →
    29 passed（新增 3 条：文案互斥 1 + 失败轮次真实 pulled 1 + 非 Error 形状回落 1）。
  - `CI=true pnpm check:all` → `✅ 全部校验通过`；`pnpm build` → 编译通过。
- 风险 / 回滚：只改「失败时说什么、记什么」，发送条件与队列语义一字未动；
  回执写失败仍会让学生在下一轮重复收到一封信（既有 at-least-once 代价，现在至少看得见）。
  回滚 = revert 本 commit。
- 下一项：A05 的出队决策（现在含两条路径：skip 永不离开队列 / 已读静默离开并掩盖积压）；
  `scheduleRetry` 写失败导致 `attempt_count` 冻结，需要先定重试写路径的设计再动。

## 2026-09-23 — 查询列名第一次有了门禁，起因是一条谁都没看见的假列（C07）

- 里程碑 / 版本：v0.12.0 C 域（测试与门禁基建）新增条目 C07，并当场完成。
- 状态：DONE ✅。
- 分支 / commit：`feat/check-query-columns`（基于 `888b998`）。
- 为什么做：给 A05 的队列读数接线时撞见 `/api/e2e/email-worker-runs` 用 `.order("started_at")` 读
  `email_worker_runs`——这张表从建表（迁移 017）起只有 `created_at`（还专门建了 `created_at desc` 索引），
  `started_at` 从来没有存在过。先做实验确认它为什么能活这么久：把 `.order()` 改回 `created_at` 之前的
  一切检查都照过——`pnpm type-check` 退出 0（生成的类型只约束查询**结果**，过滤与排序参数在类型上只是
  字符串）、单测里查询链是 mock 的、Mock 客户端 `order()` 对未知列静默 no-op。也就是说「拼错的列名」是
  这个仓库唯一一类要等打上真库才现形（PostgREST 400）的缺陷，而它已经真实存在一处。
- 完成内容：
  1. 新门禁 `pnpm check:query-columns`：纯规则 `src/lib/db/query-columns.ts`（TypeScript AST，
     与 service-role 清单同一套解析路径）+ IO `scripts/lib/query-columns-check.js` + 薄壳
     `scripts/check-query-columns.js`，进 `scripts/check-all.sh`。CI 不需要单独接线——`ci.yml` 的静态
     作业跑的就是聚合入口（C04）。
  2. 修掉起因缺陷：`route.ts` 的排序列改 `created_at`，文件头注释同步。
  3. 范围按实测收窄（D01 的「先量后写」）：只认字面量表名/视图名 + `eq/neq/gt/gte/lt/lte/is/in/like/
     ilike/order` 首参 + `select` 列表里的纯标识符；`select("alias:column")` 判冒号右边那一列；
     含关联嵌入的链整条跳过；`storage.from("avatars")` 是桶不是表。两处失败封闭：读不出任何关系报
     `QUERY_TYPES_UNREADABLE`，一条列名都没判报 `QUERY_COLUMN_GATE_VACUOUS`。
  4. 文档与登记：`docs/testing.md` 新增「查询列名一致性门禁（C07）」并补命令表行；
     `src/lib/testing/test-matrix.ts` 的 `database` 域补上该命令与 `src/lib/supabase/database.types.ts`
     路径，双语 `docs-site/testing.md` 与 `docs-site/{,zh-CN/}scripts.md` 同步；roadmap 任务池
     20 → 21 项，C07 登记为已完成（D01–D04 序号顺移）。
- 变更文件：16 个——新规则与其单测、IO 与薄壳脚本、`package.json`、`scripts/check-all.sh`、`route.ts`、
  `test-matrix.ts`、`docs/testing.md`、`docs-site/testing.md`、`docs-site/scripts.md` 及两份 zh-CN、
  `docs/roadmap-0.12.0.md`、CHANGELOG、本条目。
- 验证命令与结果：
  - **先量后写**：`node --experimental-strip-types scripts/lib/query-columns-check.js` 在修缺陷之前跑过一次全仓——
    21 个关系 / 180 处 `.from()` / 367 个字面量列名，跳过 4 条含关联嵌入的链、46 个非纯列名寻址；
    命中恰好 1 条，就是 `route.ts` 那条 `started_at`，误报 0。写第一版时正则式解析器把 `type Database`
    读成 0 张表，`QUERY_TYPES_UNREADABLE` 当场把它自己抓了出来——失败封闭第一次就值回成本。
  - 变异核对 13 项全部被抓（`/tmp/mutate2.py`，每次跑完把规则文件与备份逐字节比对）：两处 storage 豁免各去掉
    一处、关掉嵌入跳过、`PLAIN_COLUMN` 放开成 `/^.+$/`、拆掉别名解析、把 `select` 移出判定集、关掉两条
    失败封闭、反转成员判断、断掉链遍历、去掉未知表上报、不再读 `Views`、保留展不开 `Row` 的关系。
    其中「storage 豁免去掉一处」在补用例前**逃过了变异**：一次变异脚本崩在中途没走到还原，把
    `collectQueryFacts` 里的那处豁免静默吃掉而门禁全绿——新增「桶名与表名同名」用例后它必须由该用例红。
  - `pnpm check:query-columns` → 绿（覆盖数同上）；`npx vitest run src/lib/db/query-columns.test.ts` → 23 passed。
  - `pnpm test:e2e e2e/mail-flow.spec.ts` → 3 passed；全量 `pnpm test:e2e` → **108 passed**；`pnpm build` → 编译通过。
- 阻塞 / 风险 / 回滚：只新增一道静态门禁 + 一处 e2e 回读端点的排序列，未碰任何发送、鉴权或 schema 语义。
  风险是假阳性把开发者挡住：`.filter()`/`.or()` 与 `insert`/`update` payload 有意不判，PostgREST 的富寻址
  （`->>`、`::`、`count()`、嵌入）只跳过并计数，若将来出现新的合法寻址形状，改的是这份收窄清单而不是把门禁关掉。
  回滚 = revert 本 commit（门禁与修复同处一个 commit 序列，删脚本行即整体失效）。
- 下一项：v0.12.0 池内仍需外部权限的条目（B02–B05、C05、digest 生产复验）不变；A05 出队口径与 A01
  `profiles.timezone` 去留等用户拍板。可选跟进（本轮刻意不做）：让 Mock 客户端对未知排序/过滤列**报错**
  而不是静默 no-op，那样运行期也有一道防线，但会牵动所有 e2e 桩数据的列形状，需要单独一轮。

## 2026-09-23 — Push 重试的上界不能只长在一个「写成功才会前进」的计数器上

- 里程碑 / 版本：v0.12.0 A 域（投递语义）的缺陷收口，并更正 roadmap A03 的结论范围。
- 状态：DONE ✅。
- 分支 / commit：`fix/push-retry-age-ceiling`（基于 `2ccd25f`）。
- 为什么做：上一轮通知链路审计留下的待设计项（当时记在 progress「下一项」里）。核对下来它不是
  「补一句日志」能了结的：`scheduleRetry` 唯一的终止条件是 `attempt_count >= PUSH_MAX_ATTEMPTS`，
  而这个计数器只有 `markPushDeliveryRetry` **写成功**才会前进。写失败时旧代码只上报一句
  「重试回执写入失败」然后照样 `return "retried"`——行仍 `pending`、`next_attempt_at` 停在过去的时刻、
  计数冻结，下一轮它又被 `next_attempt_at` 升序拉到队首，永远到不了上限。单轮预算 50 条，
  所以一行毒记录可以长期占住队首，而看板上表现为「一切正常地在重试」。
- 完成内容：
  1. 绝对上界 `PUSH_RETRY_MAX_AGE_MS`（7 天）：超龄的行直接 `dead` + `failure_code=max-age`。
     判定只认 `created_at`——它是入队时定死的事实，写失败拖不住它；`created_at` 解析不出来时按
     「未超时」处理，宁可不收紧也不因为一个时间戳问题把还能送的行判死。
     7 天而非「退避总和」：worker 每天 22:00 UTC 才跑一轮，健康路径上 3 次尝试本来就要跨三天。
  2. 回执写失败不再静默：新增 `push.delivery.retry_failed`（`reason` = 那次投递失败的原因），
     日志改成「投递失败且重试回执写入失败（行仍待下一轮，退避与计数未推进）」，并与
     「投递失败，已安排重试」互斥（catch 里直接 return，不再落到那句成功排程的文案）。
     计数口径保留 `retried`：这一行确实下一轮还会被拉，说谎的是退避与计数，那交给指标而不是改响应形状。
  3. 种子端点 `/api/e2e/push-queue` 新增 `createdAtOffsetMs`，E2E 补一条「8 天前入队、
     `attempt_count=0` → 死信 `max-age`」。
  4. 文档：`docs/operations/sentry-alerts.md` 登记指标 + 告警行（并补全 `push.delivery.dead` 的
     `reason` 取值）；`docs-site/web-push.md` 双语补上两道界的分工；roadmap A03 更正结论范围——
     「push 没有同型缺陷」只对小时门控成立，同时记下邮件侧核对结果：`markEmailFailed` 不吞错，
     整轮会 500，是**响亮地**卡住，缺的是 A05 的出队口径而不是一个上界。
- 变更文件：11 个——`push-retry.ts`、`repositories/push-delivery-attempts.ts`、`push-retry.test.ts`、
  `e2e/push-queue/route.ts`、`e2e/push-retry.spec.ts`、`sentry-alerts.md`、`docs-site/web-push.md` 双语、
  `docs/roadmap-0.12.0.md`、CHANGELOG、本条目。
- 验证命令与结果：
  - `npx vitest run src/lib/push-retry.test.ts` → 16 passed（新增 4 条：超龄死信 / 年轻行照旧重试 /
    `created_at` 读不出来时不收紧 / 回执写失败的指标与互斥文案）。
  - 变异核对 10 项全部被抓（去掉年龄判定、恒判超时、NaN 判超时、上界错写成退避封顶、`max-age` 降级回
    `max-attempts`、不报指标、指标维度写死、日志文案改回含糊、catch 里不再 return、整段退回旧写法）。
  - E2E 层单独变异：移除年龄判定后跑 `e2e/push-retry.spec.ts` → `行龄超过上界…` 那条**红**
    （串行模式 1 failed / 5 passed），恢复源文件后与备份逐字节比对一致，再跑 → 11 passed。
  - `pnpm test:e2e`（全量）→ **109 passed**；`CI=true pnpm check:all` → 全部校验通过；`pnpm build` → 编译通过。
  - 顺带修掉两处本次改动暴露的 lint 问题：`/api/e2e/push-queue` 的 POST 因为多一个默认值分支顶到
    complexity 16（把种子行拼成 `attemptSeedRow()`），以及 C07 规则文件里三处 `max-depth` 告警
    （拆成 `knownTableFromCall` / `chainColumnChecks`）。后者在重构后重跑变异时还量出一个真洞：
    未知表的链若被计入 `fromCalls`，「什么都没判就报 VACUOUS」这条封闭的前提会被放宽，已补断言钉住。
- 阻塞 / 风险 / 回滚：不改发送条件、不改队列过滤、不改 schema；只给「已经失败的行」加一个终止时刻与一条指标。
  风险一侧：7 天内一直失败且始终写不进计数的行会在第 7 天被判死而不是继续尝试——这正是目的，但如果
  将来把 worker 调度加密（不再每天一轮），这个常数需要重新按「几轮 × 间隔」核对，别按天数拍。
  回滚 = revert 本 commit（两个 commit 可分别 revert：`b07e9b8b` 是 C07 的重构跟进）。
- 下一项：v0.12.0 池内可自主执行的条目已清空，剩余项分别等用户拍板（A05 出队口径、A01 `profiles.timezone`
  去留、C06 两个孤儿 Server Action）与外部权限（B02–B05、C05、digest 生产复验、task #28 的生产冒烟）。
  下一轮优先做「再量一次缺陷」而不是等大任务。

## 2026-09-23 — digest 中途抛错不再把已经寄出的信抹成 0，顺手给「文档里出现过」装上牙齿

- 里程碑 / 版本：v0.12.0；上一条通知链路审计留下的第 1 条（另外 4 条见下面「下一项」）。
- 状态：DONE。
- 分支 / commit：`fix/digest-run-progress`（基于 `9c9024a`），两个 commit：
  digest 路由本身 + `check:cron-contract` 的指标登记判定收紧。
- 为什么做：审计找到的不是「回执写失败会 500」，而是**失败时落的那条记录在说谎**。
  `recordFailedRun` 把 `sent / groups / failed` 写死成 0，而 A05 面板的「空发送轮次」读数定义就是
  `pulled>0 && sent===0 && failed===0`——一轮真的给若干用户寄出了摘要、随后崩在某个回执上的运行，
  会在 `email_worker_runs` 里被永久记成「拉到东西、一封没发」。A05 的出队语义打算按这个读数拍板，
  读数本身是假的就没法拍；这比「看不见」严重，因为看板会教人相信一个假信号。
- 完成内容：
  1. `DigestProgress` 由 `POST` 持有、`runDigest` 就地累加，`recordFailedRun` 照实写当时的
     `pulled / sent / groups / failed`；`sent` 在 provider 收下那封信之后、回执写入之前累加（顺序即语义）。
  2. 两处回执各包一个 `try`：`markEmailSent` 失败上报 `cron.digest.receipt_failed{stage="sent"}` 并说
     「邮件已发出，但发送回执写入失败（下一轮摘要可能重复寄出）」；`recordEmailFailures` 失败上报
     `{stage="retry"}` 并说清「该行重试次数未累加，下一轮仍会重发」，`failed` 照累加（发送确实失败了）。
  3. 指标登记进 `cron-contract.ts`（15 → 16）、`docs/operations/sentry-alerts.md`、双语 `docs-site/email.md`；
     roadmap 里那段「邮件侧不是同一个形状，它是响亮地卡住」的旧结论同步改写，因为它描述的正是被这次修掉的行为。
  4. 刻意**不加**邮件侧行龄上界（Push 上一条刚加了 `max-age`）：丢掉一封排了 N 天的信改变的是送达语义，
     归 A05 拍板，不在「修日志诚实度」这一步里替用户决定。理由写进文档与 roadmap，不留成沉默的差异。
  5. 附带修一颗假绿牙：写文档时一次编辑把 `cron.digest.failed` 的表行整行删掉而全部门禁绿灯——
     `CRON_METRIC_UNDOCUMENTED` 当时只判「指标名在文档里出现过一次」，而该名字还躺在调度表和告警规则表里。
     新增 `documentsMetric()` 只认表行首格（反引号可选）。收紧前先量：16 个指标在真实文档里都已有表行，
     所以当前仓库仍绿。
- 变更文件：`src/app/api/cron/digest/route.ts`、`route.test.ts`（+3 用例，18 条）、
  `src/lib/observability/cron-contract.ts`、`cron-contract.test.ts`（+2 用例，37 条）、
  `docs/operations/sentry-alerts.md`、`docs/testing.md`、双语 `docs-site/email.md`、
  `docs/roadmap-0.12.0.md`、`CHANGELOG.md`、本条目。
- 验证命令与结果：`pnpm --silent lint` → 0；`pnpm --silent type-check` → 0；
  `CI=true pnpm check:all` → ✅ 全部校验通过（197 文件 / 2272 用例）；`pnpm build` → 成功；
  `pnpm test:e2e` → 108 passed / 1 failed，红的是 `e2e/account-deletion.spec.ts:50`（Server Action 往返
  在并行下撞到 60s 用例超时，`fill` 没等到第二步表单），单独复跑该文件 5 passed / 7.7s、exit 0；
  本机 `retries=0` 而 CI `retries=2`。与本次改动无交集（digest 路由不在这条链上），**不**记成本次的绿。
  变异核对：`/tmp/mutate-digest.py` 8/8 被抓（回执退回裸调用、`sent` 挪回回执之后、`recordFailedRun`
  退回写死 0、两个 `stage` 写死或删掉、删指标、删日志、`failed` 累加挪进内层 `try`），源文件与备份逐字节一致；
  文档表行那颗牙用真实仓库验：删掉 `cron.digest.failed` 行 → `[CRON_METRIC_UNDOCUMENTED] cron.digest.failed`，
  还原后 `cmp` 通过。第一版测量脚本的正则漏了连字符，误报「两个 push-retry 指标没登记」——
  那是探测器自己的洞，改成 `[a-z0-9_.-]+` 后为 0。
- 阻塞 / 风险 / 回滚：不改发送条件、不改队列过滤、不改 schema；重复投递窗口本来就有（回执没写上＝下一轮重发），
  这次只是把它从「一次 500 + 一条假记录」变成显式记账。回滚 = revert 这两个 commit。
- 下一项：审计剩下的第 2 条（`countUnreadNotifications` / `markAllNotificationsRead` 把 `error` 丢掉，
  与同文件 `:196` 的规矩自相矛盾），随后是 `teams.member_count` 的 `?? 1` 造数、Stripe webhook 给解析不出
  团队的行记 `processed`、注销时丢掉擦除结果。

## 2026-09-23 — 未读角标与「全部已读」不再把数据库故障说成「一切已读」

- 里程碑 / 版本：v0.12.0；通知链路审计的第 2 条（#36）。
- 状态：DONE。
- 分支 / commit：`fix/notification-error-surface`（基于 `9c9024a`，与 #86 的 digest 分支互不相干）。
- 为什么做：`repositories/notifications.ts` 自己写着规矩（`:194` 的注释：「查询失败抛错（调用方展示
  错误态），不再吞错回空数组」——那是 v0.x 一次专项收口的产物），`listRecentNotifications` 与
  `markNotificationRead` 都照做，只有 `countUnreadNotifications`（`:211`）和 `markAllNotificationsRead`
  （`:222`）把 `error` 解构时直接丢掉。后果不是「少个数字」：故障时未读数是 0，于是侧边栏角标消失、
  「全部已读」按钮**根本不渲染**；批量标记失败返回的 `0` 与「确实没有未读」在调用方看来是同一个值。
  Action 层的 `fail("databaseError")` 和它的测试一直在，但仓库永远不抛，那条兜底分支从没被真实走到过。
- 完成内容：
  1. 两个仓库函数改为 `if (error) throw new Error(error.message)`，其余返回值不变。
  2. `MarkAllReadButton`：`result.ok === false` 时过去什么都不做（用户视角＝「点了没反应」，只能反复点），
     现在按 `RemoveMemberButton` / 各表单的既有规矩弹 destructive toast。复用 `common.error` +
     `actions.databaseError`，**不新增文案键**（`databaseError` 在 en/zh-CN 都已存在，翻译对称门禁不动）。
  3. 测试：仓库 2 条（两个函数各自「失败必须抛，而不是回一个看着像成功的数字」）、组件 3 条
     （未读为 0 不渲染 / 成功提示 / 失败必须说话）——该组件此前零覆盖。
- 变更文件：`src/lib/repositories/notifications.ts`、`src/lib/repositories/notifications.test.ts`、
  `src/components/dashboard/mark-all-read-button.tsx`、`mark-all-read-button.test.tsx`（新增）、
  `CHANGELOG.md`、本条目。
- 验证命令与结果：`npx vitest run src/lib/repositories/notifications.test.ts
  src/lib/actions/notifications.test.ts src/components/dashboard/mark-all-read-button.test.tsx`
  → 3 文件 / 47 通过；变异核对 `/tmp/mutate-notify.py`：4 项探针全部被抓（两处退回吞错、
  删掉失败 `else`、把成功提示也改成 destructive），两个源文件在 `finally` 里还原并逐字节比对通过；
  全量 `CI=true pnpm check:all` / `pnpm verify:build` 结果见本条 commit 之后。
- 阻塞 / 风险 / 回滚：不改队列过滤、不改 schema、不改发送条件；用户能感知的变化只有一条——
  以前静默失败的「全部已读」现在会报错。回滚 = revert 本 commit。
- 下一项：#35 `teams.member_count` 的 `count ?? 1` / `?? 0` 造数（同一家族：把「不知道」写成「是 0/1」）。

## 2026-09-23 — `teams.member_count` 读不到时保持旧值，不再写一个猜出来的数

- 里程碑 / 版本：v0.12.0；通知链路审计之后又量出的第 3 条（#35，与 #36 同一族：把「不知道」写成精确数字）。
- 状态：DONE。
- 分支 / commit：`fix/team-member-count-staleness`（基于 `9c9024a`）。
- 为什么做：`teams.member_count` 是**派生缓存**——迁移 007 明写「由服务端重算写入」，数据库侧没有
  触发器兜底，所以它只有两种合法状态：等于真实行数，或者保持上一次的旧值。四处重算代码在读不到
  数字时写 `count ?? 1`（邀请）/ `count ?? 0`（移除），把「我不知道」写成「7 人的团队只有 1 人」，
  而成员本身已经改成功了、回滚不了也不该回滚。其中 `src/app/api/invitations/route.ts` 的邀请分支
  更糟：计数走的是**用户作用域**客户端（RLS 下只能看见自己可见的行），写回的却是 service_role 那一列。
- 完成内容：
  1. 新增 `src/lib/repositories/teams.ts`：`syncTeamMemberCount(teamId)` 读真实行数，
     读不到（`error` 或 `count === null`）就**一条 UPDATE 都不发**；返回
     `"synced" | "count-failed" | "write-failed"`，让调用方说清坏在哪一半。
  2. 四处调用点（`actions/team.ts` 邀请 / 移除，`api/invitations/route.ts` 加入 / 移除）改为调用它，
     非 `synced` 时各自 `logActionError` / `logApiError` 上报「成员已改，但计数没更新」。
     Action 仍返回成功是刻意的：为一枚缓存把已完成的操作说成失败，会诱导用户重复邀请。
  3. service-role 清单登记新模块（`ADMIN_CLIENT_INVENTORY`，`data-access` / `server-internal`），
     门禁输出 31 → 32 个模块；`docs/db/security-audit.md` 快照同步（含调用点 88 → 89 的来源说明）。
- 变更文件：`src/lib/repositories/teams.ts`、`teams.test.ts`（新增，5 条）、`src/lib/actions/team.ts`、
  `src/lib/actions/team.test.ts`（改 1 条用例的标题与断言：现在必须看到那条上报）、
  `src/app/api/invitations/route.ts`、`src/lib/security/admin-client-boundary.ts`、
  `src/lib/security/admin-client-boundary.test.ts`（预算 88 → 89）、
  `docs/db/security-audit.md`、`CHANGELOG.md`、本条目。
- 验证命令与结果：`pnpm --silent lint` / `pnpm --silent type-check` → 0；
  `npx vitest run src/lib/actions/team.test.ts src/lib/repositories/teams.test.ts` → 36 通过；
  `pnpm check:supabase-security` → ✅ 32 个模块（登记之前它先报了 `ADMIN_CLIENT_UNCLASSIFIED`，
  失败封闭如设计）；全量 `CI=true pnpm check:all` 与 `pnpm build` 结果见 commit 之后补记；
  变异核对：把仓储退回旧的 `count ?? 0` 完整形状 → 恰好「重算查询失败时不发任何 UPDATE」与
  「provider 没回 count」两条红（第一次的探针写法无效：替换进去的是对 `const` 解构的重新赋值，
  类型上根本不成立，红也红在别处，换成完整旧代码块之后结果才可归因）；另 3 项（只认 `error`、
  写失败也报 synced、去掉上报）全部被抓，源文件逐字节还原。
- 阻塞 / 风险 / 回滚：不改成员写入本身、不改 schema、不改 RLS；数字可能变旧，但不会再被造出来。
  并发重算的竞态（两人同时被邀请 → 后写的那次赢）本条**不**解决，它要的是把计数改成查询派生或
  数据库触发器，那是另一个决定。回滚 = revert 本 commit。
- 下一项：#37（Stripe webhook 给解析不出团队的行记 `processed`）与 #38（注销时丢掉擦除结果）。

## 2026-09-23 — 邀请链上三处「把查询故障答成确定的结论」

- 里程碑 / 版本：v0.12.0；#39，同时把这一族登记为 roadmap C08（门禁候选）。
- 状态：DONE（代码）+ 已登记后续门禁。
- 分支 / commit：`fix/invite-error-honesty`（基于 `9c9024a`）。
- 为什么做：同一个函数里三种「把不知道说成知道」叠在一起才看得出形状——
  `findUserIdByEmail()` 丢 `error` 返回 null，Action 因此答 `userNotFound`（管理员会去催一个
  其实已注册的人注册）；角色检查与成员查重两处写成 `as unknown as { data …; error: null }`，
  等于**在类型上宣称这条查询不会出错**，把 error 通道从编译器手里抹掉：前者故障时答
  `onlyAdminsInvite`（凭空一条权限拒绝），后者答「不是成员」并带着这个未知状态继续 INSERT，
  让唯一约束替权限逻辑说话。
- 完成内容：
  1. 三处都真的读 `error` 并回 `databaseError`（en / zh-CN 都已有该键，不新增文案）。
  2. 成员查重的 `.single()` 换成 `.maybeSingle()`：「没有这一行」是正常结果，不该占用 error
     通道——这正是旧代码非要用那个断言不可的原因。断言删掉后 `pnpm type-check` 仍通过，
     说明 `error: null` 从来不是客户端的真实形状。
  3. 全库测量（`/tmp/measure-casts.mjs`，AST）：46 处把查询结果断言改写，其中 **29 处抹掉
     `error` 成员**；按优先级登记成 roadmap **C08**（`auth/guards.ts`、`permission-gate.tsx`
     是角色检查；`app/dashboard/**` 是页面读数；门禁判据与误伤面写在条目里）。
     同时记下第一版探测器的教训：单行 grep 少数了多行断言，且「解构了 error 却没用」的粗判会把
     `{ error: memberError }` 这种重命名算成未使用——只有「解构里没有 error」那一半是可信的。
- 变更文件：`src/lib/repositories/profiles.ts`、`profiles.test.ts`、`src/lib/actions/team.ts`、
  `team.test.ts`（+3 用例、1 处 fixture 从 `single` 改 `maybeSingle`）、`docs/roadmap-0.12.0.md`
  （任务池 21 → 22，新增 C08）、`CHANGELOG.md`、本条目。
- 验证命令与结果：`npx vitest run src/lib/actions/team.test.ts src/lib/repositories/profiles.test.ts`
  → 44 通过；变异核对 4 项全部被抓（仓储退回吞错、删掉角色检查、删掉查重检查、邮箱查询退回不兜住），
  并逐条用 `-t <用例名>` 复跑确认是**目标用例**变红而不是别处连坐；源文件 `finally` 还原后逐字节一致。
  全量 `CI=true pnpm check:all` / `pnpm lint` / `type-check` / `build` 见 commit 之后补记。
- 阻塞 / 风险 / 回滚：不改授权规则、不改 schema、不改邀请成功路径的任何行为；只有「查询失败时说什么」
  变了。`alreadyMember` 那条 fixture 跟着改了形状（`single` → `maybeSingle`），是生产调用换了方法的
  结果，不是把断言迁就旧行为。回滚 = revert 本 commit。
- 下一项：C08 门禁（先量后写），或等 #86–#89 合并后按用户指示继续。

## 2026-09-23 — 解析不出团队的 Stripe 事件落 `skipped`，不再谎报「已处理」

- 里程碑 / 版本：v0.12.0；通知链路审计之后又量出的第 4 条（#37）。
- 状态：DONE。
- 分支 / commit：`fix/stripe-webhook-unresolved-status`（基于 `9c9024a`）。
- 为什么做：`webhook_events` 是与支付方对账的唯一凭据。`upsertSubscription()` 在
  `resolveTeamId()` 返回空时只打一条 `unresolvable_team` 日志就 `return`，`applyEvent()` 随后照样
  返回 `"processed"`——库里一行都没写，登记表上却写着「这笔订阅我们处理过了」。Stripe 收到 200
  就不再重投，而 `processed` 与 `skipped` 在幂等上同形（`claim_webhook_event` 都判 duplicate），
  所以这个错既不会自愈、也没有任何读数能把它暴露出来。
- 完成内容：`upsertSubscription()` 返回「是否真的写了一行」，没写就落 `skipped`；幂等语义、HTTP
  响应、重放行为一律不变，变的只有那条记录的说法。`docs/db/webhook-idempotency.md` 的流程图补上
  这条区分，免得下一个人以为 skipped 是「漏处理」。
  修这条的过程中量出**同一函数的另一半**：`resolveTeamId()` 用 `{ data }` 解构回退查询，丢掉
  `error`——一次数据库抖动与「这个用户真的没有团队」因此同形，而在新语义下它会被记成
  `skipped`、Stripe 不再重投：抖动被固化成永久漏单。现在查询失败抛错 → 事件标 `failed` + 500，
  交回 Stripe 的重投机制。
- 顺手做了一次全库测量（`/tmp/measure2.mjs`，TypeScript AST：`await` 一个 `.from()/.rpc()` 链、
  解构里没有 `error`）：**19 处**，其中 `repositories/notifications.ts:213,224`（#36 已修）、
  `actions/team.ts:185,256` 与 `api/invitations/route.ts:307`（#35 已修）、本条的
  `webhooks/stripe/route.ts:40`（本条已修）之外，还剩 `repositories/profiles.ts:31`、
  `dashboard/admin/page.tsx:47,50,53`、`dashboard/team/page.tsx:110`、
  `api/stripe/checkout/route.ts:58,68`、`api/invitations/route.ts:55,165`、
  `api/webhooks/stripe/route.ts:252,259`（在 `notifyTeamOwner` 的整段 try 里，刻意不阻塞主流程）、
  `api/e2e/push-queue/route.ts:86,230`（mock 路由）。另有 3 处「解构了 `error` 但同一块里再没引用」。
  **第一版探测器报的是 0**——它的链遍历只在 `isCallExpression` 上推进，`.select()` 走到
  `supabase.from` 之前就停了，与 C07 第一版 `chainOf` 是同一个错；改成无条件 `.expression`
  爬升后才拿到可信数字。
- 变更文件：`src/app/api/webhooks/stripe/route.ts`、`route.test.ts`（+3 用例，13 条）、
  `docs/db/webhook-idempotency.md`、`CHANGELOG.md`、本条目。
- 验证命令与结果：`npx vitest run src/app/api/webhooks/stripe/route.test.ts` → 13 通过；
  变异核对 2 项：把 `applyEvent` 退回无条件 `return "processed"` → 恰好两条 skipped 语义用例红；
  删掉 `resolveTeamId` 的 `if (error) throw` → 恰好「回退查询失败标 failed」那条红，
  其余不动；源文件还原后逐字节比对通过；
  全量 `CI=true pnpm check:all` / `pnpm lint` / `type-check` / `build` 见 commit 之后补记。
- 阻塞 / 风险 / 回滚：不改支付数据的写入路径；对账视图以后会真的出现 `skipped` 行——那正是本条要
  的东西，但若有人按「processed 数 == 事件数」做过对账，读数会变（仓库里没有这样的读数）。
  回滚 = revert 本 commit。
- 明确**不**做的：`customer.subscription.deleted` 命中 0 行时同样记 `processed`。那是合法的幂等
  无操作（重复投递、或订阅在 Stripe 侧被直接删除），要把它和「没找到目标行」区分开需要 UPDATE
  带回 `updated` 计数（`Prefer: count=exact`），那是另一次语义决定，不在修这条谎话时顺手改。
- 下一项：#38（注销时丢掉擦除结果）——**核对后判定不是缺陷，不改代码**：
  `deleteAccountWithData()` 的两步前置（`removeUnreferencedUserObjects` 的枚举、
  `eraseAccountData`）都是 `if (error) throw`，`admin.auth.admin.deleteUser` 的 `error` 也抛；
  两个调用方（`actions/account.ts:32-37`、`api/user/route.ts:143-151`）都 catch 后回
  `accountDeleteFailed` / 500，因此「擦除没做成却报删除成功」这条路径不存在。返回值
  `AccountDeletionResult` 被调用方丢弃也不是漏记：各数据面计数与 `objectsFailed` 已经在
  `deleteAccountWithData` 内部写进 `account.deleted` 审计行的 metadata（`deletion.ts:47-60`）。
  刻意保留的两类失败（provider 删对象失败、审计补记失败）都写在模块头部，且前者仍会被
  孤儿清单发现。审计记录的这一条是**误报**，按「先核对再动手」的规矩关掉。

## 2026-09-23 — 五个 PR 全部合并回 main，把上面几条欠的「commit 之后补记」落成数字

- 里程碑 / 版本：v0.12.0；本轮「记录说假话」家族的收口。
- 状态：DONE。分支：`docs/record-merged-verification`（本条目所在 PR）。
- 合并顺序与结果（全部走 PR，`--rebase --delete-branch`，无 merge commit、无 force push 到 main）：
  #86 digest 轮次记录 + `check:cron-contract` 指标表行牙齿（`a85f892` + `a6dbeaf`）、
  #87 未读数与「全部已读」抛错（`235c85c`）、#88 `teams.member_count` 不猜数（`c818683`）、
  #89 Stripe 事件 `skipped` / 回退查询抛错（`d0735fa` + `39c5149`）、#90 邀请链三处答错话（`a8f8331`）。
  合并后 `main` = `a8f8331`，远端只剩 `main`，本地只剩 `main`（另有一个内容已在上游的历史分支
  `docs/boundaries` 经 `git cherry` 确认为 `-` 后删除）。
- 上面几条各自写过「全量 check:all 见 commit 之后补记」，此处一次落账。口径要说准：
  **本地在 rebase 到当时 main 之后重跑过全量门禁的**是 #87（2279 用例）、#88（2284）、#90（2288），
  均 exit 0；#86 与 #89 的 rebase 后验证来自 GitHub 端同一条 `pnpm check:all`（C04 之后 CI 与本地
  是同一份清单）。五个 PR 的 `Lint & Type Check` / `Unit Tests` / `Build` / `E2E shard 1+2` /
  `E2E (Playwright)` / `Build Docs Site` / `security-config` / CodeQL / Detect Secrets 全绿；
  合并后的最终状态在本地重跑：`CI=true pnpm check:all` → **exit 0，199 文件 / 2291 用例，✅ 全部校验通过**。
- 一件方法上的事，记下来免得下次重新推：五个分支都往 `CHANGELOG.md` 的 `### Fixed` 顶部和
  `docs/progress.md` 末尾同一个位置追加，因此 `gh pr update-branch --rebase` 必然报
  `RebaseConflictError`。解法是**只删三行冲突标记**（两侧都是新增条目，「都保留」就是完整解），
  `git add -A` → `GIT_EDITOR=true git rebase --continue` → 重跑门禁 → `git push --force-with-lease`
  （仅限自己的 PR 传输分支）。代码文件多半能自动合并，但**必须再跑一次测试**证明语义没打架：
  #88 改 `inviteMember` 的尾巴、#90 改它的头，git 合上了，是 49 条用例绿才确认 coherent。
- 仍未闭环的（按性质分）：
  1. 等用户拍板：A05 出队语义（含 `is_read` 那条静默出队、以及邮件要不要行龄上界）、
     A01 `profiles.timezone` 去留、C06 `actions/uploads.ts` 两个孤儿 Server Action。
  2. 等外部权限：B02 回滚演练、B03 擦除演练、B04 云端 Supabase 演练、B05 provider/事故演练、
     C05 provider 侧 `list()` 对账、digest 生产一轮观察、task #28 生产冒烟
     （Vercel 仍是 `Deployment rate limited — retry in 24 hours`，5 个 PR 的 Vercel 检查全红即此因，
     按既定口径忽略、不绕过）。
  3. 可自主开工的下一件：roadmap **C08**——把「把查询结果断言成没有 `error` 通道」变成门禁
     （已量：全库 46 处断言改写 / 29 处抹掉 `error`，判据与误伤面写在条目里）。
- 更新时间：2026-09-23（UTC 22:10 前后）。

## 2026-09-23 — 待合 PR 的合并顺序与 CI 证据范围：长栈会把 commit 留在 main 之外

- 里程碑 / 版本：v0.12.0；本轮不改代码，只回答「这些 PR 怎么合才真的进 main」。
  下面的计数是**一次性快照**（2026-09-23 09:20Z：29 个 open PR，#92–#120）。会过期的是数字，
  不会过期的是判据——重算只要跑「量法」那几条命令（这也是 D04 的口径：文档不复述会漂移的数）。
- 分支 / PR：`docs/pr-merge-order` → **PR #118**（基在 main `ad4b029`，停在 ready-for-review；
  因为 base 是 main，CI 会真跑——这正是上面「事实二」里那 21 个 PR 拿不到的东西）。
- 状态：DONE（PR 待 review 合并）。
- 量法（全部可复跑）：`gh pr list --state open --json number,baseRefName,headRefName,mergeable,mergeStateStatus`、
  逐个 `gh pr checks`、`gh api repos/…/branches/main/protection`、`git show <ref>:scripts/check-all.sh`。
- 事实一：**29 个 PR（#92–#120）没有一个处于冲突态**——28 个 `MERGEABLE/UNSTABLE`，
  第 29 个（#120）是 `MERGEABLE/BLOCKED`，因为推上来不到一分钟、必需检查还在跑。
  `UNSTABLE` 的语义是「必需检查全过、有非必需检查红着」，而红的只有两个 Vercel 部署检查
  （配额，按既定口径忽略）。
  main 的必需上下文一共 7 个：`Lint & Type Check` / `Build` / `Build Docs Site` /
  `E2E (Playwright)` / `security-config` / `Analyze (javascript-typescript)` / `Detect Secrets`；
  Vercel 不在其中 → **平台的部署限制不挡合并**。保护规则 `required_pull_request_reviews: null`，
  也没有「必须与 base 同步」，所以合并只等 CI。
- 事实二（开这个 PR 的原因）：拓扑不是一条链，而是**一条 20 个 PR 的长栈 + 7 个基在 main 的独立 PR
  + 2 个基在 #115 上的 PR**。每个长栈 PR 的 base 都是前一个的 head 分支，只有栈底 #92 基在 main：
  `#92 → #93 → #94 → #98 → #99 → #100 → #101 → #102 → #103 → #104 → #105 → #106 → #107 → #108 →
  #109 → #110 → #111 → #112 → #113 → #114`；基在 main 的是 #95、#96、#97、#115、#116、#118、#120；
  #117 与 #119 基在 #115 的 head 上（都用 #115 引入的 `e2e/support/hydrated.ts`）。
- 文件重叠是量过的（`git diff --name-only origin/main…<branch>` 求交集）：
  #119 与长栈的交集**只有文档**（`CHANGELOG.md`、`docs/testing.md`、`docs-site/scripts.md` 双语、
  `docs/progress.md`）——它改的 18 个表单组件、`src/lib/ui/form-field-rules.ts`、`scripts/lib/` 与三条
  e2e 文件，长栈一个都没碰。#117 与 #119 的真实交集是 `e2e/admin-contact-mfa.spec.ts`
  （#117 改 MFA 段的两处点按，#119 改 contact 段的提交判据，不同段落）加那几处文档尾巴；
  `e2e/support/hydrated.ts` 只有 #119 在往里加函数。
  结论：**#119 可以在这条栈的几乎任何位置落地**，代价只是文档尾部解一次冲突。
- **按编号顺序直接点合并，会把 #93–#114 的工作留在 main 之外**：#92 落地后
  `feat/gate-query-error-channel` 与 main 打平，此时把 #93 合进那条分支，main 拿不到它的 commit，
  而那条分支上已经没有任何 PR 通向 main；往后 19 个依次同理。更糟的是它**不报错**——
  仓库 `delete_branch_on_merge=false`，中间分支安静地留着，GitHub 侧每一步都显示成功。
- 因此栈内每个 PR 要两条命令（不改历史、不 force push、不产生 merge commit）：
  1. `gh pr edit <N> --base main` —— 前驱刚进 main，这一刻它的 diff 恰好等于自己那几个 commit；
  2. 等它自己的 CI 跑完再合。
  顺带解决第二个缺口：`ci.yml` 的触发条件是 `pull_request: branches: [main, develop]`，
  **base 不是 main 的那 21 个 PR（长栈里除 #92 外的 19 个，加 #117、#119）从来没跑过 CI**——
  它们头上只有 `security-config` 与 `Detect Secrets`（来自别的 workflow）加 Vercel，
  5 个必需 CI 检查不是「过了」而是「根本没上报」。这 21 个 PR 现有的证据是本地在每个 SHA 上跑的全套
  门禁（逐条写在各自条目里，口径见下）；retarget 之后 CI 会在同一个 SHA 上真跑一遍，含 E2E 分片。
- 本地证据的确切口径，别写成做不到的事：`CI=true pnpm check:all` 在长栈的 tip
  （`fix/c08-gate-range-holes`）跑过、exit 0，那是**整条栈叠加之后**的状态；
  每个中间 SHA 也各自在自己的分支上跑过全套，但不是「相对当时 main」重跑。
  门禁数量按实测：`check-all.sh` 在 main 上是 36 道，栈 tip 上是 37 道，多出来那道正是栈里加的
  `check:query-errors`——不是记忆里的 38，草稿写 38 时被这条实测纠正了。
- 冲突预期：#92、#96、#97、#115、#116、#118、#120 这些 main 基 PR 同时往 `CHANGELOG.md` 的
  `### Fixed` / `### Added` 顶部与 `docs/progress.md` 末尾追加（本 PR 只动 `docs/progress.md`，
  只会撞后半）。今天的全绿只是
  「相对各自 base」的快照，一个落地后后面的大概率转 `DIRTY`；解法是仓库里已记过的那套：
  只删三行冲突标记（两侧都是新增条目，「都保留」就是完整解）→ `git add -A` →
  `GIT_EDITOR=true git rebase --continue` → 重跑门禁 → `git push --force-with-lease`
  （仅限自己的 PR 传输分支）。
- 顺序建议：先长栈 20 个（一次一个，每个先 retarget），再 #96、#97、#115 → #117、#119（两个都得等
  #115 落地，retarget 后各自跑一遍 CI），最后 #116、#118、#120 这三个独立项（谁先谁后都行，只是
  文档尾部要有人解冲突）。
  #95 单独说一句：它是纯 progress 记录，其中「12 处就是 C08-c 的全部工作量」是**那版计数器的读数**，
  #106 补上三类写法盲区后重测，实际清单比它长（#112 把 debt 清完，台账只剩 `justified`）。
  想留完整日志就先合（后面的条目带着修正），不想再发一份过期数字就关掉——修正版在长栈的条目里已有。
- 为什么不在本次就把 20 个 base 全改好：现在 retarget，每个栈内 PR 的 diff 会变成「它以下全部未合
  commit」的累积，#114 一口气显示 20 个 commit，review 面反而变大、也没有 CI 证据增益。
  retarget 的正确时机是「前驱刚落地」。`gh pr edit` 不改历史、可回退，但会动 20 个 PR 的可见状态，
  所以这一步停在文档里等用户：要么合并时逐条执行，要么第一个 PR 落地后由我按顺序做完再逐个报状态。
- 验证：本 PR 只动 `docs/progress.md`。分支 tip 上 `pnpm -s lint` / `pnpm -s type-check` → exit 0；
  `CI=true pnpm check:all` → exit 0；`pnpm -s test` → exit 0（199 文件）；`pnpm build` → exit 0。
- 风险 / 回滚：纯文档，revert 即回滚；没动任何 PR 的 base、没动分支保护、没合并任何 PR。
- 下一件：#44 后半（结账路由的状态映射）仍等 #92 + #96 落地；等 review 期间继续从巡检里挑可自主开工的项。
- 更新时间：2026-09-23（UTC）。

### 快照之后又叠了四条（同日复测，原判据全部不变）

- 复跑同一条 `gh pr list --state open --json number,baseRefName,…`：**33 个 open PR（#92–#124）**，
  其中 base=main 的 11 个（#92 #95 #96 #97 #115 #116 #118 #120 #121 #122 #123），
  base 是 topic 分支的从 21 个变成 **22 个**——多出来的边是 **`#122 → #124`**：
  #124（passkey 删除的「0 行不等于成功」）与 #122 改同一段 `src/lib/repositories/webauthn.test.ts`，
  独立基于 main 会留下一个必然冲突的重写，所以选择叠一层。
  代价照旧：#124 现在拿不到那 5 个必需 CI 作业，已在 PR 里写明「本机全量是这条 SHA 目前唯一的证据」，
  并且 **#122 合并后要 `gh pr edit 124 --base main`**——这条边因此加进了上面那份 retarget 清单。
- 与长栈的文件交集逐条量过（`git diff --name-only origin/main…<branch>` 求交）：
  #121 / #122 / #123 只撞 `CHANGELOG.md` + `docs/progress.md` 两处文档尾巴；
  #124 额外撞 `messages/{en,zh-CN}/actions.json`——但栈里那几处新增分别落在
  `@@ -1`、`@@ -19`、`@@ -59` 三个 hunk，#124 的 `passkeyNotFound` 在 `@@ -43`，
  上下文行不重叠，**预期可自动合并**。这条判据别当保险：真要落地前仍该看一次 `mergeStateStatus`。
- 顺带修正本文件自身的一处约定漂移：#121/#122/#123/#124 的条目当时插在了**文件顶部**，
  而本文件（以及上面「冲突预期」那段）写的约定是**末尾追加**。搬运已在四条分支上各用一个普通
  commit 做完（不改写任何已推送历史、不 force push）：#121 `ad7a1e9`、#122 `fabebe2`、
  #123 `6e66dc4`、#124 `59b55db`。#124 那一个 commit 一次搬两条——它基于 #122 的旧 tip，
  所以 #122 的条目在它上面也还在顶部；按合并顺序落成「#122 → #124」，这样 #122 进 main 之后
  #124 相对 main 的增量就只剩自己那一条。搬运脚本每次都断言「非空行多重集不变 + `## ` 条目数不变」，
  唯一的内容外副作用是把顶部多余的空行分隔归一成文件里通用的一个空行（行数因此少 1～2 行）。

### 34 个 PR 按顺序合一遍会怎样（本机模拟，不动任何远端）

- 做法：`git worktree add -b sim/merge-order /tmp/merge-sim origin/main`，按编号升序把
  14 个「栈 tip 或 base=main 的独立 PR」逐个 `git merge --no-edit`；冲突就记下文件名并
  `git merge --abort`（只回退那一次合并，模拟「后一个 PR 相对已合内容还剩什么」）。
  跑完删工作区与模拟分支。
- 结果：**第一条长栈（#92–#114，tip `fix/c08-gate-range-holes`）干净落地**；其后 13 个全部冲突，
  但其中 12 个的冲突面只有 `CHANGELOG.md` + `docs/progress.md`（#95 与本 PR 连 CHANGELOG 都不撞，
  只撞 `docs/progress.md`）。这是「同一个文件尾巴各自追加一条」的机械冲突，
  解法永远是两块都留、按合并顺序排——不是需要判断的那种。
- **唯一撞代码的是 #96 `fix/checkout-guard-fail-closed`**：
  `src/app/api/stripe/checkout/route.ts`、`route.test.ts`、`messages/{en,zh-CN}/actions.json`。
  逐行对过两侧实现：#96 和栈里的 #103 是**同一个缺陷的两份修法**——都是「两道前置读取读不到就
  拒绝这次结账、回 503」，重复购买都回 409 `alreadySubscribed`，只是状态词汇不同
  （#96：`failed` + `source` / `duplicate`，日志在调用点；#103：`unavailable` / `subscribed`，
  日志在 helper 内）。两边测试各自钉住那两条 503 路径（栈侧 `route.test.ts:82` 与 `:101`，
  #96 侧 `:86` 与 `:104`）。**建议 route.ts 与 route.test.ts 取栈侧**，让 #96 只保留它真正独有的
  两样：`messages/{en,zh-CN}/actions.json` 里的 `alreadySubscribed`（main 至今没有这个键，
  栈侧也没补，而 409 早就在发这个码），以及 `docs/reference/api-routes.md` 那段
  「路由码 → 翻译」契约说明。按这个解法，#96 的净增量就是这两件事，不需要重跑它的实现。
- #125（钩子层）与栈的文件交集实测 7 个：`package.json`、`scripts/check-all.sh`、
  `docs-site/scripts.md`、`docs-site/testing.md` × 两个语言、`CHANGELOG.md`、`docs/progress.md`。
  真跑模拟时只有后两个文档尾巴冲突，`package.json` 与 `check-all.sh` 被 git 自动合掉了——
  **自动合掉不等于对**：合并后跑一次 `pnpm check:gates`，它重算门禁接线，漏接或重接都会红。
- retarget 已执行（写上面那条时它还是一条待办）：#124 对它的 base（#122 的分支）报过 **CONFLICTING**，
  起因是今天两边各自搬过一次 `docs/progress.md` 的同一段，不是代码分叉。改指前量了两边：
  `git merge-tree --write-tree origin/main fix/passkey-delete-reports-actual-work` → **0 冲突**；
  `git merge-tree --write-tree origin/fix/passkey-uncaught-reads <#124 tip>` → 唯一冲突文件就是
  `docs/progress.md`，`webauthn.test.ts` **没有**进冲突列表（#124 是从 #122 的 tip `eec9e44` 长出来的，
  那一段早就合过一次）。所以上面「独立基于 main 会留下一个必然冲突的重写、因此叠一层」那句理由**不成立**，
  原文照留，用来记下这次判断被自己的测量推翻。已 `gh pr edit 124 --base main`，GitHub 现在报
  **MERGEABLE**，那 5 个必需作业会在 `14cf8bd` 上真跑一遍；PR 正文和 #124 的条目都已同步改过。
  队列因此回到 **0 个 CONFLICTING**。
- 从这次提炼一条判据，用来和上面「刻意不提前 retarget」的约定对齐：CONFLICTING 有两种，先用
  `git merge-tree --write-tree origin/main <head>` 判性质。对 main 干净 ⇒ 只是 base 的记账问题，
  此时改指 base 是一笔有价交易——代价是 diff 会含前驱的 commit（review 面变大），收益是评审不再看到
  假红色、并且那 5 个必需作业会在该 SHA 上真跑。**只有出现这两个阻塞信号之一才提前做**（#124 两个都占：
  挂着 CONFLICTING + 从没跑过必需 CI）；否则仍按上面的约定等前驱落地再改，不要为了「看着是绿的」扩大
  review 面。改完必须同步 PR 正文和 `docs/progress.md` 里关于 base 的那句——base 是事实陈述，过期就是谎。

## 2026-09-23 — C08：错误通道门禁接线，鉴权路径先止血

- 里程碑 / 版本：v0.12.0 / C08（任务池 22 → 24 项，新增 C08-b、C08-c）。
- 分支 / commit：`feat/gate-query-error-channel`（基于 `main`）。
- 状态：DONE（PR 待 review 合并）。
- 这一条修的是本仓库连续第五次遇到的同一类缺陷：**一次读失败被答成一个确定的结论**。
  前四次（digest 轮次、未读数、`teams.member_count`、Stripe 事件状态）都是记录在撒谎，
  这一次撒谎的是**类型**——`(await supabase.from(...)single()) as { data: { role: string } | null }`
  不只是关掉一个告警，它断言「这条查询不可能出错」，于是下面的代码可以放心地把读失败当成
  「没有这一行」。`src/lib/auth/guards.ts` 里两处这种写法意味着：数据库抖一下，管理员被降级成
  `member`，日志里一行记录都没有。
- 做了什么：
  1. **先量后写（D01 口径）**：`src/**` 358 个非测试文件里 37 处 awaited 查询结果断言，
     其中 **22 处抹掉 `error`，分布在 12 个文件**。roadmap 里原先记的「29 处 / 46 处」是错的——
     那一版用单行 grep 数，多行断言整个漏掉；条目里已按实测改写并说明为什么错。
     测量脚本本身改了三轮才对：链遍历只沿 `CallExpression` 走会在 `.select()` 处停住（与 C07
     第一版同型错误）；未 await 的构造器断言（`admin.from("contact_messages").select(…) as unknown as FilterChain`）
     是给 builder 定形状、不该在射程内；`x as unknown as T` 会被数成两处。
  2. **鉴权路径先止血**（本条唯一的运行期行为改动）：`guards.ts` 两处收敛成一个 `readSessionRole()`，
     走 `maybeSingle()` 并真正读 `error`；读不出来抛新增的 `SERVICE_UNAVAILABLE`，
     `guardHttpStatus` 映射 **503**（403 是「你没权限」，重试多少次都一样；503 是可重试）。
     `safelyRequireAuth()` 内层单独 catch，不让它落到最外层那个会回答 401 的 catch——401 会让客户端
     清会话跳登录页，而重新登录并不会让那次读取成功。另修 `dashboard/admin/layout.tsx`、
     `dashboard/admin/audit-logs/layout.tsx`（原来把读失败当非管理员 redirect）与
     `actions/admin.ts` 的 `updateUserRole`（原来对没跑完的查询回答 `userNotFoundAdmin`）。
     **用户看到的变化**：管理员在数据库抖动时不再被无声降权或踢回 `/dashboard`，而是看到
     `dashboard/error.tsx` 的错误页（可点重试）；抛出的中文文案只进服务端日志，错误页走的是
     `errors.errorBoundary.*` 翻译键，不泄露内部信息。
  3. **门禁落地**：纯规则 `src/lib/security/query-error-channel.ts` + 单测、IO
     `scripts/lib/query-error-channel-check.js`、薄壳 `scripts/check-query-error-channel.js`、
     `pnpm check:query-errors` 进 `scripts/check-all.sh`（CI 经 C04 的聚合入口自动覆盖）。
     文档：`docs/testing.md`「查询错误通道门禁（C08）」+ 命令表行、`docs-site/scripts.md`（双语）
     与 `docs-site/testing.md`（双语）的 `rls-security` 行、`src/lib/testing/test-matrix.ts`。
- 台账而不是豁免表：`ERROR_CHANNEL_EXEMPTIONS` 按文件记数量，**双向对账**——新增一处抹除报
  `QUERY_ERROR_CHANNEL_CAST_AWAY`，修好一处却忘改数字报 `QUERY_ERROR_CHANNEL_EXEMPT_STALE`。
  条目分 `justified`（`permission-gate.tsx`：客户端组件无法 5xx，读角色失败回落最低权限是刻意的）
  与 `debt (C08-b)`（其余 20 处确实在撒谎）。要说清楚：**这一版门禁把台账里的 22 处全部放行**，
  它的价值是「从今天起不能再多一处」，不是「问题清完了」。
  数量对照（同一套 AST，`main` vs 本 PR）：修之前 **42 处 awaited 断言 / 27 处抹掉 `error`**，
  修掉鉴权与管理路径那五处之后 **37 处 / 22 处、12 个文件**。清偿顺序写在 C08-b，排最前的是
  **两处「用户一保存就把真数据覆盖掉」**：`actions/projects.ts:183`（config 合并读失败 → 写入
  `{ ...(current?.config ?? {}), ...input }`，没提交的其他键静默消失）与
  `dashboard/profile/edit/page.tsx:33`（表单预填 `""` / `UTC` / `en`）。
- 一条门禁自检的收获：`QUERY_ERROR_CHANNEL_PARSE` 是**被自己的测试 fixture 抓出来的**——
  把 `as { data: … }` 换行写，TS 解析器按 ASI 截断，该文件语法树不完整，于是门禁安静地判到 0 处、
  测试还绿。解析不动的文件在门禁眼里等于不存在，这是比误报更坏的一种绿，现在它必须点名。
- 两条写下来免得下次重推：① `redirect()` 的 mock **必须照抄它抛 NEXT_REDIRECT 的行为**——第一版让它正常返回，于是「读失败抛错」那条路径一路走到渲染，测试仍然是绿的（假绿）；改成抛之后，`未登录` 那条用例立刻红，说明两条路径此前根本没被区分。② 台账里三处理由最初是**按文件名猜的**（billing 写「隐藏套餐」、api-keys 写「答 notFound」），逐行读过代码后全部改写：billing 是 `?? "free"` **把付费账户显示成免费**，api-keys 是「不存在」与「读失败」共用一个 `databaseError`，profile/edit 与 notifications 是**预填默认值、用户一保存就把真数据覆盖掉**——理由写错比不写更糟，因为下一个动手的人会照它排优先级。
- 验证（全部在最后一次改动之后重跑）：
  - `CI=true pnpm check:all` → **exit 0**，38 道门禁、202 个测试文件全过；`pnpm build` → exit 0。
  - 新增/改动的测试：`query-error-channel.test.ts` 10 passed、`guards.test.ts` 33 passed、
    `admin.test.ts` 18 passed、两个 admin 布局测试各 4 passed。
  - 变异核对 15 项，逐项红且只红对应的那条：门禁侧 8 项（台账 5→4、拆掉 `as unknown` 穿透、
    删掉语法诊断循环、`rpc` 移出判定集、`keepsErrorChannel` 恒真 → 红 6 条、跳过台账对账、
    「豁免覆盖任意数量」、去掉 VACUOUS 封闭），鉴权侧 7 项（`readSessionRole` 吞掉 error、
    `safelyRequireAuth` 落到 401、`requireAuth` 不抛 503、`guardHttpStatus` 折回 403、
    去掉 `console.error`、`updateUserRole` 回 `userNotFoundAdmin`、admin 布局的 throw 分支短路）。
    每次变异前后都用 `diff -q` 与备份比对确认源码已还原——变异脚本崩在中途把改动留下来过一次（C07 的教训）。
  - 新门禁的红色能力单独验：临时放一个真实违规形状的 `src/lib/security/c08-probe.ts` → 退出 1 并点名
    `c08-probe.ts:5`，删除后恢复绿，`git status` 确认探针已清理。
  - `pnpm lint` / `pnpm type-check` → exit 0（`inspectQueryErrorChannel` 一度因复杂度 18 > 15 被 ESLint
    拦下，按规则拆成 `castAwayIssues` / `staleLedgerIssues` / `countByFile`，没有用 disable 绕过；
    顺带去掉两处**其实不需要**的 `as string | undefined`——生成类型本来就给得出 `role: string`）。
  - i18n 面：`check:locales`（en/zh-CN 各 1243 键对称）、`check:action-errors`（43 个错误码 × 2 locale、
    163 个前端文件无裸渲染）、`check:i18n` / `check:dynamic-keys` / `check:glossary` 全绿。
  - 文档面：`check:changelog` / `check:release-docs` / `check:test-matrix`（11 领域 / 104 条门禁 × 2 份文档）/
    `check:bilingual-docs` / `check:docs` / `check:gates`（38 个门禁，本地 35 / CI 37 / 豁免 3）全绿。
- 仍未闭环：C08-b（20 处债务，顺序已按读过的代码定：先把两处「保存即覆盖真数据」的排最前）、
  C08-c（12 处解构时压根不取 `error`，本门禁看不见它）、A05 出队语义与 A01 `profiles.timezone` 等用户拍板、
  B 域演练与生产冒烟等外部权限。
- 更新时间：2026-09-23（UTC）。

## 2026-09-23 — C08-c 前置测量：门禁看不见的那一半有多大

- 里程碑 / 版本：v0.12.0 / C08-c（只做测量，不改代码）。
- 分支 / commit：`docs/c08c-measurement`（基于 `main`，与 #92~#94 那条栈无关）。
- 状态：DONE（PR 待 review 合并）。
- 为什么要先量：#92 的 `check:query-errors` 只判**断言**——「awaited 查询结果被 `as` 成不含 `error`
  的类型」。同一族里还有另一种写法：解构时压根不取 `error`（`const { data } = await supabase.from(…)`），
  它不经过类型断言，所以门禁天生看不见。roadmap 里给这条留了「接线前先量误报」的前置条件，
  本条就是那次测量。**在 #92 合并之前先把它量清楚**，否则下一件事只能凭感觉写规则。
- 测量方式：TypeScript AST，与门禁同一套判定链（`.from()` / `.rpc()` 链、`await` 之下、
  括号与 `as` 穿透），按「这一处 awaited 查询结果的解构有没有绑定 `error`」分类，
  跑在 `main`（`ad4b029`）上，`src/**` 排除 `*.test.tsx?` / `*.stories.tsx?`。
- 数字：
  - awaited 查询结果被断言：**42 处，其中 27 处抹掉 `error`** —— 与 #92 里记录的「修之前 42 / 27」
    两条独立实现互相吻合，这既是 C08 的射程，也说明「断言」与「不绑定」是两个不同的判据。
  - awaited 查询结果被解构但**没有断言**：119 处；其中**不绑定 `error` 的只有 12 处**
    （另外 107 处老老实实写了 `const { data, error } = …`）。
  - 这 12 处就是 C08-c 的全部工作量：`api/e2e/push-queue/route.ts:86,230`、
    `api/invitations/route.ts:56,166`、`api/stripe/checkout/route.ts:58,68`、
    `api/webhooks/stripe/route.ts:256,263`、`dashboard/admin/page.tsx:47,50,53`、
    `dashboard/team/page.tsx:110`。
- 一个必须纠正的中间数字：第一版探针报「54 处不绑定 `error`」，是**把断言型重复计了一遍**
  （`(await q) as { data }` 既是一处断言、也是一次不绑定 error 的解构）。分桶之后
  真实集合是 42（有断言）+ 12（无断言）= 两个互不重叠的判据，不是 54 处新问题。
  记下来是因为这类「重复计数把一个缺陷说成两个」的错误，在下一份测量里还会再犯。
- 顺带量到的门禁盲区：**把查询结果先存进变量、再对变量做断言**
  （`const res = await q; const { data } = res as { data: X }`）—— 门禁的判据是「`as` 直接落在
  awaited 链上」，这种中转写法它看不见。实测**当前代码库里 0 处**。
  所以这一版不为此加规则（为一个空集合加规则只会增加误报面），但把限制写进 `docs/testing.md`
  的门禁章节，让下一个读到「零违规」的人知道射程边界在哪。
- 对 C08-c 的形状判断（仍未开工，等 #92 合并）：12 处里 6 处在 `api/e2e/*`（E2E 桩接口，
  读失败让测试失败就够，不需要产品级错误语义）、3 处在 `dashboard/admin/page.tsx`（概览读数）、
  3 处在邀请/结账/webhook 三条真实链路上。若要上门禁，判据应是「awaited 查询结果的解构必须绑定
  或使用 `error`」，误报面比 C08 大得多（要区分「绑定后确实不用」与「压根没绑」），
  而收益集中在 3 处——这个性价比要在动手前说清楚，别等写完才发现它是一条只服务 3 处的规则。
- 验证：纯测量，无代码改动；探针脚本与输出留在 `/tmp/c08/cclass2.mjs`（一次性工具，不入库）。
  `pnpm lint` / `pnpm type-check` 未跑（无源码变更），`check:changelog` 未跑（无 CHANGELOG 变更）。
- 更新时间：2026-09-23（UTC）。

## 2026-09-23 — 结账路由的两道门禁读取从 fail-open 改成 fail closed

- 里程碑 / 版本：v0.12.0；来源是 C08-c 的前置测量（PR #95 的 progress 条目），不是门禁抓到的。
- 分支 / commit：`fix/checkout-guard-fail-closed`（基于 `main`，与 #92~#95 那条栈无关）→ **PR #96**。
- 状态：DONE（PR 待 review 合并）。
- 为什么这一条值得单独做：`POST /api/stripe/checkout` 的两道**安全检查**都建立在一次查询上——
  当前用户属于哪个团队、该团队是否已有 `active`/`trialing` 订阅。两处都写成
  `const { data } = await supabase.from(…)…maybeSingle()`，压根不接 `error`。
  读取失败时方向是往下走：
  1. 跳过「已有订阅请改用 Customer Portal」的 scope 检查 → 重复订阅被放行；
  2. `teamId: membership?.team_id` 以 `undefined` 进会话 metadata → 钱照收，
     但 webhook 从此认不出这张订阅属于哪个团队（#89 那条链处理的就是「认不出归属」的事件，
     当时它被标成 `skipped`，现在知道上游为什么会持续产出这种事件了）。
  C08 的门禁看不见它（没有类型断言），所以这不是「等台账清完」的活儿，是量出来就得单独修的 bug。
- 做了什么：两处绑定 `error`，记 `[Stripe Checkout] …读取失败` 日志并回
  `503 { error: "checkoutUnavailable" }`，一次会话都不建。方向刻意选「不扣钱」那一侧——
  用户可以重试，而「扣了钱却归不了款」是要人工介入的事故。
  两道读取最后收进同文件里的 `readCheckoutScope()`，返回 `ok` / `duplicate` /
  `failed(source)` 三态。这不是顺手重构：直接把两个 `if (error)` 加在 `POST` 里，
  `eslint complexity` 就把它拦在 16>15（规则本身没错，POST 原本已有 11 个分支），
  而绕开它最诚实的办法就是把这次判断作为一个**结果**而不是几个布尔拎出来——
  「没读到」「读到了且不该再买」「读到了且可以买」压成布尔正是这个 bug 原来的形状。
- 覆盖：该路由此前**零测试**，补了它的第一份测试文件（先 6 条行为用例，加第 7 条契约对账）：
  两道门禁各自读失败 → 503 且不建会话、「确实查到已有订阅」仍是 409（读不到与查不到是两件事）、
  没有团队时按个人订阅放行且不去查 `subscriptions`、两条正常路径放行且不记错误日志。
  变异核对 5 项，各自只让对应那条红：任一读取的失败不上报（M1/M2）、有效订阅不再拒绝（M3）、
  去掉日志调用（M4，红 2 条）、没有团队时也去查订阅（M5 —— 第一轮它活下来了，所以补了第 6 条测试）。
- 契约处理（**一度写错，实测推翻**）：原本记的是「这个端点仓库内没有调用方，`checkoutUnavailable` 是
  给 API 使用者的字符串契约，不进 `messages/*/actions.json`」。复查 `grep -rn "stripe/checkout" src`
  时被打脸——`src/components/dashboard/checkout-button.tsx:38` 就在调用，而且它把响应里的码
  **直接当 i18n 键渲染**（`ta(payload.error ?? "checkoutError")`）。于是：
  1. `checkoutUnavailable` 必须登记文案，否则用户看到的是裸键（已补 `en` + `zh-CN`）；
  2. 顺着这条量出一个**已经在线上的缺陷**：`alreadySubscribed`（409，重复购买必然走到那条）
     从来没登记过，仓库自己的 `docs/reference/api-routes.md` 明写错误体是「i18n error key」。
     `git log -S alreadySubscribed -- messages/` 为空：不是后来删的，是压根没加过；
     码本身在路由里从 `5d3bbbd`（2026-09-03，错误格式收敛为 `jsonNoStore`）就在了。
     为什么没有任何一道门禁抓到：`check:i18n` 的自述是「扫描 868 个**静态**翻译调用」，动态键不在射程；
     `check:action-errors` 只管 `src/lib/actions/**`；`check:dynamic-keys` 的 9 个契约是枚举
     （角色、通知类型……），错误码这条枚举没人登记。
  修法：补两个键 + 第 7 条测试（从路由源码抽 `jsonNoStore({ error: … })` 的码，逐码要求两个 locale
  都有非空文案）。这条测试第一版就把 `rateLimited` 漏了（多行调用没匹配上），是**地板值断言**
  （`codes.length >= 9`）当场报出来的，不是靠人眼。
- 同类缺陷扫了一遍，**结论是不建全库门禁**（先量再写，D01 口径）：`src/app/api/**` 里字面量错误码
  17 个，其中只有 `Unauthorized` / `Forbidden` / `invalidJson` 在 `actions.*` 里没有键，
  而三者所在的路由（cron / e2e / ops / 公开 invitations 接口）**仓库内没有任何代码 fetch**
  （`grep -rn 'fetch(\s*["`]/api/(invitations|ops/|e2e/|cron/)' src` 在非测试文件里为空），
  它们是给 API 使用者的机器契约，不是文案。
  真正的判据是消费方：全库 24 个客户端文件把 `error` 动态喂给翻译器（`ta(result.error)`），
  其中**只有 2 个**同时 fetch 站内路由；这 2 个里真正「路由码 → 翻译器」的边**只有结账这一条**。
  `passkey-section.tsx` 也 fetch 了 passkey 路由，但非 2xx 一律 `throw`，catch 里翻的是**静态**
  `ta("internalError")`，它那个动态键吃的是 `deletePasskey` 这个 Server Action 的结果
  （`check:action-errors` 已经覆盖）。为一个 1 条边的面做全库数据流门禁，误报面比它保护的东西还大
  （与 C07 那条「判据不同源」同理），所以拦网就留在 #96 里那条逐码对账测试上：新增路由码会当场红，
  新增「fetch + 动态翻译」的客户端则要人把它纳入对账——这一点写在
  `docs/reference/api-routes.md` 的错误格式一节。
- 一条**留给 #92 合并之后**的相邻缺陷：这个路由把 `safelyRequireAuth()` 的所有失败都答成
  `401 notAuthenticated`。#92 让守卫能区分「没登录」与「角色读不到」（`SERVICE_UNAVAILABLE` / 503）之后，
  这里就必须跟着改，否则一次角色读取抖动会把用户踢去重新登录。已记进任务清单，不在本 PR 里做
  （本 PR 基于 main，那个 code 还不存在）。
- 验证：`npx vitest run src/app/api/stripe/checkout/route.test.ts` → 7 passed；行为侧 5 项变异 +
  契约侧 3 项变异（删某 locale 的键 / 文案改成空串 / 路由新增没登记的码）逐条只红对应那条；
  `pnpm lint` / `pnpm type-check` / `pnpm test`（200 个测试文件全绿）/
  `CI=true pnpm check:all`（结尾 `✅ 全部校验通过`）/ `pnpm build` → 全部 exit 0。
- 更新时间：2026-09-23（UTC）。

## 2026-09-23 — 孤儿巡检补上 provider 侧集合差（C05 收尾）

- 里程碑 / 版本：v0.12.0；roadmap C05。
- 分支 / commit：`feat/c05-provider-orphan-diff`（基于 `main`）→ **PR #97**。
- 状态：DONE（PR 待 review 合并）。
- 为什么这条不是「加个 flag」：`find_orphan_upload_objects()` 的真相来源是 `upload_objects`，
  所以**一行都不存在的记录永远报不出来**。031 之前直接写进 bucket 的存量对象就是这么消失的——
  代码注释、A10 的 v0.6.0 退出报告、`docs/db/upload-metadata.md` 三处都把它写成「未覆盖」，
  于是这块盲区被清楚地记录着，同时又被任何一次「0 孤儿」的巡检报成清白。
- 做了什么：`--provider-diff` 递归列完一个 bucket（`POST /storage/v1/object/list/<bucket>` 带分页），
  分页读 `upload_objects` 的全部键，做**双向**差集：
  「bucket 有、元数据不认得」（031 之前的存量）与「`active` 行说对象应该在、bucket 里却没有」
  （后者是有人绕开应用删过对象 / 清过 bucket，而业务表里的 URL 还指着它）。
  三条约束：opt-in（不带 flag 时请求数与以前一字不差）；**「没看完」不等于「没有」**——
  页数 / 深度 / 条数触顶、`Content-Range` 缺失或前后矛盾一律 exit 1 并说明停在哪，
  那份「0 个发现」的报告根本不打印出来；仍然只读，差集不自动删。
- 实测（这是这条的主要价值，不是单测）：本地栈跑通一个 3 对象 / 2 行元数据的矩阵——
  数据库侧只报 2 条孤儿；`--provider-diff` 额外报出 1 个无元数据对象 + 1 个已消失的 active 行，
  两边都认得的 `b.png` 正确地不在任何一侧；清场后归零。列目录形状也是实测来的：
  文件夹 `id:null`、对象大小在 `metadata.size`、`name` 相对于请求的 `prefix`。
- 实测抓到一个会长期假绿的形状：**列一个不存在的 bucket，服务端返回 200 + 空数组**。
  也就是说 `--bucket avatar`（少个 s）会产出一份漂亮的「0 个发现」。第一版就是这么写的，
  是本地跑出来的、不是想到的——现在先 `GET /storage/v1/bucket` 校验存在性，
  拼错直接失败并把服务端认识的 bucket 列出来。这类「输入笔误 → 假清白」的口子，
  只有真打一次服务才会暴露。
- 顺带留下的形状说明：身份是 `bucket/object_key`，而 `object_key` 自己带着 bucket 内的前缀目录
  （`avatars/<userId>/…`），所以报告会显示成 `avatars/avatars/…`。是数据形状如此，不是拼接 bug，
  已写进 `docs/db/upload-metadata.md`，免得下一个人以为看错了。
- 覆盖：58 项单测（纯逻辑 + CLI 两侧）。变异核对 10 项，各自只让对应那条红：
  去掉 bucket 存在性校验（Y1）、`vanished` 把 deleted 行也算进来（Y2，红 2 条）、
  不递归进文件夹（Y3，红 2 条）、页数触顶不记住停在哪（Y4）、清单不完整照样报零（Y5）、
  `--provider-diff` 变成无条件开启（Y6，红 4 条——默认那趟的开销契约是真的）、
  没有 `Content-Range` 也当读全（Y7）、行数反超总数不报错（Y8）、
  集合差发现不算进退出码（Y9）、元数据表分页没有上限（Y10）。
  其中 Y8/Y10 对应的两条分支是第一版压根没有用例的，照「每条收窄都要有人踩」补上；
  补 Y10 时才想起列目录有上限而元数据分页没有——不对称本身就是漏的那一半。
- 一次 lint 教训的复用：三个函数被 `complexity` 拦在 15 以上（列目录解析 20、元数据分页读 20、
  主流程 17）。规则没错——每个都真的在做三件事。分别拆出 `parseStorageListEntry` /
  `readEntryBytes`、`parseTrackedPage` / `readRangeTotal`、`resolveDeps`（`??` 也算分支，
  五个依赖注入默认值能把主函数压成一张分支表）。与 #96 那条同源：**这类 lint 报错是设计信号，
  不是要绕的噪音**。
- 未接入定时任务：`/api/cron/retention` 那一轮仍只跑数据库侧的两个计数。provider 侧这一趟
  要走完整个 bucket，节奏归人工；这条边界写在文档里而不是留给猜。
- 验证：`npx vitest run src/lib/uploads/orphan-audit.test.ts src/lib/uploads/orphan-audit-cli.test.ts`
  → 58 passed；10 项变异逐条只红对应那条；`pnpm lint` / `pnpm type-check` /
  `CI=true pnpm check:all` / `pnpm build` → 全部 exit 0。本地栈端到端实测见上面「实测」一段
  （凭据是本地 dev JWT，只存在于那条命令行里，没写进任何文件、更没提交）。
- 一条流程教训：中途单独跑过一次 `pnpm type-check` 是绿的，最后一次改动之后没有立刻重跑，
  结果 `pnpm build`（它自己会再走一遍 TypeScript）抓出一个测试文件的类型错误。缺陷不在工具，
  在「验证跑在最后一次编辑之前」——与既有的「先变异核对再宣布绿」是同一条规矩的另一半：
  **门禁必须在最终形态上跑**，中途的绿灯不算数。
- 下一件（写在这里，免得下一次会话重新找）：
  1. **C08-b 台账继续清**——#92 那条栈上实测剩 8 个文件 / 16 处，其中
     `permission-gate.tsx` 的 2 处是**有理由的豁免**（客户端组件没法 5xx，降级到最小权限是对的），
     真正的债务是 7 个文件 / 14 处；最大的一条是 `src/app/api/invitations/route.ts` 的 5 处
     （把查询故障答成 `No team found` / `Member not found` / `Only team admins …`）。
     它必须叠在未合并的 #92/#94 上，所以要不要继续堆第 6 个 PR 取决于用户先合哪个。
  2. **#44（analytics + checkout 把守卫失败映射成真实状态码）** 与 **#42（C08-c 门禁）**
     都上游阻塞在 #92 合并，动不了。
  3. **C06**（`src/lib/actions/uploads.ts` 两个 Server Action 留还是删）是要人拍的产品决策：
     对一个模板项目而言，删掉一个公开入口不是纯技术判断。
- 更新时间：2026-09-23（UTC）。

## 2026-09-23 — C08-b 第一批：项目操作的五处读取不再猜答案（其中一处是数据丢失）

- 里程碑 / 版本：v0.12.0 / C08-b（台账 22 → 19 处）。
- 分支 / commit：`fix/c08b-projects-error-channel`（栈在 `feat/gate-query-error-channel` 之上，
  因为台账与门禁都住在那个还没合并的 PR #92 里；#92 合并后 GitHub 会把本 PR 的 base 自动接回 main）。
- 状态：DONE（PR 待 review 合并）。
- 为什么先动 `src/lib/actions/projects.ts`：C08 接线时逐行读过台账，`updateProject` 的 config 合并是
  **22 处里唯一一处会丢数据的**——合并语义是「保留未提交的其他键」，靠的是先读回 `config`，
  而那次读取不接 `error`，读失败时 `current?.config ?? {}` 就把「没读到」当成「原本没有键」，
  于是这次 update 真的写下去，把用户没提交的其他键全部抹掉。用户只是改了个开关，别处的配置没了，
  全程没有任何一处报错。其余四处（两处成员身份、两处项目行）是同一条链上的前置读取：
  读失败时分别答成「你还没有团队」「项目不存在」「只有团队管理员能操作」。
- 做了什么：五处一律绑定 `error` 并让它决定回答（记日志 + `fail("databaseError")`），
  删掉三处把结果断言成不含 `error` 的 `as unknown as { … }`（门禁的 22 → 19 就是这么来的），
  config 读失败时**在写之前就返回**，一次都不写。
- **用户可见的变化**：数据库抖动时删除/编辑项目会看到「数据库操作失败，请稍后重试」这条可重试的提示，
  而不是「项目不存在」或「只有团队管理员能操作」——后者会把人送去开工单，而真正该做的只是再点一次。
- 覆盖：这条路径原本**零测试**（config 合并连一条用例都没有）。补了 7 条：`createProject` 一处、
  `deleteProject` 两处、`updateProject` 三处读失败，外加一条正向断言「config 合并保留未提交的其他键」
  ——没有这条，「中止不写」和「照样写」在测试里长得一模一样。测试桩改成按 `select` 的列分派，
  否则 `select("config")` 会复用项目行的形状，config 分支永远测不到。
- 变异核对 6 项：五个 `if (xxxError)` 逐个短路成 `if (false)`，各自只让对应那条红；
  合并写成 `{ ...input.config }` 时正向那条红。前后用 `diff -q` 与备份比对确认源码还原。
- 门禁的账是真的：删掉 `src/lib/actions/projects.ts` 台账条目时 `check:query-errors` 先报
  `QUERY_ERROR_CHANNEL_EXEMPT_STALE（登记 3 处，实际 0 处）`，改完才恢复绿；
  单测里那条「逐文件对账」也同步从写死的地板值 30 改成挂在台账总数上——
  一个「改进会让它红」的地板值迟早教会人跳过它。
- 验证：`CI=true pnpm check:all` → **exit 0**（38 道门禁、202 个测试文件全过）；`pnpm build` → exit 0；
  `pnpm check:query-errors` → 358 文件 / 31 处 awaited 断言 / 台账 19 处；
  `npx vitest run src/lib/actions src/app/dashboard` → 20 文件 / 223 passed。
  一条方法上的教训：中途我**同时**开了两个 vitest 全量进程，其中一个报
  `src/app/dashboard/admin/page.test.tsx` 一条红；单独跑该文件、以及后来干净的全量跑都是绿的——
  那是并发进程互相干扰出来的假红，不是回归。以后不在同一个工作目录里并跑两套全量。
- 下一批（顺序已写在 roadmap C08-b ②）：`dashboard/profile/edit/page.tsx:33` 与
  `notifications/page.tsx:46` —— 同属「保存即覆盖真数据」，读完代码才发现它们和 config 是一族。
- 更新时间：2026-09-23（UTC）。

## 2026-09-23 — C08-b 第二批：三处「渲染成合法默认值」的读取改成显形失败

- 里程碑 / 版本：v0.12.0 / C08-b（台账 19 → 16 处，debt 17 → 14）。
- 分支 / commit：`fix/c08b-prefill-overwrite`（栈在 #93 之上，#93 又栈在 #92 之上；三个 PR 合并后
  GitHub 会依次把 base 接回 main）。
- 状态：DONE（PR 待 review 合并）。
- 为什么这一批是三页一起动：它们的行为完全同型，而且都不是「显示空态」那么无害——
  `profile/edit` 与 `notifications` 是**表单**，读失败时预填的是 `""` / `UTC` / `en` 与「所有开关为关」，
  用户看不出异常、点一次保存就把真实资料与偏好写回数据库；`profile`（查看页）则把角色显示成 `member`。
  同一处还把 `single()` 用错了：`select("*")` 之后 `.single()` 在**零行**时也返回 error，
  于是「这个账户还没有 profiles 行」这个合法状态和「查询失败」被混成同一件事——
  现在统一成 `maybeSingle()`：缺行按空值渲染，读失败抛出。
- 做了什么：三处绑定 `error` 并在渲染前 `throw`，交给既有的 `src/app/dashboard/error.tsx`
  （渲染 `errors.errorBoundary.*` 的翻译文案 + 重试按钮 + digest，不泄露抛出的中文）；
  台账里三条随之下线，`check:query-errors` 先报三条 `EXEMPT_STALE`、删条目后才恢复绿——
  这条链子中的一次都没少。
- 验证：
  - 每页 2 条用例（读失败必抛 / 缺行仍渲染），6 passed；变异核对 3 项：三处 `if (profileError)`
    逐个短路成 `if (false)`，各自只让对应那条红。
  - 渲染侧真实取证：`e2e/a11y.spec.ts` + `e2e/notifications-realtime.spec.ts` + `e2e/uploads.spec.ts`
    → **20/20 通过**，这三份会真的访问 `/dashboard/notifications` 与 `/dashboard/profile/edit`，
    证明 Mock 客户端的 `maybeSingle()` 与真客户端同形，切换没有把 E2E 变成另一套语义。
  - `pnpm check:query-errors` → 358 文件 / 28 处 awaited 断言 / 台账 16 处；
    `CI=true pnpm check:all` → **exit 0**（38 道门禁、202 个测试文件全过）；`pnpm build` → exit 0。
  - 一条与本条改动无关但要记下的事实：栈在未完成 PR 之上的分支**不会触发 CI**——
    `ci.yml` 的 `pull_request` 只在 base 为 `main|develop` 时跑。所以 #93 / #94 的页面上是零检查，
    我在两处 PR 描述里都写明了「不是红了，是没接」，并把本地 `check:all` 的等价性（C04 之后同一份清单）
    与结果一并贴出来。
- 下一批（C08-b ③）：鉴权与所有权判定——`lib/uploads/service.ts` 三处（封面上传把角色读失败答成
  `onlyAdminsCreateProject`）、`api/invitations/route.ts` 五处、`lib/actions/sessions.ts` 与
  `lib/actions/api-keys.ts` 各一处。
- 更新时间：2026-09-23（UTC）。

## 2026-09-23 — C08-b 第三批：邀请 API 的七处读取分开「没读到」与「没有这一行」

- 里程碑 / 版本：v0.12.0 / C08-b（台账 16 → 11 处，debt 14 → 9）。
- 分支 / commit：`fix/c08b-invitations-route`（栈在 #94 之上，#94 栈在 #93、#93 栈在 #92；
  台账与门禁都住在那个还没合并的 PR #92 里，合并后 GitHub 会依次把 base 接回 main）。
- 状态：DONE（PR 待 review 合并）。
- 为什么先动这个文件而不是 `lib/uploads/service.ts`：它是台账里**单文件最大的一条**（5 处断言），
  而且五处全部站在授权与幂等判定的上游——读失败的答案直接决定「谁能为这个团队添人」。
  另一个原因是这条链**在仓库里被修过两次，每次都只修一半**：UI 走的 Server Action
  （`actions/team.ts` 的 `inviteMember` / `removeMember`）在 #35 与 C08 那几批里已经收敛过，
  而 `/api/invitations` 这个 REST 孪生一次都没动过——因为**没有任何前端调用它**，
  测试与页面都不会替它说话。模板用户恰恰是直接调 REST 的那批人。
- 做了什么：
  1. **五处断言**（发起人的团队归属、他在该团队的角色、对方是否已是成员、被移除的成员行、操作人角色）
     删掉 `as unknown as { data: … }`，改为绑定 `error` 并让它决定回答：`logApiError` + 503 +
     一句「… Please retry.」。
  2. **两处门禁看不见的同型缺陷**（没有类型断言，只是解构时没取 `error`，属于 C08-c 那一族）一起收掉：
     `GET` 的团队成员身份校验顺着 `!membership` 长成 403 `Forbidden`——一次抖动就把一个权限从未变过的
     人挡在团队外，他该做的只是重试；`POST` 按邮箱查 `profiles` 那处把读失败答成
     「User not found. They need to register first.」，于是用户被劝着让对方去注册。
  3. `.limit(1).single()` → `maybeSingle()`（`single()` 在**零行**时也返回 error，
     把「这个用户没有团队」这种合法状态和读取故障压成同一个形状）。
     缺行仍回 404 `No team found`、非管理员仍 403、已是成员仍 409、`owner` 仍不可移除 403。
- **用户可见的变化**：数据库抖动时邀请/移除成员会看到一句可重试的失败（503），
  而不是「你没有团队」「只有管理员能邀请」「这个人还没注册」「这个成员不存在」这四条假结论；
  后三条尤其坏，它们会把人送去开工单或让对方去注册，而真正该做的只是再点一次。
- 覆盖：该文件此前**零单测**，补 15 条。设计上有两条规矩：① 每条「读失败必须 503」都配一条
  「合法状态必须仍是 404/403/409」当反向证据——只有前者时，把所有读取都判成失败也能骗过测试；
  ② 假客户端按「表名 + 该表第几次读取」返回，才能指名道姓地让 POST 那三道 `team_members` 读取中的某一道失败。
  另外钉住两条不属于 C08 但同样没人管的行为：邮箱小写归一（`Invited@Example.com` → `invited@example.com`，
  否则大小写不同就查不到已有账号），以及缺 `id` 时 400 且**一次数据库读取都不发生**。
- 一处台账理由写错了，顺手改对：它写「『已是成员』探针读失败会放过重复邀请」。实际不会——
  `team_members` 上有 `unique(team_id, user_id)`（迁移 001），读失败的后果是撞约束、
  回一个与真实原因无关的 500。仍然是「把故障说成别的东西」，但严重性与排序权重完全不同；
  理由写错比不写更糟，因为下一个动手的人会照它排优先级（这条在 C08 接线时已经栽过一次）。
- 文案约定：响应仍是裸英文句子，沿用该文件既有写法。**判据在消费方不在生产方**（PR #96 量的那条）——
  `grep` 过整个仓库，`/api/invitations` 没有任何 `src/` 下的调用方，也就不存在 `t(payload.error)`，
  给它加 i18n 键是为一个不存在的消费方做设计。
- 验证（全部在最后一次改动之后重跑，包括只改文档之前那一版代码）：
  - `CI=true pnpm check:all` → **exit 0**（38 道门禁、206 个测试文件全过，其中本文件 15 条）；
    `pnpm build` → exit 0；`pnpm lint` / `pnpm type-check` → exit 0。
  - `pnpm check:query-errors` → 「358 个文件 / 23 处 awaited 查询结果断言，无未登记的抹除
    （台账 11 处，其中未解析文件 0 个）」。这条账不是靠嘴认的：代码改完而台账条目还在时它报
    `QUERY_ERROR_CHANNEL_EXEMPT_STALE: src/app/api/invitations/route.ts 登记台账 5 处，实际 0 处`，
    删掉条目才恢复绿；收尾时又把那条条目按原样加回去重跑一次，确认它仍然红（门禁的红色能力
    要在最终形态上重验，不能引用改动过程中的那一次）。
  - 变异核对 10 项（Z1–Z10），**逐项红且只红对应那一条**：七处 guard 空转各红自己那条；
    反向的三条（把 404「确实没有团队」改成 503、去掉邮箱小写归一、把 403「确实不是管理员」改成 503）
    证明这套用例不是「只要返回 503 就算对」。每次变异前后用 `git diff` 与计数比对确认源码已还原
    （最终 `status: 503` 恰为 7 处、变异注入的 `void` 残留 0 处）。
  - 该路由**没有 E2E 覆盖也没有前端调用方**（`grep` 过 `/api/invitations`：只出现在文档、
    eslint 豁免名单与 `admin-client-boundary` 清单里），所以这 15 条单测是它唯一的证据来源。
    这既是它一直烂着的原因，也是这次必须自带测试的原因。
- 顺带清掉的三处易漂移数字（D04 口径）：`docs/testing.md` 的 C08 段不再抄「358 / 37 / 22 / 12」，
  改为指向现量命令与 `ERROR_CHANNEL_EXEMPTIONS`；roadmap C08-b 末尾的「当前台账 16 处」同理；
  roadmap C08-c 那份 12 处清单补了「其中两处已随别的 PR 消失」的标注——它是接线时的快照，
  照它点名会白跑两个文件。另外发现 C08-b 的 ① 与 ③ **重复列了同一个文件**
  （`dashboard/profile/page.tsx`，第二批已修），已在 ③ 里划掉并注明是同处读取。
- 下一批（C08-b ②收尾）：`lib/uploads/service.ts` 三处（封面上传把角色读失败答成
  `onlyAdminsCreateProject`）、`lib/actions/sessions.ts` 与 `lib/actions/api-keys.ts` 各一处，
  再往后是 ③ 的两处页面读数（`team/page.tsx`、`billing/page.tsx`）。`permission-gate.tsx` 两处是
  `justified`，不在清偿范围内。
- 更新时间：2026-09-23（UTC）。

## 2026-09-23 — 给 C08-c 那批页面改动补跑 E2E，撞出一条真实的间歇红并修掉

- 里程碑 / 版本：v0.12.0 / C 域（E2E 稳定性），不属任何未合项，独立基于 `main`。
- 分支 / PR：`fix/e2e-hydration-click-race` → **PR #115**（base = `origin/main` `ad4b029`，
  停在 ready-for-review；因为基在 main 上，CI 会真的跑 E2E —— 这正是栈上那批 PR 拿不到的证据）。
- 状态：DONE（PR 待 review 合并）。
- 为什么去跑 E2E：C08-b/c 那十几批改动改了 8 个页面与 3 个路由的失败语义（读失败从「渲染成合法终态」
  改成抛错/503）。那些 PR 都在栈上，CI 对非 main 基的栈 PR 只挂两三个检查——**E2E 从没在它们头上跑过**。
  本地全量：`108 passed / 1 failed`。
- 红的那条：`e2e/account-deletion.spec.ts:50` 「短语输错由服务端拒绝」，60s 超时，报
  `waiting for getByRole('textbox')`。危险区域标题与入口按钮都是服务端渲染的，
  `toBeVisible()` 在 hydration 之前就会通过 → 那一次 click 被丢进空气 → 输入框永远不等出来。
  单独复跑该文件 `--repeat-each=6` → **1/6 复现**，同一台机器上没有别的项目干扰时也一样。
  所以它不是这批页面改动引入的回归，是一条一直在那儿掷骰子的用例（CI 的 `retries=2` 长期替它兜着）。
- 修法沿用仓库已确立的形状（`theme.spec.ts` 的 `toggleThemeTo()`、`keyboard.spec.ts` 的 `retry()`），
  但把它收成**一份**共享实现 `e2e/support/hydrated.ts` → `actUntilVisible(act, result)`：
  每一轮先读结果、结果缺席才重放动作。只重试断言是错的（动作会演第二遍），
  无条件重放动作也是错的（非幂等的点按会留下重复提交）——这两句话就是这套写法的全部难点。
- 顺手把 locator 收紧：确认框改成按**可访问名称**取（`aria-label` = `Type "delete" to confirm` /
  `请输入「删除」确认`）。今天设置页只有一格 textbox，两种写法等价；但 `actUntilVisible` 的
  「先看结果」依赖 `isVisible()`，多匹配 locator 在那儿抛严格模式错误——
  别人明天在设置页加一格输入，不该把这条删除用例变成随机红。
- 机制证明放在 `e2e/hydrated-click.spec.ts`，**两条一起放**：`page.route` 把 `resourceType==="script"`
  的请求统一延后 3s，之后一条断言「点一次确实会被吞」（`toHaveCount(0)`），
  一条断言 `actUntilVisible` 在同一次拖慢下仍然把表单打开。只留后一条的话，把重试删掉也没人发现；
  前一条的存在让「重试」这件事不能被糊过去。这比 CDP 节流那条复现路径（docs/testing.md 里原有的）
  更确定，也更便宜。
- 验证：`--repeat-each=12` 跑该文件 + 新文件 = **84 passed / 0 failed**（修前同命令 1 红）；
  `pnpm -s type-check` / `pnpm -s lint` → exit 0；`CI=true pnpm check:all` → exit 0；`pnpm -s test` → exit 0。
- 遗留（都带行号记进任务，不在本次动）：
  #51 同类 `goto(domcontentloaded) → toBeVisible → 一次 click` 还在 `admin-contact-mfa.spec.ts`
  （sign-in ×5、Enable 2FA、验证、联系表单提交）与 `responsive.spec.ts`（汉堡 ×2）——
  那些动作不一定幂等，包 `actUntilVisible` 之前要先定「什么结果证明它生效」。
  #52 `playwright.config.ts` 的 `reuseExistingServer: !CI` 会在端口被别的项目占掉时**静默**把整套
  E2E 跑到别人的服务上（roadmap C07 已经记过一次作废；今天这台机器上另一个项目的
  `playwright.build.config.ts` 正在并行跑，且本次跑完还留了一台 `:3100` 的孤儿 dev server）。
- 风险 / 回滚：只动 `e2e/**` 与文档，运行时代码零改动；回滚 = revert 本 commit。
  与栈上的 #113/#114 会在 `CHANGELOG.md` 与 `docs/progress.md` 的同一处相遇——谁后合谁解一次冲突。
- 下一件：#51 / #52 之上继续挑可自主开工的项；栈上 20 个 PR 仍等 review。
- 更新时间：2026-09-23（UTC）。

## 2026-09-23 — 本地 E2E 从此拒绝「不是我们的那台服务器」（任务 #52）

- 里程碑 / 版本：v0.12.0 / C 域（E2E 可信度）。基在 `origin/main`，与 #115 无依赖关系。
- 分支 / PR：`fix/e2e-server-identity` → **PR #116**（基在 `origin/main`，停在 ready-for-review）。
- 状态：DONE（PR 待 review 合并）。
- 起因不是 theorizing：`reuseExistingServer: !process.env.CI` 意味着本地会静默复用端口上任何先来的
  服务，而就绪检查只看 `/api/health` 有没有 2xx。roadmap C07 已经记过一次「整轮全量 E2E 跑在
  `trade-buty` 的服务上、结果整份作废」；今天复跑 C08-c 的验证时，同一台机器上又有一个别的项目的
  `playwright.build.config.ts` 在并行跑，跑完还留了一台 `:3100` 的孤儿 dev server。
  **一份证明不了任何东西的绿，比没有测更贵**——它会被人引用。
- 两道防线，各管一段（这是量出来的，不是设计时假设的）：
  1. `reuseExistingServer: false`（两份 playwright 配置都改）。端口被占时 Playwright 自己就拒绝启动：
     `http://localhost:3100/api/health is already used …`。实测：拿一个假服务占住 `:3100` 跑
     `e2e/theme.spec.ts` → exit 1，报的就是这句。
  2. globalSetup 里的身份核对。关键在 1 的那句报错**给出的出路**是
     `set reuseExistingServer:true`——照做就把洞重新打开了。所以身份核对必须独立存在：
     `mockMode === true` 且 `version` 等于本仓库 `package.json`，拿不到 JSON / 读失败 / 字段不对都拒绝。
     实测：临时把配置改回 `true` 再放假服务在 `:3100`，抛出的正是
     `回的不是本仓库要测的应用：mockMode 不是 true（拿到 false）`，带 `lsof` 与
     `E2E_BASE_PORT=3400` 两条出路；抛错发生在任何用例跑起来之前。
- 结构：判据是纯函数 `src/lib/testing/e2e-server-identity.ts`（含 `assertOurServer`，取数由调用方注入），
  `e2e/support/warm-up.ts` 只剩「读 package.json + 传 fetch」。身份核对排在
  「只在并行时预热」那句早退**之前**——串行才是最常用的模式，放在早退之后等于在最常跑的路上不设防。
- 覆盖：新增 15 条单测（真实健康响应放行；`mockMode` 是 `"true"` / `1` / `0` / `null` / 缺省都不放行；
  版本不一致时理由里点名两边；非对象/数组拒绝；读失败必须抛；取的是 `<origin>/api/health`；
  接线与早退顺序）。变异核对 **9 项全部被杀死**，其中两项专门盯接线（I7/I9）。
  这两条是补出来的：第一版 I7 用「循环长度改成 0」模拟，探针跑完发现它**杀不掉**（调用点文本还在早退之前），
  于是换成真正的「整段搬到早退之后」；同时把 needle 从 `assertOurServer` 收紧成 `await assertOurServer(`——
  只查名字的话 import 那一行就足够让用例假绿。
- 正向验证：端口空着时 `pnpm test:e2e e2e/theme.spec.ts` → 6 passed（真服务器被正确认出，没误伤）。
- 验证：`pnpm -s lint` / `pnpm -s type-check` → exit 0；`CI=true pnpm check:all` → exit 0；
  `pnpm -s test` → exit 0；`pnpm build` → exit 0。
- 风险 / 回滚：本地跑 E2E 的人从此不能「顺手复用一台已经在跑的 dev server」——要复用就得显式改回
  `reuseExistingServer:true`，而那条路的正确性由身份核对兜着。运行时代码零改动，revert 即回滚。
- 下一件：#51（同类 `goto → toBeVisible → 一次 click` 还在 admin-contact-mfa / responsive 里，
  要先逐个判幂等性）。
- 更新时间：2026-09-23（UTC）。

## 2026-09-23 — 预热清单与 spec 实际导航目标对账：4 条 vs 16 条（#55 #56）

- 里程碑 / 版本：v0.12.0 / C 域（并行基线可信度），C02 的后半。
- 分支 / PR：`chore/e2e-warm-route-inventory` → **PR #120**（基在 main `ad4b029`，停在 ready-for-review；
  base 是 main ⇒ CI 会真跑 E2E）。
- 状态：DONE（PR 待 review 合并）。
- 起因是 #119 跑全量并行基线时顺手看了一眼 `warm-up.ts`：清单是
  `["/", "/auth/login", "/dashboard", "/dashboard/settings"]` 四行手抄的字面量。
  而 C02 记录过的红正是「第一个打到某台服务器的用例付冷编译」——那么清单有没有覆盖 spec 真正去的页面，
  就是个可以静态量出来的问题。
- 量法与读数：解析 `e2e/*.spec.ts` 里 `${appUrl()}<path>` 的尾巴，排除 `/api/*`、含 `${}` 的动态段、
  404 探针与 `waitForURL` 的 glob → **16 条被导航的路由**，清单只有 4 条。
  12 条页面的冷编译一直记在「恰好第一个打到它的那条用例」头上。
- 两个支撑口径也是量的，不是推的：
  - mock 模式下未登录 GET `/dashboard/**` 返回 **200**（不是 307 回登录页）——所以预热真的编译到页面本身。
    这条如果不量，整个预热机制可能只是在预热登录页。
  - 未预热的路由首次命中约 1.2s（`/pricing`，日志里 `next.js: 1215ms`）；16 条一起预热实测 12–30s。
- 落成一份会自己对账的清单，而不是又一次手抄：`src/lib/testing/e2e-warm-routes.ts` 是唯一来源，
  `warm-up.ts` 只做逐台逐条 GET；单测双向核对（`E2E_WARM_MISSING` / `E2E_WARM_STALE`），
  读不到 spec 与一条都没解析到各自失败封闭。真实仓库那条用例同时是解析器的射程证明（16 > 9）。
- **收益这次没能证成，说清楚**：三次清空 `.next-e2e-*` 的冷启动（`--retries=0`、3 台）分别红
  2 条（旧清单，串行）、4 条（新清单，并发）、2 条（新清单，串行），每次受害者都不同，
  其中 `responsive.spec.ts:92` 的移动端抽屉正是 #117 在修的位置——本机并行冷启动的噪声比这次改动的
  效果大。要判收益得看 CI 的每周并行基线（`e2e-parallel.yml`），不是我这台机器。
- 于是**没有**顺手并发化预热：那次对照跑把「清单 4→16」和「3 台并发预热」一起改了，结果多出 3 条
  登录导航超时，两个变量没能分离。调度保持原样，函数头部把这条教训写死，免得下次有人「优化」回去。
  一次跑完还留了个尾巴：`next dev` 会往 `tsconfig.json` 的 `include` 追加它自己的 dist 路径且不回收
  （配置文件注释里早就写了），探针服务器停了之后手工 revert 那两行。
- 覆盖 / 验证：`vitest run src/lib/testing/e2e-warm-routes.test.ts` → 12 passed；
  变异核对：放松 `/api/` 排除或 404 豁免 → 3 红（并实测混进 13 条 api + 1 条哨兵，30 条总数），
  把对账函数改成直接返回空 → 4 红；分支 tip 上 `pnpm -s lint` / `pnpm -s type-check` /
  `CI=true pnpm check:all` / `pnpm -s test`（**200 文件全绿**，比 main 多一个测试文件）/
  `pnpm -s test:coverage` / `pnpm build` → 全部 exit 0，覆盖率
  `97.19 / 91.97 / 97.86 / 98.24`（地板 91 / 90 / 93 / 92，branches 离地板只剩两点，这条也顺手量了）。三次冷启动并行基线的用例数分别是
  111、109、111 passed / 113 条总数（串行模式下 warm-up 早退，不影响默认 CI 路径）。
- 变更文件：`src/lib/testing/e2e-warm-routes.ts`（新）、`src/lib/testing/e2e-warm-routes.test.ts`（新）、
  `e2e/support/warm-up.ts`、`docs/testing.md`、`CHANGELOG.md`、`docs/progress.md`。
- 风险 / 回滚：预热清单变长只影响 `E2E_SERVERS>1` 的基线作业；默认 CI 路径（串行 + 2 shard）行为不变。
  revert 即回滚。与 #115/#117/#119 只可能在 `CHANGELOG.md` / `docs/progress.md` / `docs/testing.md` 尾部相遇。
- 下一件：等 CI 的每周并行基线给收益数字；那之前不再加 E2E 计时类的猜测性改动。
- 更新时间：2026-09-23（UTC）。

## 2026-09-23 — 部署配置多写一个 `/`，passkey 就全量 400，而报的是「验证失败」

- 里程碑 / 版本：v0.12.0 门禁看不见的另一半（C08 主题的延伸：把故障说成结论）；ADR-012 的推导口径。
- 状态：DONE，**PR #121**（base `main`，与 C08 栈零文件重叠）。
- 分支 / commit：`fix/passkey-expected-origin`（基于 `origin/main` `ad4b029`），`1e57117`。
- 为什么做：不是猜出来的。在 C08 栈尖（`origin/fix/c08-gate-range-holes`，24 个 commit，等价于
  #92–#114 全部合入后的 main）跑了一遍 `pnpm test:coverage` 取真实数字，`src/lib/auth/passkey.ts`
  只有 **14.28% 语句覆盖**——一个安全模块里没人跑过的函数，正是缺陷藏身的地方。读过去就看到：
  `expectedOrigin()` 直接返回环境变量原值，而隔壁 `rpId()` 已经 `new URL(...).hostname` 解析过了。
- 完成内容：
  1. **缺陷**：`@simplewebauthn` 用**严格相等**比较 origin
     （`node_modules/@simplewebauthn/server/esm/registration/verifyRegistrationResponse.js:83`），
     浏览器送来的 `authData.origin` 永远是 `scheme://host[:port]`，不带路径、不带尾斜杠。
     所以 `NEXT_PUBLIC_APP_URL=https://app.example.com/` 会让注册与登录 100% 失败，
     客户端拿到 `Verification failed`（400），日志只有一句 attestation verification failed——
     指向「密钥/挑战不对」，而不是「环境变量多写了一个字符」。`/console` 这类 basePath 部署同理。
  2. **修法**：`expectedOrigin()` → `new URL(siteUrl()).origin`。规范写法逐字符不变（含端口，
     非默认端口是 origin 的一部分，不能削）；尾斜杠与 basePath 从「必坏」变成「可用」。
  3. **为什么测试以前测不出来**：`src/app/api/auth/passkey/passkey.test.ts:47` 把
     `@simplewebauthn/server` 整个 mock 掉，那条决定成败的相等比较在单测里从没真的执行；
     passkeys 又没法在 E2E 里过真认证器。所以**推导函数本身就是唯一防线**，新增
     `src/lib/auth/passkey.test.ts`（9 条）钉住 `siteUrl` / `rpId` / `expectedOrigin` 与
     challenge cookie 的写入、过期、读取。
  4. 顺带把 ADR-012 决策 3 补一句：origin 也取解析后的值。ADR 原文只写了「RP ID = hostname」，
     没说 origin 也要解析——这条缺陷正是照原文实现的产物。
- 变更文件：`src/lib/auth/passkey.ts`、`src/lib/auth/passkey.test.ts`（新增）、
  `docs/adr/adr-012-passkey.md`、`CHANGELOG.md`、本条目。
- 验证命令与结果：
  - 先红：修之前两条用例分别拿到 `https://app.example.com/` 与 `https://app.example.com/console`
    （期望 `https://app.example.com`），失败输出即证据；
  - 变异核对：只 `replace(/\/$/, "")` 的写法仍被 basePath 那条抓住，不会因为「尾斜杠也修了」而变绿；
  - cookie 断言按实测写：Next 的删除序列化成 `Expires=Thu, 01 Jan 1970…` 而不是 `Max-Age=0`，
    第一版按后者写、当场红——改断言而不是改实现（实现是对的，`response.cookies.delete()` 本就是那条）；
  - `vitest run src/lib/auth/passkey.test.ts src/app/api/auth/passkey/passkey.test.ts` → 22 通过；
  - 全量门禁（本机，push 前）：`pnpm -s lint` / `pnpm -s type-check` → 0；`pnpm -s test` →
    **200 files / 2300 tests passed**；`CI=true pnpm -s check:all` → 0（「全部校验通过」）；`pnpm build` → 0。
- 阻塞 / 风险：
  - **同一份环境变量的其余消费方没在这次里改**：`src/lib/email-marketing.ts:14`、
    `src/lib/email-notify.ts`、`src/app/api/cron/digest/route.ts:221` 都是 `${siteUrl()}/api/...`
    字符串拼接，尾斜杠会拼出 `//api/...`。双斜杠在 Next 路由上到底成不成，**尚未实测**，
    所以只登记不下结论——这是下一条要量的东西。
- 后续复测（同日，量完即结）：那条「尚未实测」已经量掉了，**阴性**——Next 16.3.5 对 `//path`
  是 `308` 归一化到 `/path` 且**保留查询串**，`next start`（3220）与 `next dev`（3221）行为一致：
  `//api/marketing/confirm?token=bad → 308 → /api/marketing/confirm?token=bad → 200`、
  `//dashboard → 308 → /dashboard`。所以邮件里的双斜杠只是一次多余跳转，不是坏链接，
  **不需要第二个修复**。缺陷因此收窄成「WebAuthn 那种严格相等比较才真的会坏」——
  字符串拼接有路由器兜着，密码学校验没有。测量用的 `NEXT_DIST_DIR=.next-e2e-probe2` 又往
  `tsconfig.json` 追加了两条 include（本机跑过的第三次），已核对差异只含生成条目后还原，探针目录已删。
  - APP_URL 完全没协议（`example.com`）时 `new URL` 抛错，`register-options` 在 try 之外调 `rpId()`，
    结果是 500 而不是可诊断的文案。属既有行为，本次未引入也未扩大；要不要做成 fail-fast 带文案，
    和「三处 siteUrl 是否收成一份」一起放下一条。

## 2026-09-23 — 仓库层按设计抛，那谁接：passkey 两条路由把读故障抛穿成 500

- 里程碑 / 版本：v0.12.0 C08 的收尾半边——error 通道不抹掉之后，还要问抛出去有没有人收。
- 状态：DONE，**PR #122**（base `main`，与 #121 只共用 `CHANGELOG.md` / `docs/progress.md` 的头部，代码零重叠）。
- 分支 / commit：`fix/passkey-uncaught-reads`（基于 `origin/main` `ad4b029`），`76b0e5d` + `4547ec4` + `459d1a2`。
- 为什么做：接着 #121 那条覆盖率线索往下走。C08 栈尖（`origin/fix/c08-gate-range-holes`）的
  `coverage-final.json` 里，`src/lib/repositories/webauthn.ts` 未覆盖的语句正好是那四行
  `if (error) throw new Error(error.message)`——不是「测试没测出 bug」，而是**这四行的抛出去以后
  从没人走过**。于是把 `webauthn.ts` 的五个导出函数的调用点逐个读了一遍。
- 完成内容：
  1. **收口情况（实测，不是印象）**：`deleteMyCredential` 在 `src/lib/actions/passkey.ts:15` 的 `try` 里 →
     `fail("databaseError")`；`createCredential` / `updateCredentialCounter` 各自包在
     `persistCredential` / `persistCounter` 的 `try` 里；`listMyCredentials` 在设置页
     （`src/app/dashboard/settings/page.tsx:70`）抛 → `src/app/dashboard/error.tsx` 边界，这是 Next 的
     正常形状。**只有两处抛穿到路由外**：`register-options:39` 与 `auth-verify:110`。
     同一把尺子量了一遍全仓：用一个按括号深度跟踪 try 块的脚本扫 28 个 `app/api/**/route.ts`，
     「调用 `@/lib/repositories/*` 导出函数、且该调用不在任何 try 块内」的位置共 **6 处**，逐处判定：
     passkey 这两处是真抛穿（本条修掉）；`api/user/route.ts:55/113` 调的 `getProfileById` / `updateProfile`
     **返回的是 error 通道**、路由就地判 `error` 并回 500 JSON（不是缺陷）；`api/cron/digest/route.ts:84`
     在 `recordEmailFailures` 自己的函数体里抛，但调用方 `route.ts:176` 把整句包进 `try` 并记
     `cron.digest.receipt_failed{stage="retry"}`（不是缺陷）；`api/e2e/webhook-events/route.ts:18` 是
     测试种子路由，不在生产路径上。**所以这不是普遍失守，是这两处漏了。**
     顺带记下工具自身的教训：这个脚本第一版把「`try` 后跟空格再跟 `{`」判成了不匹配，
     于是 27 个调用点全被报成未覆盖——正是这条假数字逼着我去逐处读被点名的四处，
     才把上面这份账做实（如果只信第一版，PR 里就会写成一个不存在的大洞）。
  2. **缺陷不只是状态码难看**：`auth-verify` 头部第 8 行写着「challenge cookie 每次验证尝试后立即清除，
     避免浏览器重放」，而抛穿那条路径上没有任何人清它——**一条文件自己声明的安全边界只在顺利时成立**。
     另外客户端在等的始终是 JSON（同文件另有三条 `jsonNoStore` 失败分支），500 给的是 HTML 错误页。
  3. **修法**：把「读不到」做成第三种状态，而不是猜一个答案。`loadCredential()` 用 `undefined` 表示
     问不出答案、`null` 表示问出来了且确实没有 → 前者 `503 + clearChallenge`（与既有两条基础设施故障
     同形），后者保持 404；`register-options` 读不到时 503，而不是拿 `[]` 继续（`[]` 说的是「你还没有
     passkey」，而 `excludeCredentials` 存在的目的就是不让人重复登记）。原始 error 只进 `logApiError`。
  4. **刻意没做的**：`rpId()` 在 `NEXT_PUBLIC_APP_URL` 缺协议时同样抛穿（`register-options:42`、
     `auth-options:35`、两个 verify 路由），但那是部署配置错误，包成 503 等于对运维谎报「重试就好」；
     留 500。`register-options` 里还有一个从没用过的 `siteUrl` import，属另一件事，没顺手删。
  5. **把路由押注的那条契约本身钉住**：上面的 503/404 分岔完全依赖「仓库层在 error 时抛」，
     而 `webauthn.ts` 五处 `if (error) throw` 里只有 `listMyCredentials` 那处有用例（C08 栈尖的
     `coverage-final.json` 报的未覆盖语句就是其余四行）。补 4 条：`findCredentialById`（抛 ≠ 404）、
     `createCredential`（抛，否则注册会以为已落库）、`updateCredentialCounter`（抛，克隆检测依赖它）、
     `deleteMyCredential`（抛，action 才会回 `databaseError` 而不是「已删除」）。该文件 7 → 11 条。
- 变更文件：`src/app/api/auth/passkey/auth-verify/route.ts`、
  `src/app/api/auth/passkey/register-options/route.ts`、`src/app/api/auth/passkey/passkey.test.ts`、
  `src/lib/repositories/webauthn.test.ts`、`CHANGELOG.md`、本条目。
- 验证命令与结果：
  - 先红：两条新用例在修之前是「`POST` 直接 reject」，被断言捕获后失败；
  - 变异核对三项全被抓：catch 里 `return null` → `expected 404 to be 503`；去掉 `clearChallenge` →
    `expected '' to contain 'pk_challenge=;'`；`register-options` 的 catch 返回 `[]` → `expected 200 to be 503`；
    每项跑完从 `/tmp` 的字节副本还原，`cmp` 确认与改前一致（不用 `git checkout`，工作区里有未提交内容）；
  - `vitest run src/app/api/auth/passkey/passkey.test.ts` → **15 passed**（该文件 13 → 15）；
    `vitest run src/lib/repositories/webauthn.test.ts` → **11 passed**（7 → 11），
    变异：删掉 `webauthn.ts` 全部五处 `if (error) throw` → **5 failed | 6 passed**，
    即五个抛错各有一条用例钉着（跑完从 `/tmp/wa.bak` 还原、`cmp` 确认字节一致）；
  - `pnpm -s type-check` → 0；全量门禁与 PR 描述同口径（lint / test / `CI=true check:all` / build）。
- 阻塞 / 风险：passkeys 由 `NEXT_PUBLIC_FEATURE_PASSKEY` 默认关闭，正常路径逐字符未变；新增的只有
  「读不到时」这一条分支。真正的读故障要接真库才会出现，单测用 `mockRejectedValue` 打桩，
  所以这条证据是行为级的、不是生产级的。
- 同一条尺子扫了 Server Action 侧（阴性 + 已被别的 PR 修掉，登记以免重复劳动）：`src/lib/repositories/*`
  里**会抛错**的导出函数共 62 个，扫 19 个 `src/lib/actions/*.ts` 后「调用它们且不在 try 内」只剩
  2 处，都在 `api-keys.ts` 的 `regenerateApiKey`（`insertApiKey` / `deactivateApiKey`）。
  逐处对过 PR **#102** 的分支：那两处它已经收口，而且顺手把顺序反转成「先吊销再签发」并新增
  `apiKeyRevokedButNotCreated`——原顺序的坏情况正是「新密钥已 active 但没人知道明文」。
  所以本条不再动它，#102 合并后这条扫描应当自动归零。
- 下一项：覆盖率表上同一批低分文件按同一条尺子过一遍（`repositories/api-keys.ts` 74、
  `repositories/marketing.ts` 77、`repositories/upload-objects.ts` 78、`push-retry.ts` 80）。
  其中 `push-retry.ts` 的四条未覆盖语句已顺手读过：两处 `catch`（死信回执写失败、失效订阅清理失败）
  是**刻意吞掉并上报**的，与邮件侧的 at-least-once 代价同源，不是缺陷——登记为阴性结果，不为其改代码。

## 2026-09-23 — 退订链接的 7 天有效期：合规出口不能带时间窗

- 里程碑 / 版本：v0.12.0 A05（营销邮件独立通道）的缺陷收口；合规面。
- 状态：DONE，**PR #123**（base `main`；与 #121 / #122 无代码重叠，只共用 CHANGELOG / progress 头部）。
- 分支 / commit：`fix/marketing-unsubscribe-expiry`（基于 `origin/main` `ad4b029`），`b1a26d4` + 门禁数字 commit。
- 为什么做：接着 #122 那条覆盖率线索往下走。`src/lib/repositories/marketing.ts` 在 C08 栈尖上
  分支覆盖 77%，未覆盖语句是 72/77/112/124 四处 `throw`。读过去时看到的不是覆盖率问题，是
  `updateStatusByToken()` 把 `.gt("token_expires_at", now)` 同时压在确认和退订两条路上。
- 缺陷链条（逐环对过代码，不是推测）：
  1. `token_expires_at` 只在 `upsertPendingSubscription()` 写入一次：`Date.now() + 7 天`（`marketing.ts:65`）；
  2. 确认成功的 `updateStatusByToken(token,"subscribed")` **不刷新**它（只写 `status/updated_at/confirmed_at`）；
  3. 于是第 8 天起，一条 `subscribed` 的行仍会被 `.gt` 判成不命中 → `false` → 路由 404 `Invalid token`
     （`src/app/api/marketing/unsubscribe/route.ts:26`）；
  4. 而 `sendMarketingEmail()` 的页脚恒挂 `unsubscribeUrl(token)`（`email-marketing.ts:46`）——
     邮件继续寄，唯一的退订出口变成 404。设计文档 A05 段自己把它称作「合规链接」。
  为什么没被人发现：`docs-site/email.md` 原话是「Tokens are stored as SHA-256 digests and expire after
  7 days」，没说这条有效期管谁——**实现是照着这句无差别实现的**。路由测试把仓库整个 mock 掉，
  也不看查询条件。
- 完成内容：
  1. 有效期只约束确认；退订不看它。token 轮换的约束（`token_hash` 必须命中）一字未动，
     所以「旧链接失效」的语义仍在——失效的原因是键名换了，不是日子到了。
  2. 顺带修正的覆盖面：`token_expires_at` 为 `null` 的历史行原本 `.gt` 永不命中（= 永远退不了），
     现在能退。
  3. 用例打在**查询构造**上而不是 mock 的结果上（`marketing.test.ts` 10 → 11 条）：确认必须带
     `.gt("token_expires_at", …)`，退订必须不带。
  4. 文档三处同口径：`docs-site/email.md` + `docs-site/zh-CN/email.md` 那条有效期说明改写，
     `docs/design/email-templates.md` 的 A05 段新增一条判据（下次实现者读得到「管谁」）。
  5. 【2026-09-25 补记】同一函数里剩下的那条未覆盖分支也补上了：`updateStatusByToken()` 开头的
     形状闸门（`typeof` / `< 16` / `> 256` → 直接 `false`）此前**两侧都没用例**，判据来自「把这份
     报告里每个守卫的起始行对一遍分支覆盖」（44 条线索 → 5 条有未覆盖分支，其中 2 条已分别归 #140
     与这条）。这两个入口挂在公开路由上、token 直接来自查询串，闸门唯一的作用是让一次垃圾请求
     换不到一个 service-role 连接，所以用例断言的是 `createAdminClient` **一次都没被调用**，
     而不是返回值。`marketing.test.ts` 到 2026-09-25 为 13 条（上面那句「10 → 11 条」是本条 commit 时的历史值，
     别把它当现状读）。
- 变更文件：`src/lib/repositories/marketing.ts`、`src/lib/repositories/marketing.test.ts`、
  `docs-site/email.md`、`docs-site/zh-CN/email.md`、`docs/design/email-templates.md`、
  `CHANGELOG.md`、本条目。
- 验证命令与结果：
  - 先红：修之前新用例报 `expected "vi.fn()" to not be called at all, but actually been called 1 times`；
  - 变异两个方向：折叠成「两条路都判过期」→ 同一条断言红；折叠成「两条路都不判」→
    `expected ... to be called with arguments: ['token_expires_at', Any<String>] / Number of calls: 0` 红；
  - `vitest run src/lib/repositories/marketing.test.ts` → **11 passed**；`pnpm -s type-check` → 0；
  - 本机 push 前全量：`pnpm -s lint` / `pnpm -s type-check` → 0；`pnpm -s test` →
    **199 files / 2292 tests passed**；`CI=true pnpm -s check:all` → 0（「全部校验通过」）；`pnpm build` → 0。
  - 【2026-09-25 补记】新用例的两个变异探针：删掉整行形状闸门 → `形状不合的 token 直接 false，不建
    admin client` 红在 `AssertionError: expected true to be false`；把 `< 16` 改成 `<= 16` →
    `长度边界 16 与 256 算合法，照常去查库` 红在同一条 `expected false to be true`。两次探针后
    `git checkout -- src/lib/repositories/marketing.ts` 还原，`git status` 只剩测试文件一处改动。
- 阻塞 / 风险：真实库里是否真有人被影响，取决于有没有人在跑 `listSubscribedEmails()`——
  本仓内没有任何调用方（它是模板交给用户的发送入口，`admin-client-boundary` 已登记），
  所以这条的严重性是「模板交付的合规语义」而不是「当前实例正在漏发」。
  刻意没动的相邻一项：凭旧 token 仍可把已退订的行确认回 `subscribed`（要持有发给本人的那封邮件，
  不是攻击面；改它属于产品口径，留给用户拍板）。
- 顺手核对的阴性结果（另一条覆盖率线索，记下来免得再量一遍）：`repositories/upload-objects.ts`
  未覆盖语句是 `listOrphanObjects()` 的那行 `throw`；读过去时怀疑 `toOwned()` 的
  `row.referenced === true` 是**失效方向朝开**——RPC 若返回 `null` 引用状态就会被当成「没引用」而删掉。
  对着迁移 033 的 SQL 核过：`upload_object_is_referenced()` 是 `select exists(...) or exists(...)`，
  `EXISTS` 永不为 null，`p_object_key` 为 null 时也只会让两个 `exists` 都落 false，
  所以那条 `=== true` 写的就是它需要的东西，**不是缺陷**，不改代码。

## 2026-09-23 — RLS 静默过滤不等于成功：删掉一条不存在的通行密钥也被报成「已删除」

- 里程碑 / 版本：v0.12.0 C08 的下游判据（「0 行受影响」不是「做到了」）；凭据管理面。
- 状态：DONE，**PR #124**（base = `main`；开 PR 时指的是 #122 的分支，2026-09-23 改指 main，理由见「风险」）。
- 分支 / commit：`fix/passkey-delete-reports-actual-work`（历史含 #122 到 `eec9e44` 的 5 个 commit，加本条的
  `b82345f` 与 3 条 progress commit），tip `59b55db`。
  base 曾经是 topic 分支 ⇒ `ci.yml` 的 5 个必需作业不在本 SHA 上跑（判据见上面 #118 那篇），当时 PR 里写的是
  「本机全量是这条 SHA 目前唯一的证据」；改指 main 之后必需 CI 会在本 SHA 上跑，那句话只对改指之前成立。
- 为什么做：还是顺着 #122 那条覆盖率线索。`src/lib/actions/passkey.ts` 在 C08 栈尖上是
  **14% 语句覆盖**——整个 action 只有一行 `await deleteMyCredential(id)` 被读过一次，
  `catch`、`revalidatePath`、`ok()` 全没被任何用例经过。先量了一下这有多没人看着：
  把 `deletePasskey` 的函数体换成无条件 `return ok()`（连仓储都不调）后跑全量，
  **199 files / 2291 tests 全过**。这条 action 是设置页上「凭据已移除」的确认。
- 缺陷：`deleteMyCredential()` 只看 `error`。迁移 019 的
  `users_delete_own_passkeys ... using (auth.uid() = user_id)` 对不匹配的行是**静默过滤**：
  0 行受影响、`error` 为 `null`。所以「删掉了自己的那条」和「那条是别人的 / 早就不在了」
  在调用方看来越同，`deletePasskey` 于是回 `ok()` 并 `revalidatePath`，UI 报「已移除」，
  而凭据其实还在。判据仓库早就立过：#102（未合）把 `revokeApiKey` 从同形缺陷里救出来用的是
  同一个形状——`.select("id")` 数受影响行；`marketing.updateStatusByToken` 也是这个形状。
- 完成内容：
  1. `deleteMyCredential(id): Promise<boolean>`：`.delete().eq("id", id).select("id")`，
     error 仍抛（保持 #122 那条契约），`data` 长度为 0 → `false`。
  2. `deletePasskey`：`false` → `fail("passkeyNotFound")` 且**不** `revalidatePath`；抛错仍
     `databaseError`。新码 `passkeyNotFound` 同步进 `messages/en/actions.json` 与
     `messages/zh-CN/actions.json`（中文按既有术语用「通行密钥」，措辞对齐 `sessionNotFound`）。
  3. 测试：新建 `src/lib/actions/passkey.test.ts`（3 条：成功 / 0 行 / 抛错，各自钉
     `revalidatePath` 是否发生）；`webauthn.test.ts` 的删除段从 1 条扩到 3 条，
     其中一条断言 `.select("id")` 真的在链上——少了它，「删掉了」和「一行都没匹配上」不可区分。
- 变更文件：`src/lib/repositories/webauthn.ts`、`src/lib/actions/passkey.ts`、
  `src/lib/actions/passkey.test.ts`（新增）、`src/lib/repositories/webauthn.test.ts`、
  `messages/en/actions.json`、`messages/zh-CN/actions.json`、`CHANGELOG.md`、本条目。
- 验证命令与结果：
  - 变异：action 里不读受影响行（等价 main 上的行为）→ `expected { ok: true } to deeply equal
    { ok: false, error: 'passkeyNotFound' }`；跑完从 `/tmp/act2.bak` 还原并 `cmp` 确认；
  - `vitest run src/lib/actions/passkey.test.ts src/lib/repositories/webauthn.test.ts` → **15 passed**；
  - 本机 push 前全量：`pnpm -s lint` / `pnpm -s type-check` → 0；`pnpm -s test` →
    **200 files / 2301 tests passed**（base #122 上是 2297，本条 +3 action +1 仓储用例）；
    `CI=true pnpm -s check:all` → 0（「全部校验通过」）；`pnpm build` → 0。
- 阻塞 / 风险：
  - **base 从 #122 改指 main**：改指前先量了两边——`git merge-tree --write-tree origin/main HEAD` 返回
    **0 冲突**，而对 base（#122 分支 tip `fabebe2`）唯一的冲突文件是 `docs/progress.md` 本身：#122 搬自己条目
    用 `fabebe2`，我这边搬 #122+#124 两条用 `59b55db`，两边改了同一段尾部。也就是说 CONFLICTING 是我自己
    那两条搬运 commit 造出来的记账冲突，不是代码冲突，而 GitHub 上挂着 CONFLICTING 会让评审以为动不了。
    改指 main 后 `gh pr view 124` 报 **MERGEABLE**。
  - 代价：本 PR 的历史含 #122 的 5 个 commit，所以 base=main 时 diff 里会一并出现 #122 的
    `auth-verify/route.ts`、`register-options/route.ts`；**#122 先落地**（它的 tip 是 `fabebe2`，比我这条的
    祖先 `eec9e44` 多一个搬运 commit）之后，本 PR 就只剩自己的 4 个 commit。顺序判据在 #118 那篇。
  - mock 模式没有 `webauthn_credentials` 这张表（`src/lib/mock` 里查无此表），E2E 也不碰 passkey，
    所以「0 行 → passkeyNotFound」在 mock 下不可达；这是既有的覆盖面缺口，不是本条引入的。
    真要覆盖它得先给 mock 补表数据 + 让 delete 回受影响行（PostgREST 的 `RETURNING` 口径）。
    **2026-09-23 量过成本，别按「补张表」估**：mock 是 1595 行手写查询层（`from()` 在
    `src/lib/mock/index.ts:1521`、`delete()` 在 `:714`），补表只是小的那一半；真正拦住的是注册仪式——
    `@simplewebauthn/server` 要验 clientDataJSON/authData（本条 #121 已读过它对 `origin` 用严格相等比较），
    E2E 里没有真 authenticator，所以得引入可注入的验证桩或让 mock 客户端接进 E2E。那是独立一件大事。
- 下一项：`src/lib/actions/admin.ts` 的 `listAdminUsersPage`（C08 栈尖上 79-89 行整段未执行、
  且没有任何用例提到它）。它和 #93–#114 那条栈改同一个 `admin.test.ts`，所以**等那条栈落地之后再补**，
  否则只是给评审多加一处必冲突的文件。

## 2026-09-23 — 三个「写着在跑」的提交钩子，其实一个都没跑过（守卫层自检）

- 里程碑 / 版本：v0.12.0 门禁基础设施——这一条查的不是业务代码，是「门禁」这件事本身是否成立。
- 状态：DONE，分支 `fix/hook-layer-actually-runs`（base `main` = `ad4b029`）。
- 为什么做：AGENTS.md 的 ⛔ 段落写着「The pre-push hook auto-runs test + build」，并把它当成
  2026-08-23 那次「没本地构建就推、Vercel 生产构建炸了」的解药。要复用这条守卫之前先量了三件事：
  `git config --show-origin --get-all core.hooksPath` 在任何 scope 都没有值（rc=1）、
  `node_modules/.bin` 里只有 eslint 与 prettier（husky / @commitlint/cli / lint-staged 都不是依赖）、
  `.husky/_/husky.sh` 不存在。也就是 `.husky/` 里那三个文件在任何克隆里都没执行过一次，
  CI 里也搜不到 commitlint。一个从不运行的守卫比没有守卫更糟——它让所有人在没保护的情况下
  相信自己有保护。
- 完成内容：
  1. 新增门禁 `pnpm check:hooks`：钩子必须能被 exec（`#!` 开头）、source 的路径必须存在、
     调用的 `pnpm <script>` / `npx|pnpm exec <bin>` / `node <file>` 必须解析得到、
     `.husky/` 非空时必须有安装入口。规则在 `src/lib/release/hook-wiring.ts`（纯函数），
     IO 在 `scripts/lib/hook-wiring-check.js`，`scripts/check-hooks.js` 只是 type-stripping 启动器。
     只接进 `check-all.sh` 就够——`ci.yml` 跑的就是聚合入口（C04 的成果），`check:gates` 会盯着接线。
  2. **先在坏仓库上跑红**：未修之前它报 6 项——1 处缺 shebang（`pre-push` 首行是中文注释，
     git 无法 exec）、2 处 source 了不存在的 `_/husky.sh`、2 处调用未安装的二进制
     （commitlint / lint-staged）、1 处没有安装入口。红是实测出来的，不是照规则编出来的。
  3. 修法保持零新增依赖：`pre-push` 补 shebang；新增 `scripts/install-hooks.sh`，由 `prepare`
     在 `pnpm install` 之后把钩子**逐个软链**进 `.git/hooks`。刻意不用 `core.hooksPath`
     （husky 的做法）：那会整体替换 hooks 目录，把别的工具已经装在那里的钩子一起屏蔽掉——
     本机 `.git/hooks` 里正躺着一个 IDE 代理装的 `post-commit` 与 `post-checkout`。
     已存在同名非软链钩子就不覆盖；`INDIESTACK_SKIP_HOOKS=1` 跳过；非 git 工作树静默退出
     （模板被 degit / 打包安装时属正常情况）。
  4. 删掉 `.husky/pre-commit`、`.husky/commit-msg`、`.lintstagedrc.mjs`。留下判断依据：
     pre-commit 那套 `prettier --write` 接到暂存文件上是**有害**的——`src/**/*.tsx` 实测 97 个文件
     不是 prettier-clean（`prettier --check` 报 97），任何一次提交都会被整文件重排；
     commit-msg 那套没有任何东西能执行。提交规范因此改成写明「规则登记在 `commitlint.config.js`、
     由 review 把关」，并在该文件顶部写清要机器强制该装什么——装完之后 `check:hooks` 才允许那个钩子存在。
  5. 文档 8 处与事实对齐：AGENTS.md（pre-push 段落 + 提交规范那条，并新增「没装钩子的克隆就是零守卫，
     先 `ls -l .git/hooks/pre-push` 再信它」）、CONTRIBUTING.md、docs-site 的 scripts / testing /
     tech-stack 三页 × 两个语言、docs/architecture 的 02-tech-stack 与 12-deployment、
     agents/10-release-manager.md。`scripts/setup.sh` 补一次显式安装，让「步骤 4 接入 Git Hooks」为真。
- 变更文件：`.husky/{pre-push,pre-commit,commit-msg}`、`.lintstagedrc.mjs`（删）、
  `scripts/{install-hooks.sh,check-hooks.js,setup.sh,check-all.sh}`、
  `scripts/lib/hook-wiring-check.js`、`src/lib/release/{hook-wiring.ts,hook-wiring.test.ts}`、
  `package.json`（`prepare` + `check:hooks`）、`commitlint.config.js`、上面那 8 处文档、
  `CHANGELOG.md`、本条目。
- 验证命令与结果：
  - 红→绿：修前 `check:hooks` 退出 1、点名 6 项；修后退出 0（1 个钩子 / 1 条命令全部可解析）。
  - 四条判定各做变异核对，数量对得上：去掉 shebang 检查 → 2 failed；去掉 pnpm 子命令白名单
    → 1 failed；去掉安装入口检查 → 3 failed；去掉二进制检查 → 2 failed。每项跑完从 `/tmp`
    字节副本 `cmp` 还原（本分支工作区全程有未提交内容，不用 `git checkout` 还原）。
  - `prepare` 确实会执行：临时目录里给一个只写 `"prepare": "touch prepared.flag"` 的包跑
    `pnpm install`，flag 出现；本仓库改完 `package.json` 后跑任意 `pnpm <script>` 也打出
    `. prepare$ sh scripts/install-hooks.sh` → 克隆被装上了钩子。
  - `vitest run src/lib/release/hook-wiring.test.ts` → 18 passed。
- 本条自己也翻了一次车并记下：往本文件追加条目时用脚本整文件重写，切片边界取错，
  把 main 最后一条（「五个 PR 全部合并回 main…」）整条删掉了。`git status` 显示该文件相对 HEAD
  干净（那条本来就在 HEAD 里），`git checkout -- docs/progress.md` 还原后改用纯追加重做。
  这正是本仓库反复记的那条规矩的第三次应验：**脚本可以读文件，不可以整文件写文件**。
- 阻塞 / 风险：纯本地层，不碰运行时与数据库，回滚 = revert 本分支的 commit。风险两条：
  一是 `prepare` 在 `pnpm install` 里跑 shell（CI/Vercel 无 `.git` 时静默退出，有 `.git` 时只是多
  两个软链，不改变任何构建产物）；二是钩子只在装过的克隆里生效，CI 才是权威关口——所以文档没有
  把它写成「有保障」，而是写成「先确认它在你机器上存在」。
- 下一件：回到 #44 后半（结账 / 分析路由的守卫状态映射），它仍等 #92 + #96 落地。
- 更新时间：2026-09-23（UTC 20:30 前后）。

## 2026-09-23 — 台账自己也得有门禁：进度日志的重复条目与顶部插入当天各发生过一次

- 里程碑 / 版本：v0.12.0 门禁基础设施（C08 那条「把故障说成结论」的线，这次照向仓库自己）。
- 状态：DONE，分支 `feat/gate-progress-ledger`（base `main` = `ad4b029`），PR 见 CHANGELOG 首条。
- 为什么做：`docs/progress.md` 是「谁在什么时候改了什么」的唯一台账，也是判断 PR 合并顺序的依据，
  但它自己的约定（新条目**追加在末尾**、一条工作一条目）一直只写在文件里靠自觉。当天两次实际损坏：
  一是 #121/#122/#123/#124 的四条条目当时都插在**文件顶部**，四条分支各自搬了一次（那次的记录在
  #118 条目的「快照之后又叠了四条」一节）；二是在写本 PR 的条目时，一个用切片重组整文件的脚本
  边界取错，把 main 的最后一条（「五个 PR 全部合并回 main…」）整条删掉——该文件相对 HEAD 当时是
  干净的，`git checkout -- docs/progress.md` 才救回来。第二次事故之后我确实把新条目写重复了一遍，
  全套 37 道门禁一路绿灯（当时的计数，`check:gates` 实测），没有任何一道发现台账里有条目是两份。
- 完成内容：
  1. 新增门禁 `pnpm check:progress`：① 台账解析不出任何条目即失败封闭（`ledger-empty`）；
     ② 每条 `## ` 标题必须带 `YYYY-MM-DD`（`heading-undated`）；③ 日期必须**非递减**
     （`date-out-of-order`，末尾追加约定的直接推论）；④ 标题不得重复（`duplicate-heading`，
     报出第一次出现在第几行）；⑤ 每条必须有 `- 里程碑` 与 `- 状态`（`missing-field`）。
     `### ` 子标题属于所属条目，不参与切分——#118 那条就是用子标题做补记的。
  2. 规则在 `src/lib/docs/progress-ledger.ts`（纯函数），IO 在 `scripts/lib/progress-ledger-check.js`，
     `scripts/check-progress-ledger.js` 只是 type-stripping 启动器；接进 `check-all.sh`
     （`ci.yml` 跑聚合入口，所以进 CI 不需要单独接线，`check:gates` 会盯着这件事）。
  3. 必填字段只钉两个是**量出来的收窄**：全 29 条既有条目里 `里程碑`=29、`状态`=29，
     而 `分支 / commit`=28、`验证命令与结果`=29、`下一项`=28、`更新时间`=14。
     拿我脑子里那套「应该有八项」去写门禁，第一天就会红 18 条——那等于把约定改成愿望。
     收窄清单写在模块文件头注释里，字段匹配也修过一次：台账实际写的是 `- 里程碑 / 版本：`，
     要求整名相等的写法会把 29 条全判成缺字段。
- 变更文件：`src/lib/docs/progress-ledger.ts`、`src/lib/docs/progress-ledger.test.ts`、
  `scripts/lib/progress-ledger-check.js`、`scripts/check-progress-ledger.js`、`package.json`、
  `scripts/check-all.sh`、`docs-site/scripts.md`、`docs-site/zh-CN/scripts.md`、`CHANGELOG.md`、本条目。
- 验证命令与结果：
  - 真文件必须绿：`check:progress` 对当前分支的台账（含本条目）退出 0，输出
    「30 条条目，日期非递减且标题无重复」。这条本身就是「末尾追加」的自检。
  - **两次实际事故都复盘成红**：把今天的条目挪到文件顶部 →
    `[date-out-of-order] 第 35 行：日期 2026-09-22 早于上一条（第 1 行的 2026-09-24）`；
    把同一条目在末尾再写一遍 → `[duplicate-heading] 第 1157 行：条目标题与第 1124 行重复`。
    两条判定各自对应今天真发生过的一次损坏，不是假想敌。
  - 单测 14 条通过（`vitest run src/lib/docs/progress-ledger.test.ts`）。
  - 变异核对，数量与预期一致：关掉重复检测 → 1 failed；关掉日期顺序检测 → 3 failed；
    必填字段清空 → 2 failed；空台账不再失败封闭 → 1 failed；把字段匹配退回「整名相等」→
    9 failed（含那条读真文件的用例，说明前缀匹配是被真实台账逼出来的）。
    每项跑完从 `/tmp/pl-backup.ts` 还原并用 `cmp` 确认字节一致（工作区全程有未提交内容，
    不用 `git checkout` 还原）。
  - 门禁：`pnpm check:all`（本分支 38 道，`check:gates` 实测：本地 35 / CI 37 / 豁免 3）/ `lint` / `type-check` / `test` / `build` 结果见 PR 描述。
- 阻塞 / 风险：纯文档层门禁，不改任何运行时行为；回滚 = revert 本分支的 commit。
  已知判定边界：日期非递减只看 `YYYY-MM-DD` 前缀，同一天内部任意顺序合法；重复判定比的是
  **整条标题**（含日期），所以「不同日期写同一件事」合法——今天那次重复恰好是同日期同标题。
  真正的漏网情形是有人把新条目插进文件中间且日期与两侧都兼容（例如补记当天更早的一次改动），
  那种顺序错误静态检不出来，只能靠 review；本门禁覆盖的是当天真发生过的那两类。
- 下一件：#44 后半（结账 / 分析路由的守卫状态映射）仍等 #92 + #96 落地；
  #96 与长栈 #103 撞代码这件事已写进 #118 那条的模拟小节。
- 补记（2026-09-24，同一件工作的增量，所以写在本条里而不是新开一条）：这道门禁第一次用在真实合并上，
  暴露的不是它漏报，而是**它的输出不够用**。#118 那次把 19 个 open PR 的栈尖按编号合成一份模拟 main，
  红的就是 `date-out-of-order`：按台账写好的解法「两块都留」解决 `docs/progress.md` 之后，内容一条没丢、
  顺序坏了，而「合并后要按日期稳定排序」这一步当时只写在台账里，不在红灯上——看到红灯的人手上没有它。
  于是把处置动作写进失败信息（这个 code 有两种成因：条目插错位置 / 冲突解完没排序），
  并新增 1 条单测钉住这段文字，`CHANGELOG.md` 那条里的「14 项单测」同步改成 15。
  复跑：`vitest run src/lib/docs/progress-ledger.test.ts` 15 passed；变异核对——把信息里的
  「按日期稳定排序」删掉 → 新增那条红，确认这条断言是可失败的。
- 更新时间：2026-09-23（UTC 21:20 前后），补记 2026-09-24。

## 2026-09-23 — 语言下拉抄了两份词表：把表单接回权威常量，并量清「要不要生效」有多大

- 里程碑 / 版本：v0.12.0 / i18n 与文档治理（`profiles.language` 这一族的第 1 步，只做无争议的那一半）。
- 分支 / commit：`fix/profile-language-vocabulary`（基于 `origin/main` = `ad4b029`，独立 PR，不叠栈）。
- 状态：DONE（PR 停在 ready-for-review，待用户合并）。
- 为什么做：从覆盖率线索（`src/lib/email-template.ts:30` 未覆盖）挖到 `profiles.language`，量出**三套互不相同的口径**：
  1. 表单把选项写死在组件里（`profile-edit-form.tsx` 的 `["en","zh","ja","ko"]`），与权威常量
     `PROFILE_LANGUAGES`（`src/lib/constants.ts:148`）是两份手抄；
  2. 常量与站点真实 locale（`src/i18n/routing.ts:13` = `["zh-CN","en"]`）不同：`zh` ≠ `zh-CN`，`ja`/`ko` 在产品里不存在；
  3. `src/lib/validations/profile.test.ts` 反而断言 `language: "zh-CN"` 合法。
  `PROFILE_LANGUAGES` 不只是 UI 列表：它是动态翻译键 `dashboard.profile.view.languages.*` 的取值域
  （`scripts/lib/dynamic-keys-check.js` 的 `profile-languages` 契约按它比对 en / zh-CN 两份消息）。两份手抄一漂移
  就有选项取不到翻译，而没有任何东西会响——所以先接回常量，再钉住它。
- 完成内容：选项改为映射 `PROFILE_LANGUAGES`；`profile-edit-form.test.tsx` 新增一条渲染断言
  「下拉 option 值序列 === PROFILE_LANGUAGES」，并顺带钉住已存值会被选中（`language="zh"` → `select.value === "zh"`）。
- 刻意没做（要产品决策，不代答）：
  - **不校验写入取值**。两条写路径（`validations/profile.ts` 的 `profileSettingsSchema`、
    `api/user/route.ts` 的 `profilePatchSchema`）都还是 `z.string().max(50)`，任意字符串可入库。收窄到
    `PROFILE_LANGUAGES` 会直接判掉 `profile.test.ts` 那条 `zh-CN` 用例；收窄到 `locales` 会把
    `zh`/`ja`/`ko` 三个现有选项变成非法。两边都是在替用户决定支持哪些语言。
  - **不让该字段生效**。UI 语言只来自 `app-locale` cookie（`src/i18n/request.ts:57`），邮件恒为中文
    （摘要主题 `cron/digest/route.ts:170`、CTA `email-template.ts:42`、类型标签 `email-digest.ts:9-17`，
    其注释自认「邮件正文当前为中文」），而邮件要真本地化必须连**已存库的通知标题**一起处理。
    `docs/design/email-templates.md:10` 承诺「英文为主、附中文摘要」，与现状相反。
- 变更文件：`src/components/forms/profile-edit-form.tsx`、`src/components/forms/profile-edit-form.test.tsx`、
  `CHANGELOG.md`、本条目。
- 验证命令与结果：
  - 变异：表单改回写死 `["en","zh","ja"]` → `expected [ 'en', 'zh', 'ja' ] to deeply equal
    [ 'en', 'zh', 'ja', 'ko' ]`（1 failed / 3 passed）；随后从 `/tmp/pef.bak` 还原并 `cmp` 确认字节一致；
  - `pnpm -s vitest run src/components/forms/profile-edit-form.test.tsx` → **4 passed**；
  - `pnpm -s type-check` → 0；`pnpm -s lint` → 0；`CI=true pnpm -s check:all` → 0（「全部校验通过」）；
    `pnpm build` 由 pre-push 钩子跑，钩子不过就推不出去。
- 阻塞 / 风险：写入仍不校验，所以一次 `PATCH /api/user {"language":"klingon"}` 之后，资料页会把
  `klingon` 当成语言名显示（展示侧有 `t.has()` 兜底，不是 500），而编辑表单退回第一项——同一份数据在同一个
  页面上自相矛盾。这一半等产品决策。
- 下一项：决策落地后按同一条链收口——选项与两条写路径统一到同一份词表，并同步 `dynamic-keys` 契约、
  `messages/*/dashboard.json` 的 `profile.view.languages`、`src/lib/mock/data.ts:60` 的 `language: "zh"`，
  以及 `scripts/lib/locales-check.js` 里为 `languages.ko` 开的值门禁豁免。
- 更新时间：2026-09-23

## 2026-09-23 — 那两句 `@ts-ignore` 是假的：删掉它 tsc 照样绿，因为载荷根本没类型

- 里程碑 / 版本：v0.12.0 / C07 的下游（写侧列名类型），凭据与设置两条写路径。
- 分支 / commit：`fix/profile-update-type-safety`（基于 `origin/main` = `ad4b029`，独立 PR）。
- 状态：DONE（PR 停在 ready-for-review）。
- 为什么做：本轮找新缺陷的两个探针都空手而归（跳过用例 0、`TODO/FIXME` 0），于是数抑制标记：
  `src/**` 非测试只有 2 句 `@ts-ignore`，都在往 `profiles` 写：`actions/profile.ts:41` 与
  `actions/settings.ts:71`，注释写着「Supabase update type inference limitation」。
- 实测（这一步推翻了自己先下的「死抑制」结论）：
  - 只删 `@ts-ignore`、载荷仍写成就地字面量 → `pnpm -s type-check` 退出 **0**，连 `full_name_typo` 都不红；
    所以那不是「抑制了一个真错误」，而是**这两处写入从来没被类型检查过**，注释把读者的注意力引向了错误的方向。
  - 换成仓库已有的写法（`api/user/route.ts:106` 把载荷标成 `Database[...]["Update"]`）之后：
    `full_name` → `full_name_typo` 报 `TS2353`；`updated_at` → `updated_att` 报 `TS2561`，
    两条错误信息还把合法列名列了出来。变异各自跑完即还原，`grep` 确认残留 0，还原后 tsc 回到 0。
- 完成内容：两处载荷改为显式 `Database["public"]["Tables"]["profiles"]["Update"]` 标注；
  `@ts-ignore` 清零（`src/**` 非测试计数 0）；行为不变。
- 变更文件：`src/lib/actions/profile.ts`、`src/lib/actions/settings.ts`、`CHANGELOG.md`、本条目。
- 验证命令与结果：`pnpm -s type-check` → 0（含变异一红一绿两轮，退出码单独取、不接管道）；
  `pnpm -s vitest run src/lib/actions/profile.test.ts src/lib/actions/settings.test.ts` → **18 passed**；
  `pnpm -s lint` / `CI=true pnpm -s check:all` 见下，`pnpm build` 由 pre-push 钩子跑，钩子不过推不出去。
- 阻塞 / 风险：本条只补了两个点。全库 `.update()` 32 个 + `.insert()` 18 个 = 50 个写载荷调用点，
  带这类标注的只有 **9** 个，其余 41 处是同一个洞（拼错列名要打到真库才现形）。逐个手改既不收敛，
  也会跟栈里正在改同一批文件的 PR 撞车。
- 下一项：把 C07 那套 `check:query-columns` 从「链上的列名参数」扩到「写载荷的键」——
  复用 `src/lib/db/query-columns.ts` 的表名→`Row` 解析，判定改成对象字面量的键集合，
  并按该仓库既有口径把「判不了的范围」计数打印出来。门禁落地前，新代码一律按本条的标注写法走。
- 更新时间：2026-09-23

## 2026-09-23 — C08-c 第五批：结账的两处读取，故障方向是「放行」

- 里程碑 / 版本：v0.12.0 / C08-c 清偿（#42 的后半）。
- 分支 / commit：`fix/c08c-stripe-reads`（栈在 #108 之上）。
- 状态：DONE（PR 待 review 合并）。
- **落地订正（合并时写）**：本条的 checkout 那一半与 PR #96 是**同一处修复的两个独立版本**
  （同一路由、同一概念、连 helper 名字都撞），按「以先落地那份为准」，`api/stripe/checkout` 的
  `route.ts` / `route.test.ts` 与两份 `actions.json` 一律取 #96 已落地的那一版，本 PR 对它们净改动为零。
  因此本条现在覆盖的是**本 PR 独有的一半**：`webhooks/stripe` 的 `notifyTeamOwner` 两处读取点名上报，
  以及随之而来的 2 条 webhook 用例。`createCheckoutScope` 那次重构与它的变异核对同样只属于已落地的那一半。
- 为什么这批优先级高：前四批的失败方向都是「把有说成无」（显示错、权限说错、终态说错），
  这一批是**放行**——`api/stripe/checkout` 读不到归属或读不到现有订阅时，scope 检查整个跳过，
  于是「已经有有效订阅的团队」被允许再买一份。那不是显示错误，是钱和数据状态真的会分叉。
- 改法：两处读取各绑 `error`，在建会话之前回 **503 + 新错误码 `checkoutUnavailable`**（双语）；
  用例同时断言 `createCheckoutSession` **一次都没被调用**——只断言状态码的话，
  「先建了会话再回 503」这种更糟的实现也能过。
- 同批的第二件事：`webhooks/stripe` 的 `notifyTeamOwner` 两次读取（按 `provider_id` 回查订阅归属、
  查团队 owner）都不绑 `error`。钱收到了、通知没发、日志什么都没有。
  现在两处各自点名上报后返回——**通知失败不让 Stripe 重放整个事件**（那是 200 的语义），
  但日志必须分得清「我们没读到」与「这个团队本来就没有 owner」。
- 覆盖：`checkout/route.test.ts` 是这个路由的**第一批单测**（5 条：两处故障、两处合法终态、
  守卫未登录仍 401）；webhook 侧新增 2 条（订阅归属读失败、owner 读失败）。
- 验证：第一版 `pnpm -s lint` **红在** `POST` 的 `complexity 16 > 15`——两处守卫加进来之后，
  这条门禁又在说「这个函数已经在做第二件事」了。于是把「谁在买、已经在买了吗」抽成
  `readCheckoutScope()` 返回三态（`ok` / `unavailable` / `subscribed`）。
  名字与栈里的 #96 撞了（同一路由、同一概念），合并时以先落地那份为准。
  重跑：`pnpm -s lint` / `pnpm -s type-check` → exit 0；`CI=true pnpm check:all` → **exit 0**（38 道门禁）；
  `pnpm build` → exit 0。变异核对按**抽完之后的形状**重做了一遍（锚点全变），
  **C1–C4 + W1–W3 共 7 项全部被杀死**，包括「把可重试的故障说成 403」（C3）
  和「抛给外层 catch，日志标签退化成通用那句」（W3）。
  重构之后测试仍然 5 条全绿，但那次「全绿」只证明行为没变——判据还是变异结果。
- 数字同步：`--unbound` 15 → **11 处**。剩下：`dashboard/page.tsx`(5)、`settings/page.tsx`(2)、
  `api/e2e/push-queue`(2)、`permission-gate.tsx`(2，按 `justified` 处理)。
- 下一批：`dashboard/page.tsx` 的 5 处（其中 4 处是 `Promise.all` 的计数读数，
  计数器修好之后才第一次被看见）。
- 更新时间：2026-09-23（UTC）。

## 2026-09-23 — C08-b 第四批：上传不再把「读不到」当成「没有旧文件」

- 里程碑 / 版本：v0.12.0 / C08-b（台账 11 → 8 处，debt 9 → 6）。
- 分支 / commit：`fix/c08b-uploads-service`（栈在 #98 → #94 → #93 → #92 之上；门禁与台账住在
  还没合并的 #92 里，合并后 GitHub 会依次把 base 接回 main）。
- 状态：DONE（PR 待 review 合并）。
- 这一批与前三批的差别：前三处是「把故障说成一个事实」，改完判断就够了；这里的第三处改完判断之后
  **必须再做一个行为决策**——读不到「要被换掉的旧头像」时，是继续上传（旧对象变成孤儿）还是中止
  （用户重试一次）。选了中止，理由是这个仓库在 A10/C05 上已经付过学费：脱离登记的旧对象只能等巡检
  去发现，而巡检是**事后**的、按天计的；一次可重试的 503 是**当场**的、按次计的。
  封面那两处更不用犹豫——读取发生在任何写入之前，中止零成本。
- 做了什么：
  1. `uploadProjectCoverFileImpl`：项目行与调用者角色两处断言改为绑定 `error`；读失败 →
     记日志 + `fail("uploadUnavailable")`，`put` 一次都不发生。`projectNotFound`（终态）与
     `onlyAdminsCreateProject`（关于用户的结论）只在真的读到那一行时才说。
  2. `uploadAvatarFileImpl`：读 `profiles.avatar_url` 改为绑定 `error`；失败时**不覆盖**业务表，
     并走既有回滚（`cleanupAfterFailure` 删新对象 + 标记元数据 deleted）。取消检查仍排在读取之后、
     故障判断之前——E05 的终态口径要求「用户取消」不被算进失败率分子，两件事同时发生时取消更准确。
  3. 新增错误码 `uploadUnavailable`：`messages/{en,zh-CN}/actions.json` 各一条（中文刻意不带你/您，
     与相邻的「上传失败，请稍后重试。」同形），`src/lib/uploads/request.ts` 的 `ERROR_STATUS`
     映射 **503**。不复用 `uploadFailed`（500 = 服务器坏了）也不复用 `databaseError`。
     文案承诺的是「本次未改动任何内容」——这在三个中止点上都成立，因为业务表都没写。
  4. `docs/db/upload-metadata.md` 的写入协议图补上这个中止点，并在「失败路径的取舍」里写清为什么
     「没这一行」和「没读到」必须是两个回答（前者照常上传，后者中止并回滚）。
- 覆盖：补 5 条（头像 2 + 封面 2 + 错误码映射 1），另在 `storage-metrics.test.ts` 钉一条
  「`uploadUnavailable` 的终态是 failure 而不是 cancelled」——它是真故障，要进失败率分子。
  老规矩，故障用例与合法状态用例成对：
  「profiles 行确实不存在」必须**照常上传**，「项目确实不存在」必须仍是 `projectNotFound`。
  `coverClient()` 加了第三个参数按读取位置注入故障，`avatarClientWithRead()` 只替那一次读取。
- 一条规则把我逼向了更好的结构：`uploadProjectCoverFileImpl` 加上两个 guard 之后
  `complexity 16 > 15` 被 ESLint 拦下（这个文件不在存量豁免名单里，也不打算加）。
  抽出 `readCoverUploadScope()` 返回 `granted | refused` 之后降到 12，而且授权判定第一次成了一个
  可以单独讨论的东西。这是本仓库第二次遇到「复杂度门禁逼出正确拆分」（第一次是 PR #96 的
  `readCheckoutScope`），记下来：**这两个案子都不是把阈值调高，而是那段判断本来就该有自己的名字。**
- 验证（全部在最后一次改动之后重跑）：
  - 变异核对 7 项（M1–M7）逐项红且只红对应那条。三个 guard 空转各红自己那条；
    **M4/M5 是反向证据**（把合法状态也改成故障会红），证明这套用例不是「只要报错就算对」；
    M6 撤掉中止时的回滚 → 红在「不留孤儿」那条；M7 把 `uploadUnavailable: 503` 从映射里删掉 →
    红在状态映射那条（退回 `?? 500`）。变异前后 `git diff --stat` 比对确认源码还原。
  - `pnpm check:query-errors` → 「358 个文件 / 20 处 awaited 查询结果断言，无未登记的抹除（台账 8 处）」，
    删掉该文件的三条台账条目之前它先报 `QUERY_ERROR_CHANNEL_EXEMPT_STALE`。
  - `npx vitest run src/lib/uploads src/lib/observability` → 16 文件 / 196 passed。
  - `pnpm lint` / `pnpm type-check` → exit 0；`CI=true pnpm check:all` → **exit 0**
    （38 道门禁、206 个测试文件全过）；`pnpm build` → exit 0。
    这一串是**抽出 `readCoverUploadScope()` 之后**重跑的：第一次 `pnpm lint` 因
    `complexity 16 > 15` 红，`check:all` 也在第一道门禁就中止（它不往后跑），所以那一次的
    「206 全过」根本不存在——按最终形态重跑才有数。
  - 浏览器侧取证：`npx playwright test e2e/uploads.spec.ts` → **5/5 通过**（23.5s，含「上传中显示进度
    并支持取消」那条）。日志里的 `Error: aborted / ECONNRESET` 是浏览器主动断开造成的，属既有的预期噪音。
    这一条要跑的理由：`e2e/uploads.spec.ts` 只在「取消」那一条上 `page.route()` 截了 `/api/uploads/avatar`，
    其余四条是**真的**打到路由 handler → `service.ts` → Mock 客户端，改的正是这条链上读结果的分支判断。
- 下一批（C08-b 收尾）：`lib/actions/sessions.ts` 与 `lib/actions/api-keys.ts` 各一处（②的尾巴），
  然后 ③ 的 `dashboard/team/page.tsx` 两处与 `dashboard/billing/page.tsx` 一处。
  `permission-gate.tsx` 两处是 `justified`，不在清偿范围内。
- 更新时间：2026-09-23（UTC）。

## 2026-09-24 — 队列涨到 40 个 PR，把 #131 的合并拓扑量完

- 里程碑 / 版本：v0.12.0；上一条「待合 PR 的合并顺序与 CI 证据范围」的增量。
- 状态：DONE。分支：`docs/pr-merge-order`（PR #118，base `main`）。
- 上一条那份「34 个 PR 按顺序合一遍」的模拟，**成员已经过期**：现在 open PR 40 个（#92–#131），
  其中 22 个 base 不是 `main`（它们至今没跑过那 5 个必需作业；判据仍是 `gh pr checks` 只列得出
  `Detect Secrets` / `security-config`）。顺序模拟没有重跑——新增的 9 个（#123–#131）里只有 #129 叠在
  #128 上，其余 8 个 base 都是 `main`，不改「第一条长栈干净落地、其余只撞账本」这个结论的形状。
  过期的是成员清单，不是方法。
- 新量出来的一条边（#131 `check:component-docs`）：对 39 个其他 open PR 逐个
  `git merge-tree --write-tree feat/component-docs-gate pr/<n>` → **39/39 冲突，其中 38 个只撞
  `CHANGELOG.md` / `docs/progress.md`**；唯一撞代码的是 **#126 `check:progress`，撞在
  `scripts/check-all.sh`**（两边各插一行门禁调用）。这是继「#96 与栈里的 #103 是同一缺陷的两份修法」
  之后第二条需要人判断的边，但性质轻得多：两行都留，然后跑 `pnpm check:gates` 重算接线即可。
- #131 的 CI 证据范围：base = `main`，所以 5 个必需作业真的跑了——`Lint & Type Check` / `Unit Tests` /
  `Build` / `E2E shard 1` / `E2E shard 2` 全绿，另 `Build Docs Site` / `E2E (Playwright)` / CodeQL /
  Detect Secrets / Analyze 绿。两个 Vercel 检查红在 `Deployment rate limited — retry in 24 hours`
  （`upgradeToPro=build-rate-limit`），按既定口径照实记录并忽略，不绕过、不放宽门禁。
- 方法（免得下次重新推）：`git fetch origin '+refs/pull/*/head:refs/remotes/pr/*'` 把全部 PR head
  落成本地引用，之后判冲突是纯本地运算。**两个坑**：① `merge-tree --write-tree --name-only` 输出的
  第一行是结果树的 OID，不剔掉它就会把每个 PR 都判成「撞代码」——我第一次跑就是这么得到 39/39 全红的，
  判据没错，是读法错了；② 文件重叠 ≠ 冲突，`package.json` + `scripts/check-all.sh` 这一对被 22 个 PR
  同时改过，git 全都自动合上了，只有 merge-tree 说了才算。
- 一条自我更正：#131 开 PR 时正文写着「若与 #128/#129 相撞，只可能撞在 CHANGELOG.md 与
  docs/progress.md」——那是没跑过的推测，而且漏了 #126 这条边。量完已经改掉正文，原句留在 PR 评论里。
  冲突面跟 base 一样是事实陈述，过期就是谎。
- 下一项：#126 与本 PR 谁后进 `main`，就在 `scripts/check-all.sh` 里保留对方的那一行并重跑
  `pnpm check:gates`；#129 需要等 #128 落地后 `gh pr edit 129 --base main`。
- 更新时间：2026-09-24。

## 2026-09-24 — 19 个栈尖整队列合一遍：门禁 41/41 绿，但台账顺序这一步谁都躲不掉

- 里程碑 / 版本：v0.12.0；上一条「把 #131 的合并拓扑量完」只算了 #131 对别人的冲突面，这次把整条队列真合一遍。
- 状态：DONE。分支：`docs/pr-merge-order`（PR #118，base `main`）。模拟发生在本地分支
  `sim/queue-131`（tip `c8be836`），**没有推送、没有碰任何远端、没有对 `main` 做任何操作**。
- 做法（可复跑）：`git fetch origin '+refs/pull/*/head:refs/remotes/pr/*'` → `git worktree add -b sim/queue-131 /tmp/merge-sim origin/main`
  → 按编号升序 `git merge --no-edit pr/<n>`，覆盖 19 个栈尖（95 96 97 114 116 117 118 119 120 121 122 123 124 125 126 127 129 130 131，
  另外 21 个 PR 的内容都在某条栈里）。冲突时套用台账已写好的解法：checkout 的 `route.ts` / `route.test.ts` 取栈侧、
  `messages/*/actions.json` 深合并、`CHANGELOG.md` / `docs/progress.md` / `scripts/check-all.sh` / 追加型的 e2e 文件两块都留。
  结果：**19 个全部落地，main 前进 110 个 commit，无一需要放弃**。
- 验证命令与结果：`CI=true pnpm check:all` 在合并后的树上 **exit 0**——41 步（38 个 `check:*` 门禁 + `type-check` + `lint` + `test`），
  `check:gates` 报 41 个门禁（本地 38 / CI 40 / 豁免 3），单测 223 文件 / 2601 用例全过。
  也就是说：按编号升序 + 上面那套解法，这批 PR 合完之后 main 是绿的，不需要任何一次代码重写。
  **但 `pnpm build` 不在这 41 步里**，这条绿灯不覆盖构建。
- 两次红，都不是 PR 的错，是「合并之后」这件事本身的两个必需步骤：
  1. **`check:progress` 红了**：`[date-out-of-order] 第 2383 行 — 日期 2026-09-23 早于上一条（第 2354 行的 2026-09-24）`。
     成因是「两块都留」的解法只保证内容不丢，不保证顺序——后合的一方带着自己那条较早的日期，落在了一条较晚的条目后面。
     这条是 #126 那个门禁带来的**新工作流空洞**：#126 进了 `main` 之后，任何一次「按台账解法解决 `docs/progress.md`」都可能让
     `check:all`（CI 跑的就是它）在 `main` 上红，而红的原因看起来像台账腐化，其实是解法少了一步。
     补上的那一步已验证够用：把条目**按日期稳定排序**（同一天的保持原相对顺序）。实测 70 条条目数不变、
     非空行多重集不变、日期由非升序变为全升序；只有 1 条真的换了位置（本 PR 那条 09-24 从第 57 位移到第 67 位），
     连带 11 个位置错位。模拟里落成 commit `ce5530b`。
  2. **`type-check` 红了 28 个错，全部在 `e2e/support/warm-up.ts(23…26)`**（`TS1109 Expression expected` / `TS1127 Invalid character`）。
     读报错位置而不是读退出码：那是我「两块都留」的脚本撞在一段 **modify/modify 的文档注释**上——两侧各自改过同一个注释块，
     删掉标记等于把 #120 那段接在 `*/` 之后，注释体外泄成代码。
     逐行对过合并结果与 `pr/116`、`pr/120` 两个版本：代码侧本来就是干净的并集（#116 的 `assertOurServer` 身份核对 + `repoVersion`，
     #120 的 `WARM_ROUTES` 与 `startedAt` 计时都在），坏的只有注释。修法是把那段注释并回块里、`*/` 收回导入之前（`c8be836`），
     之后 `pnpm -s type-check` exit 0。
- 由这两次红提炼的判据：**「两块都留」只对追加型区域成立**。判断依据不是文件名而是冲突块的形状——两侧都在文件末尾各加一段
  （`CHANGELOG.md`、`docs/progress.md`、e2e spec、`check-all.sh`）才算机械；同一区域两侧都改写（#116 与 #120 的注释块）就是
  **需要作者出场的一条边**。所以上一条里那条 #131↔#126「两行都留」的结论仍然成立，而 #116↔#120 要归到「需要人判断」那一类，
  与 #96↔#103 并列。顺带核了对机械的那对：#119 与 #117 撞在 e2e spec 与 `e2e/support/hydrated.ts`，合并后该文件同时导出
  `actUntilVisible` / `watchServerActions` / `actUntilServerAction`，三者的用例各自取得自己需要的——这块确实是并集。
- 变异核对：不采信「绿灯」本身——排序步骤是拿真实脏状态（#118 那条 09-24 在 09-23 一堆之前）量的，改完日期序列真的变升序；
  `warm-up.ts` 的并集是拿 `diff` 对两个来源版本逐行核出来的，不是「它过了所以它对」。
- 阻塞：无（本轮不需要外部权限）。Vercel 配额仍红，按既定口径记录并忽略。
- 风险 / 回滚：本条只是文档；模拟分支是本地的，回滚 = `git branch -D sim/queue-131` +
  `git for-each-ref --format='delete %(refname)' refs/remotes/pr | git update-ref --stdin`，远端无需任何动作。
- 补记（同日，两件事都是本条目自己过期造成的）：
  1. 上面那句「下一项：把排序这一步写进 #126 的失败提示」**已经做完了**：#126 的 `726b274` 把处置动作写进
     `date-out-of-order` 的信息里（两种成因各一句），并新增 1 条单测钉住这段文字。变异核对：把信息里的
     「按日期稳定排序」换成别的说法 → 只有那条新增用例红（1 failed / 14 passed），跑完从 `/tmp` 字节副本还原并 `cmp`。
  2. 本条上面那句「#131 对其他 39 个 PR：39/39 冲突，其中 38 个只撞账本，唯一撞代码的是 #126」**已经不对了**。
     #131 后续那个 commit（`033bfb6`：把 D05 登记回任务池，并把这道门禁写进 `docs/testing.md` 等四处文档）
     自己新增了一条边。重测 39 个 peer：**仍 39/39 冲突，但只撞账本的降到 18 个，另外 21 个各多撞一个文件** ——
     `docs/testing.md` × 20（整条 C08 栈 #92–#114）+ `scripts/check-all.sh` × 1（#126）。
     形状是量出来的不是猜的：对 #92 与 #114 各跑一次 `git merge-file` 三方合并，`docs/testing.md` 的冲突块是
     「两侧在同一处各插一行表格」（`check:query-errors` 那行 vs `check:component-docs` 那行），所以它属于
     「两块都留」的机械边，不是 #116↔#120 那种要作者出场的边。判据仍是上面那条：**看冲突块的形状，不看文件名**。
  3. 整队列模拟跟着刷新过一次（模拟分支 tip `5c82ab6`，`main` 之上 114 个 commit）：把 #126 / #131 的新 tip
     再合进来，只产生 3 处冲突（`CHANGELOG.md`、`docs/progress.md`、`docs/testing.md`），全部按「删掉三行标记」解掉，
     并且每次断言「非标记行多重集不变」；`CI=true pnpm check:all` 仍然 exit 0（41 步）。
     这次 `check:progress` 直接就绿了（70 条、日期非递减）——排序做过一次之后，后续的 keep-both 合并不再破坏顺序，
     所以那一步是**一次性整顿**而不是每次合并都要做的仪式。
     （**这句已被下一条推翻**，错的不是观察而是适用域：那次是在已排序的树上增量再并两个 tip；从 `main` 从零重建时
     排序第二次变红，见下一条「整队列模拟从 `main` 从零重建」。原文保留，因为它是那次测量的证据。）
- 下一项：把这条新边写进 #131 的 PR 正文——它的 base 是 `main`，评审者看不到 #118 这份台账，只看到「与在审 PR
  的交集是账本尾巴」这句过期陈述。判断型的边仍然只有两条：#96↔#103（同一缺陷的两份修法）与
  #116↔#120（同一注释区的两侧改写）。
- 更新时间：2026-09-24。

## 2026-09-24 — 生产还站在 #69 之前，而 `indie-stack` 的构建配额刚刚放行

- 里程碑 / 版本：v0.11.0 发布冻结的前置②（「部署 commit == 验证 commit」）；与上面那条合并台账是同一条分支，
  因为解锁它的动作就是「合并」。
- 状态：DONE（测量与取证已完成；剩下的动作属于用户）。分支：`docs/pr-merge-order`（PR #118，base `main`）。
- 量到的四件事，全部是不需要 Vercel 权限的读法：
  1. **生产确实不带构建身份**：`GET https://indie-stack-theta.vercel.app/api/health` 的键是
     `status,timestamp,uptime,uptimeFormatted,version,environment,mockMode,checks,allConfigured,ready,degraded`
     ——**没有 `commit`**，`version` 是 `0.11.0`（18:51Z 本机 `node`+`fetch` 探测，`curl` 在这台机器上不存在）。
  2. **原因不是「没实现」而是「没部署」**：实现它的 `96fb4fa` 已在 `main` 里（`git merge-base --is-ancestor 96fb4fa origin/main` 通过），
     PR #69 的合并时间是 `2026-09-22T09:31:13Z`；而 `gh api repos/…/deployments?per_page=100` 里
     `environment == "Production – indie-stack"`（必须精确匹配，前缀匹配会把 docs-site 那个项目捞进来）最新一条是
     `a322a4e` @ `2026-09-22T08:56:51Z`——**比那次合并早 34 分钟**。`main` tip 现在是 `ad4b029`（09-23 06:15 +08:00），
     所以生产落后 main 一整天的合并量，且这个落后不是版本号能看出的（两边都写着 0.11.0）。
  3. **配额窗口此刻是开的，但只开在一个项目上**：#131 的 `Vercel – indie-stack` 检查在 tip `033bfb6` 上 **pass**
     （对应的预览部署记录是 `033bfb6` @ `2026-09-23T18:41:54Z`），同一条 PR 的 `indie-stack-docs-site` 仍然 fail
     （`?upgradeToPro=build-rate-limit`）。这条对照又一次证明限流按项目计，也说明「同一个 PR 两个 Vercel 检查一红一绿」是正常状态，
     不是某条改动坏了。
  4. **主动取了一份新证据**：`gh workflow run "Production Smoke" --ref main` → run `35905536165`
     （18:53:02Z→18:53:39Z，job `107332168014`）**`✅ production smoke: 6/6 passed`**，其中 health 那一行自己写着
     `version=0.11.0, commit=unknown`——冒烟脚本在字段缺失时报 `unknown` 而不是悄悄通过，这一点值得留在证据里。
- 结论，写给下一步动作：**前置②现在只差「main 的一次新构建真的上生产」**，而这需要一次合并（合并属于用户）。
  配额此刻可用，所以合并任意一条 base 为 `main` 的在审 PR 都会把 `main` 推到生产；那之后 `/api/health` 会带 `commit`，
  ②才有可断言的身份。按既定口径：**不创建 tag、不把冒烟标成通过、不因为配额放行就宣布发布步骤完成**。
- 验证命令与结果：上面每一条都附了可复跑的命令与读到的原文；额外一条陷阱——
  `gh run view --log --job=…` 抓冒烟输出时，直接 `grep smoke` 只会命中 teardown 的凭据清理噪音，
  要按步骤名（`Run production smoke`）或脚本自己那行 `✅ production smoke: 6/6 passed` 取。
- 阻塞 / 风险：本条是带日期的快照，配额窗口可能几小时后又关；`indie-stack-docs-site` 仍在限流中，
  所以 docs-site 的预览不会跟着好起来，别把它当作本条改动的失败。
- 下一项：等一次合并落到 `main` 之后，重跑同一条 `Production Smoke` 并带上 `expected_commit`，
  比较「部署记录里的 SHA == health 返回的 commit」；B02（回滚演练）也需要那时才有两个可切的生产构建。
- 补记（同日）：上面这套读法在 `docs/operations/release-runbook-v0.11.0.md` 里有一份命令拷贝，
  而它写的是 `deployments?per_page=12`。按那个数取，回来的前 20 条**全是 `Preview – …`**，一条生产记录都没有
  （第一条生产记录排在第 35 位；100 条里只有 9 条是生产），于是「记录里没有这个 commit」会被读成
  「从未部署过生产」——正好是那份文档想避免的那类误读。已改成 `per_page=100`，并把「预览部署也写进同一张表」
  这句写进命令块上方的注释。`docs/progress.md` 里那条同样写着 `per_page=12` 的旧记录**保留原文**：
  台账是带日期的证据，改它等于伪造当时的测量；权威读法以 runbook 为准。
  另在 runbook 的「冻结状态与未完成步骤」里补上这次复测的四个数（部署早于 #69 合并 34 分钟、
  冒烟 run `35905536165` 6/6 且自报 `commit=unknown`、配额此刻只对 `indie-stack` 开放、
  仓库侧没有任何不推 `main` 就能触发生产部署的办法），②的剩余阻塞面因此从「配额」收窄成「一次合并」。
- 更新时间：2026-09-24。

## 2026-09-24 — 整队列模拟从 `main` 从零重建：41 个 head 逐个证包含，台账排序第二次被量到

- 里程碑 / 版本：v0.12.0；上一条把模拟刷到 `5c82ab6`（在已排序的树上增量再并两个 tip），这一条从 `main` 重新长一遍，
  并补上那条绿灯**没覆盖**的两半——覆盖率与端到端。
- 状态：DONE。分支：`docs/pr-merge-order`（PR #118，base `main`）。模拟发生在本地分支 `sim/queue-41`
  （tip `094897d`，`main` 之上 117 个 commit），**没有推送、没有碰任何远端、没有对 `main` 做任何操作**。
- 包含关系是逐个证出来的，不是数合并次数推出来的：`git fetch origin '+refs/pull/*/head:refs/remotes/pr/*'` 一次把
  41 个 head 取到本地，再对每个 head 跑 `git merge-base --is-ancestor <sha> sim/queue-41` → **41/41 通过，`missing=0`**。
  树上只有 **19 个栈尖**（first-parent 合并 19 次），差额正是栈式 base 的意义：一条栈尖一次带回若干 PR。
  这条判据替代了上一条那种「19 个栈尖 + 另外 21 个 PR 应该都在栈里」的口头推定——现在它是可重跑的。
- 冲突仍然只落在那几类**追加型区域**（`CHANGELOG.md`、`docs/progress.md`、`scripts/check-all.sh`、e2e spec / support），
  解法沿用上一条：两块都留 + 每次断言非空行多重集不变。三处例外按既有决定处理，并且落账前在合并结果上复核过：
  `messages/*/actions.json` 取深合并（现在 `en` 与 `zh` 各 **81** 个键、键集完全相同，即那次「只有一个边有的键」被并集吃掉了）、
  `checkout/route.ts` 与 `route.test.ts` 取栈侧、`e2e/support/warm-up.ts` 直接换成上一轮逐行验过的并集
  （`assertOurServer` 的身份核对与 `WARM_ROUTES` 的预热清单同时在场）。
- **`check:progress` 又红了，于是上一条的补记被推翻**：从零重建的树上 `pnpm -s check:progress` 报
  `❌ 进度台账自检失败（1 项） → [date-out-of-order] 第 2484 行`。上一条补记里那句
  「排序做过一次之后……那一步是一次性整顿而不是每次合并都要做的仪式」**是错的**。
  错在哪说清楚：那次观察是在**已经排好序的树**上做增量再合并（只并 #126 / #131 两个新 tip），
  这种情况确实不再打乱顺序；而**从 `main` 重新长一遍**时，每条栈各自带来的账本尾巴会重新互相插队。
  规则因此是「每次从零集成都要排一次序」，不是「排过一次就一劳永逸」。
- 排序的影响面是现算的（拿 `8453050` 与 `094897d` 两个 git object 比，不引用记忆里的数字）：
  `## ` 条目 **73 → 73**、非空行 **3037** 行的多重集完全一致、**13** 个位置上的条目换了、
  日期序列由「非升序」变「全升序」，第一处逆序落在第 **60** 个条目上（也就是 `第 2484 行`）。
  排完门禁报 `✅ 进度台账自检通过：73 条条目，日期非递减且标题无重复`（commit `094897d`）。
  变异核对：把排序**前**的文件原样放回工作区再跑一次，红的还是那一行 `第 2484 行`，然后按字节还原、
  `git status --porcelain` 为空——这条绿灯不是「改完忘了测」。
- 上一轮绿灯没测的两半，这轮补上了（对应 v0.12.0 退出判据第 4 条）：
  - `pnpm test:coverage`：**exit 0**，`Test Files 223 passed (223)`、`Tests 2609 passed (2609)`、
    `All files | 97.45 | 92.29 | 98.14 | 98.58`。
  - `pnpm test:e2e`：**exit 0**，`113 passed (2.2m)`。日志里那些 `[WebServer] ⨯ Error: aborted` / `ECONNRESET`
    是用例主动注入的失败路径（上传中断、mock storage 不可用），不是套件故障——判据取退出码与 Playwright 的汇总行，
    不取 stderr 干不干净。
  - `CI=true pnpm check:all`：**exit 0**，41 步全绿（38 个 `check:*` + `type-check` + `lint` + `test`）；
    `check:gates` 报 41 个门禁（本地 38 / CI 40 / 豁免 3），套件 `Test Files 223 passed`、`Tests 2609 passed (2609)`、
    `Duration 37.78s`。这一轮跑在**排序之后**的树上，所以「集成 + 排序 = 绿」是同一棵树上的结论，不是两次拼起来的。
    两个读数陷阱值得留在证据里：日志里那句 `❌ node_modules/.bin 不存在` 出自 `hook-wiring.test.ts` 的临时仓库夹具
    （它故意造一个引用缺失二进制的钩子），紧跟着的一行才是本仓库自检的
    `✅ Git 钩子层自检通过：1 个钩子（pre-push），1 条命令全部可解析`——读日志要分清那一行属于谁，否则一次绿灯会被读成红；
    而 `Tests 2609 passed` 那行带 ANSI，`grep -a "Tests  *[0-9]"` 直接读不到，必须先
    `sed -e 's/\x1b\[[0-9;]*m//g'`（同一个坑今天踩了第二次）。
- 一处测量口径的坑，值得单独记：`gh pr list --state open --json number --jq 'length'` 报 **30**，
  而真实开放 PR 是 **41**——`gh pr list` 默认 `--limit 30`，那个 `length` 量的是「这次取回了几条」而不是「队列有多大」。
  凡是数队列的读数一律显式带 `--limit`。上一条里「40 个 PR」那类数字当时就是用带 limit 的命令量的，
  所以队列没被记错过，但差 11 个的读数足够让下一次判断（比如「还有没有栈没并进来」）出错。
- 阻塞：无（本轮不需要外部权限）。Vercel 配额按既定口径记录并忽略。
- 风险 / 回滚：本条只是文档；`sim/queue-41` 是本地分支，证据落账后 `git branch -D sim/queue-41` 就是全部回滚，
  远端无需任何动作。
- 下一项：等一次真正的合并（合并属于用户）。`main` 一旦前进，就用同一套命令重跑本条的集成与验证，
  并把数字搬进 #118 的正文——评审者只看 PR 正文，看不到这份台账。
- 补记（同日）：上面那次集成之后 **`main` 没动，但 #92 长了 5 个 commit**（`3f5fd55` → `6892d87`：
  守卫层的会话读取不再把 Auth 抖动答成「你没登录」、登记 C09、审计行打 `sessionReadFailed`、
  C09 的重叠判读、两个登出按钮不再在没登出时报完成）。重新量 #92 对 40 个 peer 的冲突面：
  **40/40 冲突，其中 38 个只撞 `CHANGELOG.md` / `docs/progress.md` / `docs/roadmap-0.12.0.md` 这三本账**，
  另外两条是本就存在的 #129（`docs-site/scripts.md` 两份）与 #131（`docs/testing.md`）。
  **这一批新改动没有新增任何一条需要人判断的边**——特别是它往 `messages/{en,zh-CN}/dashboard.json`
  加了两个键，而 #110 / #111 那几条在审 PR 也各自改过同一份文件，这次没撞上是形状错开的运气，
  不是可以假设的性质。代价说清楚：**上面那三个「合并后是绿的」的读数是在 #92 的旧 tip 上取的**，
  新的 5 个 commit 之后要重跑才算数（重跑就是本条上面那套命令，一次 `check:all` + coverage + E2E）。
- 更新时间：2026-09-24。

## 2026-09-24 — 41 个 head 从零重跑整队列：绿灯覆盖到 build，另外量出三条需要人判断的边

- 里程碑 / 版本：v0.12.0；上一条留下的那句话（「#92 新的 5 个 commit 之后要重跑才算数」）在这一条兑现。
  分支 `docs/pr-merge-order`（PR #118，base `main`）。模拟发生在本地分支 `sim/queue-42`
  （worktree `/tmp/merge-sim-42`，合并树 `c89d8a0`，加两条整理 commit 后 tip `d9d35bd`），
  **没有推送、没有碰任何远端、没有对 `main` 做任何操作**。
- 状态：DONE。重跑的范围是 41 条 open PR（`origin/main` 仍是 `ad4b029`，队列自上次模拟没有合进任何东西）。
- 做法（与上一条同一套，多了两处修正）：`git fetch origin '+refs/pull/*/head:refs/remotes/pr/*'` 把 41 个
  head 取到本地 → `git worktree add -b sim/queue-42 /tmp/merge-sim-42 origin/main` → 按编号升序
  `git merge --no-edit pr/<n>`，每次合并后**核对落地的第二父（或快进后的 HEAD）就是那条 PR 的 head**，
  不匹配就停。包含关系仍是逐个证的：**41/41 通过、`missing=0`**；合并树 `c89d8a0` 上是 `main` 之上
  **152 个 commit**、first-parent 合并 **40 次**（少的那一次是 #92 直接快进）。同一条断言在整理后的
  tip `d9d35bd`（154 个 commit）上**重跑过一遍**，仍然 41/41——那两条整理 commit 没有丢掉任何 head。
- 冲突只落在那几类共享追加区，每个文件的**独立编辑条数**（逐条 PR 自己的 delta，
  `merge-base <base-ref-oid> <head>` 之后 diff 文件全名）是量出来的：`docs/progress.md` 41、
  `CHANGELOG.md` 39、`docs/testing.md` 13、`messages/{en,zh-CN}/actions.json` 各 7、
  `docs-site/scripts.md` 与 `docs-site/zh-CN/scripts.md` 各 7、`scripts/check-all.sh` 4、`package.json` 4、
  `e2e/admin-contact-mfa.spec.ts` 2（#117 #119）、`e2e/support/warm-up.ts` 2（#116 #120）。
- **三条需要人判断的边（前一轮没有量出来，因为判据本身不对）**：
  1. `messages/{en,zh-CN}/actions.json` 的 **`checkoutUnavailable` 两侧各自定义、文案不同**——
     #96 那条是泛化的「支付服务暂时不可用」，#109 那条点名了「确认不了团队当前订阅、本次没有发起结账」。
     模拟里按「后合的覆盖」取了 #109。**要人确认最终寄给用户的到底是哪一句**，这不是 git 能决定的。
  2. `e2e/support/warm-up.ts`：#116（服务器身份核对）与 #120（预热清单双向对账）是**兄弟不是父子**，
     两份里各自都没有对方那半件。「两块都留」在这台机器上产出了**非法 TypeScript（53 处 type-check 错误）**，
     只能手工并集：身份核对放在「只在并行时预热」那句早退**之前**、预热循环改用 `WARM_ROUTES`。
  3. `src/app/api/stripe/checkout/route.test.ts`：#96 是 7 条用例 / 178 行，#109 是 5 条 / 127 行，
     并集 = 12 条 / 298 行且重复声明。模拟按既定口径取了栈侧（#109），**代价写清楚：#96 那两条多的用例
     没进这棵树**，得由作者确认它们断言的行为不是 #109 需要的。
- **对上一条解法本身的两个修正**（这是本轮最有价值的产出，因为它影响每一批 PR 的重解）：
  ① 「断言非空行多重集不变」这条判据**在两类文件上都不成立**。第一次实现按
  `base + (ours−base) + (theirs−base)` 算期望值，栈式分支**共享的新增会被算两份**，于是把一次本来正确的
  「两块都留」读成「丢了一行」；② 代码文件里对侧**删掉行是合法结果**，`⊇ 两侧`根本不是想要的性质。
  现在的口径：纯追加的账（`docs/progress.md`、`CHANGELOG.md`、`docs/roadmap-0.12.0.md`、
  `scripts/check-all.sh`）才做并集断言；代码与被删过的文档只做「标记清零」，交给 type-check / lint / test 判。
  这条改完，之前那个「期望 4 得到 3」的假丢行消失了，而两处**真的**需要人判断的地方（上面 2、3）浮了出来。
- 台账排序这一步仍然躲不掉：合并完 `pnpm -s check:progress` 在**未排序**的树上红两项
  （`[date-out-of-order] 第 1470 行 / 第 2788 行`）。按日期稳定排序之后绿：79 条条目、非空行 3329 → 3329、
  多重集一致、45 条换了位置。**每一次从零重建都要重跑这一步**，它不是一次性整顿。
- 合并后同一棵树上的验证（这次比上一轮多跑了 build）：`CI=true pnpm check:all` **exit 0**，
  `Test Files 226` / `Tests 2634`；`pnpm test:coverage` **exit 0**，
  `All files | 97.46 | 92.33 | 98.14 | 98.59`；`pnpm test:e2e` **exit 0**，`113 passed (3.2m)`
  （日志里那两条 `[ERROR] avatar upload failed / storage object cleanup failed` 是用例**故意注入**的
  mock 故障路径，不是失败）；`pnpm build` **exit 0**，23 个静态页全部生成——
  上一轮那句「`pnpm build` 不在 `check:all` 的 41 步里，所以这条绿灯不含构建」现在补上了。
- 顺手清掉的队列卫生：重跑之前 `gh pr list` 全量扫 `mergeStateStatus`，**整条队列只有 #93 是 CONFLICTING**
  （它的 base 就是 #92，而 #92 今天多了 7 个 commit）。按升序重放：#93 rebase 到 `605be71`（`5312e8f`）、
  `check:all` 绿、`--force-with-lease` 推送；这又让 #94 CONFLICTING，同样处理（`4f61d42`，
  `git range-diff` 证明它自己那条 commit 逐字节没变、只是换了父）。#93 的下游链深度实测只有 1
  （唯一子分支是 #94），级联到此结束。
- 这次模拟**没覆盖**的东西，别当成覆盖了：包含性与绿灯用的是 09:54 取到的 head，
  之后 #93 / #94 的 rebase 换了 sha（内容按 `range-diff` 等价）；`main` 一旦前进，41/41 与这三条边都要重量。
  Vercel 那条部署检查仍红（平台配额），按既定口径记录并忽略，不绕过、不因此削弱任何门禁。
- 风险 / 回滚：本条只是文档；模拟分支是本地的，回滚 = `git worktree remove /tmp/merge-sim-42 --force` +
  `git branch -D sim/queue-42` + `git for-each-ref --format='delete %(refname)' refs/remotes/pr | git update-ref --stdin`，
  远端无需任何动作。#93 / #94 的 force-push 是既定生命周期内的分支更新，且各自 `check:all` 已在推送前跑绿。
- 下一项：`main` 前进之后重跑本条（含那三条需要人判断的边，届时应已由作者定稿）；
  `AUTH_ERROR_CHANNEL` 台账（C09 的门禁接不接）仍排在其后。
- 更新时间：2026-09-24。

## 2026-09-24 — 上一条那三条「要人判断的边」：两条判完了，理由和落地规则写在这里

- 里程碑 / 版本：v0.12.0；分支 `docs/pr-merge-order`（PR #118）。上一条目写着「届时应已由作者定稿」——
  那三条边都是**我自己两条 PR 之间的分歧**，作者就是我，不必等人。这一条把能判的两条判掉，并把判据落成一条
  合并时可执行的规则；判不了的那条留在原地。
- 状态：DONE（三条边全部定案；边 2 是同日晚些补判的，见下面那条订正）。
- **判据先说清楚，否则这条目就只是又一次「我说了算」**：三条边里前两条的共同点是 **#96 与 #109 把同一个守卫重写了两遍**
  （`src/app/api/stripe/checkout/route.ts`：main 上 98 行，#96 版 139 行、#109 版 133 行；
  `diff main→#96` 改 81 行、`diff main→#109` 改 79 行——两份都是整函数级重写，不是各加一处）。
  所以这不是「两个都对、只能选一个文案」，而是**同一件事的两个实现要挑一个**，挑完另一份在这三个文件上的改动整体作废。
- 逐行比过两份实现（`/tmp/r96.ts` vs `/tmp/r109.ts`，临时文件未入库）：**行为等价**，
  差别只有三处——① #96 的失败结果带 `source`（`membership` / `subscription`），日志因此能说是哪一道读失败
  （`FAILURE_LABEL`），#109 只回 `{status:"unavailable"}`，日志里分不出；② 状态命名（`duplicate`/`failed` vs
  `subscribed`/`unavailable`）；③ 注释措辞。**#109 没有任何 #96 缺的行为**（两版对 `priceId` 白名单、
  `createCheckoutSession` 参数、`idempotencyKey` 的处理逐行一致）。
  反过来 #96 的测试文件里有 #109 没有的两条，其中一条是「**路由能返回的每个错误码都在两个 locale 里有文案**」——
  那是 PR #96 那类缺陷（错误码没有对应文案）的门禁级用例，丢了就没有别的地方守着。
- **定案（边 1）**：`checkoutUnavailable` 取 **#96 的泛化文案**（「支付服务暂时不可用，请稍后重试」/
  "Payment is temporarily unavailable. Please try again."）。理由不是「#96 更早」，是**这个键服务于两种失败来源**：
  `readCheckoutScope` 会在「团队归属读失败」和「现有订阅读失败」两种情况下都用它。
  #109 那句「暂时无法确认你团队的当前订阅，本次没有发起结账」在团队归属读失败时是一句**假话**（没确认的是归属，不是订阅）。
- **定案（边 3）**：`route.test.ts` 同样整体取 #96 版（7 条），#109 的 5 条不并进来——它们断言的行为是 #96 那 7 条的子集
  （只是 `it()` 标题不同），做「按标题并集」只会产出同一行为的重复断言 + 重复声明（上一条模拟里已经量过：
  强行并集 = 12 条 / 298 行且重复声明）。
- **落地规则（合并时执行，零 rebase、零新增冲突边）**：#96 编号小于 #109，按升序先落地，所以到合 **#109** 时，
  这几处**一律取 main 已有的那一版**（也就是 #96 落进去的那份）：`src/app/api/stripe/checkout/route.ts`、
  `src/app/api/stripe/checkout/route.test.ts`、以及 `messages/en/actions.json` 与 `messages/zh-CN/actions.json` 里的
  `checkoutUnavailable` 键。**#109 其余文件照常**（它真正的贡献是 `src/app/api/webhooks/stripe/route.ts` 及其测试，
  #96 完全没碰），own-delta 全清单：`CHANGELOG.md`、`docs/progress.md`、`docs/roadmap-0.12.0.md`、
  `messages/{en,zh-CN}/actions.json`、`stripe/checkout/route{,.test}.ts`、`webhooks/stripe/route{,.test}.ts`。
  代价写清楚：#109 分支上那两处 checkout 改动就此作废，**#109 的 PR 正文应在合并前把这一点标注出来**，
  否则它的 diff 看起来像是改了两遍。
- **【同日晚些订正】边 2 也判完了，而且判法与边 1/3 不同**：`e2e/support/warm-up.ts` 的 #116 × #120 是
  **兄弟不是父子**（服务器身份核对 vs 预热清单双向对账），没有「挑一份」这回事——上一条说「这条要写代码」是对的，
  但代码**已经写完了**：整队列模拟的那棵树 `d9d35bd` 上就是并好的那份，而它跑过 `CI=true pnpm check:all` exit 0、
  `pnpm test:e2e` 113 passed、`pnpm build` exit 0。所以剩下的不是判断，是**把那段已验证的文本送到合并现场**。
  落地方式选了「写进 #120 的 PR 正文」而不是「改某个分支」，理由是量出来的：#116 与 #120 **都 base `main`、
  都没有下游 PR**（`baseRefName` 命中 0），所以两条都不必 rebase；而把并集塞进任一条，要么让那条的 diff 里
  长出对方的整个特性（#120 得连带新增 #116 的 `src/lib/testing/e2e-server-identity.ts`），要么改掉 base 之后
  **让这条分支以后再也拿不到必需 CI**：`ci.yml` 的触发条件写着 `base == main || base == develop`，
  base 一旦改到 topic 分支，之后的推送就再也不会跑那 5 个作业（旧 SHA 上那几次运行记录还在，
  但它们不再代表将要被合并的内容）——两种代价都换不到任何东西，因为解法本身没有待定的部分。
  规则写成三条（`diff #116版 合并版` = **27 行**，逐行核过没有第四类改动）：以 #116 那份为基底；
  删掉 #116 那行本地 `const ROUTES = [...]`、改成本 PR 的 `WARM_ROUTES` 导入与循环；文档注释两边都留；
  **`assertOurServer` 那段必须留在 `if (SERVERS < 2) return;` 之前**（串行才是最常用模式，放早退之后等于常跑的路上不设防）。
  #120 的正文里带这三条 + 为什么，评审与合并都只看那一处。
- 顺带更正一条与本条无关的口径：队列现在是 **42 条**（#134 `fix/c09-swallowed-signout`，base `main`，
  与那 41 条零 own-delta 重叠），上面那套整队列模拟覆盖的是 #92–#133。傍晚逐条扫 `gh pr checks` 的桶：
  41 条里 40 条唯一红项是 Vercel（配额），1 条全绿，**没有一条是因为代码红的**；#134 的必需 CI
  （Build / Unit Tests / Lint & Type Check / CodeQL / E2E + 两个 shard）在 base `main` 上全 pass。
- 验证：本条只是文档，判据本身来自 `git show <ref>:<file>` + `diff` 的逐行比对，命令都在上面；
  两条 `route.ts` 的行数与 diff 规模、#109 的 own-delta 清单、#96 无下游（`baseRefName=="fix/checkout-guard-fail-closed"`
  命中 0 条）/ #109 下游只有 #110，都是当场量的。
- 风险 / 回滚：本条不改代码、不动任何 PR 的 base，回滚 = revert 本 commit。
- 下一项：`main` 前进之后重跑整队列模拟（那时边 1、边 3 应已因这条规则自动消失，只剩边 2 与新的账）；
  `AUTH_ERROR_CHANNEL` 台账仍排在 #92 与 #114 落地之后。
- 更新时间：2026-09-24。

## 2026-09-24 — C09 门禁的输入量好了：整队列自己在**减少**抹通道点（Δ −9，全部来自 #92），新增 0

- 里程碑 / 版本：v0.12.0；分支 `docs/pr-merge-order`（PR #118）。这条是给「`AUTH_ERROR_CHANNEL` 台账接不接」
  那个待定问题补的**输入**，不是决定本身。
- 状态：DONE（测量）。决定仍按既定顺序排在 #92 与 #114 落地之后——理由在下面第三条。
- 要回答的问题：#134 那条台账把 C09 的面量成了 90 个 await 点 / 58 个抹掉通道，但**没有回答「这个债还在不在长」**。
  门禁值不值，取决于这个数，不取决于那个数。
- 怎么量的（脚本 `/tmp/c09-delta.mjs`，未入库）：对 41 条 PR 各取 own-delta（`merge-base <base-ref-oid> <head>` 之后
  的 `src/**` 非 `*.test.*` 文件），**同一套整文件 AST 判据**分别跑在 base 树与 head 树上，取差。
  分母与失明面都打印出来：`PRs scanned: 41/41`、`files with parse failure: 0`。
  **第一版这个测量是废的**：它把「新增行」单独包进函数体再解析，多行解构被截断就 `parseDiagnostics` 非空、
  该文件直接不计——报出来是「队列新增 0 处」，而唯一有信号的 #92 有 6 个文件解析失败。
  也就是说那个 0 是**没测到**，不是没有。教训与 #134 那条同型：一个计数器要先证明自己转起来了。
- 结果：**整条队列对 C09 存量是净减少，Δ = −9，全部来自 #92（它改过的文件里 14 → 5）**；
  另外 40 条**一条都没有新增**抹通道点。
- 这条测量改变的是成本，不是结论：门禁现在要做的话，台账要装 **58 个点位、散在 33 个文件**
  （比 C08-b 那份 11 条大得多；**58 已经是 #92 减完之后的数**，量在整队列合并树 `d9d35bd` 上，别拿 −9 再去减一次），
  而这些文件正是队列在改的（`actions/team.ts` 5、`actions/mfa.ts` 4、
  `actions/api-keys.ts` 4……）——门禁一接上，每条碰到这些文件的 PR 都要同时维护 `sites` 数字，
  两向对账会把「顺手修一个」和「台账漂移」混成同一次红。
  另一面也要记：这个缺陷家族在仓库历史上是**反复出现**的（58 处本身就是证据），而 `check:query-errors`
  的模块头上明写「first increment 刻意只做查询链上的断言改写」，扩到 auth 本来就是它的第二步。
  所以「接不接」仍然值得接，只是**接的位置在 #92/#114 落地之后**：判据模块（`session-error.ts`）与门禁本体
  （`query-error-channel.ts`）都还在审，现在动它们等于给一条 20 深的栈再加一条重解分支。
- 顺带把「C09 还剩几处」这个问题从「口头清单」改成「有判据可重跑的量」：两个数各自怎么来的写在上面
  （面 = 整文件 AST 分类；增量 = 同判据跑在每条 PR own-delta 的两侧取差）。
  **两个脚本本身是本轮的临时文件（`/tmp/measure-c09.mjs`、`/tmp/c09-delta.mjs`），没入库、重启即无**——
  要复测按上面那段描述重建即可，重建出来的东西必须自己打印分母（扫了几条、几个文件解析失败），
  否则拿到的 0 是「没有」还是「没测到」分不出来。
- 验证：本条只是文档与测量，不改代码、不动任何 PR 的 base；回滚 = revert 本 commit。
- 下一项：`main` 前进之后重跑整队列模拟（边 1、边 3 会因那两条定案自动消失，只剩边 2 的三行拼接与新长出来的账）；
  `AUTH_ERROR_CHANNEL` 台账在 #92、#114 落地之后接，台账尺寸按本条量出的 58 点位 / 33 文件估。
- 更新时间：2026-09-24。

## 2026-09-24 — 本地守卫全数清点：AGENTS.md 说「commitlint 强制」，而 commitlint 根本不是这个仓库的依赖

- 里程碑 / 版本：v0.12.0；分支 `docs/pr-merge-order`（PR #118）。起因是 #134 那条台账里记下的「pre-push 静失明」，
  顺着把 `.git/hooks/` 整个清点了一遍，结果比那一条大得多。
- 状态：DONE（清点 + 一处已修）。剩下的接线**排在那几条门禁 PR 之后**，理由在末尾。
- 撞上的过程：`.git/hooks/pre-push` 是指向 `/private/tmp/merge-sim-42/.husky/pre-push` 的软链
  （今天做整队列模拟时在 worktree 里跑命令，把主仓库共享的 `.git/hooks/` 指到了那个临时目录）。
  第一次推送目标还在，钩子跑了 958 行；`git worktree remove` 之后链接**悬空**，
  随后两次推送钩子一行都没跑、退出码 0、推送成功。判据不是「有没有报错」，是**推送日志的行数**（958 → 2）。
- 全数清点（`for h in …; do [ -L ] / [ -x ] / [ -e ]`）：
  - `post-checkout`、`post-commit`：真实文件、可执行 ✅
  - `pre-commit`、`commit-msg`：`.git/hooks/` 里**根本不存在**，而 `.husky/pre-commit`、`.husky/commit-msg` 是入库的 ❌
  - `pre-push`：悬空软链 → 已修成 `ln -sfn ../../.husky/pre-push`（相对链接），本条之后的推送都真跑了 `verify:build`
    （日志 946~953 行、build 23/23 静态页，四次）。
- **为什么没有照同样办法去「修」另外两个**：`.husky/pre-commit` 与 `.husky/commit-msg` 头上都有
  `. "$(dirname -- "$0")/_/husky.sh"`，而 `.husky/_/` **不存在**。把它软链进 `.git/hooks/` 之后 `$0` 变成
  `.git/hooks/commit-msg`，于是它去找 `.git/hooks/_/husky.sh`——找不到就非零退出，**每一次提交都会被挡**。
  `pre-push` 侥幸能用，只因为那份文件恰好没有这行 source。这是个反直觉的点：
  「照抄上一个修复」在这里会把仓库变成不能提交。
- 更深一层（这条才是结论）：`husky`、`@commitlint/cli`、`@commitlint/config-conventional`、`lint-staged`
  **一个都不在 `package.json`，`pnpm-lock.yaml` 里也是 0 命中**；`.github/workflows/*.yml` 里
  `grep commitlint|conventional` **零命中**。而 `AGENTS.md` 的 Maintenance 段写着
  「Commit convention: Conventional Commits, **enforced by commitlint** (config in `commitlint.config.js`)」。
  也就是说：配置文件在、钩子脚本在、话写在 AGENTS.md 上，**执行者一处都没有**——本地没装、CI 不查。
  这与 task #63 修的是同一类（承诺的守卫不存在或存在但不生效），只是这次是提交规范那一层。
- 那大家是不是在乱提交？没有。按 `commitlint.config.js` 的硬规则（`type-enum` 11 个、`scope-case: lower-case`、
  `subject-empty`、`type-empty`，加上它 extends 的 `config-conventional` 默认 `header-max-length: 100` 与
  `body-max-line-length: 100`）逐条量过 **`origin/main` 最近 200 个 commit**：**0 条违反**；
  我自己最近 40 个也 0 条（最长 header 73 字符，无一条 body 行超 100）。
  所以现状是**靠纪律维持，不是靠门禁**——这既是好消息（没有存量要清），也是坏消息（它随时可以静悄悄变成不一致，
  而且今天已经证明了这一层守卫可以整层不存在而没人发现）。
- 修法与为什么现在不做：正解是把 `@commitlint/cli` + `config-conventional` 加进 devDependencies，
  用仓库自己的门禁形态（`src/lib/**` 纯规则 + `scripts/lib/*.js` IO + `scripts/*.js` 启动器 + 进 `check-all.sh`）
  做一个「按区间校验 commit message」的门禁，这样 CI 真的会拦，不依赖谁本地装没装 husky。
  **代价现在不做**：要动 `package.json` 与 `scripts/check-all.sh`，这两个文件各有 4 条 open PR 在改
  （#113 / #114 / #126 / #131 正是门禁接线那几条），再加一条与之竞争的 PR 不划算；
  `git config core.hooksPath .husky` 这一类本地环境改动**不替用户做**（它会改变用户自己每次提交的行为）。
  已登记为待办（含「顺带把三个缺失钩子的存在性一起守住」）。
- **把范围收窄，别读成「AGENTS.md 通篇过期」**：那份文件点名的东西我逐条核过——
  5 条 `pnpm` 命令（`lint` / `type-check` / `test` / `build` / `verify:build`）全部存在于 `package.json`，
  10 个 `agents/*.md` 相对链接全部存在，3 个反引号点名的文件全部存在。
  **对不上的只有「enforced by commitlint」这一句**（外加「pre-push 钩子会自动跑」这句一度是真的坏了）。
  这条核对本身差点又产出一次假发现：第一版脚本用 `"." + 相对路径` 拼路径，拼出来是 `.agents/…`，
  于是报「20 个 agent 文件全都不在」——`ls agents` 一行就把这个结论推翻了。
  **路径要 `path.join`，别用字符串加法**；任何「全部都不在」这种数一出现，第一动作是去目录里看一眼，不是写进文档。
- 验证：以上每一条都是当场跑的命令 + 打印出来的数（钩子的 `-L`/`-x`/`-e` 三态、`ls .husky/_` 不存在、
  `node -e` 读 package.json 与 lockfile 的命中数、`grep .github/workflows`、200/40 个 commit 的规则核对）。
- 风险 / 回滚：本条只是文档；唯一的环境改动是 `.git/hooks/pre-push` 从悬空软链改成指向仓库自己的 `.husky/pre-push`，
  反向操作是 `rm .git/hooks/pre-push`。
- 下一项：门禁形态的 commit 校验排在 #113/#114/#126/#131 落地之后；
  `AUTH_ERROR_CHANNEL` 与「已装钩子存在性」两条也排在同一批之后。
- 更新时间：2026-09-24。

## 2026-09-24 — #98 因我 rebase #94 而变 CONFLICTING：判性质、按例外判据改指 main，整队列 0 假红色

- 里程碑 / 版本：v0.12.0；分支 `docs/pr-merge-order`（PR #118）。
- 状态：DONE。触发点是傍晚一次全队列 `mergeStateStatus` 复扫：**42 条里 #98 一条 DIRTY**，
  而一小时前同一把尺子是 0 条。
- 起因是我自己的动作，不是别人的代码：上午为了清 #94 的冲突把它 rebase 过（`afeca14 → 4f61d42`，
  `range-diff` 证明内容逐字节没变），而 **#98 的 base 就是 #94 那条分支**。base 换 sha 之后，
  #98 底下还压着 #93/#94 的**旧副本**，GitHub 于是把「同一批改动的新旧两份」判成冲突。
- 判性质的两条命令，结论相反才是重点（`merge-tree --write-tree --name-only`，第一行是树 OID、路径取到第一个空行为止）：
  - `pr/98` vs `origin/main` → **零冲突**；
  - `pr/98` vs `pr/94`（新 tip） → 冲突在 `CHANGELOG.md`、`docs/progress.md`、`docs/roadmap-0.12.0.md`、
    `src/lib/security/query-error-channel.ts`。
  也就是说红色是 base 记账造成的，不是这条 PR 有毛病。这正对上一早写进 #118 的那条例外判据：
  **「假红色」+「从没跑过必需 CI」同时出现才提前改指 base**——#98 的 base 是 topic 分支，5 个必需作业本来就没上报。
- 做了什么：`gh pr edit 98 --base main`（**没 rebase 任何分支、没推任何 sha、没合任何东西、没碰保护规则**）。
  为什么不选另一条路：把 #98 rebase 到新 #94 上当然也能清，但 #99 的 base 是 #98 的分支，
  于是 #99→#114 要连着 rebase **16 条**，每条都要重解同样那几个文件——零证据增益，全是风险。
- 代价写在 #98 的正文里：它现在的 diff 显示 6 个 commit（5 个是 #92/#93/#94 的，就在这条分支底下），
  那三条按升序落地之后自动缩回 1 个（`896f11e`）。
- **但「改了 base 就会跑 CI」是错的，这条要单独记**：改完之后 `gh pr view --json mergeStateStatus` 从 `DIRTY`
  变成 `BLOCKED`，而 `gh api repos/…/commits/896f11e/check-runs` 里仍然只有**昨天 09-23 那两条**
  （`Detect Secrets`、`security-config`）——`pull_request` 工作流不会因为 base 被改就重新触发，
  它挂在 `opened` / `synchronize` 这类事件上。#124 那天之所以有全绿的必需 CI，是因为**同一次操作里还推了分支**，
  不是改 base 的功劳。所以 #98 现在停在「必需检查没上报」，要等它轮到时有一次真实推送（或界面上的重跑）才会真跑。
  这一条已经把 #118 的合并动作建议改了：`gh pr edit <N> --base main` 之后**必须再推一次**才能拿到 CI 证据。
- 顺手把这条链上的台账数字对死，免得谁去重算：`ERROR_CHANNEL_EXEMPTIONS` 是
  **12（#92@`3f5fd55`）→ #93 拿掉 `projects.ts` = 11 → #94 拿掉 notifications / profile / profile-edit = 8
  → #98 再拿掉 `invitations/route.ts` = 7**，而 #98 那份文件里的 7 条**已经是终态**，
  所以那处冲突不需要两侧合并，取 #98 的即可。（测量方式：`git show <rev>:<file>` 数 `^  "..."` 的条目行，
  再用 `comm` 求两侧删除集的交集——**交集为空**，这条链上没有人改同一个条目。）
- 复扫结果（同一把尺子）：42 条 open PR 里 **0 条 DIRTY**、1 条 BLOCKED（#98，必需检查还没上报——见上一条），
  1 条 CLEAN、40 条 UNSTABLE（全部只有 Vercel 配额那两条红）。
- 验证：上面每个数都是当场命令的输出；改 base 前后的 `mergeStateStatus` 从 `DIRTY` 变 `BLOCKED` 是
  `gh pr view --json mergeStateStatus` 读回来的，不是推的。
- 风险 / 回滚：一条命令还原 `gh pr edit 98 --base fix/c08b-prefill-overwrite`。
- 下一项：#98 的必需 CI 结果；`main` 前进之后重跑整队列模拟。
- 更新时间：2026-09-24。

## 2026-09-24 — 44 个 PR 从零重建第二遍：6 条边需要人判断，`check:progress` 顺手抓出我自己三条不合规的台账条目

- 里程碑 / 版本：v0.12.0 收口期的合并证据。分支 `docs/pr-merge-order`（PR #118）。
- 状态：已完成，等待合并。
- 为什么要再跑一遍：上一轮模拟覆盖的是 41 个 PR，此后队列长出 #134/#135/#136 三条、`main` 仍是 `ad4b029`。
  台账里自己写过的规则是「这份矩阵随队列每次变动即过期，要重跑而不是引用」，所以这次是按规则办事，
  不是因为有人报了问题。
- 做法（脚本化，不再手敲，理由见下面的「第一次作废」）：`sim/queue-44` 从 `origin/main` 起，
  按编号升序并入 **24 个栈尖**（44 个 open PR 里其余 20 个是别人的 ancestor，剔除后仍全覆盖），
  逐个用 `git merge-base --is-ancestor <每个 PR head> sim/queue-44` 证包含关系，
  结果 **44/44**，`main` 之上 157 个 commit。
  台账/CHANGELOG 的冲突一律走「两侧都是纯追加 ⇒ 两块都留」的判定器，
  它对两侧各自与 merge base 做行多重集比较，任何一侧**删过**基线内容就拒绝合并并要求人工——
  这一条是有牙齿的：中途一次我把 `--ours`/`--theirs` 之外的形状交给它，它直接 REFUSING 了。
- 第一次整轮作废重跑（我的操作失误，记下来免得再犯）：驱动脚本在「同时有代码冲突」时会**先停下来**，
  而我在那次停下后手工 `git add CHANGELOG.md docs/progress.md`——**冲突标记还在文件里**，
  于是 #119、#120 两个 merge commit 把 `<<<<<<<` 提交进了模拟历史。
  发现方式不是看日志，是下一轮合并时判定器报「a conflict marker survived in the reconstruction」。
  处置：`reset --hard origin/main` 整轮重跑，把「先解文档、再决定要不要停」写进驱动脚本，
  并在结尾加一道全索引 `git grep --cached "^<<<<<<< "` 的后检。模拟分支上的历史都是远端 ref 的重放，
  重跑不丢东西；真实分支一条没动。
- 六条需要人判断的边（其余全是两块都留）：
  1. **#114 ↔ #94（两条都以 #92 为根的并行链）——豁免台账必须跟着 #114 走。**
     我第一版按「两侧条目取并集」处理 `src/lib/security/query-error-channel.ts`，把 #94 那 7 条
     `debt (C08-b)` 条目也搬了过来；`pnpm check:query-errors` 立刻逐文件点名：
     `QUERY_ERROR_CHANNEL_EXEMPT_STALE: src/app/api/invitations/route.ts 登记台账 5 处，实际 0 处`
     （另 6 处同形：`uploads/service.ts` 3、`team/page.tsx` 2、`analytics`、`billing`、`api-keys`、`sessions` 各 1）。
     也就是说 #114 那条链上这些债务**已经还清**，并集等于把已还的债重新登记。改成整文件取 #114 侧之后门禁通过。
     附带一条好消息：这道两向对账不是摆设，它在我判断错的方向上准确地红了。
  2. **#114 ↔ #96（Stripe 结账）**：`route.ts` 两侧是同一个缺陷的两种写法（#96 在调用点按 `source` 打日志，
     #114 在 helper 内部打），`route.test.ts` 更是整文件互斥 ⇒ 取 #114 侧（route + test 必须同侧，否则断言的是另一份契约）；
     `messages/{en,zh-CN}/actions.json` 取**键的并集**（#96 带进 `alreadySubscribed`、`recoveryUnenrollFailed`，
     #114 带进 `apiKeyNotFound`、`apiKeyRevokedButNotCreated`、`uploadUnavailable`，两侧对基线都是纯新增），
     en 从 79 → **81 键**，两 locale 键集相等；唯一同名不同值的 `checkoutUnavailable` 跟随幸存的那份实现。
  3. **#114 ↔ #129（`docs-site/scripts.md` 与 zh-CN）**：两侧都在重写 `check:query-columns` 这一行，
     两块都留会产出一张表里的重复行 ⇒ 按命令取并集、同名行取 #129（那条 PR 正是把这个门禁扩到写入载荷的，描述更新）。
  4. **#119 ↔ #117（`e2e/admin-contact-mfa.spec.ts`）**：两侧各 import `support/hydrated.ts` 的一个 helper，
     合并后文件里三个 helper 都在、两个都被调用 ⇒ 解法是一条合并 import，不是两块都留。
  5. **#120 ↔ #116（`e2e/support/warm-up.ts`）**：两侧都在同一段文档注释尾部各接一段，且各自带 import，
     裸的 keep-both 会把注释体吐到代码里（历史上就是 28 个 type-check 错）⇒ 合成一个注释块 + 4 条 import 去重。
  6. **#131 ↔ #126（`scripts/check-all.sh` + `docs/testing.md`）**：两侧加的是**不同**的门禁行 ⇒ keep-both 成立，
     判定器先确认两侧没有重复行才落笔。
- 合并之后仍要做的一步（不是可选）：`docs/progress.md` 按日期**稳定排序**。89 条条目里 50 条换了位置，
  两处 `date-out-of-order` 全清。这条再次印证「增量合并不再破顺序，从零重建必然破」。
- 这轮抓到的新问题，跟合并顺序有关：**#126 的 `check:progress` 会审所有条目的必填字段，而它还没进 `main`。**
  判据是 `^-\\s*里程碑[^：:]*[：:]`——也就是接受 `- 里程碑：` 和 `- 里程碑 / 版本：`，
  但**不接受我写的 `- 版本 / 里程碑：`**（复合词前缀不放行）。于是今天新开的两条 PR 里有三条条目
  在本地全绿（因为本地没有这道门禁）、一合到 #126 之后就红：`[missing-field]` 共 4 项
  （#135 两条、#136 一条，其中那条「同日晚些订正」连 `状态` 都没写）。
  已在两个源分支上把字段改成合规写法并补上缺的两项，另开 PR 的人请注意同一条：**写 `- 里程碑 / 版本：`，不要反过来。**
- 验证（整棵树 = 44 个 PR 全合完的形状）：`CI=true pnpm check:all` **exit 0**，
  `Test Files 227 passed (227)`、`Tests 2649 passed (2649)`（`main` 自己是 200 / 2299），
  `pnpm check:progress` 单跑 ✅「89 条条目，日期非递减且标题无重复」，`pnpm build` **exit 0**（23/23 静态页）。
  这轮**没有**重跑 `pnpm test:coverage` 与全量 `pnpm test:e2e`（上一轮跑过：97.45/92.29/98.14/98.58 与 113 passed），
  所以别说成「覆盖率和 E2E 也验过」——要的那两项得再花一轮。
- 与在审 PR 的重叠：本条只改 `docs/progress.md`（+ 纯追加），代码零改动。
- 阻塞：无。风险 / 回滚：文档一条，revert 即回滚。
- 下一项：把这份新矩阵同步进 PR #118 正文；顺手把 #135/#136 三条不合规的台账字段修掉。
- 更新时间：2026-09-24。

## 2026-09-24 — 合并前最后一次预清：44 个 PR 自己写的台账条目全部过 #126 那道门禁，#125 的新 commit 也没添新的判断边

- 里程碑 / 版本：v0.12.0 文档治理（PR #118 分支，base `main` = `ad4b029`）。
- 状态：DONE（待合并）。
- 为什么做：#126 的 `check:progress` 一落地就会审**全部**历史条目，而它还没进 `main`——所以「合完
  44 个 PR 之后 main 上这道门禁红不红」必须在合并之前量，而不是等红。今天已经在 #135/#136 上抓到
  三条不合规（字段反写成 `- 版本 / 里程碑：`、订正条目缺字段），当时是手工发现的；这次把它变成
  对整条队列的一次判定。
- 完成内容：
  1. 复用 #126 的判定本体（`git show pr/126:src/lib/docs/progress-ledger.ts` 直接 import，不重写规则），
     对 44 个 open PR 的 head 逐个跑：只统计**该 PR 自己新增的条目**（按标题是否与 `origin/main` 的
     条目集合重合来归属），只判 `heading-undated` 与 `missing-field` 两类；日期乱序与重复标题留给
     合并时的排序步骤，本来就不属于单个 PR 的责任。结果：**0 条不合规**。
  2. 判定器先给阳性对照再采信其沉默：拿 #135 修复前的 `7d3fd35` 跑同一段脚本 → 如实报出 3 条
     （`missing-field` × 里程碑 / 里程碑 / 状态），与今天手工发现的那三条一字不差。
  3. #125 分支今天新增一个 commit（`d71613f`，bundle 门禁的退出码被管道吞掉那次修复），重量了两次：
     - 44 对 `git merge-tree --write-tree HEAD pr/<n>`：与每个在审 PR 的冲突**只出现在
       `CHANGELOG.md` / `docs/progress.md`**（两块都是追加，删标记即可），`package.json`、
       `docs/testing.md`、`docs-site/{,zh-CN/}scripts.md` 全部 Auto-merging 干净——判断边仍是 6 条，
       没有新增。
     - 队列里没有任何 PR 改 `verify` / `verify:build` / `check:bundle` 这三行
       （逐个 `git diff origin/main...pr/<n> -- package.json` grep 过），所以 #125 重排这条链不会和
       谁打架。
- 变更文件：`docs/progress.md`（本条目，纯追加）。
- 验证命令与结果：`gh pr list --limit 100`（44）× 上述 sweep → 无输出；阳性对照 → 3 条红；
  44 次 merge-tree → 冲突文件集合 = {CHANGELOG.md, docs/progress.md}。
- 阻塞 / 风险 / 回滚：纯记账，回滚 = revert 本 commit。风险一条：这份归属判定用的是「标题是否已存在于
  main」，如果某个 PR 改写过一条已存在的条目（而不是新增），它的问题不会算到它头上——那类条目由
  `check:progress` 在合并后自己红，处置动作已经写在那道门禁的失败提示里。
- 下一项：#125 的 bundle 门禁改动只在本地路径上验证过（pre-push 跑完整链），CI 结果随该 PR 的
  11 项必需检查回来再补记。
- 更新时间：2026-09-24（UTC 07:40 前后）。

## 2026-09-24 — 第三次从零重建（补上覆盖率这一半证据）：24 个栈尖 / 44 个 PR，判断边 5 条，`check:all` 与 `test:coverage` 同时 exit 0

- 里程碑 / 版本：v0.12.0 文档治理（PR #118 分支，base `main` = `ad4b029`）。
- 状态：DONE（待合并）。这一条同时补上前一条「下一项」欠的 #125 CI 结果。
- 为什么做：前一条只量了「#125 新 commit 与每个 PR 两两合得起来」，没有重跑整队列——而 #125 那次改动
  动的是 `check:bundle` / `verify` 这两条链本身（新增一个 `src/lib/release/bundle-freshness.ts` +
  13 项单测），恰好是最可能把**集成后**的覆盖率或门禁清单搞红的改动类型。上一轮 44-PR 模拟刻意没跑
  覆盖率，这次把它补上，让「合完 44 个 PR 的 main 是绿的」这句话第一次同时有 `check:all` 与
  `test:coverage` 两份数字。
- 完成内容：
  1. `git fetch origin '+refs/pull/*/head:refs/remotes/pr/*'` 之后重算栈尖：44 个 open PR → **24 个 tip**
     （判据仍是逐个 `git merge-base --is-ancestor`，不是数合并次数），`sim/queue-44b` 从 `origin/main`
     起按编号升序并入，`main` 之上 162 个 commit，**44/44 个 PR head 逐个证为 ancestor**。
  2. 判断边这次**不靠驱动脚本的 stdout**（上一次 `tail -32` 把前半段截掉了，那 6 条里只有 2 条是我亲眼
     看着解的）。改成从合并历史反推：对 `origin/main..HEAD` 里每个 merge commit 跑一次
     `git merge-tree --write-tree <m^1> <m^2>`，把冲突路径里除去 `CHANGELOG.md` / `docs/progress.md`
     之后剩下的那些当作「需要人判断的边」。结果 **5 条**：#114（checkout route + 它的 test + 两份
     `messages/*/actions.json` + `docs/roadmap-0.12.0.md` + `src/lib/security/query-error-channel.ts`）、
     #119（`e2e/admin-contact-mfa.spec.ts`）、#120（`e2e/support/warm-up.ts`）、#129（两份
     `docs-site/scripts.md`）、#131（`docs/testing.md` + `scripts/check-all.sh`）。其余 19 个 tip
     要么干净、要么只撞那两份台账。上一条记录写的「6 条」是把 #114↔#96 单独数了一次，这次它落在 #114
     那次合并里（`messages/*` + route + test 同时红），是同一处重叠的两种数法，不是队列变了。
  3. 台账排序这一步又必须做一遍（第三次验证「从零重建必然破顺序」）：`check:progress` 红在 3 个位置，
     `/tmp/sort-ledger.py` 稳定排序后 **92 条条目 / 53 条换位**，行数 4116 → 4116 且内容多重集相同
     （脚本自己断言这两点才肯写盘），再跑 exit 0。
- 验证命令与结果（全部在 `sim/queue-44b` 这棵集成树上跑，node_modules 与本 checkout 共用）：
  - `CI=true pnpm check:all` → **exit 0**，`Test Files 228 passed`（上一轮 227，多的那 1 个文件就是
    #125 新增的 `bundle-freshness.test.ts`）。
  - `pnpm test:coverage` → **exit 0**，`All files 97.48 / 92.34 / 98.24 / 98.59`
    （阈值 91 / 90 / 93 / 92，来自 `vitest.config.ts`，**没有降低任何阈值**）。
  - 结尾一次 `git grep --cached "^<<<<<<< "` → 无命中。
  - #125 自己的 CI 在 `d71613f` 上：14 项里 **13 项 pass**，唯一红的是 `Vercel – indie-stack`
    （`Deployment rate limited — retry in 24 hours`，按定案照实记录并忽略）。同时刻 docs-site 那条
    是绿的，所以「一红一绿」再次成立。
- 变更文件：`docs/progress.md`（本条目，纯追加）。
- 阻塞 / 风险 / 回滚：纯记账，回滚 = revert 本 commit。`sim/queue-44b` 是**只在本地**的分支，从未推送、
  从未建 PR、从未碰 `main` 或任何真实 PR 分支；它的数字已经全部写进本条，所以记完就删——留一个不可达
  的本地 tip 正是 `ops:work-audit` 会点名的东西。风险一条：这份矩阵随队列每次变动即过期，
  下一次合并动作之后要重跑而不是引用。
- 下一项：把这轮的三份数字（`check:all` / `test:coverage` / 5 条边）同步进 PR #118 正文。
- 更新时间：2026-09-24（UTC 08:40 前后）。

## 2026-09-24 — 第四次从零重建（45 个 PR / 24 个栈尖）：判断边 5→6，新那条是 C11 自己贡献的

- 里程碑 / 版本：v0.12.0 文档治理（PR #118 分支，base `main` = `ad4b029`）。
- 状态：DONE（待合并）。
- 分支 / commit：`docs/pr-merge-order`（本条目）。
- 为什么做：队列从 44 条涨到 45 条（新增 #137 = C11 路由鉴权台账），而 C11 是一条**会读全仓库代码**的门禁。
  上一遍的结论只覆盖「没有 C11 的合成树」；台账是在 #135 分支的源码形状上手写的，它能不能在
  别的 43 条 PR 都落地之后仍然绿，是一个真实的未知——`#136` 改了营销端点的守卫邻近代码、
  `#98`–`#114` 改了一批 route 的鉴权与错误通道。所以重跑一遍，而不是引用上一遍。
- 完成内容：
  1. 重算栈尖：45 个 open PR → **24 个 tip**（判据仍是逐个 `git merge-base --is-ancestor`）。
     `sim/queue-45b` 从 `origin/main` 起按编号升序并入 24 个 tip，`main` 之上 **164 个 commit / 24 个 merge**，
     **45/45 个 PR head 逐个证为 ancestor**。
  2. 判断边 **6 条**（上一遍 5 条），算法不变：对 `origin/main..HEAD` 每个 merge 跑
     `git merge-tree --write-tree <m^1> <m^2>`，冲突路径去掉 `CHANGELOG.md` / `docs/progress.md` 之后剩下的算一条。
     这次**先把边的字段取错过**：merge-tree 的冲突记录是 `mode oid stage\tpath` 四个字段，
     我按六个字段去取 `$6`，于是扫出「零条边」——一个正好是我想要的回答的空结果。改成 `$4` 之后
     6 条全数现形，分母也打印出来（`6 / 24 merges`）。
     边清单：#114（checkout route + 它的 test + 两份 `messages/*/actions.json` + roadmap + `query-error-channel.ts`）、
     #119（`e2e/admin-contact-mfa.spec.ts`）、#120（`e2e/support/warm-up.ts`）、#129（两份 `docs-site/scripts.md`）、
     #131（`docs/testing.md` + `scripts/check-all.sh`）、**#137（新增：两份 `docs-site/scripts.md` + roadmap +
     `docs/testing.md` + `package.json` + `scripts/check-all.sh`）**。
  3. #96 与 #114 是**同一处修复的两个独立版本**（结账前置读取 fail-closed），这一遍把它们的关系量清楚了：
     两份 `readCheckoutScope` 在合成树里**同时存在**（自动合并把两处定义都留下了 → 重复声明），
     取 #96 的那一份（`failed` 带 `source` + 调用点 `logApiError`），丢弃 #114 的（`unavailable` / 在 helper 内记日志），
     两侧对 `checkoutUnavailable` 的中英文案也因此各留一条。`query-error-channel.ts` 的台账方向相反：
     取 #114 的（那 7 条 `debt` 已被 #98–#103 #110 逐条清掉），这一处**判据本身会双向对账**，
     所以留错方向会当场红，不靠我判断得对。
  4. C11 在合成树上 exit 0：`45 个 handler 全部登记且守卫可达（6 个无守卫符号 / 调用图截断计数 792）`。
     与单分支相比 handler 数与 public 数一字不差，只有截断计数从 770 涨到 792——别的 PR 往 helper 里加了代码，
     **没有加路由**，也没有把台账声明的守卫挪到走不到的位置。这正是这条门禁要能回答的问题。
  5. 台账排序第四次验证「从零重建必然破顺序」：`check:progress` 红在 3 个位置，稳定排序后
     **94 条条目 / 54 条换位**，行数 4211 → 4211 且内容多重集相同（脚本自己断言这两点才写盘），再跑 exit 0。
- 验证命令与结果（全部在 `sim/queue-45b` 这棵合成树上跑）：
  - `CI=true pnpm check:all` → **exit 0**，`Test Files 229 passed`（上一遍 228，多的那 1 个文件是
    #137 新增的 `route-auth.test.ts`）。第一次跑是**红的**，红的就是 `check:progress` 那 3 个乱序点。
  - `pnpm test:coverage` → **exit 0**，`All files 97.46 / 92.38 / 98.27 / 98.62`
    （阈值 91 / 90 / 93 / 92 未动；上一遍是 97.48 / 92.34 / 98.24 / 98.59）。
  - `git grep --cached "^<<<<<<< "` → 无命中。依赖面 `pnpm-lock.yaml` 零差异，所以这一遍不需要重装依赖。
- 一处必须记下的异常（原因未定位）：第一趟驱动脚本汇报「#92 merged clean / #93 merged clean」，
  紧接着 #94 冲突；但之后 HEAD 回到 `origin/main`，两条 merge **既不在 reflog 里、也不在对象库里**
  （`git fsck --dangling` 63 个悬空 commit 中没有 `sim/queue-45` 的那两条）。单独复跑同一条 merge 可复现地
  成功并留下 reflog，所以本条记录的数字全部来自第二趟（逐个调用、每步之后另外查一次 HEAD）。
  **不写机制解释**：能确认的只有「驱动脚本的 stdout 不能当证据」，而这一点上一遍已经用 merge-tree 反推解决过。
- 变更文件：`docs/progress.md`（本条目，纯追加）。
- 阻塞 / 风险 / 回滚：纯记账，回滚 = revert 本 commit。`sim/queue-45b` 只在本地，从未推送、从未建 PR、
  从未碰 `main` 或任何真实 PR 分支；数字已全部写进本条，记完即删。风险同上一条：这份矩阵随队列每次
  变动即过期，下一次合并动作之后要重跑而不是引用。
- 下一项：把这一遍的四份数字（`check:all` / `test:coverage` / 6 条边 / C11 在合成树绿）同步进 PR #118 正文。
- 更新时间：2026-09-24（UTC 09:05 前后）。

## 2026-09-24 — 第五次从零重建（46 条 / 24 个栈尖）：上一遍那句「不重跑」被推翻，红的是 #138 自己的一条等号

- 里程碑 / 版本：v0.12.0 文档治理（PR #118 分支，base `main` = `ad4b029`）。
- 状态：DONE（待合并）。
- 分支 / commit：`docs/pr-merge-order`（本条目）。
- 为什么做：本分支上一条（第四节最后那段）写着「#138 只是把 #137 顶成中间节点，因此这一遍不重跑整队列」。
  那句的输入是**上一次模拟的冲突面**，而上一次量到的 `pr/137` 是 `09717e4`——本地 fetch 的 reflog 记着它
  后来才 fast-forward 到 `ec7a6c1`。也就是说那是一个已经过时的测量被当成了事实用。合并动作在即，
  这份地图过时比没有更糟，所以重跑。
- 完成内容：
  1. `sim/queue-46` 从 `origin/main`（仍是 `ad4b029`）按编号升序并入 **24 个栈尖**：`main` 之上
     **173 个 commit / 24 个 merge**，**46/46 个 PR head 逐个 `git merge-base --is-ancestor` 证完**，
     树里 `git grep --cached "^<<<<<<< "` 零命中，`pnpm-lock.yaml` 与 `main` 零差异（不需要重装依赖）。
     修完下面第 3 点之后又并了一次，同一棵树到 **176 个 commit / 25 个 merge**；边数与包含性仍按
     24 个 merge 那一棵扫，因为「一次合并 = 一条边」只在只有栈尖的那一遍里成立。
  2. 判断边 **6 条 / 24 次合并**（`/tmp/edges46.js`：对每个 merge 跑 `git merge-tree --write-tree m^1 m^2`，
     冲突记录取 `$4`，去掉两份台账）。边数与上一遍相同，**归属与文件集变了**：第六条从 #137 挪到 **#138**
     （链尖带进 C11 那批文件），重叠面是 `docs-site/{,zh-CN/}scripts.md` + `docs/testing.md` +
     `package.json` + `scripts/check-all.sh`，**roadmap 这一遍没撞**。对「消失」做了两步证伪：
     ① 把 `pr/137` 单独合进同一个父树 `0f1b38a`，冲突文件集与合 `pr/138` 一字不差——不是 #138 挤掉的；
     ② 把这条链上前后五个 commit 逐个对同一父树跑 `merge-tree`：`09717e4` 撞 roadmap（3 条记录 = 1 个文件
     × 3 个 stage），`721f4c9`（任务池不再自己抄条数、C11 让开 19 号）起**不撞**，其后三个都不撞。
     一条边的消失是一个 commit 的事，机制是量出来的不是猜的。
  3. **这一遍唯一真实的红是 #138 自己带的一条断言**：合成树上 `CI=true pnpm check:all` 报
     `expected 16 to be 14`。数字没错——#136 给两条营销端点加了窗口；错在把接线时量到的那一个数
     写成等号，于是**谁按顺序合到 #138，CI 就在一条并不存在的回归上红一次**。已在 #138 分支修成
     地板值 + 家族白名单（见 `feat/measure-route-rate-limits` 同日条目），修完合成树复跑全绿。
  4. 六条边的**手工解法**逐条落进 PR #118 正文（合并的人要能照着做，而不是只知道「有冲突」）：
     #114 那条不是 keep-both——两份 `readCheckoutScope` 与两份 `type CheckoutScope` 会同时留在文件里
     （位置不同所以没有文本冲突），只有 `pnpm type-check` 看得见，必须手工删掉 #114 的那份 helper；
     #119 两条 hydration helper 各用一个，import 合成一行；#120 顶部文档注释两段都留 + 两个 import
     都留（只删标记会产出 28 个类型错）；#129 / #131 / #138 是表格行与脚本行的并集。
- 验证命令与结果（全部在 `sim/queue-46` 这棵合成树上跑）：
  - 第一次 `CI=true pnpm check:all` → **exit 1**，红在 `check:progress` 那 3 个乱序点；排完序复跑
    → **exit 1**，红在 `pnpm test` 的那条等号（`Test Files 1 failed | 228 passed (229)`，
    唯一失败用例就是 `route-auth.test.ts > 真实仓库 > 限流器读数…`，`expected 16 to be 14`）；
    等号修掉并再并一次之后才全绿。
  - 台账排序第五次验证「从零重建必然破顺序」：稳定排序后 **97 条条目 / 55 条换位**，
    行数 4365 → 4365 且内容多重集相同（脚本自己断言这两点才写盘），`check:progress` exit 0。
  - 等号修掉并再并一次之后 `CI=true pnpm check:all` → **exit 0**，
    `Test Files 229 passed (229)` / `Tests 2699 passed (2699)`。
  - **队列里所有「CI 真的跑过」的 PR 此刻没有一条因代码红**：23 条 base `main` 的 PR 逐条
    `gh pr checks --json name,bucket`，**23/23 扫到、共 297 行**，`bucket=="fail"` 的 **38 行全部**是
    `Vercel – indie-stack` / `Vercel – indie-stack-docs-site`（部署配额，按既定口径记录并忽略）。
    这条数字第一次跑出来是「0 红 / 283 行」——那是我自己把过滤器写成 `--jq -r '…'`（gh 没有 `-r`，
    于是过滤器变成 `-r`、真正的过滤器成了位置参数），23 次调用全部报错而 `2>/dev/null` 把报错咽掉了。
    同一趟里 #92 那次调用死在 `unexpected EOF`，所以 23/23 是先量到 22/23、再单独补测 #92
    （14 行 / 1 红 = Vercel）才成立的。**一个空结果必须先证明读的人在场**，这是本仓库第四次踩同一类坑。
  - `pnpm test:coverage` → **exit 0**，`All files 97.46 / 92.37 / 98.27 / 98.63`
    （阈值 91 / 90 / 93 / 92 一字未动；上一趟 97.46 / 92.38 / 98.27 / 98.62，差的 0.01 在 branches 列，
    这个量级我没有去归因）。
  - `node scripts/check-route-auth.js` → `✅ 45 个 handler 全部登记且守卫可达（6 个 public /
    调用图截断计数 792）`，与单分支一字不差；`--rate-limit-report` →
    **45 个 handler / 12 个路由文件**有限流器绑定，`token` 那两条报成
    `src/lib/marketing/request.ts#marketingTokenLimit`（两条营销路由自己一行都没 import 限流库）。
- 变更文件：`docs/progress.md`（本条目，纯追加）。
- 阻塞 / 风险 / 回滚：纯记账，回滚 = revert 本 commit。`sim/queue-46` 只在本地，从未推送、从未建 PR、
  从未碰 `main` 或任何真实 PR 分支；数字已全部写进本条与 PR #118 正文，记完即删。
  风险照旧一条：这份矩阵随队列每次变动即过期，下一次合并动作之后要重跑而不是引用——本条就是上一条
  犯了这个错的现场。
- 下一项：把这一遍的结果同步进 PR #118 正文（含对上一段「不重跑」的公开更正）。
- 更新时间：2026-09-24（UTC 10:55 前后）。

## 2026-09-24 — 合成树第一次跑完整 E2E：chromium 113/113 绿，而且合并配方重放出了同一棵树

- 里程碑 / 版本：v0.12.0 文档治理（PR #118 分支，base `main` = `ad4b029`）。
- 状态：DONE（待合并）。
- 分支 / commit：`docs/pr-merge-order`（本条目）。
- 为什么做：前几遍整队列重建的证据停在 `check:all` 与 `test:coverage`，而 CI 那五个必需作业里
  **E2E 从没在「46 条一起」的树上跑过**。这件事在本案里格外要紧，因为六条判断边有两条**就是 e2e 文件**
  （#119 的 `e2e/admin-contact-mfa.spec.ts`、#120 的 `e2e/support/warm-up.ts`），它们的解法是人手写的——
  解错了单测不会响，只有 E2E 会响。
- 完成内容：
  1. 把 `sim/queue-46` 的合并配方原样重放成 `sim/e2e`（同一批 24 个栈尖、同一套解法）。
     **重放是逐字节可复现的**：每个手工解点前后的行数与第一遍一字不差
     （`checkout/route.ts` 199→188→140、`route.test.ts` 305→179、`query-error-channel.ts` 745→705、
     roadmap 527→508；`#119`/`#120` 之后 CHANGELOG 1831/1844、台账 3288/3328；
     收尾 CHANGELOG 2128、台账 4365；稳定排序同样是 97 条 / 55 换位）。
     这等于给 PR #118 正文里那份解法做了一次「照着做一遍能不能得到同一棵树」的核对——
     合并的人照那份文本动手时，得到的不是我的树而是同一棵。
  2. 重放里踩到的一次自己制造的污染，记下来因为它的判据可推广：`#129` 那处我把 `#138` 的锚点文本
     用错了对象，`count==0` 断言失败了，**但脚本没有终止后续命令**，于是带冲突标记的两个
     `docs-site/*.md` 被后面的 `git add -A` 当成「已解决」提交进去。发现方式是提交之后
     `git grep -n "^<<<<<<< "` 仍然命中。修法是 `git merge --abort` + `git reset --hard <129 之前那一个>`,
     然后照真实锚点重解——`sim/e2e` 是本地一次性分支、每一步都可复现，所以这里 reset 才安全。
     重放时用过的锚点也订正了一处：`#129` 的真实冲突是「HEAD 侧短描述 + query-errors 行 / 来侧扩展描述」，
     解法取扩展描述那一行再留 query-errors 行（与 PR #118 正文写的一致）；我最初误用了 `#138`
     那次（两侧都有 query-columns）的锚点，所以才会 `count==0`。
     **可推广的两条**：机械解冲突的脚本，锚点没命中必须终止整条链；提交后要用 `git grep --cached`
     证明标记真的清零，而不是相信自己的解法。
  3. 合成树上跑完整 E2E（并行基线：`PW_FULLY_PARALLEL=true E2E_SERVERS=3`，即 3 台 dev server / 3 worker）：
     `Running 113 tests using 3 workers` → **`113 passed (4.8m)`、exit 0，零失败零重试**。
     条数范围说清楚：`projects` 只有 chromium，所以这句话就是 chromium 的 113 条；
     同一时刻 `main` 树是 **109 条**（`pnpm test:e2e --list` → `Total: 109 tests in 15 files`），
     队列净增 4 条，全部来自改 e2e 的那几条 PR。
- 验证命令与结果：
  - 跑之前逐个端口确认空闲（`lsof -nP -iTCP:3100/3101/3102 -sTCP:LISTEN` 全空）——
    `reuseExistingServer: false` 会让端口冲突变成响亮的启动失败，但前提是我没拿别人的服务当自己的结果。
  - `PW_FULLY_PARALLEL=true E2E_SERVERS=3 pnpm test:e2e` → `113 passed (4.8m)` / `e2e exit=0`。
    **条数取 runner 的汇总行**：我对日志数 `^ *✓` 得到的是 111，因为若干 ✓ 被 `[WebServer]`
    的噪声挤进行内——日志里那些 `⨯ Error: aborted` 与 `e2e injected transient failure`
    是用例自己注入的故障，不是失败。
  - 跑之后：`git status` 干净、`git diff tsconfig.json` 零差异（`NEXT_DIST_DIR` 会往 tsconfig 里追加
    且不会自己回收，这是本仓库量过第三次的坑）、三个 `.next-e2e-{0,1,2}`（合计 3.6 GB）已删。
  - 同一棵树此前已复跑：`CI=true pnpm check:all` exit 0（229 files / 2699 tests）、
    `pnpm test:coverage` exit 0（97.46 / 92.37 / 98.27 / 98.63）、`git grep --cached "^<<<<<<< "` 零命中。
- 变更文件：`docs/progress.md`（本条目，纯追加）。
- 阻塞 / 风险 / 回滚：纯记账，回滚 = revert 本 commit。`sim/e2e` 只在本地、从未推送、记完即删。
  风险两条：① 这份 E2E 结论跟着队列变，任何一条 PR 的 head 再动，「113/113」就只描述它那一刻的树；
  ② 它只覆盖 chromium，webkit 侧（视觉基线那条链）仍只能由 CI runner 出证据。
- 下一项：把 E2E 这一行与「配方可复现」一起补进 PR #118 正文。
- 更新时间：2026-09-24（UTC 11:4x 前后）。

## 2026-09-24 — 读了仓库保护规则本身：合并配方少了一步，而 Vercel 的红根本不挡合并

- 里程碑 / 版本：v0.12.0 文档治理（PR #118 分支，base `main` = `ad4b029`）。
- 状态：DONE（待合并）。
- 分支 / commit：`docs/pr-merge-order`（本条目）。
- 为什么做：合并地图里「先合前驱、再把后继的 base 改成 main」那一步是我从**过去的现象**推出来的，
  没有读过规则本身。趁队列静止，直接读 `gh api repos/Sun1090/IndieStack/branches/main/protection`。
- 完成内容：
  1. **量到的规则**：必需检查 7 个（`Lint & Type Check`、`Build`、`Build Docs Site`、
     `E2E (Playwright)`、`security-config`、`Analyze (javascript-typescript)`、`Detect Secrets`），
     `strict: true`、`enforce_admins: true`、`required_linear_history: true`，
     仓库侧 `delete_branch_on_merge: false`。
  2. **三条结论，两条推翻了我自己写过的话**：
     ① `Vercel – indie-stack*` **不在必需清单里**——那条 `build-rate-limit` 红不挡任何一次合并。
     以前我是从「红了很多天也合了几十条」归纳的，现在是读设置读出来的；
     ② `strict: true` 意味着每合一条，其余每一条立刻变成不是最新 base，必须逐条更新分支——
     46 条一起合的体力成本主要在这里，不在那 6 条冲突边；
     ③ `required_linear_history` + `enforce_admins` 关掉了我一直默认的那条退路：
     管理员**不能**绕过必需检查合并，也不能用 merge commit。
  3. **因此合并配方缺一步**：栈内 PR 的正确顺序是
     前驱落地 → `gh pr edit <n> --base main` → **`gh pr update-branch <n> --rebase`** → 等 7 项绿 → 合。
     第 ③ 步不能省，因为**改 base 不触发 CI**（本仓库量过两次、当时只记成一条 trivia）：
     只改 base 的话那 5 个必需检查会一直是「expected but not reported」，
     而 `enforce_admins:true` 让 GitHub 把这条 PR 永远判成 `BLOCKED`，谁也点不动。
     **【当日订正】「改 base 不触发 CI」是对的，但这里给的补救动作是错的**：
     `update-branch --rebase` 在 base 已经是这条 head 的祖先时得到同一个 sha，不产生 `synchronize`，
     所以它一次 CI 也唤不起来；能唤起来的是 `gh pr close <n>` + `gh pr reopen <n>`。详见下一条。
  4. **队列现状按这个判据重扫**（46 条，逐条 `mergeStateStatus` + `mergeable`）：
     `MERGEABLE=46`（没有一条 GitHub 侧冲突）；`BLOCKED=2` 是 **#98** 与 **#118**；`CLEAN=1`（#121）；
     其余 43 条 `UNSTABLE` 的红全在 Vercel 那两个非必需检查上。
     #98 的原因实测到位：它的 head 上只有 2 个 check run（`Detect Secrets`、`security-config`），
     正是「本会话早些时候我把它改指 main、而改 base 不触发 CI」留下的后果——**是我这一步做出来的一堵墙**，
     不是我发现的别人的问题。#118 是自己刚推送、CI 还在跑。
- 验证命令与结果：
  - `gh api repos/Sun1090/IndieStack/branches/main/protection`（读 `required_status_checks.contexts` /
    `strict` / `enforce_admins` / `required_linear_history`）、
    `gh api repos/Sun1090/IndieStack --jq '{delete_branch_on_merge,...}'`。
  - `gh pr list --state open --limit 100 --json number,mergeable,mergeStateStatus`
    → 分母 `PRs: 46`，`BLOCKED=2 CLEAN=1 UNSTABLE=43`，`MERGEABLE=46`。
  - `gh pr checks 98` → 4 行：2 pass + 2 Vercel fail；
    `gh api .../commits/$(git rev-parse pr/98)/check-runs` → `check runs: 2`，
    两条命令互相印证「CI 从没在这个 head 上跑过」。
  - `gh run list --limit 30` → `success=28`、`in_progress=2`（都是 #118 自己），最近 30 次没有 failure。
- 变更文件：`docs/progress.md`（本条目，纯追加）。
- 阻塞 / 风险 / 回滚：**#98 我没有动**。修它需要一次能触发 `synchronize` 的推送，而它的分支是
  #99–#114 那条 16 条长栈的地基：重推会牵动整条栈重排；`close` + `reopen` 也能触发，但仓库是否开了
  「合并/关闭时自动删头分支」我**测不到**（REST 没有这个字段），而删掉 `fix/c08b-invitations-route`
  会让那条栈全部塌掉——高爆破半径、不可逆，所以不做，改成把这一步写进正文交给合并的人：
  ~~对 #98 直接执行 `gh pr update-branch 98 --rebase`（它 base 就是 main，rebase 是空操作但会产生一次推送，
  从而触发 CI）~~。
  **【当日订正，两处】**：① 那句 update-branch 是错的——rebase 到已是祖先的 base 得到同一个 sha，
  不产生事件，唤不起 CI；② 被我当成理由的那条「关闭可能自动删头分支」当场证伪——
  `delete_branch_on_merge` 管的是合并而不是关闭，`gh pr close 98` + `gh pr reopen 98` 之后
  分支仍在同一个 `896f11e`、#98 回到 `OPEN`、#99 未受影响，并且这个 head 上 7 项必需检查转为全绿，
  `BLOCKED` 就此解除。做这一步花了两条活动流记录，不花一次推送。回滚 = revert 本 commit。
- 下一项：把这一节同步进 PR #118 正文的合并动作清单。
- 更新时间：2026-09-24（UTC 11:5x 前后）。

## 2026-09-24 — 推翻上一条交给合并的人那一步：`update-branch` 对 #98 是空操作，真正能用的是 close/reopen

- 里程碑 / 版本：v0.12.0 文档治理（PR #118 分支，base `main` = `ad4b029`）。
- 状态：DONE（待合并）。
- 分支 / commit：`docs/pr-merge-order`（本条目）。
- 为什么做：上一条结尾写了一句「对 #98 直接执行 `gh pr update-branch 98 --rebase`（rebase 是空操作但会产生
  一次推送，从而触发 CI）」，并且把它作为「交给合并的人」的动作发布出去。写完它我就去测了两件事，
  两句都不成立。交给别人的错动作比不写更贵——它让人在一条根本不存在的路上等 CI。
- 完成内容：
  1. **推翻第 ③ 步的那个括号**：#98 的 base 已经是 `main`，而 `origin/main` 是它 head `896f11e` 的祖先，
     所以 rebase 到一个「已经是祖先」的 base 得到的还是同一个 sha，不产生 `synchronize`，
     也就不可能触发 CI。**我没有真的执行 `update-branch`**——真执行了就会对一条 16 条 PR 栈的地基分支
     做 force-push；结论只依赖那条祖先测量，跟 GitHub 打印什么无关。
  2. **上一条列为「不做」的 close/reopen 才是正解，而且是实测出来的**：`ci.yml` 的 `on.pull_request`
     没有写 `types`，GitHub 的默认集合含 `reopened`。于是对 #98 做 `gh pr close` + `gh pr reopen`
     （不推、不合、不改历史）就要回了 CI：同一 head `896f11e` 上新增
     `CodeQL completed/success` + `CI in_progress`，此前这条分支上只有 `Secrets Scan` 与
     `security-config` 两种运行。**我亲手垒的那堵墙，不用推任何东西就拆了。**
     我上一条担心的「关闭时自动删头分支」也当场证伪：close/reopen 之后
     `git ls-remote origin refs/heads/fix/c08b-invitations-route` 仍是 `896f11e`，
     #98 回到 `OPEN/MERGEABLE`，后继 #99 的 base 一字未动。
     （仓库级 `delete_branch_on_merge: false` 管的是合并，不是关闭——关闭本来就不删分支。）
  3. **必需检查是按 base 分支的规则判的**，一组零歧义的对照：#98（base `main`）与 #114
     （base `feat/c08c-gate-wiring`）在各自 head 上的 check 形状**完全一样**
     （`Detect Secrets` + `security-config` 过、2 条 Vercel 红、5 项 CI/CodeQL 缺席），
     GitHub 却分别判 `BLOCKED` 与 `UNSTABLE`；差别只在 base——
     `gh api branches/feat/c08c-gate-wiring/protection` → 404 `Branch not protected`。
     推论要记牢：**栈内 PR 在改指 main 之前，`mergeStateStatus` 是一个没有信息量的信号**，
     它绿不红都跟进 main 的资格无关。
  4. **按这个判据重扫 24 个栈尖**（分母 `tips scanned: 24/24`、`api failures: 0`）：
     18 个 base 已是 main 且 7 项必需全绿；**6 个不是**——#94 #114 #117 #119 #129 #138，
     它们的 base 是栈内分支、5 项 CI/CodeQL 从没在自己 head 上跑过
     （#114 那条分支的历史里 CI/CodeQL 一次都没有，4 次运行全是 Secrets Scan 与 security-config）。
     这 6 条一旦改指 main 会立刻变 `BLOCKED`，触发方式就是第 ② 条那句 close/reopen。
  5. **而且第 ③ 步此刻对每一条都是空操作**：24 个栈尖逐个测
     `git merge-base --is-ancestor origin/main <head>` → **24/24 全部 NOT-behind**
     （main 停在 `ad4b029`，自上次合并以来队列没动过）。`update-branch` 要等到
     「合了一条、其余落到后面」之后才第一次有意义——它是**合并过程中**的步骤，不是**合并开始前**的。
     上一条把它写成了任何时刻都要做的第 ③ 步，这是它真正的错处。
  6. **顺手否掉一条我准备推荐的省事方案**：「只合栈尖、让栈里其余的自动关闭」能把 46 次合并压成 24 次，
     祖先内容确实全在栈尖里（#114 head 含 #98 head，实测 `merge-base --is-ancestor` 通过）。
     但 `required_linear_history: true` 决定了进 main 走 rebase 类合并，栈内那些 PR 的**原始 head sha
     不会成为 main 的祖先**（落进去的是改写后的新 sha），所以「祖先自动变 Merged」在这里没有依据；
     本仓库最近 60 条合并记录里也没有任何同分钟级联（一直是一条一条合的）。方案不采用。
  7. #118 自己的 `BLOCKED` 不是墙：6 项必需已 SUCCESS，只剩 `E2E shard 1/2` 在跑。
- 验证命令与结果：
  - `git merge-base --is-ancestor origin/main pr/98` → 成立（NOT-behind）；
    `gh pr view 98 --json baseRefName,headRefOid,mergeStateStatus` → `main` / `896f11e` / `BLOCKED`。
  - `grep` `ci.yml` 的 `on:` 块 → `push: branches:[main,develop]` + `pull_request: branches:[main,develop]`，
    无 `types`；`E2E (Playwright)` 是 `ci.yml:212` 的 job（不在只有 `workflow_dispatch` 的
    `e2e-parallel.yml` 里），所以 close/reopen 要回的是**全套**必需上下文，不是残缺的一套。
  - `gh pr close 98 --comment ...` → `✓ Closed`；`gh pr reopen 98` → `✓ Reopened`；
    `gh run list --branch fix/c08b-invitations-route --limit 6` → 同 sha 上 `CI in_progress` +
    `CodeQL completed/success`（对照组：`--limit 5` 在动手之前只有 2 条）。
  - `gh api repos/.../branches/feat/c08c-gate-wiring/protection` → 404 `Branch not protected`。
  - 栈尖扫描脚本 `/tmp/tip-gate.js`（`gh pr list --json` + 逐条 `statusCheckRollup`，
    打印 `tips scanned: 24/24 / api failures: 0` 作为分母）。
- 变更文件：`docs/progress.md`（本条目，纯追加）。
- 阻塞 / 风险 / 回滚：~~#98 的 CI 此刻还在跑，我没等它绿~~
  **【同日晚些订正】等完了，而且它绿了**：`gh pr view 98 --json mergeStateStatus,statusCheckRollup`
  → 从 `BLOCKED` 变成 `UNSTABLE`，7 项必需上下文在这个**一字未动的 head `896f11e`** 上全部 `SUCCESS`
  （`Lint & Type Check`、`Build`、`Build Docs Site`、`E2E (Playwright)`、`Unit Tests`、
  `security-config`、`Analyze (javascript-typescript)`、`Detect Secrets`），
  只剩两条 Vercel 配额红（非必需，按定案照实记录并忽略）。队列里那 2 个 `BLOCKED`，
  现在只剩 #118 自己（它的 CI 在跑）。所以第 ② 条那个 close/reopen 不只是「能唤起 CI」，
  它把一条 PR 从不能合变成了能合，全程没推任何东西。
  close/reopen 会留下两条活动流记录（closed → reopened），这是本次唯一的可见副作用，
  我认为它比一堵墙便宜。回滚 = revert 本 commit。
- 下一项：把这一节与前两节一起同步进 PR #118 正文的合并动作清单（配方里那一步换成 close/reopen）。
- 更新时间：2026-09-24（UTC 11:5x 之后）。

## 2026-09-24 — 定时生产冒烟的真相：每天绿的是「版本漂移」那半个，而且我自己的 `on:` 判据截过图

- 里程碑 / 版本：v0.12.0 发布证据（PR #118 分支，base `main` = `ad4b029`）。
- 状态：DONE（待合并）。
- 分支 / commit：`docs/pr-merge-order`（本条目）。
- 为什么做：上一条为了判断「改 base 会不会触发 CI」去读各 workflow 的 `on:` 块，用的是
  `awk '/^on:/{...}' | head -14`。判完才发现**这个 awk 会把 `on:` 块截断**——它让我以为
  `production-smoke.yml` 只有 `workflow_dispatch`，而它其实挂着每日 `schedule`。
  既然整份 workflow 触发清单可能是截断出来的，就重读一遍并顺手把那个定时作业看清了什么。
- 完成内容：
  1. **用真解析重读 `on:`（9 个 workflow，逐条打印触发与 cron）**：
     `ci.yml` = `push` + `pull_request`、**无 `types`**、无 cron（上一条那个 close/reopen 结论依赖的
     正是「无 types ⇒ 默认含 `reopened`」，这次是在**没有截断**的读取下重新确认的）；
     `codeql` 周一 06:00、`security-config` 周一 05:17、`e2e-parallel` 周一 07:30（+dispatch）、
     `health-check` 每日 03:17（+dispatch）、**`production-smoke` 每日 02:17（+dispatch）**、
     `supabase-auto-restore` 每日 04:37（+dispatch）。`release.yml` 只有 `push: tags: v*`。
  2. **每天那次「Production Smoke 绿」绿的是哪个作业，量清楚了**：workflow 里两个作业，
     `smoke`（6 项零副作用冒烟）带 `if: github.event_name == 'workflow_dispatch'`，
     `smoke-main`（`check-production-version.js`，期望版本取自 `package.json`）无条件跑。
     `gh run view 35970360891 --json jobs` → 今天的定时运行是
     **`Side-effect-free production smoke = skipped` + `Daily production version drift check = success`**。
     也就是说**整个 workflow 绿、而真正的冒烟套件那天一次都没跑**——读法定为：
     看 workflow 结论会高估覆盖面，要看作业。
  3. 今天这次漂移检测的输出行：`✅ health: HTTP 200, status=ok, ready=true, version=0.11.0,
     commit=unknown` —— `commit=unknown` 就是发布缺口②还没闭合的直接证据（生产仍是 09-22 08:56Z
     那次部署的构建，早于 #69），task #28 继续保持 pending，**不用我再去 dispatch 一次**：
     定时作业每天会自己把这个数报上来。
  4. **09-22 那次定时失败不是生产出事**，是 `smoke` 作业当时没有 `if:` 守卫、被 `schedule` 一起带起来，
     而它的参数全来自 dispatch inputs（定时触发时为空），于是
     `production-smoke.js -- '' --timeout-ms ''` 抛 `--timeout-ms requires a value`
     （`gh run view 35700843878 --log-failed` 读到）。这一条**文档里已经有了**
     （`docs/operations/production-smoke-v0.11.0.md` 第 36–38 行，写明了成因与「已修」），
     所以这次是复验别人的结论，不是新发现；但它顺带证明守卫是承重的：
     去掉 `if:` 就会每天红一次，而且红的原因与生产无关。
  5. **合完这 46 条不会把这台告警误触发**：`check-production-version.js` 拿 `package.json` 的
     version 当期望值，所以只要有一条 PR 把版本抬到 0.12.0 而 Vercel 仍被配额挡着，这个每日作业就会
     天天红（那属于「真漂移 = 生产落后于仓库」，按定案照实记录、不放宽门禁）。
     逐个 head 量过：`git show pr/<n>:package.json` → **`PRs scanned: 46/46`、`unreadable: 0`、
     改 version 字段的 0 条**，main 仍是 `0.11.0`。所以这批合并不会撞上它。
  6. **一条解释不了就先记下来的观测**：两个每日定时作业的实际运行时间都比声明的 cron 晚约 5 小时
     （`production-smoke` 声明 02:17 → 记录 07:34 / 07:43 / 07:41；`health-check` 声明 03:17 →
     08:23 / 08:31 / 08:29，且 `createdAt == startedAt`）。GitHub 侧调度为什么整体后移我**没有归因**，
     仓库里也看不出来；能确定的只有「它每天确实跑、偏移稳定」。
     影响：拿定时冒烟的时间去推断「它跑的时候生产是哪个构建」，要用**日志里的时间戳**而不是 cron 声明。
- 验证命令与结果：
  - `gh api`／本地 `git show`：`PRs scanned: 46/46 / unreadable: 0 / 改 version: 0`。
  - `gh run list --workflow "Production Smoke" / "Post-deploy health check"` 取 `createdAt` + `startedAt`；
    `gh run view 35970360891 --json jobs` → skipped + success 两个作业；
    `gh run view 35970360891 --log` → 那行 `commit=unknown`（注意日志里步骤名全是 `UNKNOWN STEP`，
    按 `check-production-version` 或 `health:` 抓，别按步骤名抓）。
  - `gh run view 35700843878 --log-failed` → `Error: --timeout-ms requires a value`。
  - 触发清单重读：一个 `node -e` 小解析器，按「缩进退出 `on:`」终止而不是 `head -N`。
- 变更文件：`docs/progress.md`（本条目，纯追加）。
- 阻塞 / 风险 / 回滚：定时作业整体晚约 5 小时这一条只记录了观测，未改任何 cron、未改 workflow；
  如果以后要改，先确认 GitHub 的调度语义而不是照本地时间猜。回滚 = revert 本 commit。
- 下一项：#118 的 CI（12:00Z 那次运行）跑完之后确认它从 `BLOCKED` 变成 `UNSTABLE`，
  这样队列里就没有任何一条 PR 还缺必需 CI 证据（#98 今天已经闭合）。
- 更新时间：2026-09-24（UTC 12:0x）。

## 2026-09-24 — 把 46 条的执行顺序算出来贴进正文，顺带抓到 #115 是个分叉

- 里程碑 / 版本：v0.12.0 文档治理（PR #118 分支，base `main` = `ad4b029`）。
- 状态：DONE（待合并）。
- 分支 / commit：`docs/pr-merge-order`（本条目）。
- 为什么做：正文里给的是「每个栈内 PR 两条命令」这条**规则**，而规则不能执行——46 条需要一份
  按当前拓扑算出来的顺序表，合并的人照着往下走就行。顺手清一件本地的事：`pre-push` 软链漂回了绝对路径。
- 完成内容：
  1. **遍历生成 46 步顺序表并贴进 PR #118 正文**（新增一节「附：46 条的确切执行顺序」）。
     判据：`baseRefName == "main"` 的是链根（量到 23 个根），「谁的 base 是别人的 head 分支」连成边，
     从根深度优先展开，缩进表示父子。自检是脚本自己打印的分母
     `emitted: 46 / 46 | none missing`。贴完读回正文再核一次：
     **表里的 PR 号集合 == 当前 open 队列集合**（`diff` 空输出，46 行一步不多一步不少）。
     两次假红都归因到了判据而不是数据：第一次报「缺 92–100」，是因为步骤号用 `padStart(2)` 补了空格，
     我的正则写的是行首必须是数字；第二次报「多出 44 / 47」，是因为我把 PR **标题**里的
     `（#47 + #48）`、`（#44 前半）` 也当成了步骤引用。教训同一条：核对集合时要先确定正则只吃步骤行。
  2. **遍历抓到一条此前所有文档都没写的结构事实：#115 是分叉不是链。**
     它的 head 分支 `fix/e2e-hydration-click-race` 同时是 **#117 与 #119** 的 base。
     之前正文与台账一律按「链」说话（「栈尖往下」「前驱落地」），兄弟关系从没出现过。
     对合并的人来说这条是必须的：两条先合哪条都行，但**后合的那条必须重定基到 `main` 再 rebase**，
     否则它会显示成与已经落地的兄弟冲突——而那个冲突是记账冲突，不是代码冲突。
     这条已经写进正文那一节。
  3. **`.git/hooks/pre-push` 从绝对软链改回相对**：动手前它是
     `→ /Users/mianbaopian/Projects/IndieStack/.husky/pre-push`（能用——今天四次推送日志都 ~950 行，
     守卫确实跑了），但它把守卫重新绑在「仓库目录不能移动」上，而 09-24 那次清点后的正确形态是相对链接。
     `ln -sfn ../../.husky/pre-push .git/hooks/pre-push`，改完 `readlink` 与 `test -x` 都通过，
     而**本次推送本身就是它的复验**（见下面的日志行数）。
- 验证命令与结果：
  - `node -e` 遍历（`gh pr list --state open --limit 100 --json number,baseRefName,headRefName,title`）
    → `roots: 23`、`emitted: 46 / 46 | none missing`、分叉处打印 `WARN fork at #115: #117 #119`。
  - `gh pr view 118 --json body` 读回 → 与本地文件同为 46300/46301 字符（差一个尾换行），
    严格正则集合比对 `STRICT MATCH: 46 step rows == 46 open PRs`。
  - `readlink .git/hooks/pre-push` → `../../.husky/pre-push`；`test -x` → YES。
- 变更文件：`docs/progress.md`（本条目，纯追加）；PR #118 正文（新增一节，不产生 commit）。
- 阻塞 / 风险 / 回滚：顺序表**随队列变动即过期**，正文里就写了这句——合并中途若开了新 PR 或关了某条，
  要重新走一遍遍历而不是照表硬合。回滚 = revert 本 commit（正文那一节可以整段删掉，它是纯增量）。
- 下一项：#118 这次推送的 CI 跑完后确认队列 `BLOCKED` 归零（后台在盯）。之后再往下的每一条都要先跨过
  一个停止条件：#28 要一次真实合并、#66 / C06 / A05 / C12 要产品决策、B02–B05 要云端凭据与可牺牲账号、
  #85（commit 规范门禁）按上一条的理由排在 `package.json` / `check-all.sh` 那几条落地之后。
  这个清单是按 `docs/roadmap-0.12.0.md` 22 项 +  tracker 里的 pending 项逐条过的，不是「想不出还能做什么」。
- 更新时间：2026-09-24（UTC 12:2x）。

## 2026-09-24 — C09：守卫层读不到会话时不再答「你没登录」，另外 61 处同类读数登记进任务池

- 里程碑 / 版本：v0.12.0 / C09（本池新增编号，与 C08 同形状、不同数据源）。分支 `feat/gate-query-error-channel`
  （PR #92，base `main`）——刻意**不新开 PR**：改动落在 C08 刚建起来的那道鉴权入口上，另开会把同一个函数拆成两条评审。
- 状态：DONE（守卫层已修，其余 61 处按读数排期）。commit：`5bfbcd2`（代码 + 测试）、文档改动在同一条 commit 序列里。
- 发现路径（不是猜的，是量出来的）：为了找「门禁看不见的那一类」，把 `src/**` 的 28 个 API route 全列出来问一遍
  「这个端点答话前读过会话吗」，正则判据是 `requireAuth|getUser|…`——21 个报「没读」，其中两个上传端点其实把鉴权
  委托给了 `src/lib/uploads/request.ts` + service。顺着 service 读到 `const { data: { user } } = await supabase.auth.getUser()`
  才发现真正的形状：**Auth 客户端和 PostgREST 一样，把失败装在 `error` 里返回而不抛**，所以 C08 那一类撒谎在 Auth
  上原样复发了一遍，而 C08 门禁的射程是 `.from()/.rpc()`，看不见它。
- 量到的读数（AST：调用形如 `supabase.auth.<getUser|getSession|getClaims>()`、结果做解构绑定、绑定成员里没有 `error`）：
  `main` 上 **62 处**，其中**只有 1 处绑定 `error`**（`src/app/auth/callback/page.tsx`）、2 处不是解构绑定；
  剩下按下游第一个 `if (!user)` 分支归类：**39 处答「没登录」/401**、**4 处 redirect 到登录页**、**1 处返回 null**
  （`actions/team.ts` 的 `getCurrentTeam()`，调用方据此答 `noTeam`——「你没有团队」也是读出来的事实）、
  2 处另有写法、**13 处判空跨出 14 行窗口**（这一档必须逐条读，它同时也是「有没有哪处把 `error` 当成已登录」的风险位）。
  方向上先给结论：**没有发现 fail-open**，全部是拒绝侧撒谎，所以这条不是 P0；先收口入口，再按台账偿还。
- 改了什么：`src/lib/auth/guards.ts` 两处读取统一走新增的 `readSessionUser()`（绑定 `error`，抛出交给调用方映射），
  `safelyRequireAuth()` 的最外层 catch 从「一律 UNAUTHORIZED」改成 `SERVICE_UNAVAILABLE`。
  这里有一条容易被忽略的自相矛盾：#92 早先为角色读取引入 `SERVICE_UNAVAILABLE` 时特意写了内层 catch 不让它落外层，
  但**外层本身**仍把所有异常折成 401——即 `createClient()` 失败、或 Auth 抛异常，都还是答成「你没登录」。本条把外层也改对。
  失败方向不变：仍然 deny，只是不再撒谎，而且变成可重试（503 由 `guardHttpStatus` 映射，那一档 C08 已经备好）。
- 不在本条射程、也刻意没碰：`api/analytics/route.ts` 与 `api/stripe/checkout/route.ts` 现在仍把守卫失败一律写成 401，
  那两处分别由 #103（analytics，#44 前半）和 #96（checkout）处理；去改就是抢别人的边、还多造两条冲突。
- 变异核对（不采信「绿了」）：把 `readSessionUser()` 的 `error` 解构与外层 catch 原样退回旧写法，跑
  `npx vitest run src/lib/auth/guards.test.ts` → **3 failed | 32 passed**，红的正是新加的三条
  （`requireAuth() > auth.getUser 返回 error（不抛）时…`、`safelyRequireAuth() > 会话读取抛异常时…`、
  `… > auth.getUser 返回 error（不抛）时同样…`），随后 `cp` 回字节副本并 `cmp` 确认还原、`git diff --numstat` 只剩真实改动。
  另配一条「返回 `error` 对象」的 mock（`getUserErrorObject`），因为 supabase-js 的抖动**不抛**——只测抛异常那一半，
  测试会通过而真实路径依旧撒谎。
- 顺手清掉一条会长期制造冲突的写法：`docs/roadmap-0.12.0.md` 的 `## 任务池（24 项）` 改成不写死条数、
  改指一条现量命令（D04 的既定口径）。理由是量出来的：**20 条 open PR（#92–#94、#98–#114）各自都在改这一行**
  （逐条 `git diff <merge-base> <head> | grep 任务池（` 计数，每条命中 2 行），也就是整条 C08 栈每合一个就要
  重解一次同一个单行冲突，而最后写进去的那个数字相对合并后的池子**必然是错的**。删掉数字，20 条改动同时作废。
  同时本条把引用口径写进标题：**用 ID（C09 / D04）而不是序号**——序号在本池已经撞了（C08 家族与 D 家族都占 18/19/20）。
- 判读做完了（原本记为「13 处要逐条读」，换判据后重量一遍，且是在守卫层修完之后：`main` 上 62 处、本分支 61 处）：
  **45 处有自己的 `if (!user)`**（39 答「没登录」/401、4 跳登录页、1 返回 null）、
  **8 处没有判空却直接 `user!.id`**（`dashboard/page.tsx`、`billing`、`notifications`、`profile`、`projects`、
  `projects/[id]`、`settings`、`team`：Auth 抖动时抛 `TypeError` 由错误边界兜住——不是撒谎，但是一次没有分类的崩溃）、
  **3 处两者都没有**（`api/auth/callback/route.ts`、`hooks/use-user.ts`、`lib/supabase/middleware.ts`，
  最后一处只是把 `user` 交回 `proxy.ts` 判重定向）。**全库没有一处把 `error` 当成「已登录」**，
  路由层也 fail-closed（`src/proxy.ts` 的 `isProtected && !user` 一律去登录页）——C09 的严重度据此定为「不是 P0」。
- 顺着这条判读又抓到一处**形状不同**的：`src/lib/actions/audit.ts` 的 `logAuthEvent` 用
  `user?.id ?? null` 直接落审计表，于是「读不到会话」与「失败登录时本来就没有会话」在 `user_id` 列上完全同形，
  而取证时这是两件相反的事。改成绑定 `error` + metadata 打 `sessionReadFailed: true`，
  审计照写、不阻断登录，**不加列不做迁移**（审计表是既有的 append-only 面）。
  变异核对：只把那一行标记退回 `metadata` → `1 failed | 7 passed`，红的正是新增那条断言，随后 `cp` + `cmp` 还原。
  另外生产侧顺手取了一个数：`/api/health` 的 `checks` 报 `supabase configured+reachable`、
  `sentry`/`stripe` 均 `required:false, configured:false`，`ready:true` 而 `allConfigured:false`——
  所以 #133 那条 Sentry 上报路径**在生产上目前没有接收端**，这不影响修复的正确性，但影响它的实际覆盖面。
- 判据没停在 `getUser`：把同一条规则套到**整个 Auth 客户端**（`await x.auth.<method>()` 的结果有没有绑定并使用
  `error`），量到 **90 处 awaited 调用 / 27 处绑定 / 63 处不绑定**，不绑定的按方法是
  `getUser` 55、**`signOut` 4**、`admin.mfa.listFactors` 1、`admin.mfa.deleteFactor` 1、`refreshSession` 1、
  `getSession` 1。**`signOut` 是这批里方向最坏的一档**：`退出所有设备` 与 `退出其他设备` 两个按钮
  写的是 `await supabase.auth.signOut(...)` 然后无条件往下走，而这个客户端**失败只出现在 `error` 上、不抛**，
  于是 Auth 抖动时一个把用户送去登录页（所有设备会话仍在）、一个把界面切成「其他设备已登出」
  ——后者正是共用电脑上要防的那件事，控制没生效却报了完成。改成读 `error`：失败留在原地、
  `role="alert"` 给可重试文案（新增 `logoutAllFailed` / `signOutOthersFailed`，en 与 zh-CN 各一条）。
  新增 `sign-out-buttons.test.tsx` 4 条用例；变异核对：把两个组件的 `const { error } = …` 退回
  `await …` → **2 failed | 2 passed**，红的正是两条失败路径用例，随后按字节还原并 `cmp`。
  刻意没顺手改的三处连同理由记进 roadmap C09：`site-header`（local scope，后果轻）、
  `passkey-session.ts:72`（清理用，`.catch()` 后照样 throw，是已判定的吞掉）、
  `auth/mfa/page.tsx:85`（外层 catch 读异常不读 `error`，要连 MFA 流程一起判）。
- 验证命令与结果：`pnpm verify`（type-check + lint + 全量测试 + `check:bundle`）**exit 0**，
  `Test Files 202 passed (202)`、`Tests 2315 passed (2315)`；`pnpm -s check:changelog` / `check:docs` /
  `check:bilingual-docs` / `check:gates` / `check:adr` 各自 exit 0（门禁接线 38 个：本地 35 / CI 37 / 豁免 3；
  双语 27 篇一致；CHANGELOG 11 个已发布版本 + 1 个 Unreleased）。
- 阻塞：无（本条不需要外部权限）。Vercel 配额仍按既定口径记录并忽略。
- 风险 / 回滚：行为面只有一处——Auth 不可读时不再把已登录用户送去登录页，而是 503 / 错误边界。
  回滚 = revert `5bfbcd2` 与文档 commit；无迁移、无数据面。
- 下一项：那 **8 处 `user!.id`** 的页面（判空缺失、故障时是一次没有分类的崩溃）按守卫层同一形状收口，
  先 `if (!user)` 再答「暂时不可用」——但**时机不是现在**：逐条量过重叠，`dashboard/notifications/page.tsx`
  与 `profile/page.tsx` 各有 **18 条在审 PR** 改过、`billing` 与 `team` 14 条、`page.tsx` 5 条、`settings` 4 条，
  现在动就是在整条 C08-c 栈上造 8 条需要作者出场的边。等那批落地之后一次收完。
  **【2026-09-24 当日订正】这条里的 18 / 14 / 5 / 4 不是「各自改过」的条数**：那是「相对 `origin/main`
  带着这个文件改动」的分支数，独立编辑每个页面都只有 **1** 条（#94、#101、#105、#110、#111 五条覆盖 8 个页面）。
  推迟的结论不变，理由改写见下面那条「重叠的两个数」。
  然后再按 C08-b 的台账方式立 `AUTH_ERROR_CHANNEL` 豁免表，谈门禁接不接。
- 更新时间：2026-09-24。

## 2026-09-24 — C09 第二个调用点：恢复码自救不再在一次失败的解绑后烧掉那张码

- 里程碑 / 版本：v0.12.0 / C09（第二个「抹掉 `error` 之外还要调顺序」的站点）。分支
  `feat/gate-query-error-channel`（PR #92，base `main`）——仍然**不新开 PR**：这是同一条错误通道上的第三个调用点，
  另开只会在栈上多加一条评审边。
- 状态：DONE。commit：`6831307`（代码 + 测试 + 两个 locale 的错误键），文档在同一条序列里。
- 怎么选中这一处的：C09 剩下的站点按「这个文件在几条在审 PR 里被动过」排，只挑重叠为 0 的。
  判据（2026-09-24 重跑，41 条 open PR 全部本地可测、无一条取不到对象）=
  `git diff --name-only <merge-base origin/main <head>> <head>` 对文件全名匹配，**把栈上 PR 下游带来的改动也算进来**。
  结果：`src/lib/actions/recovery-codes.ts` **0 条**，`src/lib/auth/guards.ts` 20 条（其中一条是它自己新建的），
  `dashboard/notifications/page.tsx` 18 条。**这里踩过一次判据口径**：同一份脚本改用「只看这个 PR 自己的 delta」
  （`merge-base <base-ref-oid> <head>`，栈上 PR 的 base 是父 PR 的 head）去数，`notifications/page.tsx` 从
  18 条读成 **1** 条——那会把站点选到相反的一侧。两种口径都跑一遍、并拿已知文件当对照，才确认 0 这条是真的。
  **【同日晚些订正：这句话本身是错的】**两个口径在「0 还是非 0」上**给的是同一个答案**，
  所以选站点不会因为换口径选反；它们差的是**量纲**——自己的 delta 数是「几处独立改动会撞我」，
  相对 main 的数是「合并时多少条分支要重放这个文件」。把后者读成「18 条 PR 各自改过」是把量纲读错了，
  订正与两张表见最后一条。
- 修的是什么：`redeemRecoveryCode` 原次序是「扣恢复码 → 写审计 → 解绑 TOTP」，解绑那两步走 Auth **管理**端口，
  `const { data: factors } = await admin.auth.admin.mfa.listFactors(...)` 连 `error` 都没绑定，
  `deleteFactor` 的返回值整个丢掉。于是 Auth 一次抖动的后果是这个仓库里最坏的一种谎报：恢复码是**一次性**的、
  扣掉回不来，一个因子也没解绑，用户仍被锁在**他丢掉的那把验证器**后面——也就是这条功能存在的理由没被解决，
  还少了一次重试的机会——而动作回 `{ ok: true }`。
- 改法：新增 `unbindTotpFactors()`（两步的 `error` 都读，任一失败把原因带回调用方），次序**反过来**——
  先解绑、成功后才 `consumeRecoveryCode`。失败时 `logActionError` + 回新增错误键 `recoveryUnenrollFailed`
  （en / zh-CN 各一条，文案明说「恢复码没有被扣、可以重试」）。偏保守一侧的代价只是一次失败的兑换把码留在库里；
  「账号本来就没有 TOTP 因子」是合法状态，不算失败，照常扣码。
- 测试：`recovery-codes.test.ts` 的 `mockAdminMfa()` 加 `failure` 注入参数（`list` / `delete` 两档），新增 3 条用例
  ——列因子失败 → `recoveryUnenrollFailed` **且 `consumeRecoveryCode` 未被调用**、删因子失败同上、
  没有 TOTP 因子照常扣码。单文件 `15 passed`。**变异核对**：删掉 `if (listed.error)` → `1 failed | 14 passed`，
  红的正是「列因子失败」那条；还原后再删 `if (deleted.error)` → 红的正是「删因子失败」那条；两次都按字节 `cp` 还原。
  两条 `not.toHaveBeenCalled()` 是顺序断言：把次序退回「先扣码」会让这两条一起红。
- 验证命令与结果：`CI=true pnpm check:all` **exit 0**（`Test Files 203`、`Tests 2323`）；
  `pnpm -s check:action-errors` 通过并打出 `44 个错误码 × 2 个 locale`。**这一条也是量过的**：临时把
  zh-CN 的 `recoveryUnenrollFailed` 改成别的键名，门禁报
  `[ACTION_ERROR_KEY_MISSING] …（src/lib/actions/recovery-codes.ts:125 产出）缺少 zh-CN 文案` 并 exit 1，
  还原后 44 恢复——即新错误码确实被这道门禁管着，不是「加了个没人核对的字符串」。
  `pnpm verify:build`（type-check + lint + `check-locales` + 全量测试 + `check:bundle` + `pnpm build`）**exit 0**：
  `Test Files 203 passed (203)`、bundle `2846.4 kB / 基线 2733.8 kB` 在范围内、`✓ Compiled successfully`
  且 23 个静态页全部生成（`MISSING_MESSAGE` 只有这一步能抓，所以新增的两个 locale 键必须由它收尾）。
  文档改完之后又跑了一遍 `CI=true pnpm check:all`，同样 exit 0。
- 阻塞：无（不需要外部权限）。Vercel 配额按既定口径记录并忽略。
- 风险 / 回滚：行为面只有一处——解绑失败时不再报成功，代价是那张码还留在库里可重试。
  回滚 = revert `6831307` 与文档 commit；无迁移、无数据面、不改任何已有错误键的语义。
- 下一项：C09 剩余的可动站点要重新按同一把尺量一遍重叠（`site-header.tsx` 的 `signOut`、
  `auth/mfa/page.tsx` 的 `refreshSession`）；那 8 处 `user!.id` 仍等 C08-c 那批 PR 落地；
  之后立 `AUTH_ERROR_CHANNEL` 豁免台账再谈门禁接不接。
- 更新时间：2026-09-24。

## 2026-09-24 — C09：0 重叠的站点又收两处，另外两处量完之后一条判据被推翻

- 里程碑 / 版本：v0.12.0 / C09。分支 `feat/gate-query-error-channel`（PR #92，base `main`），
  仍然折在同一条 PR 里，不新开。
- 状态：DONE（`0607805` 顶栏退出、`101fcf5` 登录回调审计）。
- 挑站点的尺子沿用上一条那把（`merge-base origin/main <head>` 之后 diff 文件全名）。这一轮量到的 0 重叠是四个：
  `site-header.tsx`、`api/auth/callback/route.ts`、`hooks/use-user.ts`、`lib/supabase/middleware.ts`；
  `app/auth/mfa/page.tsx` 是 **1**（#119 在改），所以它不动。对照着又量了消费者侧：
  `use-is-admin.ts` 0、`use-unread-notifications.ts` 0、`proxy.ts` 0、`use-toast.ts` 0。
- 收的两处：①`handleSignOut` 丢掉 `signOut()` 的返回值后照样 `push(首页)` + `refresh()`——
  这个入口比设置页那两个按钮更常被打到，用户点了退出、页面跳走，于是**以为这台电脑上的会话已经没了**；
  改成读 `error`，失败弹可重试的 destructive toast（新增 `common.signOutFailed`，en / zh-CN 各一条）。
  ②`api/auth/callback/route.ts` 在 `exchangeCodeForSession` **已经成功**之后再去 `getUser()`，那一处不取
  `error` 就把 `user?.id ?? null` 落审计表——一次确实发生的登录被写成没有主人。改成绑定 `error` +
  metadata `sessionReadFailed` + `logApiError`；**跳转方向不动**（拦一次已经成功的登录不是这条路由的职责），
  并补上该路由的第一份测试（4 条用例，含「无 code」「交换失败不回写审计」两档）。
- **有一条判据在这两处之后被推翻**：C09 原先把 `lib/supabase/middleware.ts` 记成「两者都没有」的债。
  量完发现它根本不该进这张表——那里的 `getUser()` 读的是**浏览器带来的 cookie**，读失败最常见的成因就是
  「这份会话不再有效」（access token 过期且刷新失败、token 被撤销）。对中间件而言那不是基础设施抖动，
  是关于用户的真事实，所以 `user=null` → `proxy.ts` 重定向登录页**是正确答案**；把 `error` 单独拎出来放行，
  会把一次普通的会话过期变成一个错误边界页。`proxy.ts` 本身 0 重叠，也就是不动它不是因为动不了，
  是因为动它会把对的行为改错。判据的适用范围因此收窄成「读的是服务端自己拿到的会话」，这条写进 roadmap C09。
- 另一处量完之后仍不动的是 `hooks/use-user.ts`：它的修法要么改钩子契约（多返回一个「没读到」），
  要么在三个消费者里判空，而三个文件都是 0 重叠——所以拦住它的不是冲突面，是一次接口决定；
  方向也全在拒绝侧（头像显示登出态、`useIsAdmin()` 为假、未读数为 0）。留在 C09 等决定，不塞进本 PR。
- 测试与变异核对：顶栏 6 条用例（`1 failed | 5 passed` ← 把组件退回旧写法，红的正是失败路径那条、
  成功那条照绿）；回调路由 4 条用例，两刀分别退回 metadata 标记与那行日志，**都只红同一条**用例。
  顶栏测试把 Radix 下拉 mock 成普通元素——jsdom 没有 `ResizeObserver`，被测的是「这一步失败时组件做了什么」，
  不是下拉的展开实现。两次变异都用 `git checkout --` 还原（改动已先 commit），还原后 `git status` 干净。
- 验证命令与结果：`CI=true pnpm check:all` **exit 0**（38 道门禁；`Test Files 204`，比上一条多一个文件；
  翻译对称 `en/zh-CN 各 1247 key`；`check:test-matrix` 11 领域 / 104 条门禁 × 2 份文档）。
- 阻塞：无。Vercel 部署检查仍按既定口径记录并忽略。
- 风险 / 回滚：两处都是「失败不再报成功」，回滚 = revert `0607805` 与 `101fcf5`；
  无迁移、无数据面，回调那条只往既有审计行的 metadata 里多写一个布尔。
- 下一项：C09 还剩的是那 8 处 `user!.id`（等 C08-c 那批落地）、`use-user.ts` 的接口决定、
  `app/auth/mfa/page.tsx`（#119 落地之后），以及立 `AUTH_ERROR_CHANNEL` 台账再谈门禁接不接。
- 更新时间：2026-09-24。

## 2026-09-24 — 重叠的两个数：「18 条在审 PR 改过」是把携带数当成了作者数

- 里程碑 / 版本：v0.12.0 / 文档治理（订正今天自己写进 roadmap C09 与两条台账的测量口径）。
  分支 `feat/gate-query-error-channel`（PR #92，base `main`）。
- 状态：DONE。这一条不动代码，只把一条**已经引用过三次**的读数改对。
- 怎么发现的：上一轮收完两处 0 重叠站点之后，本来要回答的问题是「C08-b 排第一的那两处数据丢失
  （`actions/projects.ts` 的 config 合并、`profile/edit/page.tsx` 的表单预填）现在能不能动」。
  按老的读法它们各有 19 / 18 条在审 PR 改过，是「全队列最脏的两块地」，结论只能是继续等。
  这次把两个口径分开重跑（41 条 open PR、全部本地可测）：
  *独立编辑* = `git diff --name-only <merge-base <base-ref-oid> <head>> <head>` 里出现该文件的条数；
  *栈上携带* = 对 `origin/main` 取 merge-base 之后再 diff。**结果：所有被查文件的独立编辑数都是 0 或 1**——
  `actions/projects.ts` 1（#93）、`profile/edit/page.tsx` 1（#94）、`api/invitations/route.ts` 1（#98）、
  `uploads/service.ts` 1（#99）、`notifications` 与 `profile` 各 1（都是 #94）、`billing` 与 `team` 各 1（#101）、
  `page.tsx` 1（#110）、`projects` 与 `projects/[id]` 1（#105）、`settings` 1（#111）、`guards.ts` 1（#92 自己）；
  而携带数是 19 / 18 / 17 / 16 / 18 / 14 / 5 / 10 / 4 / 20。**没有一个文件是「多条 PR 各自在改」**。
- 为什么之前会读错：本池是栈式的，一条改动会被它下游的每条分支带着走。
  相对 main 的 diff 把「下游重放」也算成了「有人也在改这个文件」，于是把一个作者读成了十八个。
  两个数都合法，但**回答的是不同问题**：选站点看独立编辑（有几处会和我撞），
  排合并顺序看携带数（多少条分支要重解）。
- 订正了什么：roadmap C09 里那段判据重写成了两把尺并列、并写明选型只看前者；
  「那 8 处 `user!.id` 现在不能动」的理由从「造出 8 条需要作者出场的边」改成
  「5 条分支正在重写这批文件，我改一次要沿它们下游最多 17 条分支各重放一次」；
  今天早些那两条台账里被引用过的 18 / 14 / 5 / 4 就地标注【当日订正】并留了原文（不抹，按本仓库惯例）。
  顺带一句自我核对：我上一轮刚写下的「换口径会把站点选到相反的一侧」也是错的——
  两个口径在 0 / 非 0 上给同一个答案，差的只是量纲，那句也已就地订正。
- 对排期的实际影响：**C08-b 那两处数据丢失并没有被 18 条 PR 挡住**，各自只挡在一条分支上
  （#93 与 #94）。它们是不是现在就动，取决于「一条重放」的代价，而不是「叫几个作者」——
  这条判断留给下一次动手时写，本条只把数落准。
- 验证命令与结果：本条只改文档，`CI=true pnpm check:all` 的结果记在下面那条 commit 之前跑的复跑里。
- 阻塞：无。
- 风险 / 回滚：读数的订正不改变任何行为；回滚 = revert 本文档 commit。
- 下一项：按订正后的口径重排 C08-b 的清偿顺序（先看独立编辑为 0 或 1 的文件里哪些真的是数据丢失），
  以及 `AUTH_ERROR_CHANNEL` 台账。
- 更新时间：2026-09-24。

## 2026-09-24 — 自查修正：Auth 的「没有会话」也是一个 error，按「error 非空即故障」会把匿名访问答成 503

- 里程碑 / 版本：v0.12.0 / C09（修的是**本仓库当天早些时候自己引入的那一档**，不是外部报的缺陷）。
  分支 `feat/gate-query-error-channel`（PR #92，base `main`）。
- 状态：DONE。commit `7836b5c`（代码 + 测试），文档在同一条序列里。
- 怎么撞上的：排完 C08-b 的清偿顺序之后准备动 `use-user.ts`，动手前照例先去
  `node_modules/@supabase/auth-js@2.116.0` 读 `getUser` 的真实行为，结果在 `_getUser` 里读到
  `if (!data.session?.access_token && !this.hasCustomAuthorizationHeader) return { data: { user: null }, error: new AuthSessionMissingError() }`
  ——**匿名访客拿到的 `error` 是非空的**。而当天早些时候我给守卫层加的判据是
  `if (error) throw new Error(error.message)`，映射到 `SERVICE_UNAVAILABLE`（503）：
  每一次匿名访问 `/api/*`（中间件不保护 API 路由）都会从「请先登录」变成「服务暂时不可用」，
  而 503 既不该重试也不该重新登录——比我要修的那个错更难解释。审计侧同一条判据让
  `sessionReadFailed` 打在**每一次失败登录**上，那个标记等于没有。
- 各方法的行为**不通用**，这是这次错误的根因（都对着源码核过）：`getUser()` 匿名时给
  `AuthSessionMissingError`；`getSession()` 匿名时给 `{ session: null, error: null }`；
  `signOut()` 的 `_signOut` 自己滤掉 `AuthSessionMissingError`、并且对 401/403/404 选忽略；
  管理端口的 `listFactors` / `deleteFactor` 用 service role，没有「匿名」这档。
  所以当天那三处登出与恢复码的修复**不受影响**，受影响的是两处按 `getUser()` 的 `error` 判故障的地方
  （守卫层、审计标记）与一处顺带（回调路由）。
- 改法：新增 `src/lib/auth/session-error.ts`，只把**能叫出名字**的读取故障分出来——
  `AuthRetryableFetchError`（fetch 本身失败）与状态码 ≥500 的 `AuthApiError`；其余一律维持 `main`
  的既有答复（拒绝侧、可以登录）。判不准的宁可归到「没有会话」那侧：这个模块的职责是把被误报成
  「你没登录」的故障救出来，不是扩大 503 的面。守卫层、审计标记、回调路由三处改为调用它。
- 测试：新增 `session-error.test.ts` 5 条；`guards.test.ts` 补两条匿名用例
  （`requireAuth` 仍重定向、`safelyRequireAuth` 仍 `UNAUTHORIZED`），并把当天早些那条
  「返回 error 对象」的 mock 从**手写的假对象**换成真的 `AuthRetryableFetchError`——
  旧 mock 恰好长得像 `AuthSessionMissingError`，这就是它当初没拦住这档错的原因；
  `audit.test.ts` 补「匿名不打标」、`callback/route.test.ts` 补「匿名不打标也不记故障日志」。
  变异核对两刀：分类器退回「`error` 非空即故障」→ 4 个文件 **7 failed**（全在匿名 / 4xx 那一侧）；
  退回「永远不是故障」→ **6 failed**（网络型与 5xx 那一侧）；两刀都用 `git checkout --` 还原。
- 顺带一条流程账：这一档**是 `pnpm type-check` 抓出来的**——新增测试里 `new AuthApiError(msg, 502)`
  少传了类型上必填的第三个参数，`CI=true pnpm check:all` 直接红在 `==> type-check`。
  按 AGENTS.md 的口径，push 前那四步（lint → type-check → test → build）一步都不能省。
- 验证命令与结果：`CI=true pnpm check:all` **exit 0**（38 道门禁；`Test Files 205`、`Tests 2338`）。
- 阻塞：无。
- 风险 / 回滚：这处回滚等于把匿名访问退回 503，所以它应当**先于**任何依赖守卫层新语义的消费者落地；
  回滚 = revert `7836b5c` 与文档 commit，无迁移、无数据面。
- 下一项：`use-user.ts` 的接口决定现在有了可复用的判据（`isRetryableSessionReadFailure`），
  代价从「改契约」降到「在三个消费者里各自决定怎么答」；C08-b 的清偿顺序按上一条的口径重排——
  那两处数据丢失各只挡在一条分支上（#93 已在做 `actions/projects.ts`，#94 在做 profiles 那三处），
  先确认不重复再动。
- 更新时间：2026-09-24。

## 2026-09-24 — bundle 门禁量的是上一次构建留下的目录，所以它能在全红的源码上报绿

- 里程碑 / 版本：v0.12.0 门禁基础设施（本条与上一条同族：查的是「门禁是否真的会红」，不是业务代码）。
- 状态：DONE（待合并），分支 `fix/hook-layer-actually-runs`（PR #125，base `main` = `ad4b029`）。
- 为什么做：起点是一个很轻的怀疑——pre-push 现在跑 `pnpm verify:build`，而 `verify:build` =
  `verify && pnpm build`、`verify` 里的 `check:bundle` 又自带一次 `pnpm build`，同一次推送要构建两遍。
  昨天有一次 `next build` 报 `⨯ Another next build process is already running`，我一直当作这次冗余的
  副作用。读命令写法时发现更糟的一层：`check:bundle` 是
  `bash -c 'pnpm build 2>&1 | node scripts/check-bundle.js'`，管道右边的脚本从不读 stdin、只看
  `.next/static`，而 bash 不开 `pipefail` 时管道的退出码就是最后一个命令的退出码——**构建失败根本没机会
  变成门禁失败**。
- 实测（先给阳性对照，再给缺陷）：
  - 往 `src/lib/api-response.ts` 追加一行 `const deliberatelyBroken = ;`（硬语法错误），
    `pnpm check:bundle` → **EXIT=0**，日志 14 行里没有任何 error 字样，末行是
    `✅ Bundle 体积在基线范围内`、数字 `2846.4 kB` 来自上一次成功构建留在 `.next/static` 的目录。
  - 同一棵树 `pnpm build` 单独跑 → 退出非 0，`verify:build` 今天还能拦住，靠的就是尾巴那次重复构建
    恰好把失明兜住——两处都没写在文档里，所以这个「能用」是巧合而不是设计。
- 完成内容：
  1. `check:bundle` 改成 `node scripts/check-bundle.js`（度量-only，与 CI Build job 的用法一致：
     构建归调用方）；`scripts/check-bundle.js` 换成 Node type-stripping 启动器（与 `check-gates.js`
     同形态），实现落到 `scripts/lib/bundle-freshness-check.js`。
  2. 新增纯规则 `src/lib/release/bundle-freshness.ts`：`newestStamp()` 取产物最新时间戳、
     `sourcesNewerThan()` 列出比产物新的输入。量体积之前先判新鲜度——**「调用方忘了构建」从此不依赖
     调用方的自觉**，等号成立（同一秒）不算过期，构建过程自己会读到同一秒内写入的文件。
  3. `verify` 重排成 `check → test → build → check:bundle → check:perf`，一次构建产出、两个产物门禁
     复用；`verify:build` 退化为 `pnpm verify` 的同义名并保留（`.husky/pre-push`、AGENTS.md、README ×2、
     CONTRIBUTING、docs-site 三页 ×2 语言、各版 Runbook 写的都是这个名字，`check:release-docs` 还按字面
     核对它）。顺带一条：`check:perf` 的豁免理由一直写着「由 pnpm verify 覆盖」，而 verify 里没有它——
     这条门禁此前只在 CI 跑过，现在本地也有入口，那句理由第一次为真。
  4. 文档与事实对齐：`docs-site/scripts.md` / `zh-CN/scripts.md` 的 `check:bundle` 行与 pre-push 段、
     `docs/testing.md` 的命令表与 `check:gates` 豁免清单段、`src/lib/release/gate-wiring.ts` 里
     「`check:bundle` 的命令自带一次 `pnpm build`」那句已经过期的注释。
- 变更文件：`package.json`、`scripts/check-bundle.js`、`scripts/lib/bundle-freshness-check.js`（新）、
  `src/lib/release/bundle-freshness.ts`（新）、`src/lib/release/bundle-freshness.test.ts`（新）、
  `src/lib/release/gate-wiring.ts`（注释）、`docs/testing.md`、`docs-site/scripts.md` 与
  `docs-site/zh-CN/scripts.md`、`CHANGELOG.md`、本条目。
- 验证命令与结果：
  - `npx vitest run --project node src/lib/release/bundle-freshness.test.ts` → **13 passed**。
    第一版就红了一次，红在测试而不是代码：fixture 里 `messages/en.json` 没设时间戳，按真实时钟落盘，
    于是永远比 fixture 声称的「构建」新——判定器如实报出了它。
  - 端到端两个方向都实测：源码新于产物 → `❌ 构建产物比源码旧：1 个输入文件晚于最近一次构建` 并列出
    `src/lib/api-response.ts`，EXIT=1；把 `.next/static` 里的文件 touch 新 → `✅ Bundle 体积在基线范围内`，
    EXIT=0。启动器第一版还翻过一次车：`process.argv.slice(1)` 把自己脚本的路径当成了 repoRoot 传给
    下一层，症状是「未找到 .next/static」，改成 `slice(2)`（与 `check-gates.js` 一致）后两个方向才分别成立。
  - `pnpm check:perf` 本地 → exit 0（recharts chunk 存在 / CSS 73kB / 无 sourcemap 泄漏），这是把它
    放进 `verify` 的前提，否则 pre-push 会被一条从没本地跑过的门禁堵死。
  - 全量门禁与构建结果见本条之后的下一次追加（`CI=true pnpm check:all`、`pnpm verify:build`）。
- 阻塞 / 风险 / 回滚：不碰运行时与数据库，回滚 = revert 本分支这三个 commit。风险两条，都实测过方向：
  一是 `git checkout` / `pull` 会把源码 mtime 刷到当下，之后单独跑 `pnpm check:bundle` 一定红——
  这是要的（它拒绝量一份可能已过期的产物），代价是本地得先 build；二是启动器多一层 spawn，
  CI 的 `node scripts/check-bundle.js` 命令字面不变，`check:gates` 认「直接跑实现脚本」这一形态，
  接线判定不受影响。
- 下一件：`verify:build` 的这次重排顺手消掉了「同一棵树上跑两次 `next build`」，所以昨天那个
  `Another next build process is already running` 的竞态在本地路径上已经没有产生条件。顺手把同类
  缺陷扫了一遍：`package.json` 里 38 条 `check:*` / `verify*` 命令，**含管道的只剩 0 条**（本条改完
  之后），`scripts/*.sh` 里的管道都在 `set -euo pipefail` 下或只用于 `du | cut` 这类取值；
  也就是说「把真实命令的退出码换成报表脚本的退出码」这个形态在本仓库只有 `check:bundle` 一处，已修。
- 更新时间：2026-09-24（UTC 07:00 前后）。

## 2026-09-24 — `check:docs` 的英文那一半从来没有被读过

- 里程碑 / 版本：v0.12.0 / 门禁失明复核（与 D10「形同虚设」那一族同形）。
- 分支 / commit：`fix/gate-docs-english-half`（基于 `origin/main` = `ad4b029`，独立 PR，不叠栈）。
- 状态：DONE（PR 停在 ready-for-review）。
- 怎么撞上的：这轮先量了依赖面（`pnpm audit --audit-level high` → No known vulnerabilities，且
  `.npmrc` 的 registry 本来就是 npmjs.org，所以 `npm audit` 那条路在 pnpm 仓库里必然 ENOLOCK），
  转去量「文档记录的命令 vs package.json 脚本」的双向差集，才发现单向差集里 en 有 18 条没记录——
  顺着「为什么没人管」读到 `scripts/check-docs-scripts.js`：它找 `docs-site/en/scripts.md`，
  而本仓库英文文档在 `docs-site/scripts.md`，`if (!fs.existsSync(docPath)) continue` 直接把半边吞了。
- 实测门禁当前只判一边：`pnpm this-command-does-not-exist` 写进 en → `check:docs` 退出 **0**；
  同样内容写进 zh-CN → 退出 **1** 并点名命令。（两次都用 `/tmp` 备份还原、`cmp` 确认字节一致。）
- 完成内容：路径映射改对（en 在 `docs-site/` 根、zh-CN 在子目录）；**读不到文档改为失败关闭**
  `SCRIPTS_DOC_MISSING`；规则抽成 `src/lib/docs/scripts-docs.ts` 纯函数 + 7 条单测，IO 落
  `scripts/lib/scripts-docs-check.js`，`scripts/check-docs-scripts.js` 只留 type-stripping 启动（与
  `check:gates` / `check:hooks` 同一形状）。通过输出带计数：`2/2 份文档、73 个脚本`。
- 变更文件：`src/lib/docs/scripts-docs.ts`（新增）、`src/lib/docs/scripts-docs.test.ts`（新增）、
  `scripts/lib/scripts-docs-check.js`（新增）、`scripts/check-docs-scripts.js`（改为薄入口）、
  `CHANGELOG.md`、本条目。
- 验证命令与结果：
  - 修完再跑同一支探针：en 加假命令 → 退出 **1** 且报 `docs-site/scripts.md 引用了不存在的脚本`；还原后 0；
  - 失败封闭探针：`node scripts/lib/scripts-docs-check.js /tmp/emptyrepo` → 退出 **1**（package.json 读不到），
    文档缺失由规则报 `SCRIPTS_DOC_MISSING`（单测覆盖，含「一份坏文档不掩盖另一份的判定」）；
  - 过程性错误记一条：IO 初版把 TS 语法写进了 `.js`（`import { type X }`、参数与返回标注），
    Node 只在 `.ts` 里剥类型，于是 `SyntaxError: Unexpected identifier`——分三次清掉才跑起来。
    `.js` 侧只能是纯 JS，这一点与同目录其它 IO 文件一致。
  - `pnpm -s vitest run src/lib/docs/scripts-docs.test.ts` → **7 passed**；`pnpm -s type-check` → 0；
    `pnpm -s lint` → 0；`CI=true pnpm -s check:all` → 0；`pnpm build` 与全量测试由 pre-push 钩子跑。
- 阻塞 / 风险：本条只修「两边都读到了吗」这一半，**不要求 en 把 46 个脚本全写出来**（文档是子集，
  `check:docs` 的语义仍是「文档里写的命令必须存在」）。已知的下一半差集：en 表格 42 行、zh-CN 38 行，
  两份镜像的行数不一致而 `check:bilingual-docs` 不比对这份表格。
- 下一项：**这条在本条落地时就量掉了，记下来免得再有人去追。** 两份 `scripts.md` 的
  `pnpm` 命令集合其实是一致的（en 48、zh-CN 49，唯一差集是 zh-CN 里那句作为操作步骤出现的
  `pnpm install`，它不是脚本、本就该只在一处出现）。表格行数 42 vs 38 差的是**版式不是内容**：
  `lint` / `type-check` / `format` / `check` 四条中文文档也写了，只是没放进那张表。
  所以「按行/按命令做镜像一致性门禁」会对着合法的结构差异报警——不做。
  仍然成立的那半句是：en 有 18 个脚本没写进文档，但「文档是子集」是 `check:docs` 的既有语义，
  要改的是语义而不是加门禁，那需要单独决定。
- 更新时间：2026-09-24

## 2026-09-24 — 组件参考在推荐四个已被删除的组件，改正并补上门禁

- 里程碑 / 版本：v0.12.0；「记录说假话」家族的第五处，新增门禁 D05。
- 状态：DONE（待用户合并）。分支：`docs/components-reference-counts`，base = `origin/main`（`ad4b029`）。
- 发现与量：把 `docs-site/components.md` 与中文半边的数量声明对回 `src/components/**`（非测试 `.tsx`）——
  实测 ui 30 / shared 15 / layout 8 / auth 2 / forms 7，文档写的是 24 / 11 / 5 / 2 / 5；
  6 个 `ui/` 组件（command、context-menu、kbd、radio-group、scroll-area、toaster）两侧都没列；
  `LoadingState`、`PageLoader`（`223f9eb` 删）与 `SearchInput`、`PageContainer`（`42de059` 删）四行仍作为
  可用的 `shared/` 组件在推荐；`DashboardSidebar` 标着 `layout/`，它在 `dashboard/`。
- 同一条线索往外扫（是同一次 grep 带出来的，不是新假设）：`CLAUDE.md` 的组件地图 4 处数量过期
  （ui 23 / layout 3 / forms 4 / shared 9），并且推荐了仓库里不存在的 `SupabaseProvider`、`LoadingPage`
  ——而 `CLAUDE.md` 是 AI 助手读的第一份文件，写错的组件名会被当成事实继续生成代码；
  `docs/architecture/09-frontend-components.md` 与 `agents/09-ui-ux.md` 各留着一份含幽灵的共享组件清单。
  有意思的是 `agents/09-ui-ux.md` 的 `ui/` 清单 30 个全对——同一份文档里一半新一半旧。
- 改动：五份文档按实测改正（中英两半的表格各从 49 行涨到 66 行——补 21 行真实组件、删 4 行幽灵；
  `DashboardSidebar` 改指 `dashboard/`；小节标题里重复的数量断言删掉，只留目录树那一处可核的）；
  新增 `pnpm check:component-docs`（规则
  `src/lib/docs/component-docs.ts` + 17 项单测、IO `scripts/lib/component-docs-check.js`、入口
  `scripts/check-component-docs.js`、接进 `package.json` 与 `check-all.sh`，`check:gates` 计数 37 → 38）。
- 判据与边界（都写进门禁头注释）：只认表头是 `Component`/`组件` 的表——第一版按「首格是 PascalCase」认表，
  立刻把 `CLAUDE.md` 的 `| Schema | 文件 | 用途 |` 读成一个叫 `Schema` 的组件；目录树写法（`├── auth/`）
  只在声明 `exhaustive` 的参考文档里认，否则 `CLAUDE.md` 的 `src/app` 路由树里那句 `├── auth/ # 5 个认证页面`
  会被当成组件数量；摘要文档只认 `` `src/components/<目录>/` `` 且带数字的行。条目式清单与表格说明列
  **不**解析，所以 `SupabaseProvider` 现在仍在盲区里（见下一项）。不做中英文逐行镜像，理由同上一条
  「两份 scripts.md 命令集合本来就一致」的判断。
- 验证命令与结果：`pnpm -s type-check` exit 0；`pnpm -s lint` exit 0（第一版被
  `@next/next/no-assign-module-variable` 拦下两处 `for (const module of …)`）；
  `pnpm --silent check:component-docs` → `✅ 162 行 / 62 个枚举组件 / 15 处数量声明 × 5 份文档
  （23 个组件位于不要求枚举的目录）` exit 0；`pnpm --silent check:gates` exit 0。
- 变异核对（两条都不是「改完才绿」的事后断言）：① 在真实文档里塞一行 `| SearchInput | \`shared/\` |`
  并把 ui 数量改回 24 → exit 1，`COMPONENT_GHOST` 点名 `search-input.tsx`、`COMPONENT_COUNT_STALE`
  报 24/30，还原后 exit 0；② 对 `HEAD` 版本的两份文件跑同一条规则 → `architecture/09` 报 2 个幽灵、
  `CLAUDE.md` 报 4 处数量过期，误报 0。
- 阻塞：无。CI 证据范围：这条 PR base = `main`，所以 `ci.yml` 的 5 个必需作业会真的跑；上面列的是本机结果。
- 风险 / 回滚：纯文档 + 只读门禁，无运行时路径。回滚 = revert 两个 commit。副作用是以后加组件必须同步
  目录树数量与表格行——这正是门禁的目的，但会让「顺手加个组件」的 PR 多改两处。
- 下一项：
  1. ~~把解析扩到条目式清单与表格说明列~~ —— 量过了，不做。`CLAUDE.md` 的「共享组件」小节根本没有
     `` `src/components/<目录>/` `` 这行定位标记（它写的是 `## 共享组件 (components/shared/)`），
     `agents/09-ui-ux.md` 的 `ui/` 清单是一行逗号分隔的反引号串而不是 bullet，行 86/88 那两处
     `` `src/components/ui/` `` 又在代码注释块里。要覆盖这些形态，得再加「跳过围栏」「认第二种 scope
     写法」「解析逗号串」三条规则——而第一版只因为「按首格 PascalCase 认表」这一条宽松规则就把
     `CLAUDE.md` 的 `| Schema | 文件 | 用途 |` 读成了一个叫 `Schema` 的组件。表格 + 数量已经覆盖了
     这次真正造成伤害的那部分（`CLAUDE.md` 的 4 处过期数量、`architecture/09` 的 2 个幽灵行），
     散文与条目清单留在盲区里如实写在头注释中，靠人工。第二格写成 `` `shared/x.tsx` `` 的表目前只核
     名字存在、不核目录，同理。
  2. #129 合并后要 `gh pr edit 129 --base main`（它 base 在 #128 上）。
- 补记（同日）：上面这些把编号 D05 写进了 CHANGELOG 和本条目，却没有登记进任务池——
  `docs/roadmap-0.12.0.md` 的 D 域当时只到 D04，而 v0.6.0 池的 D05 是「语言切换状态持久化」。
  「同编号在两个池里含义不同、引用必须带池子名」这句话正是 D03 那条自己写下的警告，
  而这次是我自己踩的：一个只存在于引用里的编号，等于给下一个读的人留了一道对不上的账。
  现已把 D05 登记进 v0.12.0 池（含三条判据、两条刻意边界、以及「对改动前的文件跑同一条规则」这个取证口径），
  门禁、CHANGELOG 与任务池说的是同一件事。同一轮里补掉第二处只写了代码没写文档的账：
  这道门禁当时没进 `src/lib/testing/test-matrix.ts` 的 `docs` 领域，也没进两份 `docs-site/scripts.md`
  与 `docs/testing.md` 的命令表——也就是**负责核组件文档的门禁，自己不在任何文档里**，
  贡献者按矩阵办事永远不会知道改组件参考要跑它。现在登记了，`check:test-matrix` 会强制两份矩阵文档跟着它。
- 补记二（同日，另一处「把一次性的读数钉成等号」）：上面那条「15 处数量声明 × 5 份文档」的读数被写进了
  单测，形如 `expect(report.stats.counts).toBe(15)`，而**同一个 `it()` 里另外两条都是地板值**
  （`rows >= 160`、`enumeratedModules >= 62`）——只有 `counts` 用了等号。已改成
  `toBeGreaterThanOrEqual(15)`，理由写在断言旁边。`counts` 是「文档里共有几处数量断言」，多一个目录就多两处
  （中英两半各一处），钉成等号等于要求每个改组件文档的 PR 回来改这个测试里的魔数：忘了不会挡住任何错误，
  只会在合并后的 main 上红成一场不存在的回归。地板防的是另一件事——解析停摆时读数是 0，而「一处都没读到」
  和「文档本来就没写数量」在输出里长得一样。精确读数交给 `pnpm check:component-docs` 现量。
  - 活性核对：地板抬到 16 → `AssertionError: expected 15 to be greater than or equal to 16`
    （该文件 17 项里 1 红 16 绿），顺带现量确认 `counts` 今天确实是 15；改回 15 后 17 项全绿，
    `git diff` 复核只剩预期的那一处。
  - 同一条线索顺手把上面 状态 里那个分支名订正成 `feat/component-docs-gate`（本条目原先写的是
    `docs/components-reference-counts`）：那个名字现在既不在本地分支里、也不在 `git ls-remote --heads origin`
    里，49 个 open PR 与全部历史 PR 的 head 也没有一个是它——也就是说台账留着的是一个 PR 正文里都没引用过的
    分支名，按它去找分支的人会一无所获。这次改的是**指向**，条目内容一字未动。
- 更新时间：2026-09-24。

## 2026-09-24 — 四条 CodeQL 日志注入告警挂了五天，本仓库的分诊流程第一次没被执行

- 里程碑 / 版本：v0.12.0 安全线；`docs/operations/codeql-alert-triage.md` 的 5 个工作日 SLA。
- 状态：DONE（修复 + 分诊记录都已产出）。分支：`fix/log-injection-sink`，base `main`，
  对应 issue #132 与同一个 PR。
- 怎么找到的：这轮把安全线整体扫了一遍——`dependabot/alerts?state=open` 0 条、
  `secret-scanning/alerts?state=open` 0 条、`code-scanning/alerts?state=open` **4 条**
  （#11–#14，规则 `js/log-injection`，`severity=error` / `security-severity=medium`，
  首次出现 `2026-09-19T23:15:26Z`，命中点就是 `src/lib/logger.ts:80/83/86/89` 那四个 `console.*`）。
- 要紧的不是那 4 条告警，而是**流程第一次没被执行**：本仓库自己的 runbook 写着
  「4.0–6.9 允许合并，但必须建 issue 并在 5 个工作日内完成分诊」，而 `gh issue list --search` 显示
  与这批告警相关的 issue 是 **0 条**——到 2026-09-24 是第 4 个工作日，SLA 只剩一两天，
  没有人判定过真阳性还是假阳性。这与「三个提交钩子写着在跑其实一个都没跑」是同一类失效：
  约定存在于文档里，执行状态没人看。
- 判定（真阳性）与证据：`src/app/api/webhooks/stripe/route.ts:134` 与 `:228` 把请求体字段
  （`invoice.id` / `event.type` / `event.id`）直接拼进日志文本，路径上没有字符级校验。
  一个会被拿来做假阳性论证的事实，以及它为什么不够：`console.*` 只在 `NODE_ENV=development` 或
  `NEXT_PUBLIC_VERBOSE_LOGGING=true` 时输出——但后者是 `NEXT_PUBLIC_` 的运维开关，
  把「日志不被伪造」这种性质交给一个可以随手打开的环境变量等于没有它；而且同一份未净化的
  `message` 在生产还会作为 Sentry 事件的标题（`new Error(message)`）。
- 完成内容：`src/lib/logger.ts` 新增 `sanitizeLogText()`，两个出口各过一次（`formatLog()` 的返回值
  覆盖四个 `console.*`；Sentry 标题那一处覆盖「没有 error 实例」的分支）。
  控制字符**转义而非删除**：`\n` `\r` `\t` 保留可见形状，ANSI/NUL/DEL/C1 写 `\uXXXX`——
  注入内容排查时仍然读得到，但它不再是日志的结构。
- 验证命令与结果：`npx vitest run src/lib/logger.test.ts` → 10 passed（原 3 条 + 新 7 条）。
  两处收口分别做过变异核对：抽掉 `formatLog` 那道 → 2 failed / 8 passed；抽掉 Sentry 标题那道 →
  1 failed / 9 passed；两次都从 `/tmp/logger.bak.ts` 还原并 `cmp` 确认字节一致，最后跑一次对照
  （10 passed）确认不是「删多了」。
- 为什么不给它加门禁：`check:codeql` 的口径是**本地可复现的静态契约**（扫描强度、阈值、dismissal
  理由与工作流同源）。告警计数与「每条告警是否有条目」需要 GitHub 安全 API，runbook 里已经明写这条
  本地无法复现——把门禁建在本地取不到的输入上，只会得到一条永远跳过或永远红 checks。
  缺的是「有人按 runbook 走一遍」，这次补上的是那一步，不是一条假门禁。
- 阻塞 / 风险：告警的自动关闭要等合并进 `main` 之后的那次 CodeQL 扫描；在那之前不改告警状态、
  不做 dismissal（runbook 第 4 步）。风险面很小：`sanitizeLogText` 只影响日志文本，
  不改任何控制流；dev 环境下 `JSON.stringify(data, null, 2)` 的缩进会变成 `\n` 转义，
  这是「一次调用一行」这个保证的代价，刻意接受。
- 下一项：合并后复看 `code-scanning/alerts?state=open`，确认 #11–#14 转为 closed（removed）；
  若仍在，说明 CodeQL 没把自定义函数当 sanitizer，那时的正确动作是按 runbook 记录判定并留证据，
  而不是批量 dismiss。

## 2026-09-24 — C09 面量出来是 90 个 await 点、58 个把 error 通道抹掉；先修掉两处「登出失败读成已登出」

- 里程碑 / 版本：v0.12.0；分支 `fix/c09-swallowed-signout`（base `main`，独立于那条 20 长的栈）。
- 状态：DONE（两处修复 + 4 项用例）；量出来的剩余面登记，门禁接不接仍未决定。
- 为什么要量：#92 把 `getUser()` 的语义订正之后，「C09 还剩多少」这个问题在仓库里没有任何读数——
  之前所有关于 C09 的话都是按站点清单说的，不是按 `await` 点数的。
- 怎么量的（脚本在本地 `/tmp/measure-c09.mjs`，未入库）：用门禁同一套判据（TypeScript AST，不用正则），
  把 `src/**`（排除 `*.test.*`）里每个 **await 且调用链上出现过 `.auth`** 的表达式取出来，按「error 通道还剩多少」分类：
  `destructured-with-error`（绑了）/ `DESTRUCTURED-WITHOUT-ERROR`（解构里没有 `error`，信号不可达）/
  `result-discarded`（`await x.signOut().catch(()=>undefined)` 这类整个丢弃）/ `assigned-whole`（绑给了变量，还要看数据流）。
  **量的是整条队列合并后的那棵树 `d9d35bd`，不是 `main`**——分母要的是「41 个 PR 都合完之后代码长什么样」。
  中途一次假读数：先在 `777ac9e`（#114 的 tip）上量的，那条链**不包含 #92**（`git merge-base --is-ancestor 605be71 777ac9e`
  退出码非 0），所以 `site-header` 的登出还显示成 `result-discarded`。栈式分支的 tip 不等于「队列的内容」，这条对任何
  按分支量的度量都成立。
- 量到的数（`d9d35bd`）：**90 个 await 点 / 23 个不同方法**。分类：绑了 `error` 28、`DESTRUCTURED-WITHOUT-ERROR` 55、
  `result-discarded` 3、`assigned-whole` 4。**抹掉通道的 58 个里，`getUser` 占 54**（散在 **31** 个文件，
  其中 12 个是 `src/app/dashboard/**`：
  `actions/team.ts` 5、`actions/mfa.ts` 4、`actions/api-keys.ts` 4、`actions/{projects,notifications,recovery-codes}.ts` /
  `api/user/route.ts` 各 3……），另有 `src/lib/supabase/middleware.ts` 1（**这条已判定为正当**：它读的是浏览器 cookie，
  出错通常就意味着会话无效，跳转是对的）、`hooks/use-user.ts` 1、`permission-gate.tsx` 2（客户端组件，降级即正解）。
  这 54 个的失败形状是同一个：会话读失败被答成「未登录」（`fail("notAuthenticated")`），失败关闭但诊断是假的。
- 这一条修的两个点（都是 `result-discarded`，都不是 `getUser`）：
  1. `src/lib/auth/passkey-session.ts` `consumeMagicLink`：magiclink 已消费、返回 user 与断言者不符时，
     先撤销那条刚建立的本地会话——写的是 `signOut({scope:"local"}).catch(() => undefined)`，
     于是「撤销失败」和「已撤销」在代码里同形：请求方拿到 "bridge failed"，浏览器揣着一条有效会话，日志里什么都没有。
     改成失败经 `logApiError` 留痕（抛出去的那条也接），返回值与失败关闭不变。
  2. `src/lib/actions/account.ts` `deleteAccountAction`：`signOut({scope:"global"})` 的返回值整个丢弃。
     账户已经删掉，回头报 `accountDeleteFailed` 会让人去删一个不存在的账户，所以仍返回 `ok`；
     但文件头上承诺的「清掉本设备会话」没做成时不能读成做成了，改成记一条 `logActionError`。
- 刻意没碰的：同文件 `account.ts:25` 那条 `getUser` 抹通道（判据 `isRetryableSessionReadFailure` 还在 #92 里审，
  本条要独立、不背那条栈的级联）；`src/app/auth/mfa/page.tsx:85` 的 `refreshSession` 丢弃——**#119 正在改这个文件**
  （41 条 PR 的 own-delta 全扫：它唯一命中的就是这里），留到 #119 落地之后。
  那条 `page.tsx` 里还有一句写在错误前提上的注释（「supabase-js 在网络断开或服务端错误时是抛异常而不是返回 error 对象」），
  正是 C09 已经推翻的说法，一并留给 #119 的作者或下一轮。
- 验证：`npx vitest run src/lib/auth/passkey-session.test.ts src/lib/actions/account.test.ts --project node`
  → 2 文件 / **18 用例全绿**（用例数 7+7 → 10+8）；`npx tsc --noEmit` 退出 0（第一版在 `signOut` 的 mock 上被它抓住：
  `vi.fn(async () => ({error: null}))` 把返回类型钉成 `{error: null}`，新用例的 `{error: new Error(...)}` 报
  TS2322——是 `check:all` 里那步 type-check 的又一次立功）；`npx eslint` 4 个文件退出 0。
  **变异核对**：`git checkout HEAD~1 --` 退回两个源文件，重跑 → `3 failed | 15 passed`，红的正是三条「失败要留痕迹」；
  「撤销成功时不记日志」那条保持绿（它本来就该绿，测的是不该记的时候不记）。然后 `git checkout HEAD --` 还原、复跑 18 绿。
- 阻塞：无。门禁那条路（把 auth 也纳入 `check:query-errors`，即 `AUTH_ERROR_CHANNEL` 台账）**仍未决定接不接**，
  现在有了分母才谈得上：58 个点位里 54 个是同一个 `getUser` 形状，台账要么按文件给 sites/reason（和 C08-b 一样两向对账），
  要么先只禁「新增抹通道」而不追认存量。这一步排在 #92 与 #114 落地之后，因为判据模块和门禁本体都还在审。
- 顺手挖出来的一条**本地守卫失明**（与本条的改动无关，但正是在推本条时撞上的）：
  `.git/hooks/pre-push` 是指向 `/private/tmp/merge-sim-42/.husky/pre-push` 的软链——今天 10:19 做整队列模拟时，
  在 worktree 里跑 husky 相关命令把主仓库的安装钩子指到了那个**临时目录**。第一次推送（`1d4bf33`）时目标还在，
  钩子跑了 958 行；我清掉 worktree 之后链接悬空，随后两次推送（`b3ee62b`、本分支的 `4e248c3`）**钩子一行都没跑**，
  退出码 0、推送成功，看起来完全正常。AGENTS.md 把「推送前必跑 lint/type-check/test/build」写成硬性规则，
  而这条规则的本地执行者可静消失。已修：`.git/hooks/pre-push` 改成指向仓库自己的 `.husky/pre-push`（相对链接，
  不再依赖任何临时目录），本条之后的推送会真的过 `pnpm verify:build`。
  补偿性验证：`4e248c3` 上 `CI=true pnpm check:all` 退出 0（38 道门禁 + type-check + lint + test），
  缺的那条 build 由本次（钩子恢复后的）推送补上。
  还缺的那一步没做，记在这里：**没有门禁检查「安装着的钩子是否存在且可执行」**——
  `grep -rl pre-push scripts/ src/lib` 零命中，`check:gates` 数的是 `scripts/check-all.sh` 里的门禁，
  本地钩子不在任何清单里。这与 task #63 修的是同一类问题（承诺的守卫不存在，或存在但不生效），
  接线要动 `package.json` 与 `check-all.sh`（各有 4 条 PR 在改），所以排在这两条落地之后。
- 风险 / 回滚：两个文件与 `main` 逐字节相同、且 41 条 own-delta 全扫无人碰（`src/app/auth/mfa/page.tsx` 除外，已避开），
  所以本 PR 不引入冲突边；回滚 = revert 那一个 commit。
- 下一项：`CHANGELOG.md` 已补一条 Fixed；#118 分支上的整队列模拟在 `main` 前进之后要重跑（本条会让它多一个合并点）。

## 2026-09-24 — Mock/E2E 端点的凭据比较把「没配」读成「空配」：`Authorization: Bearer ` 就能进门

- 里程碑 / 版本：v0.12.0；分支 `fix/e2e-bearer-unset-token`（base `main`，独立于那条 20 长的栈）。
- 状态：DONE。起因不是有人报障，是我在数「27 个 API 路由里谁做了限频」时顺路审到 `src/app/api/e2e/**` 的鉴权形状。
- 量到的形状（**8 个文件、9 处比较**）：全部写成了
  ``const expected = `Bearer ${process.env.E2E_BEARER_TOKEN ?? ""}` ``，其中 **7 处**前面还有一句
  `if (!expected || got !== expected)`。那句**永远不成立**——模板字符串先放进了 `"Bearer "` 前缀，
  `expected` 最短也是 7 个字符的真值。第 8 处（`webhook-events`）连这句都没有。
  净效果：**凭据没配的时候，一个 `Authorization: Bearer `（尾空格 + 空 token）的请求就是合法的**，
  而这些端点能读用户留言（`contact-messages`）、清 Mock 缓存（`mock-reset`）、注入上传失败（`mock-upload`）、
  灌通知种子（`seed-notifications`）、写偏好（`push-queue`）。
- 爆炸半径（这条要先说清，否则会把 low 说成 high）：每条路由都有 `if (!isMockEnabled) return 404` 前置，
  而 `isMockEnabled = NEXT_PUBLIC_MOCK_ENABLED==="true" || (NODE_ENV!=="production" && 没配 Supabase URL)`
  （`src/lib/mock/config.ts`）。所以**生产不会因为漏配而裸奔**；CI 的 Playwright 两个变量都设了
  （`playwright.config.ts:21,38`）。敞开的窗口是「显式开了 Mock、又没配 token」的环境——
  本地开发、手搓的预览、以及**照着模板文档把 Mock 打开的人**。仓库是模板，这一档用户量不小，
  而那恰好是 Mock 模式的常态用法。
- 改法：判据收进一处 `src/lib/testing/e2e-bearer.ts` 的 `e2eBearerAuthorized(header, token?)`，
  规则只有一句——**没配凭据 ⇒ 任何请求都不合法**，空串与未设置是同一件事；比较仍是整串等值，
  不给大小写、前缀、`Basic` 留门。仓库里其实早就有正确形状可抄：`checkCronAuth`（`src/lib/cron-auth.ts`）
  第一行就是 `if (!expectedSecret) return "secret_unconfigured"`，还把三种拒绝原因分开返回。
  `email-inbox` 那处的 `Boolean(process.env.X) && …` 本来就是对的，这次也一并换成集中守卫。
- 顺手挖出来的一件事：**门禁会奖励错误的写法**。`ADMIN_CLIENT_TRUST_EVIDENCE_MISSING`
  （`src/lib/security/admin-client-boundary.ts:826`）要求 `E2E_BEARER_TOKEN` 这个字符串出现在每个清单文件里，
  集中化把它藏掉之后门禁当场红。也就是说这些路由当初内联各自比较，部分是被门禁推着写的。
  现在证据项支持**备选写法**（内联读环境变量 **或** 调用集中守卫，二者皆无仍报缺失），
  两条新用例一边证明可用、一边证明不能白拿；`evidence` 的类型从 `string[]` 放宽成
  `Array<string | readonly string[]>`，第 197 行原来那条纯字符串用例照旧通过。
- 防腐化（不新增门禁、不动 `check-all.sh`）：`e2e-bearer.test.ts` 里一条扫描，
  `src/app/**/route.ts` 再出现内联拼 `Bearer` 头就红；**同文件先断言自己读到的路由文件数 > 8**，
  否则一个走错目录的 walker 能让这条断言永远绿。变异核对就是拿这条做的：
  临时造一条 `src/app/api/e2e/__probe__/route.ts`（内联拼头）→ 用例红且点名该文件；删掉 → 6/6 绿。
- 变更文件：新增 `src/lib/testing/e2e-bearer.ts` + `.test.ts`；改 8 个 `src/app/api/e2e/*/route.ts`
  （净 +17/−20，守卫从 3 行变 1 行）+ `src/lib/security/admin-client-boundary.ts`（类型、5 条清单证据、判定循环）
  + 其测试（2 条新用例）+ `CHANGELOG.md` + 本条台账。
- 与在审 PR 的重叠（42 条 own-delta 全扫，分母打印过）：`src/lib/security/admin-client-boundary.ts` **0 条**；
  8 个 e2e 路由里只有 `push-queue` 被 #112 碰过，而它的改动在第 86-91 与 230-240 行，
  离这里改的 70-75 行很远，实测合得动。
- 验证：`npx tsc --noEmit` exit 0（中途抓到我两处错：新测试文件漏 `import { describe, expect, it } from "vitest"`；
  以及第一版 `evidence` 类型没收窄导致 `source.includes(evidence)` 传数组）；
  `npx vitest run src/lib/testing src/app/api/e2e --project node` → 3 文件 / 29 用例全绿；
  `CI=true pnpm check:all` **exit 0**（`Test Files 200 passed`）。
  读法提醒：那份日志里有 3 行 `❌ a11y 静态审计失败：1 个问题`，那是 a11y 门禁自己的**负控用例**在打印期望输出，
  不是失败——聚合行是 `✅ 全部校验通过`。判断聚合结果要看 `门禁失败：…` 那一行有没有出现，不要看 `❌` 子串。
- 阻塞：无。build 这一腿由恢复后的 `pre-push` 钩子（`pnpm verify:build`）在推送时补上。
- 风险 / 回滚：只影响 Mock/E2E 面，生产路径一行没动；revert 本分支两个 commit 即回滚。
  唯一行为变化：**没配 `E2E_BEARER_TOKEN` 且开了 Mock 的环境，从此调不到这些端点**——那扇门本来就不该开着；
  本地要用的话 `E2E_BEARER_TOKEN=anything` 一行解决，Playwright 已经带着它自己的值。
- 下一项：跑一遍全量 E2E 确认这些 spec 不受影响；顺路审剩下的 19 个 API 路由的鉴权/限频形状（这次数出来的）。

- 更新时间：2026-09-24。

## 2026-09-24 — 27 条 API 路由逐个展开后：收件箱 `GET` 是漏掉的那一层；`account-deletion` 的三条红是 CI 的 `retries=2` 在替它兜底

- 里程碑 / 版本：v0.12.0 安全面收口。分支 `fix/e2e-bearer-unset-token`（PR #135），承接上一条的守卫集中化。
- 状态：已完成，本地全绿，等待合并。
- 触发：上一条写的「下一项」——跑全量 E2E 确认 spec 不受影响，顺路审剩下 19 条路由。
- 全量 E2E（本机，`E2E_BASE_PORT=3120`，`retries=0`）：**109 例 = 106 passed / 3 failed**，
  三条红全在 `e2e/account-deletion.spec.ts`（第 36 / 50 / 68 行），同文件另外两例是过的。
  端口换成 3120 是因为 3100 被另一个项目（`~/Projects/trade-buty`）的 dev server 占着——
  `reuseExistingServer: !CI` 会静默复用别人的服务器，那测出来的是别人。
- 归因（先说结论：不是本分支，且不是产品缺陷，是测试的时序假设）：
  - `git diff --name-only origin/main...HEAD` 14 个文件全在 `src/app/api/e2e/**`、`src/lib/{testing,security}/**` 和两份文档，
    没有一行碰到 `/dashboard/settings` 或 `DeleteAccountSection`。
  - 单独重跑这个 spec（3121）：**2 passed / 3 failed**，同样三条 → 与套件顺序、共享 mock 状态无关。
  - 失败断言的 a11y 快照里 `Danger Zone` 标题、`Delete Account` 按钮都在，只缺第二步的输入框；
    而 `delete-account-section.tsx` 的第二步是 `setConfirming(true)` 的纯客户端状态，不打服务端。
    所以「点不动」＝事件被丢，而不是「服务端拒绝」。
  - 探针（临时 spec，跑完即删）：同一个页面里 `click()` 后立刻 `count()` 得到 **0**，
    隔 1 秒再 `click()` 得到 **1**；中间一次 `press("Enter")` 也得到 1。
    即 hydration 已经完成、handler 是好的，丢的只是 hydration 之前那一次点击。
    这正是 `e2e/keyboard.spec.ts:33` 写下的机制，和 #51 那次给 click-first spec 上 `retry(动作+断言)` 的同一类。
  - 为什么 CI 看不见：`ci.yml` 的 e2e job 是 2 个 shard、每 shard 内部单 worker，`E2E_SERVERS` 没设 →
    `warm-up.ts` 第一行 `if (SERVERS < 2) return;` 直接跳过预热，`/dashboard/settings` 由第一个打到它的用例付冷编译；
    而 `ci.yml` 用默认的 `retries=2`，重跑时路由已编译好，点击就跟上了。
    对照：`e2e-parallel.yml` 既预热（`E2E_SERVERS=3`）又 `--retries=0`，所以那条基线也不该红。
    本机 `retries=0` + 串行 = 复现了 CI 的形状，只是没拿到它那两次重跑。
  - 待办已开：把 `retry(动作+断言)` 补到 `account-deletion.spec.ts` 的三处 click（新分支，别混进 #135）。
  - 【同日晚些订正】上面这条待办是重复劳动，已作废。同一处竞态**早就在 #115（`fix/e2e-hydration-click-race`）
    里修了**：它把这个文件四处点按（含键盘 `Enter` 那一例）统一收成共享的
    `e2e/support/hydrated.ts` → `actUntilVisible(act, result)`，并用 `e2e/hydrated-click.spec.ts`
    把「script 延迟 3 秒时点一次确实会被吞」钉住。我在本地另起分支写了一版同形的 `retry(动作+断言)`
    （`--retries=0` 连跑两次各 5/5 绿），确认重复后整份丢弃、分支已删、**未推送、未建 PR**。
    失误的形状值得留档：我 spot-check 了 #117、#119 两条的 `files`，两条都没有这个文件，就判了「无人认领」——
    可 #117 是栈在 #115 之上的，`account-deletion.spec.ts` 的改动落在**它的 base 里**，
    按 PR 列文件天生看不见。跨栈去重必须按**路径扫全队列**（补扫 43 条：`src/app/api/marketing/**`
    与任何 `*rate-limit*` 文件都 0 命中，下一项因此是干净的）。
    上面那段「CI 为什么看不见」（`ci.yml` 串行 ⇒ `warm-up.ts` 直接 return，再由 `retries=2` 兜住）
    是 #115 的账里没写的读数，留在这里当那条修复的背景。
- 路由普查（27 条 `src/app/api/**/route.ts`，19 条非 e2e）：第一版扫描器只展开一层调用，
  于是把守卫藏在小工具里的路由全读成「没守卫」——`contact-messages` 的 `authorized()`、
  `invitations` 的 `safelyRequirePermission`、两条上传路由的 `guardUploadRequest`
  （它内部才是 `sameOrigin` + `rateLimit.check` + 体积上限）。改成递归展开本地函数 + 按 `@/lib` 白名单补判据后：
  17 条 mutating 路由里，**只有 `marketing/confirm` 与 `marketing/unsubscribe` 的 POST 没有限频**，
  其余各自有 `rateLimit` / cron 密钥 / Stripe 签名 / Mock Bearer。
  这两条的 token 是 48 位十六进制（≈192 bit）、按 sha256 查、长度和有效期都卡，所以「猜 token」不是问题，
  问题是任何人都能不限速地打一次「命中即写库」的公开端点——限频要补，另开一条。
- 这次真正改掉的一处：`email-inbox` 的 `GET` 补 `authOk()`。它是 9 处比较里唯一没要求凭据的一层，
  而它返回的是「已寄出」邮件原文（含确认/退订链接），且 `?failNext=1` 会在一次读取里改写注入标志位——
  按副作用看，它比 `POST`/`DELETE` 更该有凭据，之前只是恰好没人写。
  spec 侧 4 处调用本来就带 `Bearer ${E2E_BEARER}`，所以零改动。
- 验证：`npx tsc --noEmit` exit 0；`npx vitest run src/app/api/e2e src/lib/testing --project node` 3 文件 / 29 用例绿；
  `pnpm test:e2e e2e/mail-flow.spec.ts`（3123，`retries=0`）**3 passed**，说明补上的这层没有把用例挡在门外；
  真实起一台 mock 服务器（3124，`E2E_BEARER_TOKEN=probe-token`）直接打这条 `GET`：无头 **401**、
  `Bearer `（空头）**401**、正确头 **200**，`?failNext=1` 无头也是 401——这条守卫能用，是量出来的不是推的。
  探针服务器跑完已停，3100 上那个别的项目的进程不是我起的、也没被我动。
- 与在审 PR 的重叠：本条只多改 1 个文件（`email-inbox/route.ts` 的 `GET`，+5 行），
  该文件在 42 条 own-delta 里仍然只有 #112 之外的 0 条命中。
- 阻塞：无。
- 风险 / 回滚：开了 Mock 又没配 token 的环境，现在连「读收件箱」也调不到——这正是本分支的判据（没配凭据 ⇒ 任何请求都不合法）。
  `docs/` 里若有抄了裸 `curl` 读 inbox 的片段需要跟着补一个头，本次已全仓搜过 `email-inbox`：只有 spec 与 `email-send.test.ts`
  （它只比 URL 拼装，不发请求）。
- 下一项：(1) ~~把 `retry(动作+断言)` 补到 `account-deletion.spec.ts`~~ —— 已由 #115 覆盖，本条作废（见上面的订正）；
  (2) 给 `marketing/{confirm,unsubscribe}` 的 POST 补限频（正在做；按路径扫过全部 43 条队列，
      `src/app/api/marketing/**` 与任何 `*rate-limit*` 文件都 0 命中）；
  (3) 这次普查量到的形状目前没有任何门禁承载：17 条 mutating 路由里，靠非限频手段挡住的是
      cron 密钥 3 条、Mock Bearer 7 个文件、Stripe 签名 1 条（含 marketing 两条待补即 13 条），
      要不要收成一条带豁免清单（每条写「为什么不需要限频」）的 inventory 规则，等 (2) 落地后再定——
      清单大小约 13 条，远小于 C09 那条 58 点位的账，但同一条「两向对账会把顺手修和台账漂移混成一次红」的成本要先算。
- 更新时间：2026-09-24。

## 2026-09-24 —【同日晚些订正】上面那条「本地全绿」被自己的 pre-push 钩子驳回了：两条全仓扫描用例卡在 5 秒默认预算上

- 里程碑 / 版本：v0.12.0 安全面收口（承接上一条，同一分支 `fix/e2e-bearer-unset-token`，PR #135）。
- 状态：已完成，本地全绿，等待合并。

- 起因：上一条写完就推，钩子（`pnpm verify:build`）在 test 这一腿**挡下**了推送——
  `Test Files 2 failed | 198 passed`，`EXIT=1`，远端还停在 `4c05d3b`。
  红的是 `admin-client-boundary.test.ts > accepts the committed service-role inventory`（9207ms）
  与 `db/query-columns.test.ts > 仓库里每个字面量列名都对得上生成的行类型`，两条都是
  `Error: Test timed out in 5000ms`，不是断言失败。
- 同一棵树、同一个套件，十几分钟前 `CI=true pnpm check:all` 是全绿（200 文件）——
  这就是 flake 的定义，不是我改出来的逻辑错。本分支对这两条的净影响只有：
  我给 `admin-client-boundary.test.ts` 加了 2 条用例，而其中一条也要读全仓。
- 空闲复测（`npx vitest run <两个文件> --project node`）：那两条**单条**分别 4570ms / 4439ms，
  也就是说默认 5 秒预算只剩 10% 余量；套件里还有 2858ms / 3216ms 两条在同一悬崖边上。
  并发跑 jsdom 用例时同一条测到 9207ms ⇒ 任何一次推送都可能随机撞上它。
- 修法：`vitest.config.ts` 的 **node project** 单独 `testTimeout: 20_000`，注释里写清实测数字与判据。
  只放宽 node 的理由是量出来的：`grep -rln readFileSync src --include="*.test.tsx" --include="*.dom.test.ts"`
  **返回空**——jsdom 项目里没有一个用例读盘，它那条 5 秒仍然是「交互回归」的有效信号，不该跟着一起松。
  这也是仓库既有的立场：config 顶部那段注释说得很明白，之前是靠 `maxWorkers: 2` 而不是靠放松断言来消超时。
- 正向对照（证明这个开关真的在管事，而不是我改了个没人读的文件）：临时放一条睡 7 秒的用例进 node 项目，
  `npx vitest run --project node` → `✓ … 7003ms`（默认 5 秒下必然红），跑完删除，`git status` 只剩 config 一处改动。
- 验证：`pnpm test` **EXIT=0**，`Test Files 200 passed`、`Tests 2299 passed (2299)`——就是钩子红掉的那一腿。
- 与在审 PR 的重叠：把 43 条 open PR 的 own-delta（`git diff --name-only <baseRefOid> <headRefOid>`，
  43/43 个 oid 本地都取得到、分母打印过）全扫了一遍，**碰 `vitest.config.ts` 的有 0 条**，
  这一行配置不会和队列里任何一条抢。
- 阻塞：无。风险 / 回滚：一行配置，revert 即回滚；放宽的是超时预算，不是任何断言的判据。

## 2026-09-24 — 两条公开营销 token 端点补上限频：27 条路由普查里最后剩下的「既不限速也不带凭据」

- 里程碑 / 版本：v0.12.0 安全面收口（C10）。分支 `fix/marketing-token-rate-limit`（base `main` = `ad4b029`）。
- 状态：已完成，本地全绿，等待合并。
- 起因：PR #135 那条路由普查量到的读数——17 条 mutating 路由里，把守卫藏在小工具里的那些
  （`authorized()` / `safelyRequirePermission` / `guardUploadRequest`）递归展开之后，
  真正「匿名 + 不限速 + 命中即写库」的只剩 `marketing/{confirm,unsubscribe}` 两条 POST。
- 判据先说清楚，免得把「限频」说成「防枚举」：token 是 48 位十六进制（≈192 bit）、按 sha256 查、
  `updateStatusByToken()` 还卡了长度上下界与 `token_expires_at`，猜中不是现实路径；
  问题是任何人都不花配额就能反复触发一次会写数据库的公开请求。
- 变更：新增 `src/lib/marketing/request.ts`（`marketingTokenRateGuard()` + `clearMarketingTokenBucket()` +
  `MARKETING_TOKEN_RATE_LIMIT = 10 次 / 60s`），两条路由的 POST 各加两行；`GET` 不动（只渲染表单，不写库）。
  两条端点**共用一只桶**——同一个滥用面分开计数等于阈值翻倍。命名与文件位置对齐既有约定：
  阈值取 `src/app/api/auth/passkey/*/route.ts` 那四条匿名入口的 `createRateLimit({ maxRequests: 10, windowMs: 60_000 })`，
  返回体形状取 `invitations` 的 `{ error, retryAfter }` + 429，`Retry-After` 头取 `guardUploadRequest` 的做法。
  桶复位导出的形状与 `src/lib/actions/login-attempts.ts` 的 `clearLoginBuckets()` 一致。
- 测试：`src/app/api/marketing/confirm/route.test.ts` +45 行——`beforeEach` 复位桶（不复位就是一条
  顺序依赖的 flake），三条新用例分别钉住「第 11 次 429 且仓储层没被调到」「两条端点共用一只桶」
  「GET 不吃配额」。
- 变异核对（两条各测一件事，跑完都 `git checkout --` 复原，`git status` 干净）：
  1. 从 `confirm/route.ts` 删掉那句守卫 → 红的是 `× 同一来源打到第 11 次返回 429，并且不再碰数据库`
     和 `× 确认与退订共用一只桶…`（`Tests 2 failed | 11 passed`）——正是这两条该红。
  2. 把 `request.ts` 里的单桶改成按 URL 分桶 → **只有** `× 确认与退订共用一只桶…` 红
     （`Tests 1 failed | 12 passed`），说明这条断言测的是共用性，不是阈值。
- 验证：`npx tsc --noEmit` exit 0；`npx vitest run src/app/api/marketing --project node` → 1 文件 / 13 用例绿；
  `CI=true pnpm check:all` **exit 0**（`Test Files 199 passed`——比 #135 分支少一个文件，
  因为本分支从 `main` 起，那边新增的 `e2e-bearer.test.ts` 还没进 `main`，这个差值本身是对得上账的）。
- 与在审 PR 的重叠：按**路径**扫全部 43 条 open PR（`gh pr list --json number,files --limit 100`，
  一次拉全，不再 spot-check——PR #135 那条台账刚为这件事付过一次重复劳动的学费）：
  `src/app/api/marketing/**` **0 条**、任何 `*rate-limit*` 文件 **0 条**。
  唯一的可预期机械冲突是 `CHANGELOG.md` 与 `docs/progress.md` 的插入区——两侧都是追加，删标记即可。
- 阻塞：无。
- 风险 / 回滚：真实用户点一次确认邮件、一次退订，离 10 次/分钟很远；被限频挡住时返回 429 + `Retry-After`
  而不是静默成功。revert 本分支两个 commit 即回滚，没有数据面改动。
- 下一项：这次普查的承载问题——「17 条 mutating 路由靠什么挡住」目前没有任何门禁记录，
  要不要收成一条带豁免清单（每条写理由）的 inventory 规则，等这条落地后再定（清单约 13 条）。

- 更新时间：2026-09-24。

## 2026-09-24 — 四处 Server Action 的限流一直把所有人当成同一个人

- 里程碑 / 版本：v0.12.0 安全/滥用防护；分支 `fix/limiter-client-identity-in-actions`，base `main` = `ad4b029`。
- 状态：DONE（待合并）。
- 分支 / commit：`fix/limiter-client-identity-in-actions`（本条目）。
- 为什么做：起因是给 C12 找判据——在 `feat/measure-route-rate-limits` 上跑
  `node scripts/check-route-auth.js --rate-limit-report`，读到的分母是「45 个 handler 里 14 个有限流器绑定」。
  但那份台账只覆盖 `app/api/**/route.ts`：**登录、MFA、恢复码这些真正的凭据面不在那 45 个里**，
  它们是 Server Action。于是去数 action 那一侧，结果不是一个盲区统计，而是一个活着缺陷。
- 完成内容：
  1. **量出来的形状**（全库 17 个限流调用点，逐个分类，分母写在这里）：
     13 个传的是真 `request`（8 个路由文件 + `src/lib/uploads/request.ts`），
     **4 个传的是现造的对象**：
     `rateLimit.check(new Request("http://local/{contact,account-delete,redeem,audit}"))`
     ——分别在 `src/lib/actions/{contact,account,recovery-codes,audit}.ts`。
  2. **为什么这是缺陷而不是省事写法**：`createRateLimit().check()` 的键只来自
     `clientIpFromHeaders(request.headers)`（读 `x-real-ip`，其次形如 IP 的 `x-forwarded-for`，
     否则 `"anonymous"`）。凭空 new 出来的 Request 一个 header 都没有 → 键恒为 `"anonymous"` →
     **所有用户挤在同一个 100 次/60 秒的桶里，而且四个 action 共用这一个桶**
     （默认导出是单例）。用真模块跑的探针读数：两个合成请求都解析成 `anonymous`，
     同一个实例上第 **101** 次调用被拒，而换一个带 `x-real-ip` 的请求不受影响。
     后果不是「限得太松」而是**能被打人锁死**：刷联系表单可以顺带把别人的
     恢复码兑换（2FA 兜底路径）和账号删除一起限掉。
  3. **判据不是猜的**：同目录的 `login-attempts.ts` 一直在用
     `clientIpFromHeaders(await headers())` 拿真实 IP——说明 Server Action 里请求头**拿得到**，
     这四处是漏了而不是做不到。也没有任何测试钉过 `anonymous` 这个行为（grep 全测试目录 0 命中），
     所以不存在「这是有意为之」的解释。
  4. **修法**：新增 `checkActionRateLimit()`（`src/lib/rate-limit.ts`），内部
     动态 `await import("next/headers")` 取真实请求头，再交给同一个 `rateLimit` 单例——
     路由侧行为一字未动，action 侧从「全局共用一桶」变成「按客户端分桶」。
     动态导入而不是顶层 import：`recovery-codes.ts` 顶部就写着它被客户端组件引用，
     静态引入 `next/headers` 会进客户端图。不在请求上下文时**退化**为匿名桶而不是抛错：
     这层是滥用防护不是鉴权边界，宁可限得粗也不要让用户的操作失败。
  5. **顺手加了一条守卫**（写在既有 `src/lib/rate-limit.test.ts` 里，不开新测试文件，
     所以 `check:test-matrix` 不需要跟着改）：扫 `src/**` 找「把现造的 Request 交给限流器」这个形状。
     它第一次跑就红了——红在 `rate-limit.ts` 里**我自己写的那句描述旧写法的注释**上，
     于是判据补了「注释不算」，并把这条同时写进阳性对照。
- 验证命令与结果：
  - 定向：`npx vitest run`（rate-limit + 四个 action 的测试）→ **5 files / 46 tests passed**。
  - 四条变异核对（每条跑完 `git checkout --` 复原，末尾 `git status --porcelain` 为 0）：
    ① 让 `checkActionRateLimit()` 不再传 headers → 红在「一个 IP 打满配额不会影响另一个 IP」，
    消息是「另一个客户端不该共享同一个桶: expected false」，**并且**仓库扫描也红（说明守卫是承重的）；
    ② 删掉 `headers()` 的兜底 → 只有「拿不到请求头时退化为匿名桶而不是抛错」红
    （`Error: outside of a request context`）；③ 让扫描器恒返回空 → 红在阳性对照
    （`expected [] to deeply equal ['sample.ts:1']`）；④ 取消「跳过注释」 → 阳性对照与仓库扫描**两条都红**。
  - 四个 action 的测试原本会因换导入符号而全红（13 条），已把 mock 的键从
    `rateLimit: { check }` 改成 `checkActionRateLimit`；它们不断言参数，只断言放行/限流两条分支。
  - 全量：`pnpm verify:build`（lint + type-check + test + build）由 `.husky/pre-push` 跑，
    结果记在下面的推送日志判据里（守卫真跑时日志 ~950 行，悬空时 ~2 行）。
- 变更文件：`src/lib/rate-limit.ts`（+22）、四个 `src/lib/actions/*.ts`（各 2 行）、
  `src/lib/rate-limit.test.ts`（两个 describe + mock 键）、四个 action 测试的 mock 键、`docs/progress.md`。
- 阻塞 / 风险 / 回滚：**与 open PR 的重叠是量过的，不是推测的**——按
  `git diff --name-only origin/main...pr/<n>` 逐条判：`account.ts` 撞 #134，
  `recovery-codes.ts` 与 `audit.ts` 撞 #92/#94/#114 那条 C08 链。
  先看行号：我那几行（`audit.ts:8` 与 `:71`、`recovery-codes.ts:13` 与 `:74`）**就落在**
  它们 hunk 的范围里（例如 #92 在 `recovery-codes.ts` 改 `-69,7`，正好盖住我的 74 行），
  所以我一开始写在台账里的「同一文件不同区域」是错的。改成量两件事：
  ① `git merge-tree --write-tree` 逐个真合（`pr/134`、`pr/92`、`pr/94`、`pr/114`）→
  **四次都 rc=0、零条冲突记录**；② 光合得上不算数，还要证明我没把符号删掉——
  统计各 PR 版本里的 `rateLimit` 引用数与 `main` 完全相等（account 3=3、recovery-codes 3=3、audit 2=2），
  且 #134 那份 `account.ts` 里仍是「import + 一处 check + `rateLimited` 字符串」这三行，
  **没有哪条 PR 新增限流调用点**，所以我换掉导入不会留下悬空符号。
  风险面：合并后每个客户端从「四个 action 共用一个全局桶」变成「一个 IP 共用默认桶
  （100/分钟，与 user/analytics/checkout/invitations/uploads 同一单例）」——
  这与路由侧一直是同一套口径，不是新增的收紧；如果以后要按 action 分预算，那是 C12 的产品判断，不在本条。
  回滚 = revert 本 commit（纯行为回退，无迁移、无数据面）。
- 下一项：合并这条之后，把 C12 的判据从「45 个 route handler 有没有窗口」扩成
  「17 个限流调用点按身份来源分类」——本报告的分母与分类可以直接复用。
- 更新时间：2026-09-24（UTC 13:1x）。

## 2026-09-24 — `isIpLike()` 修形：限流桶键与 `inet` 列不再收任意客户端字符串

- 里程碑 / 版本：v0.12.0 C 域（防滥用 + 数据形状），与 #139 是同一条链上的两件事。
- 状态：READY FOR REVIEW（本机门禁全绿；base 是 main，所以推上去会跑全套必需作业）。
- 分支 / commit：`fix/ip-shape-validation`（基于 `origin/main` = `ad4b029`）。
- 为什么做：#139 让四处 Server Action 第一次真的拿到请求头，于是 `clientIpFromHeaders()` 的
  `x-forwarded-for` 回落分支**第一次成为活跃路径**。它唯一的闸门 `isIpLike()` 是
  `/^[\d.]+$/ || includes(":")`，而文档注释承诺「避免客户端伪造任意字符串或注入畸形值污染限流桶 key」。
- 完成内容：
  1. 差分测量（判据不自己发明，拿 `node:net` 的 `isIP()` 当 oracle，74 例语料、无重复）：旧判据把
     **63/74 判成「像 IP」（oracle 只认 23 例），其中 40 例与 `isIP()` 直接相反**——`":"`、`"foo:"`、
     `"evil:"`、`"999.999.999.999"`、`"1.2.3.4.5"`、七组不合法的 `"1:2:3:4:5:6:7"`、`"1::2::3"`、
     `":1:2:3:4:5:6:7:8"`。
  2. 覆盖分母：main 上 168 个 `*.test.ts` 逐个统计，`isIpLike` / `clientIpFromHeaders` **合计出现 0 次**
     （所以这个形状错着不会变红）。
  3. 重写 `isIpLike()`：IPv4 逐段 0–255、IPv6 含 `::` 压缩与内嵌 IPv4 尾巴，八组/压缩上限各自判。
     新实现与 oracle **只剩 1 例分歧**（`fe80::1%eth0` 判否：代理不会写进转发头，且它进 `inet` 列的形态
     存疑——没去实测 PG 对 zone id 的接受度，所以选择判否而不是依赖它）。不 import `node:net`：
     本模块被 `@/lib/actions/*` 引用，而那些文件被客户端组件 import。
  4. 后果钉成用例：`clientIpFromHeaders()` 畸形 XFF → `"anonymous"`（不再当来源地址）、合法 IPv6 采信、
     多段取最左；`recordCurrentSession()` 在只有畸形 XFF 时 `ip_address` 存 `null`——那一列是 `inet`
     （`supabase/migrations/001_initial_schema.sql:92`），收到 `"evil:"` 会让整条 upsert 报错，
     于是这台设备永远登记不上，而 dashboard 布局的每次心跳各留一条 `databaseError`。
  5. **已知残留，写明不动**：采信的是 `x-forwarded-for` 的最左段，即客户端自己写的那一段；形状修好后
     用一个*合法*假 IP 换桶仍然可行。收紧（改取最右段 / 配置受信代理数）是按部署拓扑定信任模型的决定。
- 验证命令与结果：
  1. `npx vitest run src/lib/rate-limit.test.ts src/lib/actions/sessions.test.ts` → **26 passed**
     （差分用例的语料 74 例，两侧各 ≥15 例，所以「与 oracle 只剩 1 例点名分歧」不是空断言）。
  2. 五道变异，各自红在该红的用例上，跑完文件**逐字节还原**（`restored byte-identical: true`）：
     M1 退回旧判据 → 4 红（差分、畸形形状、桶键退化、`inet` 存 null）；M2 删掉「`::` 最多一次」→ 差分红；
     M3 压缩上限 7→8 组 → 2 红；M4 未压缩 8 组→至少 8 组 → 差分红；M5 `clientIpFromHeaders` 不做形状判定
     → **只有桶键那条红**，`inet` 那条照旧绿——因为 `sessions.ts` 自己还会再判一次，列保护与桶键保护是
     两道独立闸门（这一条是预期的绿，写进变异脚本的 `expectGreen` 而不是靠事后解释）。
  3. **变异查出两处我自己的错**：① 第一版实现里 `if (groups.some((g) => g === "")) return false;` 是死代码
     ——空段在下面的 `else return false` 同样落到拒绝，删掉后 26 条照旧绿（M2 当时"套件全绿"就是它的信号）；
     ② 语料原本没有任何值能钉住「`::` 最多一次」，所以补了 `"1:2:3:4::5:6:7::8"`（`isIP()` 判 0，
     去掉上限后宽度正好凑到 8 组会被判真）。
  4. `pnpm type-check` / `pnpm lint` / `node scripts/check-changelog.js` / 台账门禁；
     推送时 `.husky/pre-push` 跑完整 `verify:build`（lint + type-check + test + build）。
- 阻塞：无（不依赖凭据、不依赖合并）。
- 风险 / 回滚：只收紧形状，没动额度、窗口与桶键算法；若某个代理确实往 `x-real-ip` 里写非 IP 值，
  那个桶会从「任意字符串」变成 `anonymous`（与两个头都缺省时同一个桶）——回滚单位是一个 commit。
- 下一项：等用户拍板「`x-forwarded-for` 的信任模型」（取最左还是最右、要不要显式配置受信代理数）。
- 更新时间：2026-09-24（UTC 13:4x 前后）。

## 2026-09-24 — CSV 字段转义补上裸 CR：一个字段不该在表里变成两行

- 里程碑 / 版本：v0.12.0 工具契约修正（`src/lib/csv.ts` 是模板对外提供的导出工具）。
- 状态：READY FOR REVIEW（本机门禁与变异全过；base 是 main，推上去跑全套必需作业）。
- 分支 / commit：`fix/csv-quote-lone-cr`（基于 `origin/main` = `ad4b029`）。
- 为什么做：`escapeCsvField()` 判 `includes(",") || includes('"') || includes("\n")`，
  而它自己的注释写着「处理包含逗号、引号、换行符的情况」——CR 也是换行符。只含 `\r` 的字段
  原样输出，RFC 4180 与表格软件按 CR 结束一行，于是那一格在打开的表里变成两行。
  发现路径不是猜：`isIpLike()` 那条（#140）之后扫了一遍「形状闸门比注释弱」的同族，
  357 个 src 文件里 43 条守形状声明没有任何测试按名字引用，逐个读到这一条。
- 完成内容：
  1. 判据改为 `/["\r\n,]/`，CR / LF / 引号 / 逗号任一命中就整体加引号。
  2. 三条新用例：`"a\rb"`、`"one\rtwo\rthree"`（多个裸 CR）、`"a\r\nb"`（钉住「两种换行都算」），
     再加一条把两步顺序钉住——先 `'` 防公式注入、再因 CR 加引号：`"\r=cmd"` → `"'\r=cmd"`。
     改之前两条都是红的（`expected 'v\na\rb' to be 'v\n"a\rb"'`）。
  3. **影响面说清楚**：现有两个导出点（管理端审计日志、分析时间线）导出的列是 action /
     entity_type / entity_id / 时间戳，全是代码常量或 uuid；裸 CR 也过不了 HTTP 请求行解析，
     所以本仓库今天没有一个可利用的入口。这条修的是模板工具的契约，不是扑火。
- 验证命令与结果：
  1. `npx vitest run src/lib/csv.test.ts src/lib/csv.dom.test.ts` → **17 passed**（改前 2 failed）。
  2. 四条变异各红在该红的用例上，跑完逐字节还原：去掉 CR → 2 红（两条新用例）；去掉逗号 →
     红在既有「转义包含逗号」；去掉引号判定 → 红在「双引号翻倍」；给注入前缀正则去掉 `^` 锚 →
     红在「普通以字母开头的字段不受影响」。
  3. **一条测试质量观察**：既有 `it.each` 里已经有 `"\r=cmd"` 这个样本，但断言是
     `expect(csv).toContain("'")`，修复前后都绿——带 CR 的样本出现在测试里 ≠ CR 的行为被断言过。
  4. `pnpm type-check` / `pnpm lint` / `node scripts/check-changelog.js` / 台账门禁（含三道对照）。
- 阻塞：无。
- 风险 / 回滚：只在「字段含 CR」这一种输入上多包一层引号，其余输出逐字节不变；
  回滚单位是一个 commit。
- 下一项：同一次扫描还剩 42 条同族声明没被任何测试按名字引用（多为门禁模块的私有 helper，
  经父函数间接覆盖）；已排除 `escapeCsvField` 这一条真阳。
- 更新时间：2026-09-24（UTC 14:3x 前后）。

## 2026-09-25 — main 的文档里有 7 个 commit 指针在任何克隆里都解析不出来，逐个对回落地 commit

- 里程碑 / 版本：v0.12.0 文档治理（living doc 家族的第六处）。
- 状态：DONE（待合并）。分支 `docs/dead-commit-refs`，base = `origin/main`（`ad4b029`）。
- 为什么做：起点是 #131 那条「台账写着一个既不在这台机器、也不在远端的分支名」——同一个形状的问题
  在 commit 指针上更常见，因为**rebase/squash 落地会把 PR 期间写进台账的那个 sha 变成 main 之外的孤对象**。
  量法：把 `origin/main` 上所有 `.md`（152 份）里**反引号包起来的 7–40 位十六进制串**当作
  「作者声称这是一个可解析的 commit 指针」，对每个跑两件事——`git rev-parse --verify <sha>^{commit}`
  与 `git merge-base --is-ancestor <sha> origin/main`。分母与阳性对照印在报告里：
  `md files=152 read=152 tokens=41 reachable=35 suspect=7`，对照是把 `origin/main` 自己的 HEAD
  也塞进待验清单，它必须判可达（`positive control flagged? false`）。
- 结论要说准，不能只说「链接坏了」：这 7 个对象**在 github.com 上仍然能点开**（逐个走 REST
  `GET /repos/…/commits/<sha>`，7/7 返回 200），但**任何分支头都不包含它们**
  （`git branch --contains` 与逐条 `for-each-ref` 都是空），所以在一份只取分支的干净克隆里
  `git show <sha>` 是 unknown revision——而台账里两处写的是
  「回滚 = revert `<sha>`」这种**照做会失败**的指令。为什么服务端还留着这些对象没有取证
  （PR ref、事件缓存都可能解释得通），本条目只记录「分支头不含它 + 服务端仍可解析」这两件量到的事。
- 逐条对账（旧值按下面的约定不加反引号，新值加）：3b7a5df→`bbdd9318`、3d624e5→`8c510c84`、
  30ec139→`67d3e53e`、ea9489f→`46bc2519`、481f357→`b07e9b8b`、60242cb→`56aa4739`、
  9f11337→`aa3b66f0`。配对不是靠「subject 差不多」猜的：每个旧 sha 的 subject 在 `origin/main` 上
  **有且只有一条命中**（`main_matches=1` ×7），且**两侧 tree hash 完全相同**（`tree_equal=true` ×7）
  ——同一份内容在落地前后的两个身份，不是两个改动。
- 完成内容：10 处引用改指向，分布在 4 份文档，**按用途分两种写法**。
  1. 用途是「照着做」或「这是那条达成的证据」（`回滚 = revert X`、v0.11.0 缺口审计表格的达成列）——
     直接换成落地 sha，读者要的是一个能真的 revert、能在历史里找到的对象。
  2. 用途是「当时的 ref 长这样 / 这是分支的第几个 commit」（Actions run 的 ref、`基于 X` 的父提交）——
     旧值**原样保留但不加反引号**，后面补「落地后 `<新 sha>`」。历史一字不改，指针全部可解析。
  由此这份文档有了一条明写的约定：**反引号里的 sha = 可从 `main` 解析的指针；纯文本 = 历史原值**。
  这条约定本身没有门禁守着（见下面的取舍），但它让「还剩下几个坏指针」变成一条命令能复量的量。
- 变更文件：`docs/progress.md`（5 处 + 本条目）、`docs/roadmap-0.12.0.md`（2 处）、
  `docs/roadmap-0.5.0.md`（2 处）、`docs/operations/release-gap-audit-v0.11.0.md`（1 处）、
  `CHANGELOG.md`。
- 验证命令与结果：
  - **先红后绿**：改之前对同一棵树跑扫描 → `md files=152 read=152 tokens=41 reachable=35 suspect=7`
    （就是上面那 7 个）；改之后复跑 → `tokens=42 reachable=43 suspect=0`
    （多出来的那一个 token 是本条目自己引用的 base `ad4b029`，它可从 `main` 解析，所以按约定就该进
    反引号、也该被计入），阳性对照两次都没被误报。
    复扫跑在 `git stash create` 出来的临时 commit 上，HEAD 与工作树都没动，避免为了验证
    先把未提交的改动 commit 掉。
  - 每一处都是**单行替换**：在「只改那 10 处引用、还没写本条目与 CHANGELOG」的那一刻，
    `git diff --stat` = 4 files / 10 insertions(+) / 10 deletions(-)。增删行数相等就是「没有整段重写」
    的证据，这一条是防着自己用脚本重排整份文档（同一次工作里已经写过「脚本整文件重写要先断言行数
    才能信」，而这次真的靠它发现了一次重复追加）。
  - 本条目那 7 个旧 sha 是**故意**写成纯文本的，所以扫描不会再看见它们——不是绕过检测，
    而是它们本来就不该是可解析指针。
- 阻塞：无（不依赖凭据、不依赖合并）。
- 风险 / 回滚：不改任何代码路径，回滚 = revert 本 commit。真正的风险是**这还会长回来**：
  只要 PR 以 rebase/squash 落地，作者在台账里写下的自己分支的 sha 就在合并那一刻变成 main 之外的对象，
  这是结构性的而不是某次疏忽。两条收口方式与它们的代价：
  ① 约定「进 `main` 的文档只引用 PR 编号，落地之后才允许引用 sha」——成本低，但靠人遵守；
  ② 加一道 `check:commit-refs`（规则就是上面那条扫描）——它能红，但红的时点必然在**合并之后**
  （写的人在 PR 上不可能知道自己的落地 sha），于是红话落在合并的人头上，而不是写错的人头上。
  本条选择先把已发现的 10 处修完、把探测器留在台账里，①/②的取舍要人拍板。
- 下一项：把这条扫描并进 #118 的**合并后清单**——整队列合并会一次制造几十个这样的假指针
  （每个 squash 落地的 PR 都是一个），合完必须复跑一次并重新指向。
- 更新时间：2026-09-25 00:2x（本机）——同一时刻是 UTC 2026-09-24 16:2x。所以这一条按本机日历挂在
  09-25 名下，而它在时间上晚于上面所有标着「UTC 09-24 白天」的条目；「台账按哪一侧的日历记」
  这一条本条目不替仓库定，只把两个读数都写下来。

## 2026-09-25 — 三条线索扫到底，三条都是阴性：把分母和探测器的坏法一起记下来

- 里程碑 / 版本：v0.12.0 的测量收口（不改任何行为，价值在于关掉重复挖掘）。
- 状态：DONE，本条目所在的 PR（base `main` 的独立叶子；编号以 PR 头部为准，条目里不写死——
  写完这条再去开 PR 的话，硬编码的编号就是下一处「合并之后才发现写错」的东西）。
- 分支 / commit：`docs/measurement-closures`（基于 `origin/main` `ad4b0299`）。
- 为什么做：#141（CSV 裸 CR）是从「函数名字声称做 A、实际只做 A 的一半、而且测试里从没点过它的名」
  这条线索掉出来的。同一族的其余部分、以及两条相邻的「文档说有的东西代码里没有」族，这轮一次扫完。
  **三条结论全部是阴性**——没有代码改动，但每一条都包含一个「探测器第一版是坏的」的故事，
  那部分才是下次不用重新踩的东西。
- 三条结论：
  1. **「守卫没有任何用例点名」→ 44 条线索，0 条真缺口。** 判据是对 `git ls-files src` 的
     **357 个文件**找带判定形状的声明（`test(` / `includes(` / `>=` / `length <` …），要求这个名字
     不出现在 **199 个 `*.test.ts(x)` + `e2e/*.ts`** 全文里；44 条跨 30 个文件，函数体逐条读完。
     用覆盖率报告交叉验证时**第一版探测器是坏的**：它把一条语句摊到 start..end 的所有行，再用
     「任何一条有命中的语句也摊到这一行」去减，于是外层长语句盖掉了自己首行的内层语句——
     报出 `uncovered=0`。正对照（`push-retry.ts:121` / `appark.ts:67` / `metrics.ts:32` 三条已知
     有 0 命中语句的行）返回「三条都不 uncovered」，当场作废。改成「某行**起始**有 0 命中语句 →
     该行未覆盖」后正对照 3/3 变红，真读数才是：**44 条里 0 条的函数体从未被执行**
     （3 条所在的文件压根不在报告里：`components/layout/site-header.tsx`、`i18n/routing.ts`、
     `lib/mock/mock-docs.ts`，那是「未知」不是「已覆盖」；报告只含 134 个 src 文件）。
     真正有信息量的是 v8 的 `branchMap`（全仓库 `untaken=313 / total=3896` 作为探测器能跑的证据）：
     44 条里 **5 条有从未走过的分支**——`rate-limit.ts` 的 `isIpLike` IPv6 侧（**#140 在做**）、
     `repositories/marketing.ts` 的 `updateStatusByToken` 形状闸门（**已补进 #123**，断言打在
     `createAdminClient` 的调用次数上，两个方向的探针都红）、`ci/workflow-policy.ts` 的
     「触发器同行内联写法」返回路径、`migrations/migration-drift.ts` 缺号 >8 时的截断显示、
     `security/client-write-policies.ts` 的 `dollarTagAt` 兜底。后三条读到底、写法与名字一致、
     失败方向朝闭，**各开一条 PR 不值**，作为已知未覆盖记下。
     顺手两条与「未点名」无关的：`site-header.tsx` 的 `isExternalUrl` 六个入参全来自 `ROUTES.*`
     相对路径，那条外链分支在本仓库永远走不到（死代码，不是缺陷）；`ui/a11y-rules.ts` 的 `hasAlt`
     写作 `/\balt=/`，`data-alt=` 会被误判成「有 alt」，按 `[^"'\s-]alt=|data-alt` 扫全部 `.tsx`
     **当前实例 0 命中**，所以也只是记下。
  2. **「文档里写的 `pnpm <命令>` 其实不存在」→ 1297 次提及，0 个真死命令。** 语料 152 个 `.md`。
     11 次未解析，去掉之后是零：4 次是散文截断（「逐个 `pnpm check:*`」、句子里紧跟 `pnpm audit` 的冒号）、
     1 次是模板占位（`docs/operations/release-audit-template.md` 里的 `pnpm check:x` 讲的就是「任何一条门禁」）、
     1 次是 pnpm 自己的子命令（`pnpm peers`，pnpm 11 的新命令，实跑会打印 peer 依赖告警），
     最后一次最有迷惑性：`agents/06-documentation-writer.md` 让人跑 `pnpm deploy:vercel`，而根
     `package.json` 里没有——**但那个代码块第一行是 `cd docs-site`**，`deploy:vercel` 是
     `docs-site/package.json` 的脚本（`vercel --prod`），`pnpm-workspace.yaml` 里 `.` 与 `docs-site` 两个包。
     判据因此是：**按工作区逐包收脚本名，再判定**；并且对幸存项**真的跑一次**看
     `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL`。
  3. **环境变量双向核对 → 0 个只写不读，也 0 个只读不写。** 正向：357 个非测试 src 文件里
     直接读到的 37 个变量名，逐个能归位——平台注入的（`NODE_ENV` / `NEXT_RUNTIME` / `VERCEL_ENV` /
     `VERCEL_GIT_COMMIT_SHA` 及其 `NEXT_PUBLIC_` 构建期内联版）、测试装置自己塞的
     （`E2E_BEARER_TOKEN` 在 `playwright.config.ts:38`，且 `docs-site/mock.md` 两份与
     `docs/architecture/13-mock-system.md` 都写了），以及走非常规写法读的三个
     （`process.env[APPARK_SAMPLE_RATE_KEY]`、模板串 `NEXT_PUBLIC_FEATURE_${name}`、
     `OSS_VARIABLES.filter(...)`）。反向：`.env.example` 的 37 条在 939 个文件的语料里
     **每条都有消费者**，`SENTRY_AUTH_TOKEN/ORG/PROJECT` 与 `SUPABASE_DB_URL` 不在 src 而在
     sentry 配置、脚本与工作流里。**两条都干净 = 不需要改动，但这是模板产品最该长期干净的地方**，
     下次谁再扫这三族，直接引用本条。
- 为什么不顺手做成门禁：第 2 条最适合（它防的就是文档腐烂），但它要维护一份 pnpm 内建命令清单，
  而这份清单**随 pnpm 版本增长**（`peers` 就是 11 里新加的）；门禁会红在「代理升级」这种与本仓库
  无关的事件上，红在合并之后——正是 #137 / #131 这几轮在修的同一族。真要收，收法应该是
  「从每个工作区包解析脚本名 + 用 `pnpm <cmd>` 的退出码判定，不维护内建清单」，那是一条独立的活。
- 变更文件：本条目（`docs/progress.md`）。
- 验证命令与结果：三个扫描脚本都是只读的（`/private/tmp/scan-untested-guards.mjs`、
  `cov-leads.mjs`、`cov-branches.mjs`、`dump-leads.mjs`，以及内联的 pnpm / env 两遍），
  分母印在各自输出里；`pnpm test:coverage` → exit 0（HEAD `e951b03b`，即 #142 的分支头，
  本报告就是它，所以「已覆盖」的读数以该 commit 为准）；`vitest run src/lib/repositories/marketing.test.ts`
  → 13 passed（#123 的追加用例）；本机 push 前 `pnpm -s lint` / `pnpm -s type-check` / `pnpm -s test` /
  `CI=true pnpm -s check:all` / `pnpm build` 的逐项结果记在本条目的 PR 正文里。
- 阻塞 / 风险：无代码风险（不改行为）。风险只有一个：阴性结论会被读成「查过了所以不用再查」，
  而这三族的判据都依赖**当前的文件清单**——新增一个 `src/lib/**` 守卫、往 `.env.example` 加一行、
  或改一次 pnpm 大版本，读数都会变。所以每条都印了分母，re-scan 的成本是几条命令。
- 下一项：仓库侧没有不依赖用户动作就能推进的活了——生产构建 commit 的证明（B 域）等一次合并，
  C06 / A05 出队语义 / C12 是否升级为判定 / `x-forwarded-for` 信任模型 / `profiles.language`
  与邮件语言等产品口径，都需要拍板。
- 更新时间：2026-09-25（UTC 17:5x 前后）。

## 2026-09-25 — 文档里的路径引用全量核了一遍：6 处指向不存在的文件，最坏的一处是假说明书

- 里程碑 / 版本：v0.12.0 文档治理（D 族）的一次全量核对 + 收口。
- 状态：DONE，本条目所在的 PR（base `main` 的独立叶子；编号以 PR 头部为准）。
- 分支 / commit：`docs/dead-doc-paths`（基于 `origin/main` `ad4b0299`）。
- 为什么做：#143 记了三条阴性线索，同一套「文档说有的东西代码里没有」的判据换到**路径**上不是阴性——
  模板产品里最贵的错误就是读者照着文档打不开文件。扫描是上一条里那版探测器的改型。
- 扫描口径与分母（脚本 `/private/tmp/scan-doc-paths2.mjs`，只读）：152 个 `.md`、**1451 处**
  `src|scripts|docs|docs-site|e2e|supabase|agents|public|app|lib` 开头的路径 token，
  未解析 116 处，分三桶：A「补 `src/` 就存在」62 处、B「散文截断」12 处、C「两边都不是」42 处。
  逐条读 A/C 之后，**真正的缺陷是 7 类**（其中 6 类是路径、1 类是随之暴露的行为描述错误）。
- 完成内容：
  1. **`src/middleware.ts` 在任何地方都不存在**（Next 16 已把 middleware 改名 proxy，真文件 `src/proxy.ts`）。
     写错的地方：`docs-site/auth-flow.md`（英文产品文档）、`docs-site/zh-CN/auth-flow.md` 两处、
     `docs/architecture/04-routing.md` 的代码示例头。**顺着这条还挖出更要紧的**：那两处文档把
     「检测浏览器语言偏好 → 设置语言 Cookie」列为这条链路的第一步，而 `src/proxy.ts` 全文没有
     `locale` / `language` / cookie 相关代码（文件头注释自己写着「中间件不再负责语言检测」），
     locale 实际由 `src/i18n/request.ts` 从 Cookie 读。照文档去 proxy 里找语言逻辑的人会一直找不到。
     修法：文件名与函数名改成 `proxy`，六步流程按代码真实顺序重写（CSP nonce + trace-id → `updateSession`
     → Mock 短路 → 受保护路由 → 认证页重定向 → 放行），并显式写一句「语言不在这里处理」。中英两半同步改。
  2. `agents/01-code-writer.md` 让代理「添加国际化文本 → `src/lib/i18n/messages/`」——该目录不存在，
     真实位置 `messages/en/*.json` 与 `messages/zh-CN/*.json`；补一句「两半必须同时加」，因为
     `check:locales` 的判据写在 `scripts/lib/locales-check.js` 头部：**en 与 zh-CN 的嵌套键集合必须完全一致**
     （只加一侧就是门禁红，不是风格问题）。同文件另有一处 `lib/types/action-result.ts` 少了 `src/`。
  3. `agents/07-dba.md` 把 Service Role 客户端写成 `supabase/admin.ts`，实为 `src/lib/supabase/admin.ts`。
  4. `CONTRIBUTING.md` 让改 `docs-site/index.html`；VitePress 的源文件是 `docs-site/index.md`。
  5. `CLAUDE.md` 的 `lib/types/action-result.ts` → `src/lib/...`。
  6. `docs/architecture/02-tech-stack.md` 的 `app/api/` → `src/app/api/`。
  7. `docs/architecture/03-project-structure.md` 命名表 10 行示例全部省略 `src/`，而**同一份文件**
     上面的目录树写着 `src/app/`——同页自相矛盾。逐行补前缀（10 个目标都 `ls` 过存在）。
     另外 `04-routing.md` 的 `authRoutes` 示例漏了 `"/auth/mfa"`（`src/proxy.ts:22` 里有三项），
     连同下面的那条说明一起补上。
- 刻意没做的两件事（写下来免得下次又手痒）：
  1. `04-routing.md` 那 33 行「路由 → 文件」表整体按 App Router 根写路径（`app/dashboard/page.tsx`），
     文件内部**没有**自相矛盾，属于约定而非错误。重写成 33 行 `src/` 前缀是一次纯风格改动，
     还会与同时在改 roadmap / docs 的 PR 抢更多行；改成在表前加一句约定说明。
  2. `CHANGELOG.md`、`docs/progress.md`、`docs/operations/release-exit-report-v0.6.0.md` 里的
     `lib/auth/guards.ts` 之类简写**原样保留**：那些是 append-only 历史文本，改写等于伪造当时看到的东西
     （A 桶 62 处里落在历史文本 / 有意约定上的正是这类，剩下的 42 处 C 桶也逐条读过：临时探针
     `__gate-probe` / `__storage-probe` 明确写了「验证后已清理」，`004_your_feature.sql` 是占位示例，
     带右括号的 `docs/...md)` 是 markdown 链接语法）。
- 探测器的坑（下次改判据前先看这段）：**A 桶「补 src/ 就存在」不能整桶当缺陷**——它同时装着
  真缺陷（命名表示例）与两种假阳性（约定简写、历史文本）。第一版扫描还把 README 的
  `docs/...md)` 三处当成未解析，因为我只在 token 结尾去掉了 `.` 没去掉 `)`；
  判据是「同一个文件第 152 行连续三个 token 都以 `)` 结尾」这种不成形的读数。
- 变更文件：`docs-site/auth-flow.md`、`docs-site/zh-CN/auth-flow.md`、`docs/architecture/02-tech-stack.md`、
  `docs/architecture/03-project-structure.md`、`docs/architecture/04-routing.md`、`agents/01-code-writer.md`、
  `agents/07-dba.md`、`CONTRIBUTING.md`、`CLAUDE.md`、`CHANGELOG.md`、本条目。
- 验证命令与结果：改完后复跑同一支扫描——**A 桶在活文档里剩下的全部是有意约定（路由表），
  C 桶数量不变（都是占位 / 探针 / 链接语法）**，`src/middleware.ts` 在全仓库 `.md` 里 0 命中
  （`git grep` 复核）；改动的每条目标路径都 `ls` 过存在。全量门禁逐项数字记在本条目所在 PR 的正文里。
- 阻塞 / 风险：零代码行为改动，风险是文档措辞与产品口径不一致（语言 Cookie 那一段）。
  回滚 = revert 本 PR。
- 下一项：同族还可以往「文档里的行号引用」走（`route.ts:29` 这类），那是另一种会腐烂的指针；
  但**它需要一次能定位符号的解析**，不是 existsSync 能判的，先记着不当作本轮。
- 更新时间：2026-09-25（UTC 18:5x 前后）。

## 2026-09-25 — C08 家族里最后一处「没有 PR 认领」的 error 抹除：PermissionGate 读不到角色时落到地板

- 里程碑 / 版本：v0.12.0；C08（把查询结果断言成没有 `error` 通道）的补漏。
- 状态：DONE。分支：`fix/permission-gate-fail-closed`（本条目所在 PR），基线 `origin/main` = `ad4b0299`。
- 起点是一次数口径明确的清点，而不是一条灵感：把 `src/**`（排除测试）里每一处 `.single()` 映射到
  52 条 open PR 的 diff 文件清单上。grep 命中 **32 处 / 22 个文件**，其中 `src/lib/mock/index.ts` 的
  2 处是 mock 客户端自己的 `single()` 实现与一条注释、不是查询点，扣掉是 **30 处 / 21 文件**；
  这 30 处里 7 处所在文件没有任何 open PR 碰过（含 1 处测试替身）。但「无主」不等于「缺陷」——真正的判据是这一次
  查询的 `error` 通道有没有被类型断言抹掉，于是换一个检测器再量：**14 处抹除**，落在 10 个文件；
  除 `permission-gate.tsx` 的 2 处之外，另外 12 处全部有主（#92 / #94 / #98 / #101 / #107）。
  本条改掉那 2 处，改后 12 处、**无主的抹除** 0 处。无主的 `.single()` 查询点还剩 4 处
  （`repositories/profiles.ts` 2、`hooks/use-is-admin.ts` 1、`repositories/notifications.ts` 1，
  另有 1 处在 `repositories/test-helpers.ts` 是测试替身不是应用代码），逐个看过：`profiles.ts`
  两处都是 `const { data, error } = await`、`notifications.ts` 插入后 `if (error) throw`，
  `use-is-admin.ts` 是下面那条失明形态、失败方向本来就是低的。
- 采信这个计数之前先做阳性对照：把 `ad4b0299` 的 `permission-gate.tsx` 覆盖回工作树重跑，
  它准确报出 90、174 两处（正是那两处角色读取），总数从 14 回到 12 的差值等于本 PR 删掉的 2 处；
  随后 `git checkout --` 还原并确认工作树干净。**没有这一步，「改后无主 0 处」这句话毫无价值**——
  一个从不报警的检测器同样会报 0。
- 但这把尺量的是**下界**，两个低估来源都实测过、不是猜的：一是它只认链尾断言，把类型写在回调参数上的
  `.then(({ data }: { … }) => …)` 形态不在它眼里；二是把 `error: null` 写进断言的**更强**抹除，
  在第一版判据里因为「字面上出现了 error」被放过（`src/app/dashboard/page.tsx:59` 就是一例；
  这一子形态 #92 的门禁已经把它当抹除处理）。为覆盖第一个形态改写的那版检测器还给了我一个反例：
  它在**本 PR 修好后的形状**上报假阳性——多行断言里内层 `{ role: string }` 的右花括号提前截断了
  扫描，把已经绑了 `error` 的两处判成抹除（14→15，且正好包含刚改掉的两处）。两版对同一份代码给出
  不同数字时以能过对照的那版为准。所以 **14 / 12 不是普查**，本条的结论只在「无主的链尾断言」
  这个口径下成立——那个口径下的 2 处已清零。
- 那条失明当场补齐量完，不留成口头保证：全仓（排除测试与 mock）`.then(` 出现 8 处，其中把 `data`
  解构出来并就地写类型标注的 **2 处**——`src/hooks/use-is-admin.ts:29`（失败时 `isAdmin` 取 `false`）
  与 `src/app/auth/reset-password/reset-password-form.tsx:56`（读不到 session 就显示「请重新登录」，
  且该文件由 #119 认领）。两处失败方向都已经是低的，**没有第二处本条这种缺陷**，也就不顺手改：
  改 `use-is-admin.ts` 只会把一句已经正确的代码绕一圈。
- 缺陷本身：两处写成 `parseRole(profile?.role) ?? "member"`，且断言里根本没有 `error` 这一项。
  看上去像「未知角色降级为普通成员」，但 `profiles.role` 的取值域**从迁移 002 起**就是
  `super_admin / admin / member / viewer`（001 的 `'user' | 'admin'` 早被 002 drop + add 换掉，
  遗留 `'user'` 行也被 002 `update` 成 `'member'`，默认值同步改掉）。于是 `parseRole()` 返回
  `undefined` 只可能是「查询失败」或「没有 profile 行」，一次 DB 抖动给到 50 档、同组件 `catch` 分支
  给 10 档，两条失败路径答案不同。
- 第一版注释在这里写错过一次，记下来：我当时引的是 001 的域，并据此断言 `'user' → member` 是
  **必需的映射**、还为此加了一个 `'user'` 分支。回头查 002 才发现那个分支不可达——
  留着它等于把同一个过时认知继续写进代码。最终删掉分支、注释改引 002，并顺手改掉三处仍在复述
  001 旧域的文档（`docs/architecture/06-database.md` 的 ER 图与字段表、`docs-site/supabase.md`
  与 `docs-site/zh-CN/supabase.md` 的 profiles 段），外加一处把 `viewer` 写成团队角色的
  `team_members` 段（`TeamRole` 只有 `owner / admin / member`，001 line 144 的 check 同样如此）。
- 一处**没动**的同族陈旧片段：`docs-site/zh-CN/auth-flow.md` 里那段 `create table public.profiles
  … default 'user' check (role in ('user','admin'))` 同样停留在 001，但该文件由 #144 拥有，
  按队列卫生规则不跨 PR 抢改，留给 #144 落地后再补。同文件的 `### teams` 项目符号列表也把
  `viewer` 混在团队角色里，属意图片段而非字段域声明，未改、只登记为线索。
- 测试：`roles.test.ts` 新增 4 条（纯函数四态：error 优先、正常角色透传、无 error 但读不出角色、
  遗留 `'user'`），新建 `permission-gate.test.tsx` 7 条。**该组件此前零测试**——这正是它能带着
  一句站不住的 justified 豁免活到今天的原因，也和 #103（44 条「无测试的守卫」线索）接上。
  组件测试刻意不走纯函数：mock `@/lib/supabase/client` 的查询链，从渲染结果反推档位。
- 变异核对 4 项，全部被抓，且逐个确认红的是**目标用例**：
  1. 删掉 `resolveProfileRole` 的 `error` 分支 → 红 3 条（纯函数 1 + 组件 1 + hook 1）。
  2. 兜底从 `viewer` 改回 `member` → 红 2 条（纯函数「读不出角色」组 + 遗留 `'user'` 那条）。
  3. 只把 `PermissionGate` 调用点退回「不绑 error」→ **只红 `PermissionGate > 查询报错时不放行`**。
  4. 只把 `usePermissions` 调用点退回同样写法 → **只红 `usePermissions > 读不出答案时…同一个地板`**。
  3、4 是分开的两次探针，各自还原；这一步的意义在于：两个调用点各自被钉住，纯函数测得再全也不能
  证明调用点真的读了 `error`。
- 严重性边界（写清楚，免得下次当漏洞处理）：**这不是提权通路**。授权仍由服务端说了算
  （`requireRole` / RLS / Action 守卫），客户端档位只决定 UI 露不露入口。而且今天它连一个页面都
  影响不到：`PermissionGate` 与 `usePermissions` 在 `src/**` 里**没有任何消费方**——grep 全仓
  只命中它自己和这次新建的测试；真正给侧边栏 / 移动端抽屉用的那条路是 `hooks/use-is-admin.ts`
  （2 个消费方，且两个都有测试）。它不删的理由是身份不同：这是模板交付给使用者的公共件，
  `docs-site/components.md` 两语都在册、`docs/architecture/09-frontend-components.md` 也列着它，
  「app 里没人用」在这里不等于死代码。于是这个缺陷的完整成因是三件事叠在一起——
  **有文档、无消费方、无测试**，再配上一条把意图当成事实的 justified 豁免：四层防护各自都以为
  别人在管这件事。
- 与 #92 的耦合（两条 PR 正文都写了）：#92 的 `src/lib/security/query-error-channel.ts` 豁免清单里
  `permission-gate.tsx` 是一条 `sites: 2` 的 **justified**，理由句 `a failed role read resolves to
  the least privileged role on purpose` 描述的是意图、不是代码。本 PR 让那句话变成真的，代价是
  豁免不再需要：**若本 PR 先合，#92 落地时该条要删（sites 2 → 0）**，否则 #92 门禁的反向计数
  会因为一条过期豁免而红。本地不会红——那份清单在 #92 的分支上，main 还没有这个门禁。
- 验证（分两轮，但只推一次）：第一轮 `pnpm lint` exit 0、`pnpm type-check` exit 0、
  `pnpm test` → 200 文件 / 2302 用例全绿、`CI=true pnpm check:all` exit 0「✅ 全部校验通过」
  （37 个门禁）、`pnpm build` exit 0。第一轮之前那次 `pnpm test` 有 2 条红，都是 CHANGELOG
  结构校验：我的条目里有一行以 `#92` 开头，被解析成标题层级——**是门禁抓对了写法**，
  改成 `PR #92` 后转绿。改完文档与台账之后重跑第二轮：`check:all` exit 0、`pnpm test` exit 0
  （200 / 2302 不变）、`pnpm -C docs-site build`（VitePress，本轮动了 `docs-site/**`）exit 0、
  `pnpm build` exit 0。lint 与 type-check 不在第二轮重跑的理由：这两轮只改了 `.md`，
  两者都不读 Markdown——写在这是为了让「全绿」这句话的范围可查。
- 下一项：无主的链尾断言已清零、`.then` 形态已扫完，C08 剩余 12 处全部有主（#92 / #94 / #98 /
  #101 / #107），等它们的 PR 落地；把它们对上号正是 #92 那份豁免清单要做的事。
- 这条线索顺出来一个可量的口径，当场量完：`src/components/shared/` 15 个件里，**0 消费方**的只有
  两个——`permission-gate`（本条刚补上测试）与 `section`；后者是现在唯一「既没人用也没测试」的一个。
  整个目录无测试的是 5 个：`section`、`github-icon`、`upload-progress`、`breadcrumbs`、`page-header`。
  和 #103 那 44 条「无测试的守卫」是同一片地：**模板交付件不会因为 app 里没人用就变安全**，
  它的使用者会直接用。下一件从 `section` 起不如从 `upload-progress` 起——它 2 个消费方、
  带进度状态机，出错方向比一个 `<section>` 壳子要紧。
- 风险 / 回滚：回滚只需还原本 PR 两个源文件；不改任何服务端判定，最坏影响是数据库故障期间
  客户端 UI 少露出一些入口（这正是想要的行为）。
- 合并时 pre-push 钩子拦下的一条，是这道门禁第一次在真实合并上抓到过期台账：本条把两处
  `const { data: profile }` 改成绑定 `error` 并交给 `resolveProfileRole({ error, role })`，
  于是 `src/components/shared/permission-gate.tsx` 实扫 0 处，而台账里那条 `justified` 还写着
  `sites: 2` → `QUERY_ERROR_CHANNEL_EXEMPT_STALE`。按门禁自己的判词「清理后请删掉这条条目」处理：
  删条目、更新解释它的两段注释（`query-error-channel.ts` 的表头与 `docs/testing.md` 的门禁说明），
  并把单测里当 fixture 用的文件名换成台账里仍剩 2 处额度的 `src/app/dashboard/team/page.tsx`
  （那个 fixture 依赖真实台账，删掉条目后它会连同 STALE 一起红）。
  行为没变——`resolveProfileRole` 在 `error` 非空时返回 `viewer`，与原先的 `?? "member"` 一样落到地板；
  变的是这个结局现在从 error 通道导出，不再与「读到了」同形。`justified` 这一类条目因此清零。
- 更新时间：2026-09-25。

## 2026-09-25 — 客户端两处「会话快照盖掉实时答案」：回调页双花一次性 code，`useUser` 把刚退出的人写回来

- 里程碑 / 版本：v0.12.0；不在 roadmap 条目里，是 C09 那条线往外扫时带出来的一族。
- 状态：DONE。分支：`fix/auth-callback-once`（本条目所在 PR），基于 `origin/main` = `ad4b0299`。
- 这一族怎么扫出来的：`src/**` 里 **19** 个文件提到 `useEffect`，其中 **7** 个既 `await` 又 `set*`，
  **3** 个带了取消旗子、**4** 个没有。而**这 4 个里 2 个是检测器的假阳性**——
  `reset-password-form.tsx` 的旗子叫 `mounted`、`push-notification-form.tsx` 的叫 `active`，
  我的正则只认 `isMounted` / `alive` 那几种写法。记下来是因为这类判据下次还会用到：
  旗子叫什么不重要，认出来才算。真正没人管的就是本条目的两处。
- 回调页（`src/app/auth/callback/page.tsx`）的实测读数：`next.config.ts:26` 是 `reactStrictMode: true`，
  开发期 effect 跑两遍，而这一页花的是**一次性**凭据。按「第二次交换必返回 `invalid_grant`」的
  真实 PKCE 语义打桩：包 `StrictMode` 时 `exchangeCodeForSession` 调 **2** 次、状态文本停在
  `callback.failed authOtpExpired`；不包时 **1** 次、`callback.success`。两行都在同一个用例文件里跑出来，
  所以翻倍只能来自双跑。而 `router.push("/dashboard")` 两种情形下**都发出去了**——用户其实登录成功了，
  页面念的是失败。第二个读数：失败分支那个「2 秒后回登录页」的定时器没人记账，
  `unmount()` 之后把时钟推过 2 秒，`router.push("/auth/login")` 照样触发。
- **方法上记一笔，这是个会重犯的坑**：第一版探针把 `useRouter()` mock 成每次返回**新对象**，
  于是 `router` 这个 dep 每渲染都变，effect 被 mock 自己逼着重跑，量到的是 **3** 次而不是 2 次——
  多出来的那次是我造的。真实 `next/navigation` 的 router 与 searchParams 都取自 context、
  跨渲染同一身份，mock 必须照做；换成 stable 之后 2/1 这组对照才成立。
  凡是被测对象的**身份稳定性**参与被测行为的，mock 就得先还它稳定。
- 两处改动的取舍：
  1. 回调页按**凭据**去重而不是按挂载次数（换一枚不同的 code 仍要去换，这条有用例钉着）。
     刻意**没有**用「cleanup 里置 `cancelled`、回来先看旗子」那个常见写法——StrictMode 下第一遍的清理
     先跑、第二遍又被去重挡掉，两边都不落地，等于把唯一一次真交换判死。定时器句柄进 ref，
     被去重挡掉的那一遍也返回**同一个**清理函数，否则第一遍排下的那个定时器就没人负责。
  2. `useUser()` 的快照与推送两路写同一个 state，改成快照只在没见过推送时才写。
     这里**没有**加卸载旗子：那件事从组件外部观测不到，为它写用例只会得到一条永远绿的断言；
     而 StrictMode 双跑的两次都是同一个纯读、回的是同一个用户，不产生可见差异。
- 验证：`src/app/auth/callback/page.test.tsx` 新增 6 条、`src/hooks/use-user.test.tsx` 新增 4 条
  （后者是 `src/hooks/` 的第一份直接单测）。先红后绿：改动前回调页 3 红 2 绿（那 2 条是正向对照）、
  `useUser` 1 红 3 绿。变异核对 **8** 项各自抓红——回调页 P1 抓 3 条、P2（去重改成按挂载）只抓
  「换 code」那 1 条、P3（定时器不记账）与 P4（清理里不 `clearTimeout`）各抓卸载那 1 条、
  P5（删掉跳登录页）抓正向对照那 1 条；`useUser` U1（删闸门）与 U2（回调里不置旗子）各抓 1 条、
  U3（闸门反过来）抓 3 条，其中含两条正向对照，所以这个方向不是靠巧合绿的。
  每次跑完 `git checkout --` 还原，并校验与动手前字节一致。
- 门禁数字（本机）：`pnpm lint`、`pnpm type-check`、`pnpm build` 均 exit 0；`pnpm test`
  **201 文件 / 2301 用例** exit 0；`CI=true pnpm check:all` **37 个门禁步骤**全过。
- 队列影响：新增第 **54** 条 open PR，落在 #118 附十三那张表的第 54 步。与在途 53 条的文件重叠
  **只**发生在 `CHANGELOG.md` / `docs/progress.md` 的追加约定上——`src/app/auth/callback/**`、
  `src/hooks/use-user.ts`、`src/hooks/use-user.test.tsx` 此前 **0** 条 PR 碰过
  （`gh pr list --state open --json number,files` 53/53 都取到非空清单，所以这是个读数不是扫漏）。
- 同一族里剩下的那一处：`dashboard/layout.tsx` 之外还有 **8** 个 dashboard 页面在 `user` 为空时
  不分支、直接 `user!.id` 抛进错误边界（fail-closed，是 UX 不是权限洞）。**8/8 文件都被在途 PR 占有**，
  按队列卫生只登记不改，读数与判据写在 #118 附十七。
- 下一项：这一批合完之后按附十七那张表逐文件补页面判空；`src/hooks/` 另外四个 hook
  从这条起有可复制的测试形状（`use-unread-notifications` 最值得先钉——它的轮询开关是
  `enabled: Boolean(user)`，本条目修的就是那个 `user` 会被旧快照复活这件事）。
- 更新时间：2026-09-25（本机 UTC 09-24 20:20 前后）。

## 2026-09-25 — 发布证据那格 `commit=unknown` 拆成两种读数：旧构建与没拿到 git 变量不是一件事

- 里程碑 / 版本：v0.12.0 的 B 域（发布证据链）；闭合的是「生产是不是旧构建」这个问题能不能由工具自己回答。
- 状态：DONE。分支：`fix/smoke-commit-three-state`（本条目所在 PR），基于 `origin/main` = `ad4b0299`。
- 怎么撞上的：不是计划里的改造。在给 #146 取证时直读了一次真生产 `/api/health` 的**键集合**
  （`status,timestamp,uptime,uptimeFormatted,version,environment,mockMode,checks,allConfigured,ready,degraded`）
  ——里面**没有 `commit`**。而 `main` 上那个 handler 是无条件带它的（`?? null`），所以这不是「值为空」，
  是「那份构建还不认识这个字段」。旧的一行摘要把这两种情况印成同一条 `unknown`，
  于是这个结论当时只能靠人再跑一遍部署记录才敢立：
  `gh api repos/<owner>/<repo>/deployments?per_page=100` 取 `environment == "Production – indie-stack"`
  （`per_page` 不能小——那 100 条里 62 条是 docs-site 的预览，`per_page=12` 一条生产记录都捞不到，
  看起来像「从未部署过生产」）。复测结果：生产最近一条仍是 `a322a4e`（`6587025748`，09-22T08:56:51Z），
  与「早于 `96fb4fa3`」互相印证。
- 改动：`commitLabel()` 从「收那一个值」改成**收整个 health body**，于是能问键在不在，三种读法分开
  （`not-reported` / `no-build-env` / 短 SHA）；health 那条检查与证据文件顶层各多存一格 `commitReported`；
  摘要行改用 `describeEvidenceCommit(evidence)`。**默认方向选过一遍**：读缺 `commitReported` 这一格的
  旧产物时按 `not-reported` 处理，因为 `no-build-env` 是在指控一个具体的平台配置原因，
  证据不足时不该替人下那个结论。
- 覆盖边界要说准：`main()` 会真发 HTTP 请求，单测里跑不了，所以摘要行那条**接线**是用源码契约钉的
  （`toMatch(/describeEvidenceCommit\(/)` + 不许再出现 `?? "unknown"`），行为侧才是 12 条用例。
  这个仓库已有同类先例（`src/lib/deployment/production-smoke-contract.test.ts` 钉的是 workflow YAML 文本），
  所以这条不算新开路子，但也不假装它钉住了输出行为。
- 验证：直跑真生产（只 GET）从
  `6/6 passed, expected version 0.11.0, deployed commit unknown` 变成
  `6/6 passed, expected version 0.11.0, deployed commit not-reported`，
  证据 JSON 里 `{"commit":null,"commitReported":false}`——与手工翻部署记录的结论一致，只是不再需要手工。
  用例 `src/lib/production-smoke.test.ts` 7 → 8、`src/lib/production-version-drift.test.ts` 3 → 4。
  变异核对 5 项各自抓红（label 退回两态 2 条、`commitReported` 不看键在不在 2 条、摘要读法忽略那一格 1 条、
  顶层不再存那一格 2 条、摘要行退回自写默认值 1 条），每步 `git checkout --` 还原并校验字节一致。
- 门禁数字（本机）：`CI=true pnpm check:all` → **exit 0，37 步**，`pnpm test` **199 文件 / 2293 用例**；
  `pnpm build` exit 0。**日志读法记一笔**：那份 check:all 日志里有三行
  `❌ a11y 静态审计失败：1 个问题`，它们不是门禁红，是**用例自己在审计器上注入缺陷**时打出来的
  （`src/lib/a11y*.test.ts`），整步仍是绿的——与 E2E 日志里那些故意注入的 `Error:` 同一族，
  按行 grep `❌` 会把这套件读成满屏故障。
- 不动的两处文档（量过归属）：`docs/operations/release-runbook-v0.11.0.md` 由 #118 占有，
  `agents/10-release-manager.md` 由 #125 占有；而且前者开头明写「本文件不复述以免两处漂移」，
  所以三种读法写在 `docs/operations/production-smoke-v0.11.0.md`（free）与代码注释里。
- 队列影响：新增第 **55** 条 open PR，仍是升序表的最后一步。`scripts/production-smoke.js`、
  `scripts/check-production-version.js`、`src/lib/production-smoke.test.ts`、
  `src/lib/production-version-drift.test.ts`、`docs/operations/production-smoke-v0.11.0.md`
  **逐个量过是 0 条在途 PR 碰**，重叠只在 `CHANGELOG.md` / `docs/progress.md` 那两处追加。
- 下一项：「生产上报自己的 commit」这条待办（跟踪清单里的 task #28，属 roadmap 的 B 域）现在
  **只差一次合并**——工具已经能报出
  `not-reported`，合并落地、生产真的构建了 `main` 之后，那一格应变成短 SHA；
  如果它变成 `no-build-env`，要查的是 Vercel 项目里 *Enable access to System Environment Variables*
  而不是代码。这一条判据本身就写在这次的注释与文档里了。
- 更新时间：2026-09-25（本机 UTC 09-24 21:1x 前后）。

## 2026-09-25 — 按文档跑一次发布 smoke，仓库里就多一份没被忽略的证据 JSON

- 里程碑 / 版本：v0.12.0 的 B 域收尾卫生；不动任何探测逻辑。
- 状态：DONE。分支：`fix/smoke-commit-three-state`（本条目所在 PR，与上一条同一条 PR），基于 `origin/main` = `ad4b0299`。
- 怎么撞上的：给上一条复测时直跑
  `node scripts/check-production-version.js --base-url https://indie-stack-theta.vercel.app`，
  跑完 `git status --porcelain` 里多出一条 `?? production-smoke.json`——这条命令的 `--output`
  默认值就是仓库根下的那个文件名（`DEFAULT_OUTPUT`）。不止它：`.github/RELEASE_CHECKLIST.md`
  让发布负责人照抄的那条 `pnpm smoke:production -- … --output production-smoke.json`、
  `production-smoke.yml` 两个作业的 `path:`，以及 6 份 `docs/operations/production-smoke-v*.md`
  里的 5 份，写的都是同一个仓库根路径。也就是说**每按文档做一次发布前 smoke，工作区就留一份
  没被忽略的探测结果**，谁顺手 `git add -A` 就把它提交进仓库。
- 后果说准，不夸大：这不是漏洞也不是数据丢失。要防的是把一次瞬时探测固化成仓库事实——
  证据的正确存法本来就有两条，CI 侧是保留 30 天的 artifact（`production-smoke-evidence` /
  `production-version-drift-evidence`），人读的那份是 `docs/operations/production-smoke-v<版本>.md`
  里手写的读数与时间戳。仓库根那个 JSON 是这两条的中间产物。
- 动手前先量「会不会挡掉本该提交的东西」：`git log --all --oneline -- production-smoke.json` 空，
  `git ls-files | grep -c production-smoke.json` = **0**，即这个路径在整个仓库历史里从来没被跟踪过；
  唯一带它的那类引用（v0.11.0 矩阵里的「证据 JSON：本地 `production-smoke.json`」）明写是本地文件。
  所以忽略它不丢证据，只是把工作区恢复成干净。
- 改动只有一行加一节标题：`.gitignore` 在 Vercel 与 Testing 之间新增 `# Release smoke evidence`。
  副作用逐个查过：`actions/upload-artifact` 用的是自己的 glob、不读 `.gitignore`，CI 那两个作业的
  `path: production-smoke.json` 不受影响；`pnpm check:production-smoke` 断言的是 workflow YAML 文本，
  也不读这份文件；全仓 `git grep -l gitignore` 在 `src/**`、`scripts/**`、`tests/**` 命中 **0 条**，
  即没有任何用例对 `.gitignore` 有断言，改它不会碰坏谁的绿灯。
- 验证是同一条命令跑前后各一遍。改前：exit 0，`git status --porcelain` 出 `?? production-smoke.json`。
  改后：exit 0、6/6 通过，`git status --porcelain` 只剩 ` M .gitignore`，
  `git check-ignore -v production-smoke.json` 回指到 `.gitignore` 里新加的那条规则（命中即生效，
  不靠「status 里没出现」这种反向读法）。跑完把本地那份产物删掉了——它是这次探测的中间物，
  真证据在上一条里已经落进文档。
- 顺带量到、本条不修：生产这次仍报 `commit=not-reported`，即那个构建根本不认识 `commit` 字段，
  与上一条拆出来的三种读法一致。task #28（「生产上报自己的 commit」）仍差一次合并才闭环。
- 队列影响：`.gitignore` 逐条扫过全部 57 条在途 PR 的 diff（`git diff --name-only origin/main...pr/<n>`，
  92–149 去掉不存在的 #132），**0 条碰它**，所以这一行不与任何在途 PR 冲突，落 #147 不需要重排合并顺序。
- 更新时间：2026-09-25（本机 UTC 09-25 00:3x 前后）。

## 2026-09-25 — Mock 替身缺 `remove()`：上传失败的回滚在 mock 模式下一次都没做成过

- 里程碑 / 版本：v0.12.0；不在 roadmap 条目里，是「替身与被替身的表面漂移」这一族的新实例。
- 状态：DONE，已开 PR #148（base `main`，分支 `fix/mock-storage-remove`）。
- 起因（不是推测，是日志）：跑 `e2e/uploads.spec.ts` 的注入失败用例时，worker 服务端日志里有一条
  `[ERROR] storage object cleanup failed { operation: "avatar-upload-rollback", resourceId: "mock-user-001", key: "avatars/mock-user-001/…png" }`
  后面跟 `TypeError: createAdminClient(...).storage.from(...).remove is not a function`。
  调用点在 `src/lib/storage/index.ts:100`，替身在 `src/lib/mock/index.ts` 的 `storage.from()`——那里只有
  `upload` 与 `getPublicUrl`。`cleanupStorageObject` 把失败 catch 成日志并返回 `false`（设计上刻意非阻塞），
  所以用户看到的还是「上传失败」那条正确消息，E2E 五条用例全绿：**坏掉的只有孤儿对象清理，而且只坏在 mock 模式**。
- 为什么门禁没抓到：`src/lib/storage/index.test.ts` 那份手搓替身**自带 `remove`**（26 条用例覆盖驱动的
  `put/publicUrl/signedUrl/remove` 与 provider 选择），驱动侧一直是真的在被替身满足；而 mock 客户端这边
  从来没有一条用例问过「驱动会调的方法你都有吗」。仓库里已有 C07（列名 vs 生成类型）、C11（路由 vs 鉴权清单）
  两个「两个真相源对账」门禁，替身表面是同一族的第三个位置。
- 完成内容：
  1. `src/lib/mock/index.ts` 的 `storage.from()` 补 `remove(paths)`，返回 supabase-js 的形状
     `{ data: [{ path, bucket_id, id }], error: null }`；**刻意不消费 `UploadFailNext`**——回滚是「把没写成的那个对象删掉」，
     不是一次新的上传，让它计入就会把「注入 N 次失败」那批用例的语义改掉（这条决定下面有用例钉住，且它自己差点钉不住）。
  2. 新增 `src/lib/storage/mock-parity.test.ts` 4 条：表面存在（逐个问方法名，缺哪个点名哪个）、返回形状、
     回滚不消费注入预算、驱动侧 `getStorageDriver().remove()` 真的走到同一个客户端。
  3. 三处文档把注入打错方法名说了：`docs/architecture/13-mock-system.md`、`docs-site/mock.md`、
     `docs-site/zh-CN/mock.md` 都写「`failNext` 让 `storage.put()` 失败」，而真正返回注入错误的是
     `storage.from(bucket).upload()`；`put` 是**驱动对象自己**的方法名（编译栈帧里就是 `Object.put`，推测这个说法
     从那里来），OSS 驱动的 `store.put()`（`src/lib/storage/index.ts:120`）压根不读那个计数器。
- 方法上值得记住的一条（第一版用例是**测不出来的**）：注入独立性那条原本写 `setMockUploadFailNext(1)` 再
  `upload` → 预算被上传自己吃光，`remove` 时读到的本来就是 0——把 `remove` 改成「也扣一次」之后**四条全绿**，
  变异活了下来。改成 `setMockUploadFailNext(2)`、断言回滚后预算仍是 `1`，同一个变异才恰好红 1 条。
  教训：**断言「A 不消耗共享计数器」时，必须在 A 执行前还剩着预算**，否则这条断言恒真。
- 变更文件：`src/lib/mock/index.ts`、`src/lib/storage/mock-parity.test.ts`（新增）、
  `docs/architecture/13-mock-system.md`、`docs-site/mock.md`、`docs-site/zh-CN/mock.md`、`CHANGELOG.md`、本条目。
- 验证命令与结果：
  - `npx vitest run src/lib/storage/mock-parity.test.ts src/lib/storage/index.test.ts` → 30 通过（新增 4 条）。
  - 变异核对 3 项，每项都先确认改动落地再跑，`git checkout --` 还原并校验逐字节一致：
    删掉整个 `remove` → **4 条全红**（表面缺失点名 `['remove']`、形状/独立性 `client.remove is not a function`、
    驱动侧 promise rejected）；返回形状改成 `{data:null,error:null}` → **恰好红形状那条**（另外三条仍绿，
    说明三条各判各的事，不是重复覆盖）；`remove` 改成消费 `UploadFailNext` → 第一版 **0 红（幸存者）**，
    加固后恰好红独立性那条；未变异的正向对照 4 绿。
  - `CI=true pnpm check:all` → **exit 0**，37 步、`200 文件 / 2295 用例`（`main` 上是 199 文件 / 2291 用例，
    即本条 +1 文件 / +4 用例）。
  - `pnpm build` → exit 0。
  - **真环境复验**：`npx playwright test e2e/uploads.spec.ts` → 5 passed（22.6s），同一份
    `.next-e2e-0/dev/logs/next-development.log` 里那行从修前的 `[ERROR] storage object cleanup failed … TypeError`
    变成修后的 `[INFO] storage object cleaned`（`operation: "avatar-upload-rollback"`）。这条 INFO 只在
    `driver.remove()` 不抛时才打，所以「0 个 ERROR」不是空读数——同一份日志里仍然有 1 条
    `avatar upload failed`（那是被注入的失败，本来就该有）。
- 归属检查（动手前量的，55 条 open PR、`--json files` 全部非空）：`src/lib/mock/index.ts`、
  `src/lib/storage/*`、`e2e/uploads.spec.ts` 与上述三份文档**全部 FREE**；
  `src/app/api/e2e/mock-upload/route.ts` 属于 **#135**，所以它头部那句同样写错的 `storage.put()` 注释
  **本条没动**——留给 #135 的作者或合并时顺手改，不跨 PR 抢文件。
- 阻塞 / 风险 / 回滚：不改生产路径（生产走真 supabase-js，那里 `remove` 一直存在），mock 行为只多不少；
  唯一潜在影响是若将来有 E2E 用例想让**回滚**失败，需要新开关而不是复用 `UploadFailNext`。
  回滚 = revert 本 PR 的两个 commit。
- 下一项：本条只补了 storage 一族；Mock 客户端其余表面（`from()` 的链式方法、`auth.*`）与被替身调用点的
  对账还没有测——按 C11 的做法可以做成门禁（「驱动/调用方真的调到的方法，替身必须有」），但要先量命中面，
  命中为 0 就不值得开门禁，只留这条对账用例。
- 更新时间：2026-09-25（UTC 21:25 前后）。

## 2026-09-25 — Mock 查询链缺 `gt()`：营销确认/退订在 mock 模式下点了就是 500，并把这类「替身表面漂移」做成对账

- 里程碑 / 版本：v0.12.0；与同日 `storage.remove` 那条同族（「替身绿」不等于「替身像」），是第二实例。
- 状态：DONE，已开 PR #149（base `main`，分支 `fix/mock-query-gt`）。
- 起因（代码路径读完 + 链上实测，不是推测）：`src/lib/repositories/marketing.ts:89` 的 token 过期闸门用
  `.gt("token_expires_at", now)`，而 `MockQueryBuilder` 只有 `eq / in / gte / lt / lte / contains / not / or / is /
  order / range / limit / select / insert / update / delete / upsert / single / maybeSingle`——**没有 `gt`**。
  `.gt(...)` 是同步抛 `TypeError`，穿过 `updateStatusByToken` → `confirmSubscription`，被
  `src/app/api/marketing/confirm/route.ts:30` 的 catch 收成 **HTTP 500**；`unsubscribe` 同形状。
  所以 mock 模式（E2E、`pnpm dev:mock`）里点邮件里的确认/退订链接必然报错。E2E 为什么没抓到：
  `e2e/mail-flow.spec.ts:84` 只断言「邮件 HTML 里含 `/api/marketing/confirm?token=`」，从没 POST 过那条链接。
- 三层盲区（同一件事的三个侧面，逐条量过）：
  1. 仓储层单测 `marketing.test.ts` 用的是 `src/lib/repositories/test-helpers.ts:18` 的手搓 `chainMock`，
     **那份清单里写着 `gt` 与 `neq`** —— 替身比真替身更宽容，于是永远绿。
  2. 双语 mock 文档 `docs-site/{mock,zh-CN/mock}.md` 声明支持 `eq() / neq() / in() / is()`，
     而 **`neq()` 从来没实现**（链上一调用就是同一个 TypeError）。这是「假说明书」，不是笔误：
     读文档的人会以为 mock 覆盖整个 PostgREST 过滤词汇。
  3. 没有任何东西把「调用点真的链到的方法」与「替身有的方法」放在一起比过。
- 完成内容：
  1. `MockQueryBuilder.gt()` 补齐，且**读写两条路径都落**：`matchesFilters`（服务 `update`/`delete`）与
     `applyFiltersAndPagination`（服务 `select`）在 mock 里是两处独立实现，只补一边就是留一个下次会踩的洞。
     排序算子的判定抽成模块级 `orderedFilterSuffix()` + `passesOrdered()`：边界语义只写一次。
     这层抽取同时是**合规要求**——直接在 `matchesFilters` 里加 `:gt` 分支会让 ESLint 红在
     `complexity 34 > 30`，而本仓库对这条规则不用 `eslint-disable` 豁免（全仓库仅 1 处 disable，是
     `@next/next/no-img-element`），所以要重构而不是关掉。
  2. 新增 `src/lib/mock/mock-query-gt.test.ts`（4 条）：写路径严格大于、`gte` 正向对照（边界那条要收进来，
     证明两个算子不是一回事）、读路径同语义、以及仓储那条链的形状（`eq` + `gt` 同时生效，含一条不匹配的对照）。
  3. 新增 `src/lib/mock/mock-query-surface.test.ts`（3 条）：用 TypeScript AST 从 `src/**`（排除 mock 自身与
     `*.test.*`、`test-helpers.ts`）现取「挂在查询构建器上的方法名」，逐个问 Mock 的构建器实例
     （`createMockSupabaseClient().from("profiles")`）可不可调用。**不手写清单**——那份清单自己就是会腐烂的第二次实现。
     三条用例分工：① 扫描有效性（正向：文件数 > 200、链上命中 > 200、`eq`/`select` 必须在场；
     反向：`map`/`join`/`find`/`subarray`/`bind`/`channel`/`subscribe` 一条都不许进结果集）；
     ② 每处 `.from(` 的归属都要认得（只允许认识得的 JS 原生 `from` 与 `.storage`），认不出的新写法就红并点名，
     防止「少扫一条链」把 ③ 扫成空洞；③ 表面覆盖本身。
  4. 文档：两份 mock 文档按实测重列已实现算子，并写明「`update()`/`delete()` 链上的 `or()/contains()/not()`
     会被接受但**忽略**（读路径全部生效）」——这是代码事实（`matchesFilters` 的跳过分支），
     以前文档没说过，读者会以为读写一致。
- 量到的阴性（写下来免得下次重扫）：`src/**` 查询链上真正用到的构建器方法共 **19 个**，缺的就是 `gt` 一个；
  `neq / like / ilike / filter / match / textSearch / containedBy / overlaps` 的链上使用数**全为 0**；
  写路径会忽略的三个算子与写操作的组合数 **0**（6 处 `.or(` 逐条看过，全在 `select` 链上：
  `notifications.ts:68,87,104,120`、`contact-messages.ts:106`、`api/e2e/seed-notifications/route.ts:108`）。
  也就是说 2 里那条不对称今天是**文档问题而不是在跑的缺陷**，按阴性记录、不改行为。
- 变更文件：`src/lib/mock/index.ts`、`src/lib/mock/mock-query-gt.test.ts`（新增）、
  `src/lib/mock/mock-query-surface.test.ts`（新增）、`docs-site/mock.md`、`docs-site/zh-CN/mock.md`、
  `CHANGELOG.md`、本条目。**没有改** `src/lib/repositories/marketing.ts`（属 #123）与
  `src/lib/repositories/test-helpers.ts`（手搓替身留着，它服务的是仓储层的错误注入，不是替身保真度）。
- 验证命令与结果：
  - 先红：`typeof q.gt` 实测 `undefined`；`npx vitest run` 两个新文件 5 条红（surface 那条点名
    `gt()：1 处，例如 src/lib/repositories/marketing.ts:89`）。
  - 修后：`npx vitest run src/lib/mock/mock-query-gt.test.ts src/lib/mock/mock-query-surface.test.ts` → 7 通过；
    `npx vitest run` 全量 → **201 文件 / 2298 通过**（`main` 上 199 / 2291，即本条 +2 文件 / +7 用例，逐条对上）。
  - 变异核对 3 项（每项先确认改动真的落地，再跑，再 `git checkout --` 还原并校验逐字节一致；未变异的正向对照 7 绿）：
    删掉 `gt()` → 4 条红（3 条语义 + surface 点名）；`:gt` 判成 `>=` → 恰好写/读两条严格大于红、`gte` 对照仍绿；
    只让写路径放过排序过滤器 → 写路径 3 条红、读路径仍绿。**第三条读起来像少了覆盖，其实是分工**：
    它证明读写两边各被独立钉住，而不是读路径顺带把写路径顶绿了。
  - `pnpm --silent type-check` → exit 0；`CI=true pnpm check:all` 与 `pnpm build` 见 commit 之后补记。
- 阻塞 / 风险 / 回滚：只动 mock 与文档，生产路径（真 supabase-js）一行未改；`gt` 语义与 PostgREST 的 `>` 一致，
  且 mock 模式下原先这条链**根本跑不通**，所以不存在「以前能跑现在变了」的回归面。
  回滚 = revert 本 PR 两个 commit。
- 下一项：`.auth.*` 与 realtime `.channel()` 的表面保真还没做对账（本次范围刻意止于查询构建器）；
  先把已量到的 3 处补齐（`signInWithOtp`/`verify`/`refreshSession` 一类要逐个问「谁在链上调它」），
  并且 AST 分类器现在认不出 `useMemo(() => createClient(), [])` 这类浏览器端拿法——
  它被第二条用例挡住了，将来出现会红并点名，而不是漏扫。
- 更新时间：2026-09-25（UTC 22:35 前后）。

## 2026-09-25 — Appark 的结账埋点进了队列就没人送：唯一的 flush 点在另一个 serverless 函数里

- 里程碑 / 版本：v0.12.0 的旁路可观测（不在 roadmap 条目里，是 ADR-011 那句「关键流程均在请求尾部
  主动 flush」从来没落地）。
- 状态：DONE。分支：`fix/appark-producer-flush`，基于 `origin/main` = `ad4b0299`。
- 怎么撞上的：不是在找 APM 的 bug，是在扫「调用点存在但永远不会被执行到」这一族。
  `src/lib/appark.ts` 的头部写着事件进**内存队列**、由 `flushEvents()` 批量 POST，那就有一个问题值得问：
  谁调它。数出来 `git grep -n "flushEvents(" -- 'src/**'` 全仓**只有两个**文件命中——
  `src/lib/appark.ts` 里的定义与内部调用，和 `src/app/api/cron/digest/route.ts` 结尾那一次
  （生产者侧同一条 grep 换个词：`trackEvent(`/`trackError(` 命中 `src/lib/stripe/index.ts:122`、
  cron 那一处，另有 `src/lib/i18n/dynamic-keys.ts` 命中一次，但那是文档注释里的**反例举例**，不是调用）。
  队列是进程内的，而 cron 在 Vercel 上是**另一个函数实例**：它 flush 的是自己那份队列。
  所以 `checkout.session_created` 这条埋点从接线那天起就没离开过进程——
  `trackEvent` 一切正常、没有日志、没有失败码，配置了收集端的模板用户看到的是一个**永远空白的事件流**。
- 改动：
  1. `src/lib/stripe/index.ts` 在埋点之后加 `void flushEvents()`。**刻意不 await**：await 等于把一次
     第三方收集端的往返塞进「跳 Stripe」那条路上，而这个模块的全部设计约束是旁路
     （`flushEvents` 自己 catch 掉 fetch 异常，非 2xx 也只是把批次留在队列里）。
     未启用 Appark 时它只把队列清空、不发网络请求，所以默认路径仍然是零开销。
  2. 新增 `src/lib/appark-flush-coverage.test.ts`：扫 `src/**`（跳过测试与 `appark.ts` / `appark-config.ts`
     自身），任何出现 `trackEvent(` / `trackError(` **调用**的文件必须自己出现 `flushEvents(`，
     否则点名红。判据把注释行单独摘出去（`//`、`*`、`/*` 开头），因为 `src/lib/i18n/dynamic-keys.ts`
     的文档注释里正好有一句 `trackEvent(...)` 的反例——不摘的话会把一份纯规则模块报成生产者。
     与 `src/lib/mock/auth-surface.test.ts` 同族，跑在 `pnpm test` 里，不再往
     `scripts/check-*` + CI + 双语 docs-site 那套接线复制第三遍。
  3. `src/lib/appark.ts` 头部补一条契约（队列不会自己出去 / 谁入队谁负责送 / 由哪份测试核对），
     `docs/adr/adr-011-appark-apm.md` 就地更正那句括号：它写的不是事实，更正以当时的形状记在里面。
- 验证：
  - `npx vitest run src/lib/appark-flush-coverage.test.ts` → **5 通过**。
  - **正向对照（这条测试真的有牙齿）**：把 `void flushEvents()` 那一行删掉再跑 →
    真实仓库那条用例红，消息点名 `src/lib/stripe/index.ts`；`git checkout --` 还原后重新绿。
    fixture 侧另钉两条：有生产者没 flush ⇒ `flushes:false`；补上 flush ⇒ `flushes:true`。
  - **失败封闭**：那条用例同时断言「扫出来的生产者数量 > 0」，并把文件数写进消息——
    否则将来判据或目录形状一变，全仓扫出 0 个生产者会打印成「0 个缺失」的漂亮绿灯。
  - 注释甄别也钉了一条：拿真实那份 `src/lib/i18n/dynamic-keys.ts` 断言它**不是**生产者。
  - **变异核对 3 项**（每项先 `assert` 改动真的落地、跑完 `git checkout --` 还原并比对 blob 一致）：
    M1 删掉 `src/lib/stripe/index.ts` 的 `void flushEvents()` ⇒ 恰好 1 条红，点名 `src/lib/stripe/index.ts`；
    M2 把 `isCommentLine` 打成恒 `false` ⇒ 3 条红，其中真实仓库那条点名
    `src/lib/i18n/dynamic-keys.ts`（正是那句文档注释里的反例），证明这层甄别不是装饰；
    M3 把 `PRODUCER_CALL` 换成一个永不匹配的正则 ⇒ 3 条红，包含那条「生产者数量 > 0」的封闭断言。
    未变异的正向对照 5 绿。
  - 门禁（本机，最终形态）：`pnpm lint` / `pnpm type-check` 各 exit 0、
    `CI=true pnpm check:all` **exit 0 / 37 步**、`npx vitest run` **200 文件 / 2296 通过**、
    `pnpm build` exit 0。
  - 用例数：本条新增 **5 条**（`199 文件 / 2291 用例` ⇒ `200 文件 / 2296 用例`，逐条对得上）。
- 队列影响：`src/lib/appark.ts`、`src/lib/stripe/index.ts`、`docs/adr/adr-011-appark-apm.md`、
  `src/lib/appark-flush-coverage.test.ts`（新增）**逐个按 blob 扫过全部 57 条在途 PR**
  （`git ls-tree <ref> <path>` 取第三列与 `origin/main` 比，分母 57/57），命中 **0 条**；
  新测试读的那三个源路径同样 0 条与 `main` 不同，所以这条没有 `merge-tree` 看不见的语义边。
  重叠仍只在 `CHANGELOG.md` / `docs/progress.md` 两处追加。
- 下一项：同一条判据现在只覆盖 Appark。`src/lib/metrics.ts` 与 Sentry 那两族是否也有
  「入队了但没人 flush / 没人 init」的形状，按同一套扫法量一遍再说。
- 更新时间：2026-09-25（本机 UTC 09-25 09:3x 前后）。

## 2026-09-25 — C06 定案：删掉两个零调用方的上传 Server Action，因为「共用服务层」不等于「共用守卫」

- 里程碑 / 版本：v0.12.0；roadmap C 域 **C06**（缺口审计里标为「产品决策（保留为编程入口或删除）」，
  2026-09-25 由用户拍板：**删**）。上一条里那条「等用户拍板」的三项之一就此闭环。
- 状态：DONE（代码侧完成，等 PR 合并）。分支：`chore/remove-upload-server-actions`（base `main`）。
- 判定依据三条，全部今天量过：
  1. **零调用方**：`src/lib/actions/uploads.ts` 的 `uploadAvatar` / `uploadProjectCover` 除自己那份
     `uploads.test.ts`（15 条用例）之外无人 import；仓库里活着的上传入口是
     `POST /api/uploads/avatar` 与 `POST /api/uploads/project-cover`，`avatar-upload-form` 走同源 XHR。
     action id 不出现在任何服务端渲染的 HTML 里，所以**今天不可利用**——留着它的代价不在今天。
  2. **两个入口的守卫不同形**（这条是删的真正理由）：路由经 `src/lib/uploads/request.ts` 拿三道请求边界
     ——同源校验、限流、解析 multipart **之前**的请求体上限；action 三道全空，连路由里那句
     `projectId` 长度检查也没有。service 文件头原来写着「Server Action 与 Route Handler 共用……避免
     安全规则分叉」，而分叉恰好就在这一行下面：领域规则同源，边界守卫不同源。
  3. **覆盖不因删除而丢**：`src/lib/uploads/service.test.ts` 22 条用例直接测领域规则，两个路由测试
     3 + 4 条测边界与状态映射；被删的 15 条测的是同一批判定的 action 外壳。
- 结果与验证（同一条 `pnpm test` 口径，两边都是实跑，不是推算）：

  | 度量 | 删除前（`main` = `ad4b0299`） | 删除后（本分支） |
  | --- | --- | --- |
  | 测试文件 | 199 | 198 |
  | 用例 | 2291 passed | 2276 passed |
  | `pnpm check:all` | — | exit 0，37 步全过（含 type-check / lint / test） |
  | `pnpm build` | — | exit 0 |

  差值 1 文件 / 15 用例，与被删文件里的 `it(` 计数**逐条对上**（15 条：头像 9 + 封面 6）。
- 随删除一起改掉的是「随之变假」的描述，四处代码注释加两处文档：service 文件头（改成写清三道守卫
  只作用于走 HTTP 路由的调用方，直接 import 本文件的函数拿不到）、两个路由头注释里点名的 action、
  `src/lib/mock/index.ts` 与 `src/app/api/e2e/mock-upload/route.ts` 注释里点名的 `uploadAvatar`、
  `docs-site/storage.md`（双语）那句把守卫写成路由属性的话，以及
  `docs/architecture/11-integrations.md` 的「头像与项目封面通过 Server Actions 完成……」——那正是
  v0.6.0 退出报告点名的「标注与代码相反」，删掉 action 之后它从夸张变成不存在，属于不得回流的旧表述。
- 明确**没有**改的：`messages/{en,zh-CN}/**` 里的 `uploadAvatar` 键（那是头像按钮的文案键，与被删的
  符号无关）、`docs/roadmap-0.6.0.md` 里那句「统一经 Server Actions」（带日期的历史证据，按 D04 口径
  就地保留，其错误已由 v0.6.0 退出报告记录）。
- 仍未闭环的（沿用上一条的三分法）：等用户拍板的还剩 A05 出队语义（含 `is_read` 那条静默出队）与
  A01 留下的 `profiles.timezone` / `profiles.language` 去留。
- 更新时间：2026-09-25（UTC 03:10 前后）。

## 2026-09-25 — A05 后半落地：判定「根本寄不出去」的当场写原因出队，面板把两笔静默账拆开

- 里程碑 / 版本：v0.12.0；roadmap **A05** 的后半（前半是 2026-09-23 的可观测卡片）。
  三个候选口径（复用死信 / 新增过滤列 / 拉取侧翻页）2026-09-25 由用户拍板：**新增原因列**。
- 状态：DONE（代码侧完成，等 PR 合并）。分支：`feat/email-skip-reason-dequeue`（base `main`）。
- 落地的东西，按「谁写、谁读、谁说」三段：
  - **谁写**：迁移 `supabase/migrations/034_email_skip_reason.sql` 给 `notifications` 加可空列
    `email_skipped_reason`，`CHECK` 取值 `no_email` / `preferences_off`；manifest 追加第 34 条并核对
    SHA-256，`migration-rollback-runbook.md` 的机器可读「最新迁移」标记同步前进。
    `src/app/api/cron/digest/route.ts` 的两个跳过分支当场为放弃的那批 id 写原因；
    写入本身失败时不抛穿整轮，走 `cron.digest.receipt_failed{stage="skip"}` —— 抛穿会把一轮
    处理过的运行记成 `pulled>0 && sent===0 && failed===0`，正好命中面板「空发送轮次」的定义，
    那是本仓库前一天刚修过的假信号种类，不再制造第二个。
  - **谁读**：待发队列谓词多出第五段「未被判定为不可投递」，worker 拉取 / 积压计数 / 最老一条年龄
    三处整段同改（原有「同一段过滤逐项相等」的用例继续钉住）；新增
    `countEmailSkippedByReason()` 与 `countReadBeforeSendEmailNotifications()`，
    后者量的是那条一直在但没人看的静默出队（队列含 `is_read=false`，站内读过就不会再寄，
    而且连 `email.backlog` 都不计入——只看积压数会把一次堵塞读成一次缩小）。
  - **谁说**：admin 概览页的邮件队列卡片按原因分组报数并把「读掉」那笔单列；原因标签用
    `Record<EmailSkipReason, string>` 而不是拼出来的动态键，加第三种原因却忘补文案时编译期就红；
    `docs-site/email.md`（双语）、`docs/operations/sentry-alerts.md` 的 `stage` 取值、
    roadmap 里那句「出队语义仍未决」一并改掉。
- 验证（两边同一条命令）：`pnpm test` 从 `main` 的 199 文件 / 2291 用例变成 **199 文件 / 2304 用例**
  （+13：仓储 8 + 诊断纯函数 3 + worker 回执 1 + mock 语义对账 1），`pnpm check:all` **exit 0 / 37 步全过**（含
  type-check、lint、test），`pnpm build` exit 0。service-role 清点表的调用点预算由 89 改为 **92**
  （新增 3 个 admin 客户端函数，分类与理由登记在同一处）。
- 三条方法上的收获，记下来免得下次重新踩：
  1. **一条 false green 被自己的改动照出来了**：digest 路由测试用显式清单 mock 仓储模块，
     里面没有 `markEmailSkipped`，于是跳过分支跑起来是 `TypeError`，恰好被我新加的 `try/catch`
     吞掉——补齐 mock 之前，那两条「跳过」用例全绿却什么都没测。补上 mock 并断言
     `toHaveBeenCalledWith(["n1","n2"], "no_email")` 之后才有牙齿。给一段自带吞错语义的代码加
     调用，必须先确认测试替身真的在场。
  2. **钉死「最新迁移名」的测试是每条迁移都要改一次的税**：
     `src/lib/db/migration-runbook.test.ts` 原来把 `report.latest` 断言成字面量 `033_...sql`，
     而「标记必须等于真实最新迁移」这件事已由 `RUNBOOK_STALE_LATEST` 判定负责——那条断言只是把
     每次加迁移都必然失败的噪声留在仓库里。改成按 manifest 推导之后，判定强度不变、维护面少一处。
  3. **第二条 false green 是同一种病，出在「抄一份清单」上**：钉住「拉取 / 计数 / 最老一条走同一段
     过滤」的用例自己抄了一份 `["eq","in","or"]` 来比对调用记录，而第五段谓词用的是 `.is()`——
     变异探针把三处 `.is("email_skipped_reason", null)` 逐个删掉，用例仍然全绿。修法不是把那三个
     方法名补全（下次再加一种过滤又会漏），而是让 `chainMock` 公布自己的构造表
     （`src/lib/repositories/test-helpers.ts` 的 `CHAIN_FILTER_METHODS`），对账用例直接取它：
     mock 支持一种新过滤，比对就自动多比一项。重跑三个变异全部当场被杀，改一句日志文案的对照组仍存活。
- **PR 推上去之后 E2E 红了 3 条，根因在 mock 不在业务代码**：`mail-flow` 的两条与
  `admin-contact-mfa` 那条「面板数字与队列一致」全部失败，`digest` 报 `sent=0`。
  变异探针（把三处第五段谓词整段删掉再跑同一 spec → 1 passed）把范围锁死在 `.is()` 本身：
  `src/lib/mock/index.ts` 里消费 `filters` 的两个循环中，notifications 走的那一个不认识 `:isnull` 后缀，
  于是 `email_skipped_reason:isnull` 被当成一个普通列名做等值比较，条件恒假——**mock 模式下整条队列看起来是空的**。
  已修（补后缀识别）并加一条单测钉住「缺键 ≡ null」这条 SQL 语义。
  值得记的是这一层的分工：仓储层单测全绿不是假绿，`chainMock` 声明了自己不实现过滤语义；
  真正覆盖「mock 与 PostgREST 行为一致」的只有 E2E，而它是 CI 的独立 job、**不在 `pnpm check:all` 里**。
  下一次给通知表加谓词的人不必再踩这一次，但 `#149` 那条 `check:mock-docs` 对账的是文档与操作符**清单**，
  管不到「同一个操作符在两个循环里行为不同」这种形态。
- 仍未闭环：`is_read` 免寄的口径**没有**改变（本轮只让它可见）；邮件侧依然没有行龄上界；
  生产复验要等下一次部署（B 域仍缺外部权限）。上一条里「等用户拍板」的三项，本轮定案两项
  （A05、C06），剩下 `profiles.timezone` / `profiles.language` 去留一项按「文档+UI 说明是偏好」处理。
- 更新时间：2026-09-25（UTC 04:05 前后）。

## 2026-09-25 — A01 留下的「时区 / 语言」定案：把它说明白是偏好，而不是让它生效

- 里程碑 / 版本：v0.12.0；收口 A01（2026-09-22「放宽窗口、一天一封」）末尾那条
  「要么在文档与 UI 上说明它只是偏好，要么删掉这条链路」的产品决策。
- 状态：DONE。分支：`fix/profile-preference-semantics` → **PR #154**（base `main`）。
- 决策来源：用户 2026-09-24 一次性授权的四个产品判断之一，选**「文档 + UI 说明是偏好」**
  （另两个方向——删链路、让字段真正生效——都没选；生效的代价记在 roadmap A01 新的小节里）。
- 动手前先把「有没有消费方」量出来，别凭印象写文案：`timezone` 全仓命中只有资料页展示
  （`src/app/dashboard/profile/page.tsx:98,100`）、编辑表单（`profile-edit-form.tsx:65`）、
  两条写入校验（`src/lib/validations/profile.ts:16`、`src/app/api/user/route.ts:29`）、
  完整度计分（`profile-completeness-card.tsx:18`）与 mock/类型；`language` 同形，展示侧多一个
  `t.has()` 兜未知值（`page.tsx:109`）。digest 路由自 A01 起不读这两列，
  所以「不影响发送时刻」这句话是有依据的事实陈述，不是免责声明。
- 变更文件：`messages/{en,zh-CN}/dashboard.json`（各 +2 个 key）、
  `src/components/forms/profile-edit-form.tsx`（两个 `FormField` 各加 `description`）、
  `src/components/forms/profile-edit-form.test.tsx`（+1 用例：说明渲染出来且绑进 `aria-describedby`）、
  `docs-site/email.md` + `docs-site/zh-CN/email.md`（「偏好与重试」小节各加一段）、
  `docs/architecture/06-database.md`（`profiles` 字段表两行说明）、`docs/roadmap-0.12.0.md`（A01 定案小节）、
  `CHANGELOG.md`、本条目。
- 验证命令与结果：`CI=true pnpm check:all` → **exit 0，37 步全过，199 文件 / 2292 用例**（+1，文件数不变）；
  新 key 过三道 i18n 门禁的具体读数：`check:locales` en/zh-CN 各 1244 键对称、
  `check:i18n` 870 个静态调用两侧均存在、`check:glossary` 与 `check:dynamic-keys`（9 契约 × 2 locale、
  64 取值全覆盖）不受影响。`pnpm build` → **exit 0**，`/dashboard/profile` 与 `/dashboard/profile/edit`
  两页正常生成（这条改动只加文案，但 `MISSING_MESSAGE` 只有静态生成会现形，所以按 AGENTS.md 的
  pre-push 顺序它必须跑）。
- 变异核对（2 项，都被抓）：① 删掉时区那行的 `description={t("timezoneDesc")}` →
  恰好新增那条用例红（`1 failed | 3 passed`）；② 把时区的 key 换成 `languageDesc`（说明接错字段、
  两栏文案对调）→ 同一条红。第二次容易漏：只测「删掉」证明不了文案与字段的对应关系，
  而这条改动的全部价值就在那个对应关系上。两次还原后 `shasum -c` 逐字节一致、复跑 4 通过。
- 阻塞 / 风险 / 回滚：不改任何发送、写入、鉴权行为，只加文案与一条组件用例；回滚 = revert 本 commit。
  冲突面（2026-09-25 实测，队列 **61** 条 open）：与本条**同文件**的只有 #127（`profile-edit-form.tsx`
  与其测试——把 `language` 的 `<option>` 换成映射 `PROFILE_LANGUAGES`）、#119（同一组件 1 行——
  `<form>` 补 `method="post"`）、#92（`messages/{en,zh-CN}/dashboard.json` 各 2 个 key）；
  `docs-site/email.md` 另有 #152、#123；`docs/architecture/06-database.md` 另有 #145；
  `docs/roadmap-0.12.0.md` 另有 25 条；`CHANGELOG.md` / `docs/progress.md` 是 58 / 61 条的公共尾部。
- **就地补记，并订正上一条第一次量错的口径**（台账约定：判错要就地标注，别只留在对话里）：
  第一次扫用的是 `gh pr list --state open` 的**默认分页，它只回 30 条**，于是当时写下的「队列 30 条」
  是个半队列读数；加 `--limit 200` 重扫拿到真实分母 **61**（#92–#153），同文件名单也因此从
  「只有 #127」补成 #127 / #119 / #92 三条。整队列 `merge-tree(本条 tip, 各 PR head)`：
  **61/61 与本条冲突，而冲突文件只有两个台账尾部**（`docs/progress.md` 61 条、`CHANGELOG.md` 的 #127 与 #151），
  代码与配置零冲突；对照跑法 `merge-tree(origin/main, 各 PR)` 61 条全干净 ⇒ 这些尾部冲突由本条引入
  （任何往同一位置追加的分支都躲不掉，不是本条特有）。#120 的 head 在循环里 `git fetch` 失败一次，
  单独对它重跑 merge-tree，结论同上（只冲 `docs/progress.md`）。
  同文件的三处按「merge-tree 看不见语义边」逐个真合过：#127（组件 +2 行、测试 +12 行，合并后该测试
  5 条用例）→ `npx vitest run src/components/forms/` **6 文件 / 22 用例全过**、`pnpm type-check` 0 错；
  #119 与 #92 叠在一起（组件 +1 行、两个 messages 各 +2 key）→ `check:locales` **1246 键对称**、
  `check:i18n` / `check:glossary` / `check:fields` 全绿、表单 6 文件 / 21 用例、tsc 0 错。
  两边碰的确实不是同一件事：#127 换 `<option>` 的取值来源、#119 换 `<form>` 的提交方法、本条加说明文案。
  跑法记一下：`git merge-file` 三方合并出内容后覆盖到工作树，跑完 `git checkout --` 回到本条 commit
  （`dirty=0`）。**顺手记一条踩坑**：本想丢进 `git worktree` 跑整份 `check:all`，走不通——worktree 里
  symlink `node_modules` 会让 pnpm 报 `ERR_PNPM_UNSAFE_MODULES_DIR` 并拒绝对真实仓库的 `node_modules` 动手
  （它拒绝得对，别去绕），所以语义边复验只能在主检出里用「commit → 覆盖 → 跑 → `checkout --`」这套做。
- 明确**不**做的：① 不让 `timezone` 参与投递（要第二条 cron 路径，不是放宽门控——A01 正文已写）；
  ② 不做邮件本地化（要先拍「邮件要不要本地化」和「`ja`/`ko` 算不算支持语言」，因为它连已存库的
  通知标题都得一起本地化）；③ 不收窄 `language` 的写入校验（两条写路径目前都只 `z.string().max(50)`，
  取值词表 `en/zh/ja/ko` 与站点真实 locale `zh-CN/en` 的分歧由 #127 收窄到权威常量，是否据此校验仍未定）；
  ④ 不删字段、不写归一化迁移。
- 下一项：C13（roadmap 已登记，#153 分支上）——生产构型里禁止开 mock；本条不与之耦合。

## 2026-09-25 — C13：生产构型不许开 mock（缺闸门的只有显式那一半）

- 里程碑 / 版本：v0.12.0；C 组（门禁与安全语义），roadmap 里 C13 那条由 #153 登记。
- 状态：DONE。分支：`fix/mock-production-guard` → **PR #155**（base `main`）。
- 缺陷的形状：`src/lib/mock/config.ts` 的判定有两条来源，**生产闸门只写在第二条上**。
  第一条 `NEXT_PUBLIC_MOCK_ENABLED === "true"` 什么都不问，第二条（自动降级）的注释正是
  「避免生产环境误配时静默绕过认证」。同一个文件里两种语义，危险的那一种胜出：
  `NEXT_PUBLIC_*` 是构建期内联进产物的，一个忘在部署平台上的 `true` 会跟产物进生产，
  `server.ts` / `client.ts` / `middleware.ts` 改发 Mock 客户端，中间件看到的就是「已登录」。
  而 Vercel 的 Preview 与 Production 是同一种构型（`NODE_ENV === "production"`），
  所以 `docs/operations/environments.md` 那条「Preview 保持未设置」的约定过去只靠人守。
- **这条不是读代码读出来的结论，是跑出来的**（差分探针，两次跑法只差那三行源码）：
  `NEXT_PUBLIC_MOCK_ENABLED=true pnpm build` → `NEXT_PUBLIC_MOCK_ENABLED=true next start -p <随机空闲端口>`
  → `redirect:"manual"`。修复前：`/dashboard` **200 不重定向**，`/api/health` 回 200 且
  `mockMode=true`、Supabase `status="skipped"`、`ready=true`（**readiness 对着一次认证绕过点头**）；
  修复后：`/dashboard` **307 → `/auth/login?redirect=%2Fdashboard`**、`mockMode=false`。
  如实记一条边界：探针里「HTML 像不像 mock 内容」那个正则没命中，所以判定只依赖上面两格，不依赖页面文案。
- 修法：真值表收成一条纯函数 `evaluateMockMode(env)`（生产一律 `false`，两条来源共用这道闸），
  `isMockEnabled` 由它算出；并把此前**各自抄了一遍**这个条件的两处消费方（`/api/health` 的 `isMockMode()`、
  provider 诊断的 `isMockMode(env)`）改为调用它——三处拷贝各写一遍正是这次漂移的发生方式，
  也是为什么健康检查会比应用更乐观。
- 变更文件：`src/lib/mock/config.ts`、`src/lib/mock/config.test.ts`（新增 9 条）、
  `src/lib/providers/diagnostics.ts` + 其测试（+1 条生产用例）、`src/app/api/health/route.ts` + 其测试
  （+1 条）、`docs-site/mock.md` 与 `docs-site/zh-CN/mock.md`、`docs/architecture/13-mock-system.md`
  （条件表 + mermaid 入口节点）、`docs/operations/environments.md`、`.env.example`、`CHANGELOG.md`、本条目。
- 验证命令与结果：`CI=true pnpm check:all` → **exit 0，37 步全过，200 文件 / 2302 用例**
  （`+1 文件 / +11 用例`；`check:mock-docs` 仍报「18 张表 / 8 个 E2E 端点 × 3 份文档」，
  说明两份 mock 文档的改动没破坏它比对的那一层）；`pnpm build` → **exit 0**（就是上面那次探针构建）；
  `pnpm type-check` → 0 错。
- 变异核对（两次，都被抓）：① 只删 `if (env.NODE_ENV === "production") return false;` 这一行 →
  3 个测试文件 **8 条红 / 30 条绿**，其中 **2 条是本条之前就存在的生产用例**
  （`fails closed when production Supabase configuration is missing`、
  「生产环境缺少 required Supabase 配置时返回 503」）——**它们当时只测自动降级那一半，
  所以那两条绿灯只说了半个真话**；② 把三个源文件整体退回 `origin/main` 的版本、只留新测试 →
  6 个文件 **10 条红 / 62 条绿**。两个脚本都 `trap` 还原，跑完 `git status` 对涉及路径为空（`dirty=0`）。
- 阻塞 / 风险 / 回滚：改的是「生产 + 显式 true」这一格的行为：以前发 Mock 客户端，现在发真实客户端，
  缺凭据就如实失败（这是 fail-closed 的方向，也是文档一直写的方向）。开发、`dev:mock`、E2E、
  视觉基线都不受影响——`playwright.config.ts` 与 `playwright.visual.config.ts` 起的都是 `pnpm dev`。
  回滚 = revert 本 commit。
- 冲突面（队列现况 62 条 open，见 #118 附二十九；逐路径扫 61 条 + 本分支自己）：
  **本条那五个代码文件（`src/lib/mock/config.ts`、`config.test.ts`、`diagnostics.ts` 与其测试、
  `api/health/route.ts` 与其测试）在整条队列里命中 0 条**，没有语义边要预防；
  同文件的只有文档三处——`docs-site/{,zh-CN/}mock.md`（#148、#149）、
  `docs/architecture/13-mock-system.md`（#148），都是不同区域的追加，`merge-tree` 自动合上。
  整分支对 62 个 head 逐个跑 `merge-tree`：**62/62 与本条冲突，冲突文件只有台账尾部**
  （`docs/progress.md` 62、`CHANGELOG.md` 50），**非台账冲突 0 个**，代码/配置/迁移零冲突。
  这一串数字第一次跑出来是「冲突 0 条、非台账 0 条」——看着像好消息，其实是 62 条全部 `FETCH_FAIL`、
  合并检查一条都没跑过：喂给脚本的那份 `gh pr list --json` 没有 `headRefName` 字段，ref 名全是 `undefined`。
  救回来的是脚本里那句 `fetchFail: 154,153,…` 把整串列出来了：**分母与「取到的是什么」要和结论同行打印**，
  否则一个坏掉的输入与一个干净的结果长得一样。
- **一条 merge-tree 看不见的边，要人做一次动作**：roadmap C13 的文案登记在 **#153 的分支**上，
  写的是「给 `check:security-config` 加一条拒绝生产开 mock 的规则」。本条的判定是**不加那条门禁**：
  那个变量活在部署平台而不是仓库里，想证明「生产没设它」要读 Vercel 的项目环境变量，
  而本机 `VERCEL_TOKEN` 对 env 端点回 `403 invalidToken`（量不到就不是能写进门禁的事实）；
  闸门放进判定函数之后，「配错」不再等于「假登录」，这是行为层面的收口而不是清单层面的。**因此
  #153 落地后要把它那节 C13 改成「由 `evaluateMockMode()` 的生产闸门关闭，不另建门禁」**——
  谁后合谁做，两侧文本零冲突，所以只有读台账的人会漏。
- 同一个常量还管着**产物形状**，这条是本条目补测出来的第二件事（起因是 `e078275b` 推不上去：
  `check:bundle` 红在 `2951.7 kB / 基线 2733.8 kB`）。逐层量下来的结论（每次 `rm -rf .next` 干净构建、
  同一台机器、`.env.local` 里 `NEXT_PUBLIC_MOCK_ENABLED=true`）：
  - `origin/main` = **2846.4 kB**；本分支修复后 = **2951.7 kB**（+105.3）；只把 `src/lib/mock/config.ts`
    单独拿进 main 的树 → **2951.7 kB**，**一字不差**。所以整个差额来自这一个文件，不是那三份文档；
  - 机制不是"真实客户端被摇回来"这种好事，而是**构建期折叠丢了**：Next 只把 `process.env.X` 这类成员表达式
    替换成字面量，`evaluateMockMode(process.env)` 把整个对象传进函数，打包器就折不出常量，
    `if (isMockEnabled)` 两侧都留在产物里。用 chunk 内容证实：main 那份最大的客户端 chunk 里
    Phoenix/realtime 的 `pendingDiffs`/`rejoinTimer`/`Presence` **一个都没有**，而 faker 的
    `iataTypeCode`（310 次）两边都在——被摇掉的是真实客户端，不是 mock 数据；
    - 修法：模块级常量保留 `process.env.NODE_ENV === "production" ? false : evaluateMockMode(process.env)`。
    真值表仍然只有 `evaluateMockMode` 一份，这层三元是折叠提示（删掉它运行时行为不变，函数里那道闸再判一次），
    改完客户端产物 **2926.8 kB**。**代价记下来**：这层三元在运行时同样生效，所以「只删函数里那道闸」
    不再能动到认证路径。四刀变异核对（分母都是 `config.test.ts` + `diagnostics.test.ts` +
    `api/health/route.test.ts` 这三个文件的 **39 条用例**）：
    ① 只删函数里 `if (env.NODE_ENV === "production") return false;` → **7 红 / 32 绿**
    （红的是真值表三条生产格 + 两个消费方各 2 条，其中 `fails closed when production Supabase
    configuration is missing` 与 `生产环境缺少 required Supabase 配置时返回 503` **是本条之前就有的**
    ——它们当时只测自动降级那一半，绿灯只说了半个真话）；② 三个源文件整体退回 `origin/main` → **11 红 / 28 绿**；
    ③ 两道生产判断一起删 → **9 红 / 30 绿**（这时「导入时判定」那条才红，证明常量那道确实独扛认证路径）；
    ④ 只把常量退回函数调用（运行时行为不变、折叠丢失）→ **1 红 / 38 绿**，红的只有形状那条。
    先前那两处 "8 条红 / 30 条绿" 与 "6 个文件 10 条红 / 62 条绿" 的读数**是在还没有这层三元的树上量的**，
    杀伤面差异正是上面那句代价；本条按当前树重量之后已在 CHANGELOG 里就地更正；

  - **并且生产产物不再受这个开关影响**：`NEXT_PUBLIC_MOCK_ENABLED` true / false 两次构建总字节
    2,997,011 / 2,997,015（差的 4 字节是内嵌 chunk id 字符串长度），最大的那个 chunk
    `0q8j5g_fowmqu.js`（743,012 字节）在 main(mock 关) / 本分支(mock 关) / 本分支(mock 开)
    **三次构建里 sha256 相同**（`b4fc187d70b71672…`）——本条对生产客户端的净增量是 0 字节；
  - 顺手把这个文件头部那句「零依赖轻量模块，免得把 faker 打进 Edge 运行时」**量了一遍**（此前没有任何
    用例或文档给它数字）：`.next/server/edge` 下 3 个 `.js` 合计 **183,021 字节**，main 与本分支
    **逐文件同大小**，`iataTypeCode` 命中 0 次。所以那句承诺是真的，而且改动没碰它。
    （一次失败的探针值得记下来：我用 `createServerClient` / `GoTrueClient` / `traceContextExtractor`
    在 Edge 产物里找 Supabase，全部 0 命中 —— 服务端 Edge 包会被改名，**类名与导入名不是可搜的标记**，
    要搜就搜字符串常量（`iataTypeCode` 这类）或直接比字节数。）
  - `.bundle-baseline` 因此从 2733.8 改成 **2926.8**：旧基线量的是"生产误配把真实客户端摇掉"那个 shape，
    而 C13 之后那个 shape 在生产构建里已经不存在（main 用真实生产构型构建也是 2926.8，比基线高 7.1%——
    这份增长是 v0.6.0 以来攒的，不是本条带来的，本条只是让它没法再被误配隐藏）。
    **不放宽判据**：5% 预算、脚本、`verify` 接线一字未动，只换被记录的读数；
  - 24.9 kB 只占基线 0.9%，落在 5% 预算内 ⇒ `check:bundle` 拦不住"折叠又丢了"这类退化，
    所以由 `config.test.ts` 钉住写法（断言声明里直接出现 `process.env.NODE_ENV === "production"` 与
    `? false :`）。变异核对：把声明退回 `evaluateMockMode(process.env)` → **只有那 1 条红，其余 9 条绿**；
  - 顺手量到一条**会污染任何本地体积测量**的事实（先给出观察，再给未证实的部分）：仓库根下一个
    **未被 `.gitignore` 收录**的临时目录会改变 `check:bundle` 的读数。同一批 ref 在 `.gate-logs/` 里
    堆了约 240 个日志与构建产物副本之后，两次重复构建各自稳定地比干净树高 8.9 kB
    （main 2855.3 vs 2846.4、未折叠分支 2960.6 vs 2951.7），而且其中一次一侧的 CSS 比另一次多出
    9,069 字节 / 77 个 utility 选择器（83,809 与 855 vs 74,740 与 778）——**同一份源码的产物形状被一个
    无关目录改了**。机制我没有证实（怀疑方向：Tailwind 的自动内容扫描把该目录当源码），能证实的是
    处置动作有效：把临时目录挪出仓库根之后，每个 ref 的读数在重复构建间逐字节稳定，改动与差值一一对应。
    #151 正是把 `.gate-logs` 写进 `.gitignore` 的那条 PR（还没合进 `main`）；在它落地之前，
    任何按体积取证都要先清掉仓库根里的临时目录，或者按这里的姿势先量一遍自己的"空载"读数。
    这次踩到之前我先把两组 A/B 跑了个遍：**结论方向没错（差额确实只来自那一个文件），但数值是错的**
    （当时量的 96.4 kB 与那条"CSS 少 8.9 kB"的假线索都来自被污染的树）。
- 明确**不**做的：① 不新增 `check:*` 门禁（理由见上一条）；② 不给「生产跑 mock」留逃生开关
  （仓库里没有任何文档把它写成承诺，加一个 `ALLOW_MOCK_IN_PRODUCTION` 只是把这次收口的口子重新打开）；
  ③ 不改 mock 客户端本身与 `.env.example` 的取值（只加注释）；④ 不动 Preview 的环境变量——那要 Vercel 权限。
- 下一项：v0.12.0 任务池在 `main` 上读到的剩余未收口项已经全部不在「可自主开工」这一类——
  B02–B05 与 C05 要外部权限（云端 Supabase / Vercel / provider），C06 由 #151 收口、C08 由 #92 那条链
  在做、A05 由 #152、C12 由 #153（都还没合进 `main`，所以 `main` 上的 roadmap 读起来仍是「待做」）。
  因此接下来的自主工作是**继续找缺陷**（安全线例行扫、未测件、合并后才会红的那类写法），不是开新的池项。

## 2026-09-25 — C12 的限流两态台账接进门禁，第一天就抓到两条到期豁免

- 里程碑 / 版本：v0.12.0 门禁基础设施 + 安全面（本分支 `feat/rate-limit-ledger-gate`，PR #153）。
- 状态：DONE（PR 待合并；门禁与全量门禁本地已跑通）。
- 合并时的订正（门禁自己抓到的）：`check:route-auth` 落地后第一次跑真实仓库就红了 **2 项
  `RATE_LIMIT_STALE`**——`POST /api/marketing/confirm` 与 `POST /api/marketing/unsubscribe`
  在台账里登记为「已知缺口」，而调用图已经看得见窗口（`src/lib/marketing/request.ts#marketingTokenLimit`）。
  成因是这两条豁免的 `reason` 里**自己写好了关闭条件**：「#136 正在补按 IP 的滑窗，那条合并之后
  本条会被 `RATE_LIMIT_STALE` 报出来，届时删掉这两行」。#136 确实合了，于是这道判据按设计响了。
  按它自己的判词删掉那两行，没有顺手把 `RATE_LIMIT_GAP_MARKER` 一起放宽。
- 这条是「两态台账」这个形状的第一次真实回报：豁免不是永久选项，它带一个到期条件和一个
  会响的检查。读数从 45 个 handler = 16 有窗口 + 31 写明理由（含 2 条已知缺口）变成
  **45 = 16 + 29**，缺口从 2 降到 0。
- 验证：`node scripts/check-route-auth.js` → exit 0（`✅ 限流两态台账一致`）；
  `CI=true pnpm check:all` → **exit 0，✅ 全部校验通过**。
- 回滚：还原本 PR 即可；那两行豁免不恢复——恢复会让 `RATE_LIMIT_STALE` 重新变红。

## 2026-09-25 — `NEXT_PUBLIC_FEATURE_*` 开关在客户端一侧从来没生效过（计算式 `process.env` 不会被内联）

- 里程碑 / 版本：v0.12.0；「文档/断言说假话」这一族之外的一例——**开关本身说假话**。
- 状态：DONE。分支：`fix/feature-flags-client-inline`（本条目所在 PR）。
- 怎么发现的：不是设计出来的扫描，是量 C13 产物时的副产物——为了搞清「客户端产物里为什么有 faker」
  而在 `.next/static` 里搜 env 读取点，撞见 `src/lib/feature-flags.ts` 编译成
  `processModule.default.env[\`NEXT_PUBLIC_FEATURE_${name}\`]`。
- 证据链（每条都写了怎么量）：
  1. **计算式的值不在产物里**：`NEXT_PUBLIC_FEATURE_AUDIT_LOG_EXPORT=false` 做一次生产构建
     （`rm -rf .next`，同一台机器），整个 `.next/static` 里这一族只剩模板前缀 `NEXT_PUBLIC_FEATURE_`
     一个字符串，`false` 没有内联进去。
  2. **浏览器里那个 `process` 是空垫片**：对同一份产物起真实 `next start` + Playwright 读
     `typeof process` ⇒ `"undefined"`。⇒ 客户端永远读到 `undefined` ⇒ **永远走代码里的默认值**，
     平台上怎么设都不改变它。
  3. **对照组在同一份产物里**：修法落地后重新构建，`RAW_FLAGS` 编译成
     `{AVATAR_UPLOAD: 垫片读取, AUDIT_LOG_EXPORT:"false", …}` —— 设过的那一项成了内联字面量，
     没设的仍是垫片读取（行为不变）。这条同时说明机制：**Next 只替换静态成员表达式，
     且只替换构建时真实存在的变量**。
  4. **消费面**：`features.auditLogExport`（默认 `true`）在客户端的唯一消费方是
     `src/app/dashboard/admin/audit-logs/audit-logs-page.tsx`（`"use client"`，由同目录的 `page.tsx`
     这个服务端壳渲染），服务端与客户端因此不一致——设成 `false` 时服务端不渲染导出按钮、
     客户端 hydration 后又补出来。其余四个开关的消费方（login / settings / passkey 路由）
     都只在服务端读 env，本条不影响它们（逐个查过 `"use client"` 标记与 import 归属）。
- 修法：`src/lib/feature-flags.ts` 把键摊平成 `RAW_FLAGS` 静态读法表，判定函数改成
  `flag(name: FlagName, default)`（`FlagName = keyof typeof RAW_FLAGS`，新增开关不登记就编译不过）。
- 测试：`src/lib/feature-flags.test.ts` 4 条 → 7 条。新增 ①「显式 false 关得掉」（默认开的
  `auditLogExport` 是唯一能证伪这一格的位置）；②禁止计算式访问 `process.env[`；
  ③`flag("X")` 调用点与静态读法**两侧一一对应**（数量相等 + 两个方向的差集都为空），
  并带一条「调用点为 0 就说明判定被搬走了」的防空转断言。
  **为什么是源码形状而不是运行时用例**：vitest 的 jsdom 里 `process.env` 是真的，
  修复前后那 4 条运行时用例同样全绿——这条缺陷在单测环境里结构性看不见，浏览器那一侧只能靠产物取证。
  变异核对两刀（同一分母 7 条）：只把查表改回计算式 → **1 红 / 6 绿**；整个文件退回修复前 →
  **2 红 / 5 绿**（第二刀正是那条防空转断言在响）。两刀都由 `git checkout` 还原，跑完 `git status` 为空。
- 门禁读数：`CI=true pnpm check:all` → **exit 0，199 文件 / 2294 用例**（main 是 199 / 2291，
  `+3` 条全在这个文件里）；`pnpm build` → exit 0。
- 文档：`docs/operations/environments.md` 新增一节「`NEXT_PUBLIC_*` 是构建期常量」（值内联、
  只有构建时存在的变量会进产物、计算式永不内联），`.env.example` 补登记此前没有记录的
  `NEXT_PUBLIC_FEATURE_AUDIT_LOG_EXPORT`，`CHANGELOG.md` 记 `### Fixed` 一条。
- 明确**不**做的：① 不加 E2E——要让 E2E 有牙齿必须给 webServer 设一个 `NEXT_PUBLIC_FEATURE_*=false`，
  而那会改变整个套件的产物形状（默认开的这项在 E2E 里就没有按钮了），代价大于收益；
  客户端侧的证据用产物取证已经足够且更可复核。② 不把开关系统改成运行时（DB/远程配置）——
  文件头早已写明这是构建期开关，改成运行时是另一个池项。③ 不动另外两处计算式读法
  （`src/lib/env.ts`、`src/lib/appark.ts`）：逐条查过消费方，两处都只在服务端跑
  （`env.ts` 被 `lib/storage` 引、`appark.ts` 被 cron / instrumentation / stripe 引），
  真实 `process.env` 在那里存在，不是本条缺陷的实例。
- 下一项：继续找缺陷；本轮 C13 那条（#155）与这条共用一个判据——**「构建期常量」的形状决定它到不到得了客户端**。

- 更新时间：2026-09-25（UTC）。

- **合并时的订正（门禁自己抓到的）**：本条落地时 `query-error-channel.test.ts` 里那条
  「真实仓库两侧都有量到」的地板断言红了——实测 **159 处 awaited 查询结果断言 / 0 处未绑定**，
  C08-c 八批把这条债真的还完了，而那个 `expect(unbound.length).toBeGreaterThan(0)` 正是它自己写的
  清零判据（地板值断言的是一个「改进会让它红」的阶段）。按 D04 口径把它升级成**天花板**：
  `expect(summary.unbound).toEqual([])`，并把分母断言（`total > 0`）与
  `skippedUnparseable === 0` 留下——「零未绑定」必须带着一个非零分母和「解析不动的文件为 0」
  才成立，否则扫描范围被扫空时它会照样报绿。约束比原来更紧：任何一处新的「没绑 error」立刻红。

## 2026-09-27 — 46 条待合并队列清空：落地方式与正文那张顺序表的三处出入

- 里程碑 / 版本：v0.12.0（本条是 PR #118 的收口；那条把执行顺序算出来贴进正文，并写明「这张表随队列变动即过期」——现在它过期了，这一条记的是实际怎么落地的）。
- 状态：DONE。分支：`docs/queue-closeout`。基线 `ad4b029` → `d94b8a36`。
- 结果（现量，不是回忆）：`main` 从 `ad4b029` 到 `d94b8a36` 共 **202 个提交**、本次会话合并 **62 条 PR**，
  **开放 PR 0 条**、远端只剩 `main`。`CI=true pnpm check:all` → exit 0（**238 文件 / 2,789 用例**）。
  门禁 36 → **42**（本地 39 / CI 41 / 豁免 3，9 个工作流）；台账条目 99 → **102**；
  C08 两本台账 **22 处 → 0 处**（断言侧与解构侧各自清零）；解构侧未绑定读取 **15 → 0**。
- **出入一：#118 正文说的「一条 20 个 PR 的长栈」在 C08-b 那一段不是长栈。**
  C08-b（#93 / #94 / #98 / #99 / #100 / #101 / #102）是从**同一条分支**上切出来的，
  父 PR 的 head 里已经带着子 PR 的提交。判据不是「分支图」，是 patch-id：合并 #98 之后
  `git log origin/main --grep='项目操作的读取失败不再答成权限或不存在的事实'` 命中 `323f5fac`，
  它的非台账 patch-id 与 #93 的 `5312e8f0` 一致，`src/lib/actions/projects.ts` 上也确实已是绑定
  `error` 的版本。所以 #93 与 #94 在合并 #98 时就一并落地了，本条把它们按「已落地」关闭而不是重开重合。
  **正文那条「按编号合会把 #93–#114 的工作留在 main 之外」对 C08-b 不成立，对 C08-c（#104–#114）成立。**
- **出入二：`--delete-branch` 会关掉别人的 PR。** 父 PR 合并后 base 分支被删，GitHub 随即把以它为
  base 的 6 条自动关闭，而它们的工作**没有**进 main（#93 / #99 / #117 / #119 / #129 / #137，
  三点差异 8–45 个文件）。GitHub 不允许 reopen 已删除 base 的 PR（422
  `state cannot be changed. The <base> branch has been deleted`），只能从同一 head 新开：
  **#158–#162**。所以这一批**不能**带 `--delete-branch`，要等整条链都落地之后再统一清分支。
- **出入三：台账冲突有两种形态，正文只写了「删三行标记即完整解」。** 除了两侧都新增（按日期稳定排序即可），
  还有两种：① 提交专门在「把条目搬到文件末尾」，于是「删除点」与「追加点」各自成冲突，逐块并集会留下**同一条目两份**；
  ② 同一条目被后续提交改写过正文，逃过整块文本比对。收尾按「标题行去重、保留最后一次」+ 全文按日期稳定排序归一化，
  再由 `check:progress` 独立验证（它自己给出的修法就是排序）。
- **三次门禁在真实合并上抓到的，不是事后补的**：
  1. **#145** —— pre-push 拦下 `QUERY_ERROR_CHANNEL_EXEMPT_STALE`：它把 `permission-gate.tsx` 两处都改成绑定
     `error` 了，台账里那条 `justified` 还写着 `sites: 2`。按门禁自己的判词删条目、更新两处解释它的注释，
     并把单测里当 fixture 用的文件名换成可注入台账（真实台账清空后那条用例本来会失去被测对象）。
     `justified` 这一类因此清零。
  2. **#112** —— `expect(unbound.length).toBeGreaterThan(0)` 红了，实测 **159 处判读 / 0 处未绑定**：
     C08-c 八批把债还完了，而那个地板值正是它自己写的清零判据。升级成**天花板** `unbound === []`，
     留下非零分母与 `skippedUnparseable === 0`——「零未绑定」必须带着这两个条件才成立。
  3. **#153** —— `RATE_LIMIT_STALE` ×2：#136 的按 IP 滑窗落地后，两条营销端点的豁免到期，
     而那两条的 `reason` 里自己写好了「#136 合并后删掉这两行」。按判词删掉，限流缺口 2 → 0。
- **两个我自己犯的错，记下来免得重犯**：
  1. 先用 `git rebase` 重放，结果**把已合并的提交又放了一遍**——台账在冲突解算时被改写过，patch-id 对不上，
     git 认不出「已应用」。改成「按 subject 剔除已合并提交」，并对 **864 条**跳过项做了一次集中复核
     （其中 subject 在 main 里找不到的：**0 条**）。这一步同时暴露了 patch-id 会因 **hunk 上下文行**变化而不同，
     所以它只能当复核信号、不能当判据。
  2. 给 `src/lib/security/query-error-channel.ts` 定的「门禁裁决」规则（取 ours，门禁不过再取 theirs）
     **静默丢掉了 #113 的核心接线**：`unboundAwayIssues` 定义在却没有调用点，而门禁因为规则没接上反而通过。
     补回接线后，把「重放结果不许残留冲突标记」的断言从限定路径改成**全仓扫描**——上一轮 `scripts/check-all.sh`
     正是漏在路径限定之外、被 pre-push 抓到的。
- 回滚：每条 PR 独立可 revert；`main` 无 merge commit（全程 `--rebase`，`required_linear_history` 之下）。
- 下一项：无队列可合。剩下的都是产品决策与外部权限，不是合并顺序问题。

## 2026-09-29 — C13 后半：「生产构型不许开着 mock」从注释里的一句话变成 `check:security` 的一条规则

- 里程碑 / 版本：v0.12.0（任务池 C13 的后半；前半是 2026-09-25 落地的运行时那道闸）。
- 状态：DONE。分支：`feat/c13-production-mock-gate`（PR #166，已合并）。基线 `e99e5925`。
- **为什么它是下一项**：roadmap 里 C 域只剩这一条可执行，而它是被 C12 落地时**量**出来的，
  不是设想的——`RATE_LIMIT_LEDGER` 那 18 条 mock 豁免与 `ROUTE_AUTH_LEDGER` 整族 `mock-only`
  的理由都写着「它们只在 mock 构型下存在」，而「生产不开 mock」当时**没有任何门禁在管**
  （`rate-limit-policy.ts:63` 自己写着「`scripts/check-security-config.js` 里没有 MOCK 字样」）。
  前半（`config.ts` 的生产闸）2026-09-25 已落地，配置面这一半一直空着。
- 结果：新增 `inspectProductionMockSettings`（规则 `src/lib/security/security-config.ts`，
  接线 `scripts/lib/security-config-check.js`）；`CI=true pnpm check:all` → exit 0，
  **238 文件 / 2,815 用例**（main 是 238 / 2,789，`+26` 条全在这两个文件里）。
- **判据怎么划的（这一步比规则本身重要）**：按「谁是生产面」划，**不**按「哪里出现 MOCK 字样」。
  `.env.production` 按文件名是生产面；`vercel.json` 的 `env` 会被 Vercel 发到所有目标（含 production）；
  CI 工作流**只有自己声明了生产意图时**才算（`vercel deploy --prod` / `--env production` /
  `VERCEL_ENV: production` / `docker build --build-arg NEXT_PUBLIC_MOCK_ENABLED`）——
  仓库里今天**一条都没有**（部署走 Vercel 的 git 集成，CI 只做构建与只读冒烟），所以那份名单是
  **待命**的，而不是从「我猜生产部署长什么样」来的。
  反面同样重要：按「出现 MOCK 字样」判会立刻把 `.env.example`、`.env.development`、`.env.local`
  与 **`e2e-parallel.yml`**（开着 mock 跑 `pnpm build`，E2E 就要这个构型）判红——
  那是一条没人会去修的假红，比没有门禁更糟。所以有一条用例直接把真实树上的这些面喂进去并断言 `[]`。
- **失败封闭的那一半**：一条生产面都没扫到时返回 `no production surface to inspect` 而不是 `[]`。
  「没扫到」和「干净」长得一模一样，而这正是本规则唯一会失效的方式（`.env.production` 改名、
  vercel 配置挪走、IO 层忘了读）。与 `RATE_LIMIT_NOTHING_MEASURED`、
  `query-error-channel` 的分母断言是同一条纪律。IO 层那侧另有 4 条用例，其中一条**不加任何注入**、
  强制走真实读取——否则「规则接了线」与「规则能被调用」是两件事。
- **三次变异核对，**前两刀各逼出实现里一个真缺陷**（这是本条最值钱的部分）**：
  1. 往 `.env.production` 末尾追加 `=true`（文件里本来就有一行 `=false`）→ **没红**。
     只读第一个赋值时这一刀不红，而「先关后开」正是部署平台上改环境变量最常见的形状。
     改成「读全部、任一为 `true` 即红」，并在消息里打出 `found N assignment(s)`。
  2. 把已有的 `=false` 改成 `=true` → 红（1 条赋值）。
  3. `vercel.json` 顶层 `env` 设成 `true`，且是**行内** JSON → **没红**。
     只锚行首的行级解析漏掉整行 JSON，于是另配一条 JSON 专用式（键必带引号、必紧跟 `{` 或 `,`，
     这两个条件就是它的锚，不需要猜「行内还有没有别的东西」）。三刀跑完 `git status` 干净。
  另有两条**在单测阶段就红**的实现缺陷：值解析没摘引号（`NEXT_PUBLIC_MOCK_ENABLED="true"`
  会被读成非真值 → 一条永远不红的门禁），以及大小写那条我先写成了比运行时更严
  （`TRUE` 判红），改成与 `evaluateMockMode` **逐字一致**并把理由写在旁边：更严造出的是假红。
- 顺带修掉一处**已经过期的事实**：`rate-limit-policy.ts` 那段注释还写着「生产不许开 mock
  目前没有任何门禁在管」，现在改成「两道闸各守一道」+ 明确这一列端点不加窗口是
  **「进不来」的结论，不是「没人想过」**。按 D04 口径，漂移的陈述要改，不能只加新的。
- 文档：双语文档站 `mock.md` / `zh-CN/mock.md` 的「方式一」各补一段配置面规则（含「E2E 面刻意在外」），
  `docs/operations/environments.md` 的 Preview 安全段同步；roadmap C13 条改写成「两半都已落地」
  并把上面这些出入记在条目上（不是记在 PR 描述里——roadmap 是给人回来查的）。
- 明确**不**做的：① 不把 mock store 改成请求级（roadmap 原文就禁止，会重演 C01 的
  「Action 写进去、RSC 读不到」）；② 不改 Dockerfile 的 `ARG NEXT_PUBLIC_MOCK_ENABLED`——
  它从 build arg 取值、不写死，且 `isMockEnabled` 在生产构建里折成 `false`，
  也就是说**镜像即使带着 `true` 构建出来，跑起来 mock 也是关的**；③ 不给 `mock-only` 家族
  另加一条「路由必须真的 404」的门禁——C11 的 `ROUTE_AUTH_LEDGER` 已经核过
  `isMockEnabled` 在每个 handler 的闭包里可达，另起一条只会把 `check:route-auth` 的职责
  撕成两半（要加也只能加在那里，且是另一个池项）。
- 回滚：单条 revert 即可，运行时那道闸（`config.ts`）不受影响——本条是纯增量。
- 下一项：继续找缺陷。C 域按 roadmap 已无未落地条目；A 域只剩产品决策（`profiles.timezone` 去留、
  「已读是否等于不必寄」），B 域整体等外部权限（Vercel 配额 + 云端 Supabase 凭据 + 隔离账号）。

- 更新时间：2026-09-29（UTC）。

## 2026-09-29 — C09 后半：8 处 `user!.id` 一次收完，顺手给这类形状留了一条常驻检查
- 里程碑 / 版本：v0.12.0（任务池 C09）。分支：`feat/c09-session-user-classification`（PR #169）。
- 状态：DONE。基线：PR #166（C13 后半）合并后的 `main`。
  **分支换过一次名，连原因一起记下来**：第一版开在 `feat/c09-session-user-truth-table` 且叠在 C13 分支上，
  而 #166 用 `--rebase --delete-branch` 合并时 GitHub 随即把它自动关闭——2026-09-27 那条记过的形状，
  又踩了一次；按同一条 head 重开为 #168，又因 rebase 改写了祖先而 `CONFLICTING`。
  **没有 force-push**：关掉 #168，从新 `main` 起一条新分支 cherry-pick 那一个提交，另开 #169。
  前两次都不是代码问题，而「合并不是最后一次检查」这件事本身要写进台账，否则下一个人还会重排一遍。
- **为什么它是下一项**：roadmap 上 C09 那段写着「那 8 处 `user!.id` 现在不动，原因是**重叠**而不是难度
  ——这 5 条分支正在重写同一批文件」。那条 46 项的待合并队列已于 2026-09-27 全部落地，
  **阻塞条件自己消失了**，而 roadmap 的正文不会自己改，于是「推迟」变成了「没人再回来」。
  这是本仓库里最容易被静默遗忘的一类待办：不是没做，是等的东西已经等到了而没人触发。
- 结果：`src/app/**` 里 `user!` 由 **15 处 → 0 处**（8 个页面）。
  `CI=true pnpm check:all` → exit 0，**240 文件 / 2,828 用例**（上一条是 238 / 2,815）；`pnpm build` → exit 0。
- 落地：`src/lib/auth/session-user.ts` 的 `requireSessionUser(supabase)`，三条出口各有名字——
  读到用户就返回（**已判空**，所以调用方写 `user.id`）、确认没有会话就 `redirect(ROUTES.login)`、
  确认是读取故障就抛 `SessionReadUnavailableError`（带 `code`，仪表盘 `error.tsx` 有重试按钮）。
  分类仍交给 `session-error`，与 `guards.ts` / `api/auth/callback` / `actions/audit` 同一套判据。
  8 条单测覆盖三条出口 + 两条反向证据（「没有会话时绝不抛 `SessionReadUnavailableError`」——
  否则「一律抛错」也能骗过整套测试）。
- **中途返工了一次，原因记在这里免得重犯**：第一版让 helper 返回 **id**，结果 type-check 报出
  `profile` 与 `settings` 两页另有 7 处对裸 `user` 的引用（`user?.email`、`user?.created_at`、
  `user?.last_sign_in_at`）。**只把 id 交出去会把那些「容忍 null 的可选链」变成「为了拿邮箱
  再发一次请求」——那是拿一个真缺陷换另一个**。于是改成返回整个 user，顺带把 `user?.email ?? ""`
  收成 `user.email ?? ""`（类型上从此不必再假装可空）。
- **另一处返工，代价更大**：改完 8 个文件后顺手跑了 `prettier --write "src/app/dashboard/**/*.tsx"`，
  它的 `prettier-plugin-tailwindcss` 重排了 class 顺序，**把 9 个本来与本条无关的文件也改了**
  （admin / analytics / api-keys / integrations 等）。`git checkout -- src/app/dashboard/` 全部回退后重来，
  改成只做字符串替换、一次 prettier 都不跑——本仓库的 `format` 脚本并不在 CI 里，
  tailwind 插件的排序偏好与已提交代码不一致，**跑一次就是一次无关 diff**。
- 常驻检查 `session-user-wiring.test.ts`（读源码形状，不是运行时用例——缺陷本身是**类型上的一句谎**，
  jsdom 里把 `getUser` 桩成永远返回一个用户，任何运行时用例都分不出「写对了」与「又写错了」）：
  「`src/app/**` 下不得有 `user!`」+ 非空分母 + 反向证据（地板值 8 个页面确实在用
  `requireSessionUser`）+ 防空转用例。**没有**接成新的 `check:*` 脚本：判据只有一个记号，
  `pnpm test` 在 pre-push 与 CI 都跑，注册一条新门禁要多维护四处接线（package.json /
  check-all.sh / 工作流 / 豁免表），代价大于收益；先例是 `mock/config.test.ts` 钉构建期折叠。
  判据**没有白名单**——真有合法的可空局部变量也叫 `user`，修法是改名；开白名单等于把
  「谁都可以把自己排除在外」写进规则。
- **写检查时自己踩的坑，已由用例挡住**：`g` 标志正则的 `lastIndex` 是**跨调用保留**的，
  复用同一条正则扫多行会让同一文件的第二处违规被跳过——「漏掉一半现场」比「全漏」更难发现。
  加了「同一个文件里的多处违规一处都不漏（3 处）」这条用例。
- 变异核对（真实树，改完复原）：把 `profile/page.tsx` 的 `.eq("id", user.id)` 退回 `user!.id`
  → 该用例红并点名到文件与那一行；复原后 5 条全绿。
- 明确**不**做的：① 不改 `proxy.ts`——`user = null` → 重定向登录页是**正确答案**，
  把 error 单独放行会把一次普通的过期会话变成错误边界页（roadmap 原文就写了这一条）；
  ② 不动 `mfa/page.tsx` 的 `refreshSession`（要连 MFA 流程一起判，单独改会把成功路径改坏）；
  ③ **不**把 C09 的另一半（页面只解构 `user` 而不取 `error`）接成门禁：合法状态与「没读到」
  在 AST 上都只是「没取 error」，先接会把正常写法一并点掉——那一半仍然是台账，不是门禁。
- 回滚：单条 revert。`requireSessionUser` 是纯新增模块，8 个页面的调用点可独立回退。
- 下一项：继续找缺陷。A 域剩产品决策，B 域等外部权限，C 域与 D 域按 roadmap 已无未落地条目。

- 更新时间：2026-09-29（UTC）。

## 2026-09-29 — C13 的 CI 反证：一条本地全绿、CI 报 ENOENT 的用例，和它逼出来的覆盖面订正
- 里程碑 / 版本：v0.12.0（PR #166 的 CI 反馈，不另起分支）。
- 状态：DONE。分支：`feat/c13-production-mock-gate`（PR #166，已合并）。
- **CI 抓到的，不是事后补的**：`Lint & Type Check` 与 `Unit Tests` 两个作业红在
  `Error: ENOENT: no such file or directory, open '/home/runner/work/IndieStack/IndieStack/.env.production'`
  ——C13 那条「真实仓库的生产面集合本身是干净的」用例直接 `readFileSync` 读 `.env.production`，
  而它**被 `.gitignore` 排除**（`git ls-files` 里 `.env*` 只有 `.env.example` 一个），
  于是本地全绿、CI 必然崩。本地跑 `check:all` 跑一百遍也抓不到。
- 修法：与 IO 层同一套读法——**读不到就跳过**，不是读不到就崩；
  `PRODUCTION_CONFIG_FILES` 是「哪些路径算生产面」，不是「这些文件一定存在」，
  缺文件这件事本来就该交给 `no production surface to inspect` 去说。
  分母断言从 `=== 2` 改成 `>= 1`：`vercel.json` 是跟踪的，至少它一定在，
  写死 2 就是把「本地有 `.env.production`」当成全仓事实——那正是第一版的错。
  验证方式：把 `.env.production` 移走模拟 CI（`mv` 到 `/tmp`），83 条用例全绿、
  `check:security` 仍 exit 0；移回后同样。
- **顺手订正一条我自己写过头的话**：`.env.production` 不在版本库里，
  所以**这条规则在 CI 里实际盯的是 `vercel.json` 与带生产意图的工作流**，
  `.env.production` 那一格咬的是本地构建与模板用户自己的 checkout。
  订正写进规则头注释、CHANGELOG 与 roadmap 三处。
  「覆盖面被高估」是本仓库反复付过学费的形状（C12 的限流读数、C08 的 22 处台账，
  都是先量后写才没写错），而**这次是 CI 替我量的**——比我自己量更可信。
- 门禁本身没坏：`security-config` 作业在同样的缺文件条件下照常 exit 0。
  一条门禁的失败要分清是「规则错了」还是「用例把环境的偶然当成事实」，
  这一条是后者，所以改的是用例与文档，不是判据。

- 下一项：#166 已合并（`12f8f371`），C09 走 #169 重开；继续找缺陷。

- 更新时间：2026-09-29（UTC）。

## 2026-09-29 — C09 再往前一步：剩下 4 处会话读取收进同一个入口，并给这类形状加一条治本的判据

- 里程碑 / 版本：v0.12.0（PR #169 的后续）。分支：`feat/c09-session-layouts`。
- 状态：DONE。基线：`2bd952dd`（#169 合并后的 main）。
- **为什么接着做这条**：#169 修的是 8 个页面里 `user!` 那一种**症状**，而同一批文件里还留着
  4 个 layout/页面用另一种写法读会话——`const { data: { user } } = await supabase.auth.getUser()`
  加 `if (!user) redirect(ROUTES.login)`。它们读**角色**时读失败已经答成抛错而不是 redirect
  （那是 C08 那一族修的，代码注释就写在 `admin/layout.tsx:36`），**唯独会话这一次读取仍然把
  一次 Auth 抖动答成「你没登录」**：客户端清掉本地会话并跳登录页，而重新登录走的正是同一条读取。
  四个文件：`dashboard/layout.tsx`、`admin/layout.tsx`、`admin/audit-logs/layout.tsx`、
  `profile/edit/page.tsx`。
- 落地：全部改走 `requireSessionUser(supabase)`。行为变化只有一处、方向单一：
  **可重试的读取故障**从「跳登录页」变成「错误边界 + 重试按钮」；
  **真的没登录**（`AuthSessionMissingError`）仍然是重定向，一行没变——所以这次改动
  碰不到任何正常路径。实测 `src/app/dashboard/**` 里 `auth.getUser()` 由 **4 处 → 0 处**。
- 顺带删掉 2 个因此变成未使用的 import（`dashboard/layout.tsx` 的 `redirect` + `ROUTES`、
  `profile/edit/page.tsx` 的 `ROUTES`）。**`pnpm lint` 不报未使用的 import**——
  那是 type-check / bundler 的事，而 `next build` 也不会因为它失败（tree-shaking 照常）。
  所以这一步是逐个查出来的，记在这里免得下一个人以为 lint 过了就没人用。
- **常驻检查加了第二条判据，而且第二条才治本**：
  1. 「`src/app/**` 下不得有 `user!`」——只判**症状**。它的盲区是实测出来的：一个新页面写
     `const { data: { user } } = await supabase.auth.getUser()` 再配 `if (!user) redirect(...)`
     时第 1 条**全绿**，而缺陷原封不动又来了一遍——那正是这 4 个文件原来的写法。
  2. 「`src/app/dashboard/**` 下不得直接 `auth.getUser()`」——判**成因**。被认可的入口只有
     `requireSessionUser`（只要用户）与 `requireAuth`（还要角色）。
     范围只到 `dashboard/**`：`proxy.ts` 重定向是对的、`api/auth/callback` 要区分 error、
     route handler 走 guards，拿一条规则覆盖它们就是把判据做成噪音。
     另有一条用例把 `auth.getSession()` **显式排除在外**并写明理由（settings 页用它算
     `currentSessionId`，只用于**显示**「这台」标记、不参与任何权限判定，解析不出 token 时
     返回 null，fail-closed）——把它一并禁掉就是拿一条造假的规则换一次改动。
- 变异核对（真实树，改完复原）：
  ① 把 `billing/page.tsx` 退回自己解构 `auth.getUser()` + `if (!user) redirect` → 第 2 条红并
  点名 `dashboard/billing/page.tsx`；复原后 8 条全绿。
  ② 第 1 条的变异（退回 `user!.id`）在 #169 里已做过。
- 读数：`CI=true pnpm check:all` → exit 0，**240 文件 / 2,831 用例**（#169 是 2,828，`+3` 条
  是新增的第 2 条判据那三例）。
- 下一项：继续找缺陷。A 域剩产品决策，B 域等外部权限，C/D 两域按 roadmap 已无未落地条目。
  C09 到此为**全部收完**：全仓 `src/app/**` 再无 `user!`，仪表盘再无直接 `auth.getUser()`。

- 更新时间：2026-09-29（UTC）。

## 2026-09-29 — 顺着 C09 量出去的同型缺陷：守卫失败被一个二元三元压成两种说法

- 里程碑 / 版本：v0.12.0。分支：`fix/checkout-guard-status`（PR #171）。
- 状态：DONE。基线：`a506ce59`（#170 合并后的 main）。
- **怎么找到的**：上一条修完 C09 之后去核 roadmap 里那句「两个已知消费者不在本条射程」——
  `api/analytics` 由 #103 修好了，`api/stripe/checkout` 仍然把**每一种**守卫失败写成
  `401 + notAuthenticated`。同一个缺陷的两次落地，谁也没给另一次提个醒。
  顺着它往外量：`src/app/api/**` 里 3 个用 `safelyRequire*` 的路由，只有它没用 `guardHttpStatus`；
  再往外到 Server Action，找到 **8 处**调用点写着一模一样的
  `auth.error.code === "UNAUTHORIZED" ? "notAuthenticated" : "forbidden"`。
- **缺陷比 C09 那条更重**：`AuthGuardError.code` 有四个值
  （`UNAUTHORIZED` / `FORBIDDEN` / `NOT_FOUND` / `SERVICE_UNAVAILABLE`），那个三元只有两个出口，
  于是 `SERVICE_UNAVAILABLE`（我们自己没读到会话或角色）被答成 `forbidden`——
  **一件关于用户权限的事实**。管理员看到「你没有权限」、列表显示成空的、日志里什么都没有。
  `guardHttpStatus` 早就分开了（`SERVICE_UNAVAILABLE → 503`），所以同一个模块里
  **同一个概念有两份映射**，其中一份是错的：类型层看不出错，只有逐个调用点看得出。
- 落地：新增唯一出口 `guardFailureKey(error)`（`src/lib/auth/guards.ts`）返回
  `notAuthenticated` / `forbidden` / `authUnavailable` 三键；8 处调用点各改一行；
  `api/stripe/checkout` 改用 `guardHttpStatus` 并分开两种键；
  新键按双语登记（`messages/{en,zh-CN}/actions.json`，键数 1260 → 1260，`check:locales` 对称）。
- **一处刻意的「让代码迁就判据」**：checkout 那里写成两个 `if` 分支而不是一个三元。
  `route.test.ts` 那条「路由能返回的每个错误码都在两个 locale 里有文案」靠正则读
  `jsonNoStore({ error: "字面量" }`——三元里的两个键它一个都读不到，那条测试立刻从
  地板值 9 掉到 8 报红。放宽判据去迁就代码会把「动态键读不出来」这个真实盲区一起放宽；
  改代码则只是多一个 `if`。**这条在代码注释与 CHANGELOG 里都写了**，免得下一个人「顺手优化一下」。
- 常驻检查 `guard-failure-key-wiring.test.ts`：判据是「`src/lib/**` 下不得出现对
  `auth.error.code` 的就地三元」（`guards.ts` 自身除外）。
  **不钉具体字符串的理由**：只钉 `? "notAuthenticated" : "forbidden"` 的话，
  下一个人写成三元套三元照样绿；真正要守的形状是「一个四值判别联合被两出口三元吃掉两个」。
  带非空分母、一条防空转用例、一条「注释里写那个三元不算违规」，
  以及一条**「出口真的被用上了」（地板值 8 处调用点）**——少了它，判据可能在「规则自己坏了」的
  状态下全绿（前例：`query-error-channel` 的 `QUERY_ERROR_CHANNEL_PARSE`）。
- 测试：7 条 `guardFailureKey` 单测（含「三个出口互不相同」与「SERVICE_UNAVAILABLE 绝不是
  forbidden」两条反向证据）；checkout 路由 3 条新用例把三种守卫失败分别钉住；
  3 个 action 测试文件各加 1 条 `authUnavailable` 用例当反向证据。
  4 处 `vi.mock("@/lib/auth/guards")` 改成 `importOriginal` 展开——原先只导出被测函数，
  新出口一接上就报 `No "guardFailureKey" export`（这类桩是「只桩被测的那一个」写法的必然代价）。
- 变异核对（真实树，改完复原）：把 `actions/webhooks.ts` 的一处退回二元三元 → 常驻检查
  两条用例同时红（判违规 + 出口地板值不足），复原后 5 条全绿。
- 门禁自己抓到一次：`check:glossary` 报 `[GLOSSARY_TERM_FORBIDDEN] actions.authUnavailable`——
  「verify」在本仓库的术语表里统一译作「验证」，我写成了「校验」。改文案而不是加豁免。
- 读数：`CI=true pnpm check:all` → exit 0，**241 文件 / 2,847 用例**（上一条 240 / 2,831）；
  `pnpm build` → exit 0。
- 下一项：继续找缺陷。A 域剩产品决策，B 域等外部权限，C/D 两域按 roadmap 已无未落地条目。

- 更新时间：2026-09-29（UTC）。

## 2026-09-29 — 把「结论做完了要回头改那一行」变成一件 CI 会红的事（check:roadmap-entries）

- 里程碑 / 版本：v0.12.0。分支：`fix/checkout-guard-status` 之后另起 `chore/roadmap-entries-gate`（PR #172）。
- 状态：DONE。基线：`1bd9f51c`（#171 合并后的 main）。
- **动机不是「文档需要治理」，是这一天里踩了两次同一个坑**：
  1. C09 写着「那 8 处 `user!.id` 现在不动，原因是 5 条分支正在重写同一批文件」，
     而那条 46 项的待合并队列**两天前就清空了**。阻塞条件消失、正文没人回头改，
     于是「推迟」静悄悄地变成「没人再回来」——一条早已可做的待办在任务池里躺成了一句历史。
  2. C06 写着「定夺……保留还是删除」，而定案结论（**删除**）躺在 CHANGELOG 里两天，
     roadmap 那一行仍是开放式问句。任何人回来读它都会**重新决策一次**。
  两次的共同点不是「忘了写文档」，是**忘了改那一行**——而那一行没有任何东西在管。
- 落地：`pnpm check:roadmap-entries`（规则 `src/lib/release/roadmap-entries.ts` 纯函数 + 17 项单测，
  IO `scripts/lib/roadmap-entries-check.js`，入口 `scripts/check-roadmap-entries.js`，
  已接进 `package.json` 与 `scripts/check-all.sh`——CI 只跑 `check:all`，所以这一步就是 CI 覆盖；
  `check:gates` 读数由 42 → **43** 个门禁）。
  判据只有一句：**每一条任务池条目要么带 `YYYY-MM-DD` 的完成/定案标注，要么写明被什么挡住**
  （产品决策 / 外部权限 / 上游缺失）。失败封闭那一格：一条条目都没解析出来时报
  `ROADMAP_NO_ENTRIES`，而不是返回空数组——「没扫到」和「全部合规」长得一模一样。
- **顺带修掉 roadmap 开头一段自相矛盾的话**：它原来要求「状态只在退出报告里维护，
  roadmap 只写目标与验收口径」，而文件里到处是就地完成标注——**约定与做法互相否定**，
  于是两种读者都拿不到准数。现在那一段改成**两处都留、并由门禁要求一致**，
  并把两次踩坑写进去当作这条规则存在的理由。
- **判据自己被抓出三个真缺陷，全部在真实文件上**：
  1. **`DATED_MARKER` 的日期是可选的**（写成 `(\d{4}-\d{2}-\d{2})?`），
     于是 `（**已完成**：…）` 两条规则同时命中，`ROADMAP_MARKER_UNDATED` 那一支**永远走不到**——
     判据废掉了自己，而单测当时是绿的（它只测了「有日期」这一侧）。改成日期必需。
  2. **每条的开头取了「标题 + 后面 16 行」**，量出来的后果是：把 C06 的完成标注删掉之后
     门禁**仍然报绿**——窗口越过了 C07 的标题，**借用了下一条的完成标注当自己的证据**。
     改成「在下一条开始处截断」。借用比没有判据更坏：它让门禁在一个条目上永远报绿。
     现在由「不得借用下一条目的完成标注」那条用例钉住。
  3. 修好 ② 之后，真实文件暴露出 **3 条一直在借邻居证据才通过的条目**（B04 / B05 / C06）
     与 1 条无日期标注（A02 的「随 A01 完成」——日期挂在被它跟随的那一条上）。
     逐条按真实状态补齐：B02–B05 写明**未完成：外部权限**并说明缺什么凭据，
     C06 补回定案日期，A02 补上自己的日期。
- **三次变异核对**（全部在真实文件上做、做完复原，每次只报**该报的那一条**）：
  ① 删掉 C06 的完成标注 → `ROADMAP_ENTRY_UNMARKED` 点名 C06；
  ② 把 `（**2026-09-25 已定案并完成**` 改成 `（**已定案并完成**` → `ROADMAP_MARKER_UNDATED`；
  ③ 把 B02 的「外部权限」四个字去掉 → `ROADMAP_ENTRY_UNMARKED` 点名 B02。
  另有一条：删掉「## 任务池」这一节 → `ROADMAP_NO_ENTRIES`（解析器失效必须报红）。
- 读数：`CI=true pnpm check:all` → exit 0，**241 文件 / 2,864 用例**（上一条 241 / 2,847，`+17`）；
  `check:roadmap-entries` 自己报「29 条条目，完成标注或阻塞理由二者必居其一」；
  `pnpm build` → exit 0。
- **一条边界要说准**：这条门禁只管「有没有交代」，**不判断任务做得对不对**（那是退出报告的事），
  也不去数条数（条数写进正文就会随队列漂移，roadmap 开头为此专门改过一次口径）。
  豁免表留了口子，但**空理由不放过任何条目**——一个空的 `exempt` 关不掉任何一条。
- 下一项：继续找缺陷。A 域剩产品决策，B 域等外部权限，C/D 两域按 roadmap 已无未落地条目。

- 更新时间：2026-09-29（UTC）。

## 2026-09-29 — 关掉限流台账里那条已知缺口的**放大面**那一半（health 的 DB 探测）

- 里程碑 / 版本：v0.12.0。分支：`fix/health-probe-cache`（PR #173）。
- 状态：DONE。基线：`0f4df32d`（#172 合并后的 main）。
- **怎么找到的**：`check:route-auth` 报「45 = 16 有窗口 + 29 写明理由，其中 2 条标注为已知缺口」。
  两条缺口（`GET /api/health` / `GET /api/og`）都不是「判定为不需要」，而是**自己写明了怎么关**
  的——这正是 C12 设计的意图：缺口的条数每次印在读数里，而每条都带着它的关法。
  `health` 那条的关法有一半是「把 DB 探测结果按秒缓存」，那一半当场就做。
- 缺陷本身：那条端点必须能被负载均衡器、Docker `HEALTHCHECK` 与 `check:production-smoke`
  **无凭据**地打，所以按 IP 的滑窗会把监控自己读成 429（这一半是真做不了，缺口继续留着）；
  但它每次请求都真打一次 `profiles limit(1)` 的 anon 探测（超时 3s），
  于是**无凭据的重复调用把成本按次数转嫁给 Supabase，没有任何东西拦住**。
- 落地：`src/lib/health/probe-cache.ts` 的 `createProbeCache`（TTL 5s + **single-flight**），
  路由的 `checkSupabaseReachable` 改走它。**single-flight 比 TTL 更关键**：TTL 只挡得住
  「先后到达」的重复调用，而放大面通常来自**并发**的一簇——只加 TTL 的话 20 个并发探针仍然是
  20 次往返。**失败也缓存**（TTL 相同）：Supabase 挂掉时正是最需要挡住的时刻，
  「失败不缓存」看起来更实时，实际是把一次故障放大成一串。
  5 秒的来由写进代码注释：Vercel Cron 的保活是**每天一次**，5 秒已把日常成本降到二十万分之一，
  而 Docker `HEALTHCHECK` 的 `--start-period=20s` 与 LB 间隔通常在秒级。
- **一个测试侧的坑，顺手钉住**：路由里有了**进程级**状态之后，原来的 8 条用例用静态 import
  会共用一份缓存，于是「先让探测失败、再让它成功」的两条会读到上一条缓存下来的失败。
  改成每条用例 `vi.resetModules()` 后重新 import 一份模块实例；
  **没有给生产代码加「供测试清缓存」的导出**——那是另一种谎（告诉读代码的人这个缓存可以随便清，
  实际不行）。
- **实现里自己出的一个缺陷，由测试当场抓住**：第一版只在成功路径写缓存，**失败不缓存**，
  而模块头注释恰恰把「失败也缓存」写成了它的设计要点——**注释说一套、代码做另一套**。
  由「失败也缓存」那条用例逼出来（实测 1 次 vs 2 次）。改成缓存**已结算**的结果
  （成功值与失败同 TTL），并补一条「TTL 之外失败标记会被丢掉，DB 恢复后重新探测」——
  那条守住「不会把一次抖动变成一次停机」。
- 变异核对（真实树，做完复原，三刀都红）：
  ① 拆掉 single-flight 只留 TTL → **3 条红**，并打出「并发 20 次 vs 期望 1 次」；
  ② 失败不缓存（退回第一版）→ **2 条红**；③ 路由不查缓存 → **1 条红**。
- **剩下那一半说清楚，不夸大**：端点本身仍无凭据、无窗口；缓存是**进程内**的，serverless 下
  每个实例各有一份，挡的是「一个实例被重复打」而不是「整个部署被重复打」。
  要关掉剩下那半需要把「探针」与「对外可见的健康端点」分成两条路径，或引入跨实例共享缓存——
  台账条目里照旧写着这句，`RATE_LIMIT_GAP_MARKER` 仍然保留（缺口数仍是 2）。
  顺带按 D04 把条目里那句已经过期的「没有任何东西拦住这件事」改掉。
- 读数：`CI=true pnpm check:all` → exit 0，**243 文件 / 2,876 用例**（上一条 241 / 2,864，
  `+12` = 缓存 10 + health 路由 2）；`pnpm build` → exit 0。
- 下一项：另一条缺口 `GET /api/og` 的关法是「先按参数做缓存」，同一类工作；
  A 域剩产品决策，B 域等外部权限，C/D 两域按 roadmap 已无未落地条目。

- 更新时间：2026-09-29（UTC）。

## 2026-09-29 — 第二条已知缺口关掉：`/api/og` 加按 IP 的窗口（关法与台账原本写的不一样）

- 里程碑 / 版本：v0.12.0。分支：`fix/og-param-cache`（PR #174）。
- 状态：DONE。基线：`c60baca4`（#173 合并后的 main）。
- **起点是台账自己写的那句「关掉它的判据是先按参数做缓存」——而那个关法是错的。**
  参数缓存挡不住这条端点真实的放大方式：**变一下 `title` 就是一个新键**，
  于是任何参数缓存都以「每个键只算一次」收口，而攻击者要的正是这个。
  参数缓存能防的只有「同一篇文章被反复分享时重复合成」——那是 CDN 的活，
  响应本来就带 `s-maxage=86400`，不值得重复实现。
  真正能收住的是**按来的人算**的窗口。
- 为什么按 IP 在这条上成立（而会话限频不成立）：它挂在 `<meta og:image>` 上，
  社交预览爬虫与搜索引擎都是**以用户的 IP** 来取的，所以按会话限频会把所有人挤进一个桶；
  但正常爬虫每个页面只取一次，**60 次/分钟**对一个 IP 绰绰有余，同一个 IP 反复取才是异常。
  也就是说台账条目当初那句「按会话限频这种现成形态对它不成立」是对的，
  但它顺手把**按 IP** 也一起否掉了——那一步是缺的不是结论。
- 落地：路由加 `createRateLimit({ maxRequests: 60, windowMs: 60_000 })`，
  超窗回 429 + `no-store, must-revalidate` + `Retry-After`。
  **429 刻意不能长缓存**：放行那一侧是 `s-maxage=86400`，若 429 也长缓存，
  窗口一过期客户端仍拿不到图——「限流」本身就会变成一次更长的不可用。
  `Retry-After` 向上取整且**至少 1 秒**（0 或负数会让客户端立刻重试，把窗口变成一个紧循环）。
- **删台账条目这一步是门禁逼出来的**，不是我记得要删：`check:route-auth` 报
  `RATE_LIMIT_STALE`（有窗口却还躺着一条台账也是红）。读数由
  **16 有窗口 + 29 写明理由（2 条缺口）** 变成 **17 + 28（1 条缺口）**。
  这正是 C12 设计的意图在起作用：豁免会过期，门禁会喊。
- 测试：新建 `src/app/api/og/route.test.ts` 5 条（此前该端点**一条用例都没有**），
  钉住放行 / 超窗不合成 / 429 不长缓存 / `Retry-After` 取整 / **限流按请求打与参数无关**
  （最后一条正是参数缓存做不到的那一格：同一 IP 换三次 title，仍然是三次限流判定）。
- 变异核对（两刀都红，做完复原）：① 把限流从路由里去掉 → **5 条红**；
  ② 429 改成长缓存 → **1 条红**。
- 顺带按 D04 改掉 roadmap C12 条目里那句「其中 4 条自我标注为已知缺口（… `GET /api/og`）」
  ——它已过期，且过期的是**条数**（4 → 1），比过期的一句话更容易误导。
- **剩下的 1 条缺口说清楚**：`GET /api/health`。探针与对外可见的健康端点还没分成两条路径，
  而它的放大面已由上一条（#173）的 `createProbeCache` 关掉。剩下的那一半需要把
  「探针」与「对外可见」分成两条路由，或引入跨实例共享缓存——不是本条的射程。
- 读数：`CI=true pnpm check:all` → exit 0，**244 文件 / 2,881 用例**（上一条 243 / 2,876）。
- 下一项：A 域剩产品决策，B 域等外部权限，C/D 两域按 roadmap 已无未落地条目。

- 更新时间：2026-09-29（UTC）。

## 2026-09-29 — 把最后一条非阻断告警清零：25 处 `outline-none` + 一条更怪的「门禁污染自己的取证途径」

- 里程碑 / 版本：v0.12.0。分支：`fix/shadcn-outline-hidden`（PR #175）。
- 状态：DONE。基线：`9b67ca28`（#174 合并后的 main）。
- **起点**：把每道门禁自己的读数扫一遍找非零项，只剩一条：
  `check:tailwind` 的 `⚠️ [TW_RENAMED_UTILITY] src/components/ui:1 上游 shadcn 基元里还有
  25 处 v3 类名待跟随上游收口（非阻断）`。**全量统计发现 25 处全是同一个**：
  `outline-none` → `outline-hidden`。
- **这不是风格问题，从本仓库自己构建出来的 CSS 里量到**：
  `.outline-none{outline-style:none}`，而
  `.outline-hidden{outline-style:none;outline-offset:2px;outline:2px solid #0000}`，
  且 `outline-hidden` 自带 `@media (forced-colors:active)` 兜底。
  那圈 `transparent` 轮廓正是**高对比度模式下浏览器替我们画的焦点环**——
  也就是说那 25 个控件（按钮 / 输入框 / 下拉 / 开关 / 标签页 / 对话框 / 右键菜单…）
  在 Windows 高对比度模式下**只剩键盘操作**的用户彻底看不见焦点。
  「等上游」不成立：shadcn 上游同样在往 `outline-hidden` 收；本地改完下次 `shadcn add`
  覆盖也只是回到今天这个形状（而门禁会再报一次）。
- **顺带查出本轮最怪的一条：门禁自己把被禁的类名塞进了产物。**
  修完源码 25 处之后，`rg outline-none .next/static/chunks/*.css` **仍然有命中**——
  三段死规则（`.outline-none`、`.hover\:outline-none:hover`、`.focus-visible\:outline-none:focus-visible`）。
  逐一量出来源（每一刀都做完复原）：
  1. 假设一：陈旧的 `.next-e2e-0/` 产物被扫进来了 → 移走重建，**仍有**残留，排除。
  2. 假设二：`coverage/`（测试覆盖率 HTML 内嵌源码）→ 移走重建，**仍有**残留，排除。
  3. 真因两条：`src/lib/tailwind/` 里是 `check:tailwind` 的规则本体与它的用例，
     它们**必须逐字**写着被禁的类名（正则名 + 测试 fixture），否则门禁就检查不了它；
     以及 **Markdown 也在 Tailwind 的默认扫描范围里**——`CHANGELOG.md` 与历史 roadmap 里
     **提到**某个类名等于在用它（连本条 CHANGELOG 自己也贡献了一段，这是个闭环）。
- 修法：两条 `@source not`（v4 的排除指令，只排除**扫描**，不影响 TypeScript 编译，
  也不影响 docs-site 自己的构建——那是另一套 VitePress + 自己的 CSS）：
  排除门禁目录、排除 `**/*.md`。写成一句原则放在 CSS 注释里：**Tailwind 该扫的是代码，不是散文。**
  量到的效果：产物里 `outline-none` **归零**，CSS 总体积 **73952 → 73128 字节**（少 824 B 死规则）。
  这一格值得单独记，因为它堵住的是「从产物取证」这条路——而那恰恰是判据失效时最该看的地方。
  **判据把自己的取证途径污染了，比判据本身失效更难发现**：门禁报绿、产物有货、两者都对不上。
- 判据从**告警**升成**天花板**：`native-theme.test.ts` 新增 3 条——
  ① 真实仓库 `src/components/ui` 读数为 0，**带非空分母**（`> 20` 个文件，否则「没扫到」也能报绿）；
  ② 合成输入读数为 0（`warnings` 与 `errors` 都空）；③ 退回 `outline-none` 时会红。
  变异核对：把 `button.tsx` 一处改回 → 真实仓库那条红并点名 `src/components/ui/button.tsx`。
- **为什么这条不在 `check:a11y` 的射程内**（值得记，免得下一个人把它塞进 a11y 规则）：
  `check:a11y` 是静态写法审计，看 ARIA 属性 / `alt` / 按钮标注；
  「`outline-none` 会不会把轮廓彻底去掉」属于**类名语义**，只有产物里看得见——
  所以它由 `check:tailwind` 的类名规则守。把两套规则混在一起只会让两边都变钝。
- 全量验证（改动碰到 17 个 shadcn 基元 + globals.css，值得跑全套）：
  `CI=true pnpm check:all` → exit 0；`pnpm test:e2e` → **113 passed / 0 failed**（2.2m）；
  `check:bundle` 与 `check:perf` 均在阈值内（CSS 73.1kB < 100kB，bundle 基线未涨）。
- 下一项：A 域剩产品决策，B 域等外部权限，C/D 两域按 roadmap 已无未落地条目；
  门禁读数里已无非零项（唯一那条缺口是 `GET /api/health` 的第二半，需拆探针与公开端点）。

- 更新时间：2026-09-29（UTC）。

## 2026-09-29 — 本轮收口：9 条 PR 全部合并，v0.12.0 的可执行部分到此做完

- 里程碑 / 版本：v0.12.0。基线 `e99e5925` → `8cec8bf9`。
- 状态：**代码侧 DONE，发布侧 BLOCKED（外部权限）**。远端只剩 `main`，开放 PR 0 条。
- 本轮合并（全部 `--rebase`，无 merge commit，`required_linear_history` 之下）：

  | PR | 主题 | 门禁读数变化 |
  |---|---|---|
  | #166 | C13 后半：生产构型不许开着 mock 变成 `check:security` 的一条规则 | `+26` 用例 |
  | #169 | C09 后半：8 处 `user!.id` 收进 `requireSessionUser` | 用例 2,789 → 2,828 |
  | #170 | C09 收尾：剩下 4 处会话读取进同一入口 + 一条**治本**的判据 | `+3` |
  | #171 | 守卫失败不再被二元三元压成「你没登录」/「你没权限」 | 用例 → 2,847 |
  | #172 | `check:roadmap-entries`：结论做完了要回头改那一行 | 门禁 42 → **43** |
  | #173 | health 的 DB 探测加 short TTL + single-flight | 用例 → 2,876 |
  | #174 | `/api/og` 加按 IP 窗口，限流缺口 2 → **1** | 用例 → 2,881 |
  | #175 | 25 处 `outline-none`：高对比度模式下没有可见焦点 | 用例 → 2,884 |
  | #176 | 订正本台账里一处我自己写错的用例增数 | — |

- **最终读数（`main` 上现量，不是回忆）**：
  `CI=true pnpm check:all` → exit 0；`pnpm verify:build` → exit 0
  （lint / type-check / 244 文件 2,884 用例 / build / bundle / perf）；
  `pnpm test:e2e` → **113 passed / 0 failed**（2.2m）；`pnpm test:coverage` → exit 0，
  覆盖率 **97.43% 语句 / 92.46% 分支 / 98.33% 函数 / 98.59% 行**（阈值 91/… 未下调）；
  `check:gates` → **43** 个门禁（本地 40 / CI 42 / 豁免 3，9 个工作流）；
  bundle **2926.4 kB**（基线 2926.8，**略降**——#175 的 `@source not` 去掉了 824 B 死 CSS）；
  CSS **71.4 kB**（此前 73 kB）。
- **两态台账的现值**（每条都带自己的关法，缺口的条数每次印在读数里）：
  路由鉴权 **45/45**，限流 **17 有窗口 + 28 写明理由，其中 1 条已知缺口**，
  查询错误通道 **370 文件 / 4 处断言 + 168 处解构 / 0 处未登记**。
- **发布判断：v0.12.0 不发布，且这是有依据的判断而不是拖延。**
  roadmap 退出标准第 2 条要求 B01、B02 都有执行记录（UTC 时间、命令、状态码、
  artifact 指纹或 deployment id），而 B02–B05 全部卡在**外部权限**：
  Vercel 部署与 build 配额、云端 Supabase 凭据、可牺牲的隔离账号。
  roadmap 风险段自己写着「若权限未到位，v0.12.0 不得因为『代码都改了』宣布退出标准达成」。
  同理 `v0.11.0` 的 tag 也仍未打（缺账户删除演练与 commit 归属证据）。
- **剩下的都不是「等我有空」，是有名字的阻塞**（`check:roadmap-entries` 现在强制每条都写明）：
  - **A05 余下**：站内已读是否等于不必寄——**产品决策**；
  - **B02–B05**：回滚演练 / 账户删除全链路 / 云端保留期与擦除 / provider 与 incident 演练
    ——**外部权限**（各自缺什么凭据已写进 roadmap 条目头）；
  - **`GET /api/health` 的第二半**：把「探针」与「对外可见的健康端点」分成两条路径，
    或引入跨实例共享缓存。它的**放大面已关**（#173），剩下的是纵深防御；
    但它会改动 `check:production-smoke`、Docker `HEALTHCHECK`、Vercel Cron 三方依赖的
    响应契约与 B01 记录下来的生产证据，**不该由我单方面改**。
- **本轮最值钱的一条经验**（也是「下一次去核 roadmap 的某一句」比「再想一个新任务」
  产出更高的原因）：C09 的「现在不动」与 C06 的「定夺」都不是忘了做，是**结论做完了、
  写在别处、任务池那一行没人回头改**。`check:roadmap-entries` 就是为这件事存在的，
  而它自己也被变异核对逼出三个真缺陷（可选日期让它自己废掉、窗口越界借用邻居的证据、
  修好之后暴露出 3 条一直在借证据的条目）。

- 更新时间：2026-09-29（UTC）。

## 2026-09-29 — 顺着「产物里有没有不该有的东西」量出来的 48%：生产首页的 JS 有一半是 mock 假数据

- 里程碑 / 版本：v0.12.0。分支：`fix/mock-client-bundle`（PR #178）。
- 状态：DONE。基线：`fe3e3e72`。
- **怎么开始量**：上一条把「门禁污染自己的取证途径」记下来之后，我接着问了一个没人量过的维度——
  **产物里有没有本不该在那里的东西**。第一问就是 mock：`NEXT_PUBLIC_MOCK_ENABLED` 的生产闸
  早就有了（2026-09-25 的 C13 前半），**但那管的是「跑不跑」，不是「进不进产物」**。
- **量到的（gzip 后的真实传输量，不是文件大小）**：生产首页 **506,604 字节**的 JS 里，
  **246,541 字节**是一个 742 kB 的 chunk，内容是 `mock-user-001` 那一整套假数据 + 整包 faker
  ——**占 48%**，而且是首页**单笔最大的一个资源**（第二名 73 kB）。
  用 Playwright 记网络请求复核：8 个生产页面里只有 `/` 去取它。
- **成因链（三段，每段都单独核过）**：
  1. `src/lib/supabase/client.ts` 用**静态** `import { …, createMockSupabaseClient } from "@/lib/mock"`；
  2. `@/lib/mock` 静态引入 `./data`（faker）与 `./store`；
  3. 本仓库 12 个 `"use client"` 模块都碰 `createClient`（`site-header` 在营销布局里，
     所以连首页都吃到了），整块跟着每一个客户端入口走。
- **为什么 `config.ts` 的折叠救不了它**（这一格最值得记）：那一处折的是 `isMockEnabled`
  这个**常量**，而调用点写的是 `shouldUseMock()`——**一次函数调用把常量链断掉了**，
  于是分支活着、静态 import 活着、整块 faker 跟着活着。
  修法用的是**同一个机制**：把 `NODE_ENV === "production"` 写进这个三元，
  打包器就能把分支折成常量 `false`，`createMockSupabaseClient` 随之没有引用点，整块被摇掉。
  顺带把 `shouldUseMock` 的 import 从桶里拆到零依赖的 `@/lib/mock/config`
  ——那个模块文件头本就写着「仅供 bundle 体积敏感的场景引入」。
- **效果（现量）**：首页 JS **506,604 → 260,084 字节（gzip，−48.7%）**；
  Playwright 复核 8 个生产页面（`/`、`/auth/*` 5 条、`/pricing`）**全部 0 次取到含 mock 的 chunk**。
  `pnpm test:e2e` → **113 passed / 0 failed**（mock 在 dev/E2E 构型下必须照常工作，这是回归闸）。
- **一个必须说准的分界**：`check:bundle` 只从 2926.8 → **2925.5 kB**（−1.3 kB），
  因为那块 741 kB 的死 chunk **仍然留在 `.next/static` 上**（被 5 个 auth 页面的
  client-reference manifest 列出），只是**没有任何页面会去请求它**。
  我试过在 `supabase/server.ts` 上用同一个折叠去彻底消掉它——**无效**（重建后仍在），
  所以没有把那处 no-op 改动留下来。「产物里存在」与「用户会下载」是两件事。
- **因此新加的常驻检查判「形状」而不是判产物**（`src/lib/release/mock-client-bundle.test.ts`，5 条）：
  ① 除已登记的 `src/lib/supabase/client.ts` 外，任何 `"use client"` 模块都不得静态 import
  `@/lib/mock` 桶（要判配置就用 `@/lib/mock/config`；要真拿 mock 客户端只能走动态 `import()`）；
  ② 那一处**必须**被可折成 `false` 的三元守着；外加非空分母、登记本身的防空转、
  「注释里提到不算违规」。
  **我先写的是「产物里不许出现 mock 记号」那条门禁，并且它当场抓到了一块残留死 chunk——
  然后我把它删了**：按「产物里存在」报红是**假红**（浏览器从不取它），
  一条永远红的门禁只会变成没人修的噪音，而仓库的规矩是「先量到误报才有依据的扩展」。
  **如实记账、不交红门禁**，是这个决定。
- 变异核对（两刀都红，做完复原）：① 折掉那行三元 → 折叠形状那条红；
  ② 给一个新 `"use client"` 模块加静态桶 import → 第一条红并点名 `components/ui/__probe.tsx`。
- **自己踩的一个坑，记下来免得重犯**：新检查的头注释里我写了「处于 `/* … */` 之内」来描述
  粗判方式——**那个 `*/` 把 JSDoc 提前关掉了**，语法错误报在六十行之后的字符串上。
  「在注释里写出注释的结束符」是个非常朴素的自伤。
- 读数：`CI=true pnpm check:all` → exit 0，**245 文件 / 2,889 用例**（上一条 244 / 2,884）；
  `pnpm build` → exit 0；`check:bundle` 2925.5 kB / 基线 2926.8；`check:perf` CSS 71.4kB；
  `test:e2e` 113 passed。
- 下一项：继续沿「产物里有没有不该有的东西」量——server-only 的值有没有进客户端 chunk。

- 更新时间：2026-09-29（UTC）。

## 2026-09-29 — 沿同一维度量第二问：服务端专用变量有没有进客户端产物（干净），以及把这一维变成门禁

- 里程碑 / 版本：v0.12.0。分支：`chore/client-artifact-env-gate`（PR #179）。
- 状态：DONE。基线：`48825360`（#178 合并后的 main）。
- **量到的**：① 把本机 env 文件里 8 个服务端专用变量的**值**（只在内存里比，绝不打印）
  拿去扫 61 个客户端脚本产物 → **一个都没有**；② 扫**变量名** → 12 个名字一个都不出现；
  ③ 顺带量到一个更干净的结论：客户端产物里 **`process.env.` 这个形态一次都没出现**
  （全部在构建期折成字面量）。
  也就是说这一维今天是干净的——**但「干净」本身不是结论，「它会不会一直干净」才是**。
- **补的是一个真实的盲区**：`check:security` 的 `inspectClientModules` 判的是
  「`"use client"` 模块里有没有**直接**读 `process.env.<服务端专用名>`」。
  它看得见写在客户端组件里的那一行，**看不见**「客户端组件 → import 一个读该变量的
  共享 helper」这条**间接**路径——而 `NEXT_PUBLIC_*` 之外的变量一旦被客户端图碰到，
  构建期就会把**值**内联进去，那时它在服务端也不再是秘密。
- **按名字判而不是按值判**（这一格是刻意的）：值依赖那台机器上真的配了什么，CI 上通常什么都没有，
  那条门禁在 CI 上会永远绿——**一条永远绿的门禁比没有门禁更糟**（前例：`query-error-channel`
  的 `QUERY_ERROR_CHANNEL_PARSE`，解析不动的文件被当成干净）。
  变量名是源码里的常量，与环境无关，所以判据在任何机器上都成立。
- 落地：`src/lib/release/client-artifact-env.ts`（纯函数 + 7 项单测），接进
  `scripts/lib/bundle-freshness-check.js`——**放在 `check:bundle` 里而不是新开一条门禁**，
  因为它问的是**同一份产物**的另一个性质，而新鲜度那一步是共用的（量一份可能过期的产物，
  体积与内容两个结论都会是假的）。
  变异核对：往一个客户端 chunk 注入 `VAPID_PRIVATE_KEY` → 红并点名那个文件；复原后绿。
- **这一门禁自己被两道门禁各绊了一次，都记在这里**：
  1. `check:supabase-security` 报「client module references service-role admin access」——
     因为我在规则模块里**重抄**了一份变量名清单，而本模块只是逐字列出它们以便扫描、一个字节的
     值都没读。这与 #175 那次是同一个形状：**门禁被自己必须枚举的数据绊倒**。
     改法不是加豁免，而是**别把那份数据抄第二遍**——改成从 `security-config.ts` 导入。
  2. `pnpm lint` 报 `scripts/lib/bundle-freshness-check.js` 的 `runBundleCheck` 复杂度 16 > 15。
     仓库里有过同样的处置（`settings/page.tsx` 的 `readDeviceList` 就是为这个抽出来的），
     于是把内容判定抽成 `checkClientScriptContents`。
  3. 另有一条更朴素的：裸 `from "../security/security-config"` 让 Node 的 type-stripping
     ESM loader 解析不到（CLI 走的是那条路径）——同目录的其它 CLI 可加载模块都写显式 `.ts` 后缀，
     跟着写就是。
- **刻意不判 mock 记号**（与 #178 同一个分界，不再重复论证）：真实产物里有一块从不被人请求的
  死 chunk，按「产物里存在」报红是假红。
- 读数：`CI=true pnpm check:all` → exit 0，**246 文件 / 2,896 用例**（上一条 245 / 2,889）；
  `pnpm build` → exit 0；`check:bundle` 2925.5 kB / 基线 2926.8，并自报
  「客户端产物无服务端专用变量名：61 个脚本产物」；门禁数仍是 **43**（判据并入既有门禁，不是新增）。
- 下一项：这一维（产物内容）现已覆盖「服务端变量名」与「体积」两格；
  「产物里有没有不该有的东西」还剩可查的第三格——**源 sourcemap / 调试残留**（`check:perf`
  已有 sourcemap 泄漏一格，可复核它量得对不对）。

- 更新时间：2026-09-29（UTC）。

## 2026-09-29 — 复核第三格：`check:perf` 的 sourcemap 那一格只能看见三种形态里的一种

- 里程碑 / 版本：v0.12.0。分支：`fix/perf-sourcemap-shapes`（PR #180）。
- 状态：DONE。基线：`745cbc4b`（#179 合并后的 main）。
- **怎么找到的**：上一条把「产物里有没有不该有的东西」这个维度的前两格收口之后，
  剩下第三格就是 `check:perf` 已有的 sourcemap 那一格。**「已有」不等于「量得对」**——
  这条断言是「一条永远绿的门禁比没有门禁更糟」那条纪律的直接对象，所以值得复核它到底在量什么。
- **复核结果：它只判了三种泄漏形态里的一种。** 原实现是「静态目录里有没有 `.map` 文件」，
  而另外两种它完全看不见：
  1. `//# sourceMappingURL=data:application/json;base64,…`——**整份原始源码内联进那个
     JS/CSS 文件**。不需要额外请求，浏览器拿到产物就等于拿到源码。
  2. 一条指向**确实存在**的 map 的 `sourceMappingURL`。
  也就是说「产物里没有 `.map` 文件」**完全推不出**「没有泄漏」——而这正是
  「产物侧断言」最容易写成一句空话的地方。
- **顺带补上分母**：静态目录一条文件都没有时**报红而不是报绿**。这一格靠 `walk()` 的结果说话，
  而「什么都没在看」和「干净」长得一模一样。
- **一条刻意的假红防线**：指向**不存在**路径的 `sourceMappingURL` **不算**泄漏。
  那是第三方库留下的死引用，既不泄漏也不可调试；按它报红就是一条没人会修的假红——
  与 `check:bundle` 的内容判定、以及产物侧那两条判据是同一态度。
- **实测基线（真实生产构建）**：63 个产物文件里 `.map` 文件 **0** 个、`sourceMappingURL`
  **一处都没有**（内联与可解析两种形态都是 0）。所以这条规则今天 0 命中，
  而它的失败模式是**具体的**：有人开了 `productionBrowserSourceMaps`，或者某个依赖把 data URI 塞进来。
- 变异核对四种，全部在真实产物上做、做完复原：
  | 变异 | 结果 |
  |---|---|
  | 内联 data URI | ❌ 红，并点名那个文件 |
  | 落一个 `.map` 文件 | ❌ 红 |
  | 指向确实存在的 map | ❌ 红，并打出「文件 → 引用」那一对路径 |
  | 指向**不存在**路径的引用 | ✅ **仍然绿**（假红防线） |
- 读数：`CI=true pnpm check:all` → exit 0（246 文件 / 2,896 用例不变——本条改的是脚本不是规则模块，
  按 `check-perf` 既有形态它没有单元测试，证据是上面的四次产物级变异核对；
  「脚本侧断言靠变异核对取证」这个取舍在此显式记下，不是默认）；
  `check:perf` 三格全绿并自报「扫了 63 个产物文件」。
- 下一项：「产物里有没有不该有的东西」这一维度至此覆盖三格（体积 / 服务端变量名 / sourcemap 形态）；
  可以转向别的维度或收口。

- 更新时间：2026-09-29（UTC）。

## 2026-09-30 — 第二轮收口：开一个没人量过的维度（「产物里有没有不该有的东西」），三格落地

- 里程碑 / 版本：v0.12.0。分支：`fix/mock-client-bundle` / `chore/client-artifact-env-gate` /
  `fix/perf-sourcemap-shapes`（PR #178 / #179 / #180）。基线 `fe3e3e72`。
- 状态：**代码侧 DONE，发布侧 BLOCKED（外部权限）**。远端只剩 `main`，开放 PR 0 条，工作树干净。
- **这一轮的起点是一个问题，不是一个任务池条目**：上一条把「门禁污染自己的取证途径」记下来之后，
  我接着问了一个**没人量过**的维度——**产物里有没有本不该在那里的东西**。
  头两问就都不是设想：
  - 第一问（mock）：`NEXT_PUBLIC_MOCK_ENABLED` 的生产闸 2026-09-25 就有了，
    **但那管的是「跑不跑」，不是「进不进产物」**。量到生产首页 JS 里有 **48%（gzip 246 kB /
    506 kB）**是 mock 假数据 + 整包 faker——已修（#178，首页 JS 506,604 → 260,084 字节）。
  - 第二问（服务端专用变量）：本机 8 个变量的**值**、以及 12 个**变量名**，
    在 61 个客户端产物里**一个都不出现**；顺带量到 `process.env.` 一次都没出现。
    干净不等于安全，所以把它变成门禁（#179）。
  - 第三格（`check:perf` 已有的 sourcemap 断言）：**「已有」不等于「量得对」**——
    它只判了三种泄漏形态里的一种（#180）。
- **这一轮最值钱的一条方法论**（与 #178 的结论同源，所以写在一起）：
  **体积门禁对「本来就多余的代码」结构性失明**——基线是在泄漏已经存在的时候立的，
  一块多余的代码不会让总量变大，5% 的预算永远看不到它。
  所以这一轮加的两条新判据都**不判大小**：一条判「客户端图里不该有静态 mock import」的**形状**，
  一条判「产物里不该出现服务端变量名」的**内容**。仓库里已经记过一次同族先例
  （构建期折叠那 24.9 kB「只占基线的 0.9%」）。
- **「事实」与「门禁」在这一轮被反复分开，第三次确认**：
  - #178：修完产物里**仍留着一块 741 kB 死 chunk**，浏览器实测 8 个页面**从不取它**。
    我先写了「产物里不许出现 mock 记号」的门禁，它当场抓到那块死 chunk——**然后我把它删了**，
    因为按「产物里存在」报红是**假红**。「产物里存在」与「用户会下载」是两件事。
  - #179：同理，那条新门禁只判服务端变量名，**刻意不判 mock 记号**。
  - 三条剩余阻塞继续靠 `check:roadmap-entries` 强制写明类别，不会被静默遗忘。
- **新门禁自己被两道门禁各绊了一次**（#179，都记在该条里）：
  `check:supabase-security` 报「client module references service-role admin access」——
  因为我在规则模块里**重抄**了一份变量名清单，而本模块只是逐字列出它们以便扫描；
  改法不是加豁免，而是**别把那份数据抄第二遍**。这与 #175「门禁被自己必须枚举的数据绊倒」
  是同一个形状，两次都选了「消除重复」而不是「加豁免」。
- **最终读数（`main` 上现量）**：`CI=true pnpm check:all` → exit 0；
  `pnpm verify:build` → exit 0；`pnpm test:e2e` → **113 passed / 0 failed**（1.7m）；
  246 文件 / **2,896** 用例（第一轮收口时是 244 / 2,884）；门禁仍是 **43**（新判据并入既有门禁）；
  bundle **2925.5 kB** / 基线 2926.8；CSS **71.4 kB**；`check:bundle` 现在还自报
  「客户端产物无服务端专用变量名：61 个脚本产物」，`check:perf` 自报「扫了 63 个产物文件」。
- **发布判断不变**：v0.12.0 退出标准第 2 条要求 B01/B02 有执行记录，而 B02–B05 全部卡在
  **外部权限**（Vercel 部署与 build 配额、云端 Supabase 凭据、可牺牲的隔离账号）；
  roadmap 风险段自己写着「若权限未到位，不得因为『代码都改了』宣布退出标准达成」。
  `v0.11.0` 的 tag 同理仍未打（缺账户删除演练与 commit 归属证据）。
- **剩下的三条阻塞（与第一轮相同，`check:roadmap-entries` 强制每条写明类别）**：
  1. **A05 余下**「站内已读是否等于不必寄」——**产品决策**；
  2. **B02–B05** 回滚演练 / 账户删除 / 云端擦除 / provider 演练——**外部权限**；
  3. **`GET /api/health` 的第二半**（把探针与对外可见的健康端点分开）——**会改动
     `check:production-smoke` / Docker `HEALTHCHECK` / Vercel Cron 三方依赖的响应契约，
     以及 B01 记录下来的生产证据**，属运维/产品决策，不该由我单方面改。
- **一条留给下一个人的具体方向**（我量到但没做的）：`check:perf` 的 recharts 那一格是
  「在任一产物的**前 200 kB** 里正则找 `recharts`」——chunk 名与压缩都会影响它能不能命中，
  也就是说**它可能一直在报一个由运气决定的结论**。复核方式与 #180 同形：
  先量它今天命中的是哪个文件，再决定判据该按什么写。

- 更新时间：2026-09-30（UTC）。

## 2026-09-30 — 把我自己留下的「量到但没做」那一件做掉：`check:perf` 的 recharts 那一格**永远不可能命中**

- 里程碑 / 版本：v0.12.0。分支：`fix/perf-chart-lazy-gate`（PR #182）。基线 `0a2574bc`。
- 状态：DONE。这是上一条**自己写给自己**的待办（原文：「它可能一直在报一个由运气决定的结论。
  复核方式与 #180 同形」）。**结论比「运气」严重得多：它不是有时命中不了，是一次都命中不了。**
- **怎么发现的**：先量它今天命中的是哪个文件。结果 **一个都没有**——63 个产物文件里
  `recharts` 零出现。可 recharts 确实装在依赖里、也确实被打进了产物
  （`src/components/charts/area-chart.tsx`，经 `next/dynamic` 懒加载）。
- **根因（值得单独记，因为它不是 bug 而是工具链事实）**：构建走的是 **Turbopack**，
  而 Turbopack 的**生产**产物里**不内嵌模块路径字符串**。
  所以「拿包名去产物里搜」这个手法在 dev 有效、在生产**结构性地失效**——
  搜索空间里根本没有那个字符串，与代码在不在无关。
  （旁证：`recharts` 只出现在 `.next/server/**/*.js.map` 与 `.next/cache` 里，
  `.next/static` 里一处都没有。webpack 时代的经验在这里不能照搬。）
- **换判据时踩过的第二个空**：先想过用路由→初始 chunk 的清单来判「懒加载没回退」，
  结果 `.next/build-manifest.json` 的 `pages` 在 App Router + Turbopack 下**只有 `/_app` 且 0 个文件**，
  逐路由清单压根不存在。这条路也堵死——**两次尝试都失败，才逼出下面那个真正可判的写法**。
- **最终判据（能被判、也能红）**：标记从**包名**换成**导出符号** `AreaChart`——它扛得过压缩
  （`recharts` 扛不过），且只出现在那两个图表 chunk（360.6kB + 15.2kB），
  741 kB 那个 faker 死 chunk 里没有。
  但关键不是「找到了」，而是**判它该不在的地方在不在**：
  **落地页初始 payload（`rootMainFiles`，落地页真正会请求的那 6 个文件，合计 431kB）
  里不得出现该符号**。有人把 `next/dynamic` 改回静态 import → recharts 被拉进落地页 → 红。
- **两处刻意的「宁可红」，与这轮前两条同源**：
  1. **一个文件都没命中标记 → 报红**，不报「未检测到」。标记消失的成因是**压缩器/工具链改名**，
     不是「图表被删了」；这时候这一格**量不到任何东西**，而沉默地绿比红危险得多。
     这是本轮第三次把同一件事做实：**门禁量不到东西时必须出声**（前两次：#178 交红门禁之前
     先量「用户会不会下载」，#179 按名字判而不是按值判）。
  2. **不再只读前 200 kB**：实测 61 个 js 里有 **4 个超过 200 kB**（最大 724 kB），
     原来的窗口对其中 4 个文件的大半内容是瞎的。
- **变异核对三种（真实产物上做、做完复原）**：
  | 变异 | 结果 |
  |---|---|
  | 把标记塞进 `rootMainFiles` 里那个文件（等价于 static import 回退） | ❌ 红，并点名那个文件 |
  | 把标记整体改名（等价于压缩器改名） | ❌ 红，并说明「这一格量不到任何东西」 |
  | 移走 `build-manifest.json` | ❌ 红 |
- **一处必须记下来的耦合**：这一格现在硬编码了组件符号 `AreaChart`，与
  `src/components/charts/area-chart.tsx` 的导出名绑定。**改名时会红**——这是刻意的
  （红的意思是「请更新 CHART_MARKER」，不是「出事了」），但它确实是一处需要人维护的耦合，
  按前一条的取舍格式显式写在这里，不藏着。
- 读数：`CI=true pnpm check:all` → exit 0；`pnpm lint` → exit 0；
  `check:perf` 三格全绿并自报「图表仍在懒加载 chunk 里：chunks/0w5ujw4kdknj_.js、
  chunks/2hvrh58g01j8o.js（落地页初始 payload 431kB / 6 个文件，其中不含图表）」。
- **这一格的**原**原实现是一条 `⚠️` 警告，从不参与退出码**（`failed` 只由 CSS 与 sourcemap 两格
  设置）——也就是说它连「能不能红」这件事本身都做不到，这次一并改成了真正参与退出码。
- 下一项：产物侧三格（体积 / 服务端变量名 / sourcemap 形态）已齐；`check:perf` 三格现在都
  参与退出码且都量得到东西。可以转向别的维度。

- 更新时间：2026-09-30（UTC）。

## 2026-09-30 — 把「门禁的强度」也变成可判定的事实：`check:gate-rule-tests`

- 里程碑 / 版本：v0.12.0。分支：`feat/gate-rule-tests-gate`（PR #183）。基线 `dde76208`。
- 状态：DONE。门禁数 43 → **44**。
- **怎么开始的**：#180 与 #182 都在同一件事上收口——`check:perf` 三格里**两格从来没响过**，
  而「它们没响过」这件事**没有任何机制会发现**。那就问一句更根本的：
  **仓库里有多少条门禁的「会不会响」是有人兜底的？**
- **先量，发现静态方法量不出来**（这一步的失败本身是结论）：
  - 扫 `exit(1)` / `exitCode` / `throw`：**43 条门禁全都有失败路径**——静态扫不出来。
  - 按「规则模块有没有单测」粗查：先得出「5 个规则模块没单测」，**这个结论是错的**——
    我的文件名匹配写成了 `*fields*`，而真实文件叫 `form-field-rules.test.ts`（`field` 不是 `fields`）。
    重查后 3 个都有单测。**一个自己量错了的测量差点写进提交**——和 #182 同一课：
    判据要能被反例打脸，否则它只是把猜测写成了断言。
  - 重查（跟两跳 `wrapper → scripts/lib/*-check.js`）：**33 条**门禁走规则模块、
    10 条判定内联在脚本里，规则模块缺单测的 **0 个**。
- **结论不是「加门禁」，而是「把已有的好性质钉住」**：33/33 全覆盖说明约定已经在自发地成立，
  但它**没有被强制**。所以新门禁不判「强度够不够」（那判断不了），只判一件**可判定**的事实：
  **规则模块有没有单测**。
- **它补的正是 `gate-wiring.ts` 自己声明的缺口**——那个文件的文档里写着
  「规则只判断接线与引用是否成立，**不判断门禁本身的强度**」。本条就是那句缺口的另一半。
- **两处刻意的设计，与前几条同源**：
  1. **提取失效应出声**：「这条门禁引用了哪些规则模块」靠读脚本文本，是启发式。
     一个「因为提取得不对所以什么都没查到」的审计，必须**报红**而不是安静地报 0 项通过——
     否则这条门禁自己就会变成它所反对的那种东西。
  2. **内联门禁不算错，但必须被计数打印**：那 4 条判定内联在脚本里的门禁不是违规，
     但**这个数是分母**；隐去它等于把「有 4 条门禁的强度没有被单测兜底」藏起来。
- **一次真实的假红，暴露了一个定义漏洞**：第一版把
  `src/lib/notifications/types.ts` 与 `src/lib/supabase/database.types.ts` 报红了。
  两者装的是**类型声明**，不是判定逻辑——给类型别名写单测是没有意义的问题
  （后者还是 schema 生成的）。于是把「什么算规则模块」**写进定义**（排除 `types.ts` / `*.types.ts`）
  而不是加豁免名单，并**把代价写明**：万一有人把判定逻辑塞进叫 `types.ts` 的文件，它会逃过
  这条审计——可接受，因为那样的文件按约定本身就命名错了，而 tsc 与 ESLint 仍覆盖它。
- **我自己写的单测当场抓到我自己代码里的一个 bug**：`moduleNameOf("state-rules.test.ts")`
  原先返回 `state-rules.test` 而不是 `state-rules`——那会让「规则模块有没有单测」这条判据
  **永远为假**。也就是说这条门禁本来会**永远红**。这是本轮第三次由负向断言救回一次
  「量不到东西」的审计（前两次：#179 的 `.ts` 后缀、#182 的结构性不可搜）。
- 变异核对两种（做完复原）：
  | 变异 | 结果 |
  |---|---|
  | 加一条规则模块没有单测的门禁 | ❌ 红，并点名 `src/lib/release/zz-fake-rules.ts` |
  | 让提取返回 0 条门禁 | ❌ 红（`NO_RULE_MODULE_DETECTED`：「这道审计自己量不到东西」） |
- 读数：`CI=true pnpm check:all` → exit 0；`pnpm lint` / `pnpm type-check` → exit 0；
  **247 文件 / 2,913 用例**（上一条 246 / 2,896）；`check:gates` → 44 个门禁
  （本地 41 / CI 43 / 豁免 3）；`check:all` 与 CI 都跑它（CI 只跑 `pnpm check:all`，单清单设计）。
- **仍未验证的那 4 条**（本条只把它们**变成可见**，没有声称它们没问题）：
  `check:gate-rule-tests` 自报「另有 4 条判定内联在脚本里，强度未被单测兜底」。
  要给它们兜底，正确的做法是把判定搬进 `src/lib` 规则模块——那是一次真实重构，
  不该顺手塞进这条 PR。**明确记为下一项，不假装已经解决。**

- 更新时间：2026-09-30（UTC）。

## 2026-09-30 — 上一条明确留下的下一项：给 4 条「内联门禁」兜底，第 1 条（`check:i18n`）搬完了，还捡到 3 个洞

- 里程碑 / 版本：v0.12.0。分支：`refactor/i18n-gate-rule-module`（PR #184）。基线 `28512756`。
- 状态：DONE。门禁数仍 **44**；**内联门禁 4 → 3 条**。
- **上一条的原话**：「要给它们兜底，正确的做法是把判定搬进 `src/lib` 规则模块——那是一次真实
  重构，不该顺手塞进这条 PR。**明确记为下一项，不假装已经解决。**」本条就是那个下一项的第 1 条。
- **为什么先做 `check:i18n`**：4 条里它是唯一有**真逻辑**且体量最大的（84 行内联判定），
  其余 3 条（`agents` / `perf` / `release-docs`）要么小、要么已有人工证据
  （`check:perf` 三格在 #180 / #182 里逐格做过产物级变异核对）。而 i18n 恰好是本仓库
  **已经付过学费**的领域——`AGENTS.md` 记着 2026-08-23 那次：漏一个 key，
  `type-check` 与 `lint` 都抓不到，只有生产构建才炸。
- **搬的过程中捡到三个洞，其中一个当时还活着**：
  1. **别名遮蔽**（静默）：命名空间绑定收在 `Map<别名, 命名空间>` 里，同一文件里
     `const t = useTranslations("a")` 与 `const t = getTranslations("b")` 并存时**后者覆盖前者**。
     于是按 `a` 写的调用拿 `b` 去查：查不到就**报红**（假红），查得到就**当作已验证**（假绿）。
     两种结果都是编的。现在它是一条明确问题项 `AMBIGUOUS_NAMESPACE_ALIAS`——
     **静态阶段判不出来就说出来，而不是挑一个继续**。实测本仓库今天 **0 处**（先量过才动手）。
  2. **别名未转义**（静默）：调用正则用 `\\b${alias}` 拼，别名却取自 `[A-Za-z_$][\\w$]*`——
     **`$` 是合法 JS 标识符字符**，而在正则里 `$` 是「输入末尾」断言，
     所以 `const t$ = useTranslations("a")` 的正则**永远匹配不到**，它名下所有调用被静默跳过。
     实测本仓库今天 **0 个含 `$` 的别名**（6 个别名：`t/ta/tc/td/ts/tv`）。
  3. **注释里的示例代码被当成真调用**（**当时还活着**）：扫描的是原始文本，而
     `// const t = useTranslations("a")` 这种示例是本仓库文档的常态。
     证据不是推测——**旧实现直接拿它自己文件里的 `t("a//b")` 报红**：
     `缺少 zh-CN 翻译 key: a.a//b`。新规则一加上就当场把它照出来了。
     现在扫描前先剥注释，且**保留换行**（行号是这条门禁的输出之一，去了换行就会指错行）。
     实现用**单遍 alternation**（字符串在前、注释在后）而不是状态机：
     「先匹配到字符串」就天然保证不会把 `t("a//b")` 里的 `//` 当注释。
- **不丢覆盖的证明**（重构最该给的那份证据）：把新旧两版**在同一棵树上对跑**——
  旧实现（`git show HEAD:scripts/check-i18n-usage.js`，把新文件挪开避免自触发）报
  **878 个静态翻译调用**，新实现报 **878 个**（另附 155 个命名空间绑定 / 375 个文件）。
  逐个相同 = 重构没有悄悄少查东西。
- **变异核对（真实文件上做、做完复原）**：
  | 变异 | 结果 |
  |---|---|
  | 造一个别名遮蔽的文件（`t` 同时绑 `Common` 与 `Other`） | ❌ 红，并说明「该改别名，而不是让其中一个被静默覆盖」 |
  | 造一个 `t$` 别名引用不存在的 key | ❌ 红（改前会被**静默跳过**） |
- **两处刻意的「保留既有行为」**（都是对的，写下来防止后来人顺手优化掉）：
  - 动态 key（模板字符串、变量）**跳过**而不是猜。原注释：「无法在静态阶段可靠展开，交由 `t.has`
    或运行时回退处理；它们会被明确跳过，而不是**伪造为已验证**」。
  - 命名空间必须是**字面量**才绑定，`useTranslations(ns)` 里的变量同样跳过。
- 读数：`CI=true pnpm check:all` → exit 0；`pnpm lint` → **0 warning**（中途撞到一次 `max-depth` 5 > 4，
  按仓库既有做法把「按别名查缺 key」抽成 `missingKeyIssuesFor`，而不是加 disable 注释）；
  `pnpm type-check` → exit 0；**248 文件 / 2,941 用例**（上一条 247 / 2,913）；
  `check:gate-rule-tests` → 49 个规则模块 / 41 条走规则模块 / **3 条内联**（分母 4 → 3）。
- **剩下 3 条内联门禁**（`check:agents` / `check:perf` / `check:release-docs`）：本条**没有**声称
  它们没问题，也**没有**声称它们需要同样处理——`check:perf` 的判定是产物侧的，
  搬进规则模块要先想清楚「临时目录里的假产物」怎么构造，那是另一条 PR 的事。

- 更新时间：2026-09-30（UTC）。

## 2026-09-30 — 合并后 `check:all` 红了：不是我的改动，是 override 钉在了自身已是漏洞版本的版本上

- 里程碑 / 版本：v0.12.0。分支：`fix/override-pinned-to-vulnerable`（PR #185）。基线 `2ab852c5`。
- 状态：DONE。**这一条是从「我刚把 #184 合了、顺手复验一下 main」里冒出来的**——
  复验发现 `check:all` exit 1，而 `verify:build` exit 0、CI 全绿。这个不一致本身就是信号。
- **不一致值得当回事**：CI 刚跑完是绿的，本地红。差别只可能在**时间**上——
  advisory 数据在这半小时里更新了。于是去看红的那一条。
- **红的不是代码，是 `pnpm audit`**：`security/config check failed: pnpm audit:
  0 critical, 4 high vulnerabilities`，4 条 high **全是同一个包** `brace-expansion`，
  两条 advisory（`GHSA-qhr7-859c-m2p7` / `GHSA-6j4f-fj2g-mc7p`）各覆盖两个版本区间。
- **真正的问题不是「有漏洞」，是「override 在骗人」**：`pnpm-workspace.yaml` 里**早就有**
  `brace-expansion` 的 override（上一轮修同一条 advisory 时加的），钉的是 `^2.1.4` 与 `^5.0.9`——
  而新 advisory 下 2.x 需 `>=2.1.6`、5.x 需 `>=5.0.11`，**这两个钉住的版本自身就在漏洞区间内**。
  也就是说：**override 一直绿着，audit 一直红着**，而「我们已经处理过这条 advisory 了」
  这条记录掩盖了一个**已经不再成立**的结论。
  这与本轮反复出现的那条同源：判据（当年那个版本确实是修复版）**成立过**，但没有跟着世界一起复核。
  `fast-uri: ^3.1.6` 同理（需 `>=3.1.8`）。
- **踩到一条 pnpm 版本事实**：我第一反应是往 `package.json` 的 `pnpm.overrides` 里加，
  结果 **pnpm 11 不再读 `package.json` 的 `pnpm` 字段**（override 的新家在 `pnpm-workspace.yaml`），
  而 pnpm 只给了**一行 WARN** 就继续跑完整个安装——**装完什么也没变**。
  这条 WARN 就夹在 22.6s 的一堆输出里。**一条「加上去没生效」的改动如果没人复核，
  就会变成一条「我们已经处理过了」的记录**——和上面那个 override 是同一个形状，一小时内遇到两次。
- **改动**：全部是**同一大版本内的 patch 升级**，不跨 major：
  `^2.1.4 → ^2.1.7`、`^5.0.9 → ^5.0.12`、`^3.1.6 → ^3.1.8`。
  （先查了 registry：4.x 那条 advisory 的修复版是 `>=5.0.11`，一度以为要跨 major，
  结果实际装的是 `5.0.9`，**同 major 内 patch 就能解决**——差一步就做出一个不必要的大版本覆盖。）
- 读数：`pnpm audit` **任意严重度 0 条**（`--audit-level high` exit 0）·
  `pnpm lint` exit 0 · `pnpm type-check` exit 0 · **248 文件 / 2,941 用例** ·
  `pnpm build` exit 0 · E2E **113 passed** · `CI=true pnpm check:all` **exit 0**（合并前是 1）。
- **一条留给下一个人**：这两次「override / 门禁钉在一个曾经正确、后来不再正确的值上」是同一族。
  本仓库已经有过第三例同族（`query-error-channel` 的 `QUERY_ERROR_CHANNEL_PARSE`，见 #179 引用）。
  **这类失效有一个共同特征：它们不会自己变红，它们只是让某条记录继续看起来有效。**
  能被机械抓住的只有一类——「钉住的值本身要在一个会被复核的地方」；
  本条至少做到了「audit 的阈值是真门禁（check:security 里那一步）」，所以它**这次**红了。

- 更新时间：2026-09-30（UTC）。

## 2026-09-30 — 内联门禁 3 → 2：把 `check:perf` 三格搬进规则模块，手跑变异变成常驻用例

- 里程碑 / 版本：v0.12.0。分支：`refactor/perf-gate-rule-module`（PR #186）。基线 `7dccab37`。
- 状态：DONE。门禁数仍 **44**；**内联门禁 3 → 2**。
- **选它的理由不是「它最大」，是「它的判据错过」**：`check:perf` 三格里**两格从来没响过**
  （#180 的 sourcemap 只判三种形态里的一种、#182 的 recharts 在 Turbopack 产物里结构性不可搜）。
  **这两格的问题都是「判据选错了」**，而「判据选错」这件事只有把判据写成可测的纯函数，
  才谈得上被**反复**检查——之前它们靠的是「在真实产物上手跑一次变异」，那是一次性证据。
- **搬动的真实收益，写清楚免得被当成形式统一**：那些变异现在是**每次都跑**的用例：
  `SOURCEMAP_INLINE` / `SOURCEMAP_FILE` / `SOURCEMAP_RESOLVABLE_REF` /
  `CHART_INLINED_IN_LANDING` / `CHART_MARKER_MISSING` / `CSS_BUDGET_EXCEEDED` /
  `NO_ARTIFACTS_SCANNED` / `LANDING_PAYLOAD_UNKNOWN`。
- **搬的过程中解决了一个「本来以为搬不开」的问题**：sourcemap 那一格要判断
  「一条 `sourceMappingURL` 指向的 map 是否**确实存在**」，原本只能用 `fs.existsSync`，
  于是它看起来只能留在脚本里。改成**把 `exists` 作为谓词注入**之后，
  这个分支在单测里只是一次数组查找——**「必须碰文件系统」经常不是搬不动的理由，
  而是没人把 IO 参数化**。
- **新增一格判据**：**落地页初始 payload 未知时报红**（`build-manifest.json` 缺失或
  `rootMainFiles` 为空）。原先这种情况会退化成「什么都没查」而安静放行——
  这正是本轮那条纪律的第四个实例（前三次：#179 按名字判、#183 提取失效应出声、#184 判不出来就说出来）。
- **不丢行为的证明，两层**：
  1. **新旧实现在真实产物上对跑**：同样 **2 个**图表 chunk、同样 **71.4kB** CSS、同样扫 **63** 个文件。
     唯一差异是自述值：落地页 payload 从四舍五入的 `431kB` 变成 `430.6kB`
     （`sumKb` 保留一位小数）——**仅显示差异，不影响判定**。
  2. **真实产物上的 5 种变异逐个重跑，行为不变**：
     | 变异 | 结果 |
     |---|---|
     | 内联 data URI | ❌ `SOURCEMAP_INLINE` |
     | 落一个 `.map` 文件 | ❌ `SOURCEMAP_FILE` |
     | 指向确实存在的 map | ❌ `SOURCEMAP_RESOLVABLE_REF`（并打出引用名） |
     | 把图表标记塞进落地页初始文件 | ❌ `CHART_INLINED_IN_LANDING` |
     | 指向**不存在**路径的引用 | ✅ **仍然绿**（exit 0，假红防线） |
- **三次「我自己的测试写错了」**（都靠断言自己发现，没有一条是靠运气绿的）：
  1. 「默认预算是 100kB」那条我拿 100.5kB 去证「不超预算」——方向写反了，改 99.9kB。
  2. 两条 sourcemap 用例的假产物树**没有图表 chunk**，于是先被 `CHART_MARKER_MISSING` 拦下，
     根本走不到被测分支——**一个「量不到东西」的测试自己就是绿的**。补上图表 chunk。
  3. 「自述行」那条一开始写成了一个绕来绕去的表达式，读不懂，改为直白构造。
- 读数：`CI=true pnpm check:all` → exit 0；`pnpm lint` **0 warning**；`pnpm type-check` → exit 0；
  **249 文件 / 2,961 用例**（上一条 248 / 2,941）；`check:gate-rule-tests` →
  **50 个规则模块 / 42 条走规则模块 / 2 条内联**。
- **剩下 2 条内联门禁**（`check:agents` / `check:release-docs`）：体量都小，且本条已把
  「搬动产物侧门禁」最难的那条走通（`exists` 注入 + 假产物树）。但**本条不声称它们需要同样处理**——
  下一个该做什么，仍应由「哪一格的判据错过过」决定，而不是由「还剩几条内联」这个计数决定。

- 更新时间：2026-09-30（UTC）。

## 2026-09-30 — 换一个维度：读者看不见的分叉。CHANGELOG 说 11 个已发布版本，仓库只有 1 个 tag

- 里程碑 / 版本：v0.12.0。分支：`feat/changelog-tag-reconciliation`（PR #187）。基线 `c6643d18`。
- 状态：DONE。门禁数 44 → **45**。
- **这一条不是从任务池里挑的，是量出来的。** 前面几条都在查「门禁会不会响」，
  于是顺手查了一句「**发布这一侧对不对得上**」：`git tag` 只有 **`v0.6.0`**，
  GitHub Release 也只有 `v0.6.0`，而 `CHANGELOG.md` 声明了 **11** 个已发布版本、
  约 210 条内容——**10 个版本处于「变更日志说发布了、仓库里 checkout 不出来」的状态。**
- **第一版我把这件事说小了**：我最初以为是 5 个版本（0.7.0–0.11.0）缺 tag。
  门禁第一次跑就纠正了我——**0.1.0–0.5.0 同样没有 tag**。准确数字是 **10 个**、约 **176 条**内容。
  这已经是本轮第三次「我自己的测量是错的」，三次分别是：文件名匹配（`*fields*`）、
  守卫符号集（漏了 `safelyRequireRole`）、以及这次的版本范围。
- **必须说清楚这不是谁写错了**：生产确实部署过 `0.11.0`（roadmap 开头有记录），
  tag 是**刻意不打**的——缺账户删除端到端演练与 commit 归属证据（B01/B02/B03，**全部卡外部权限**）。
  **「没有证据就等于没做」而打 tag 是对外声明「做完了」**，所以不打是对的，本条不推翻它。
  问题在于**它只被记在 `docs/progress.md` 里**：读 CHANGELOG 的人以为有 11 个可 checkout 的发布，
  审计 tag 的人发现只有 1 个——**两边都「正常」，而它们互相矛盾。**
- **而 `check:release-tag` 恰恰不管这件事**：它校验的是**发布工作流的契约**
  （tag 命名、notes 必须来自 CHANGELOG 章节、禁止 `--generate-notes`），读的是配置与文档，
  **不读 `git tag`**。于是一个真实的发布事实分叉没有任何门禁会发现。
- **10 个无 tag 版本分两组，原因不同，所以逐条登记而不是合并成一句**：
  | 组 | 版本 | 原因 |
  |---|---|---|
  | 一 | `0.1.0`–`0.5.0` | **标签纪律当时还不存在**。J07（tag / Release Notes 自动化门禁）是在 **v0.6.0 周期**落地的（`docs/roadmap-0.6.0.md` 的 J07 条目），而 `v0.6.0` 恰好就是**唯一**有 tag 的版本——两件事对得上，不是巧合。补打 tag 等于**伪造从未发生过的发布证据**。 |
  | 二 | `0.7.0`–`0.11.0` | **纪律已在、证据未闭合**（外部权限）。 |
  组一的理由是**查到的**（roadmap-0.6.0.md 记着 J07 属于 v0.6.0 周期），不是推测。
- **五条规则，其中两条是这一轮没先想到、被追问出来的**：
  1. 每个已发布版本要么有 tag，要么登记理由；
  2. **反方向也判**：有 tag 但 CHANGELOG 没章节 → 红（同一类分叉，相反方向）；
  3. **登记过期也红**——某版本已经有 tag 了，登记还在 → 红。**这是台账的自我清理机制**：
     将来 B01/B02/B03 闭合、tag 补上后必须回来删登记，否则门禁会红；
  4. **披露本身在不在也要判**（`DISCLOSURE_MISSING`）。**登记在代码里、读者看不见的真相，
     仍然是读者读不到的真相**——而最省事的一次「整理」就是把 CHANGELOG 开头那段说明删掉，
     文件立刻干净好看而分叉原封不动。**这条是量着量着加的**：我先写了前三条，
     然后问「读者怎么知道」，才发现披露本身需要被强制。
  5. 解析失败 / 登记理由为空串 → 失败封闭。
- **我自己写的单测又抓到我自己代码里的两个洞**（本轮第 5、6 次）：
  1. **空理由等于没登记**——`ledger: { "0.11.0": "" }` 原本能通过，
     也就是说 **`""` 就能把这条门禁关掉**。改成空串判红（与 `gate-wiring.ts` 对豁免表的处理同一条纪律）。
  2. **自述行写成了 `versions - tagged`，而 `versions` 是那个数组**——于是门禁自报
     「**NaN 个**在台账里登记了」。规则与 18 项单测全绿、门禁 exit 0，**只有这一行是错的**，
     而它恰恰是唯一会被人读的那一行。处置不是修那一行，而是**把自述行搬进规则模块并补单测**
     （并显式断言 `not.toContain("NaN")`）——「输出里唯一给人看的那句话」必须有测试。
- **CHANGELOG 开头那段披露撞到一个真实约束**：`check:changelog` 要求说明文字 ≤ 280 字符，
  我第一版写了 951 字符直接被红。这不是要绕过的约束，于是改成
  **短指针在开头（≤280）+ 逐版本理由在新文档 `docs/operations/release-tag-ledger.md`**，
  再由 `DISCLOSURE_MISSING` 强制那个指针**不许被删**。
- 变异核对三种（做完复原）：新增一个 `0.12.0` 章节但不登记 → 红；
  **删掉开头那段披露** → 红；给已经有 tag 的 `0.6.0` 留一条登记 → 红。
- 读数：`CI=true pnpm check:all` → exit 0；`pnpm lint` **0 warning**；`pnpm type-check` → exit 0；
  **250 文件 / 2,979 用例**（上一条 249 / 2,961）；`check:gates` → **45 个门禁**
  （本地 42 / CI 44 / 豁免 3）；`check:gate-rule-tests` → 51 个规则模块 / 43 条走规则模块 / 2 条内联。
- **仍然阻塞、且本条把「阻塞」变得可见**（这是它真正的收益）：B01/B02/B03 依然是外部权限。
  差别在于——**从今天起，一个读者只读 CHANGELOG 就能知道「有 10 个版本没有 tag、为什么」**，
  而不必去翻 `docs/progress.md`。
- **一条明确留给产品决策的**：`0.1.0`–`0.5.0` **是否补打 tag** 是一次独立决策——
  补打等于承认它们通过了从未存在过的门禁。台账只要求它被显式记录，不替它表态。

- 更新时间：2026-09-30（UTC）。

## 2026-09-30 — 同一个 PR 里被 CI 抓到的两个洞：门禁在 CI 上报了一个与事实相反的结论

- 里程碑 / 版本：v0.12.0。分支：`feat/changelog-tag-reconciliation`（PR #187，**同一个 PR 内的后续**）。
  基线 `c6643d18`。
- 状态：DONE。
- **这一条是 #187 第一次在 CI 上跑出来的**，本地全绿（250 文件 / 2,979 用例、`check:all` exit 0），
  CI 上 `Lint & Type Check` 却红了。**本地绿、CI 红，而门禁本身 exit 1、看起来理直气壮**——
  这种失败最值得查，因为它要么是环境差异，要么是门禁在骗人。
- **根因一：门禁把「读不到 tag」当成了「仓库没有 tag」。**
  `actions/checkout@v7` 默认**浅克隆且不 fetch tag**，于是 `git tag --list` 返回**空数组**。
  空数组被我当成了事实，于是「`0.6.0` 有 tag」被判成「`0.6.0` 没有 tag」——
  **报出了一个与事实正好相反的结论**。
  **这与本轮那条纪律是同一条，但方向相反**：
  #179 / #183 / #184 / #186 修的都是「量不到东西却报绿」，**这一次是「量不到东西却报红，而且红得很有把握」**。
  前者让人忽略门禁，后者让人**改代码去修一个不存在的 bug**——更贵。
  修法两条：
  1. 规则侧新增 `TAGS_NOT_VISIBLE`：读到空 tag 列表**且**仓库是浅克隆时立刻停下，
     说清「这不是仓库没有 tag，而是对账量不到东西」并给出修法，**不继续比下去**
     （继续比会把每一个真 tag 都报成「没有 tag」）。
  2. IO 侧先问 git 自己（`git rev-parse --is-shallow-repository`），
     **不靠「列表为空」去猜**。
  3. `ci.yml` 的 `lint-and-type-check` 作业 checkout 加 `fetch-depth: 0`——
     **只有这一个作业需要 tag**（它跑 `check:all`），所以只改这一处，不给全仓库加历史。
  验证方式不是推理而是**真的造出两种 clone**：
  `--depth 1 --no-tags` → 报 `TAGS_NOT_VISIBLE` 并给出修法（不再报 0.6.0）；
  完整 clone → 正常对账绿。
- **根因二：`check:workflows` 把注释当配置。**
  为解释「CI 必须能读到 tag」，我在 `ci.yml` 的**注释**里写了
  「`pnpm check:changelog-tags` 要对账 tag，所以要 fetch-depth: 0」，
  而 `PNPM_COMMAND` 扫的是**原始文本**，于是那句注释里的 `` `check:changelog-tags` ``
  （连反引号一起）被当成一条脚本引用，门禁报「工作流引用了不存在的脚本 `pnpm check:changelog-tags\``」。
  **注释不是配置。** 而且注意这里的脆弱性形状：**加一句带反引号的说明就能让一个门禁变红**，
  而这条门禁的职责是保证 CI 接线正确。让门禁对散文敏感是净负债。
  修法（与 #184 修过的「正则扫原文 → 注释里的示例代码被当成真调用」同一个病根）：
  1. 扫描前去掉**整行注释**；
  2. 脚本名 token 不再接受反引号等标点（`/^[A-Za-z0-9:_-]+$/`）。
  **刻意不去掉行尾注释**：`run: |` 块里的 `# pnpm xxx` 是 shell 注释（去掉是对的），
  但 YAML 里行尾 `#` 可能落在引号字符串或块标量内部，**去错地方会把真正的命令删掉**——
  那是更坏的失败（漏检）。整行注释没有这个歧义，并为此写了断言锁住行数（行号不错位）。
  顺带明确了一条取舍并写成用例：**注释里提到不存在的脚本也不报红**——
  门禁校验的是 CI **执行什么**，不是散文**说了什么**。
- **这一条还纠正了我自己的一个设计冲动**：我最初想「只去掉整行注释就够」，
  写的测试里却断言「注释里提到不存在的脚本仍要报红」——**那条断言和我刚做的实现是矛盾的**。
  停下来想清楚哪一个对：**是 (a) 门禁不管注释，还是 (b) 注释里的脚本名也要校验。**
  选 (a)，因为 (b) 正是这条脆弱性的来源。测试改成断言 (a)，并把理由写进用例名。
- 读数：`CI=true pnpm check:all` → exit 0；`pnpm lint` **0 warning**；`pnpm type-check` → exit 0；
  **250 文件 / 2,985 用例**（同一 PR 内 +6）；`check:gates` → 45 个门禁；
  `check:changelog-tags` 在完整 clone 与本仓均绿。
- **留给下一个人的一句**：这一轮修了 6 次「我的测试/我的实现量错了」，
  而这一次的教训与前几次**都不同**——前几次是**判据写错**，这一次是**判据在某个环境里
  悄悄换了含义**（浅克隆让「空列表」从「事实」变成「读不到」）。
  **一个判据的正确性依赖它被运行的那个环境**，而这件事不会写在判据的注释里，只会写在事故里。

- 更新时间：2026-09-30（UTC）。

## 2026-09-30 — 第二轮收口：把「判据审过没有」变成一份可继承的账

- 里程碑 / 版本：v0.12.0。分支：`docs/gate-criteria-audit-closeout`（PR #188）。基线 `30655dd9`。
- 状态：DONE。门禁 **45** 条；本次会话累计 **11** 条 PR（#178–#188）。
- **这一条要把「我审过哪些门禁、结论是什么」写下来**，理由很实际：
  这一轮我一条一条地审门禁判据，而**审过的东西如果不落成文，下一个人会从头再审一遍**——
  而「重新审」的成本正是这一轮最大的一笔开销。
- **门禁判据审计台账（本轮实际审过的，逐条带结论）**：
  | 门禁 | 结论 | 处置 |
  |---|---|---|
  | `check:perf` | **三格里两格从来没响过** | 已修（#180 / #182 / #186） |
  | `check:bundle` | 内容维度原先只判体积 | 已补（#179） |
  | `check:i18n` | 3 个洞：别名遮蔽 / 别名未转义 / 注释被当调用 | 已修（#184） |
  | `check:workflows` | **把 YAML 注释当配置**（加一句带反引号的说明就能让门禁变红） | 已修（#187） |
  | `check:changelog-tags`（新） | 只判 CHANGELOG 结构，**不读 tag** | 已补（#187） |
  | `check:release-tag` | 校验**工作流契约**，确实不读 `git tag`——**这不是缺陷，是分工**，缺口由新门禁补 | 保留 |
  | `check:a11y` | 上一轮（D10）已把「结构上不可能命中」的规则重写 | 无需处置 |
  | `check:trace-coverage` | 怀疑「45 边界 / 29 带 trace 却通过」，查证后确认**诚实**：0 豁免，规则是「服务端边界不得用裸 console」，16 个边界本来就没有错误路径 | 无需处置 |
  | `check:supabase-security` | service-role 边界用 `admin-client-boundary.ts` 逐调用点登记、**新增调用点失败封闭** | 已有覆盖 |
  | `check:rls` / `check:query-columns` / `check:route-auth` | 全表策略、列名、45 个 handler 的守卫可达性均有台账且失败封闭 | 已有覆盖 |
  | 其余 33 条走规则模块的门禁 | **规则模块 100% 有单测**（`check:gate-rule-tests` 强制） | 已有覆盖 |
- **另外量了三件事，结论都是「没有缺口」，但量过与没量过不一样**：
  1. **门禁里还有没有 recharts 那种「只读一部分文件」的反模式** → 没有；
  2. **⚠️-only 的判据** → 只有两处，都不是判据（一处是 health 探针的**重试提示**，
     一处是 `storage.warnings`——「没人引用的 bucket 是过期的复核决定，不是安全漏洞」，
     **有明确理由且有单测**）；
  3. **18 个 server action 文件有没有测试** → 全部有测试**直接 import 它们**
     （第一版用「文件名前缀」匹配，`admin.ts` 匹配上了 `admin-client-boundary.test.ts`——
     **前缀匹配太宽**，改用 import 关系才准）。
- **这一轮我自己的测量错了 6 次，全部是被断言或被复现抓到的**，逐条记下来当反面教材：
  | # | 错在哪 | 怎么抓到的 |
  |---|---|---|
  | 1 | `moduleNameOf` 少剥 `.test` 后缀 → 「规则模块有没有单测」**永远为假** | 我自己写的单测 |
  | 2 | 测试夹具缺图表 chunk → 先被别的码拦下，**走不到被测分支** | 我自己写的单测 |
  | 3 | 「默认预算 100kB」拿 100.5kB 去证「不超」，**方向写反** | 我自己写的单测 |
  | 4 | 门禁自述行 `versions - tagged` 里 `versions` 是**数组** → 报「**NaN 个**」，而门禁 exit 0 | 只有人读那一行，所以把它搬进规则模块并断言 `not.toContain("NaN")` |
  | 5 | 「5 个规则模块没单测」——文件名匹配写成 `*fields*`，真实文件是 `form-field-rules` | 重查后纠正，**差点写进提交** |
  | 6 | 「5 个版本缺 tag」——实际是 **10 个**；`Unreleased` 计数一度报 315（实为 125） | 门禁第一次跑 + 用 git 里的真实文件复核 |
  另加一条**判据在环境里偷换含义**的（不是测量错，是判据错）：
  **浅克隆让「空 tag 列表」从「事实」变成「读不到」**，门禁因此报出与事实相反的结论（#187）。
- **发布判断（本轮第三次复核，结论不变）**：
  - **不能发 patch**：package.json 已在 `0.11.0`，而 `v0.11.0` 的 tag **刻意不打**
    （B01/B02/B03 外部权限）。要发 `0.11.1` 就得先补 `v0.11.0` 的 tag，
    **那等于推翻一个正确的克制**。
  - **不能发 `0.12.0`**：它的退出标准第 2 条要求 B01/B02 有执行记录，而 B02–B05 全部卡外部权限；
    roadmap 风险段自己写着「若权限未到位，不得因为『代码都改了』宣布退出标准达成」。
  - 所以本轮的结论是：**发布被阻塞，且这个阻塞现在是可见的**——
    一个读者只读 CHANGELOG 就知道「有 10 个版本没有 tag、为什么」（#187 的实际收益）。
- **最终读数**：`CI=true pnpm check:all` → exit 0；`pnpm verify:build` → exit 0；
  E2E **113 passed**；`pnpm audit` **任意严重度 0 条**；**250 文件 / 2,985 用例**；
  门禁 **45**（本地 42 / CI 44 / 豁免 3）；规则模块 **51**、走规则模块的门禁 **43**、内联 **2**；
  `Unreleased` **125** 条；CHANGELOG 声明 **11** 个已发布版本、其中 **1** 个有 tag。
- **下一项（按「哪一格判据错过过」排，不按数量排）**：
  1. 剩 2 条内联门禁（`check:agents` / `check:release-docs`）——**本轮明确不预设它们该怎么做**；
  2. 「判据在某个环境里偷换含义」这一类还值得再扫一遍：
     门禁里凡是**读环境**的（env / 网络 / git 状态 / 平台）都要问一句
     「读不到时它说的是『干净』还是『量不到』」；
  3. 三条阻塞不变：A05（产品决策）、B02–B05（外部权限）、`/api/health` 响应契约（运维/产品决策）。

- 更新时间：2026-09-30（UTC）。

## 2026-09-30 — 补上 #178 那个「死 chunk」的成因，并订正两处我说过头的数字

- 里程碑 / 版本：v0.12.0。分支：`fix/mock-middleware-comment`（PR #189）。基线 `a733585c`。
- 状态：DONE。
- **起因**：#178 修完首页 mock 泄漏后，产物里**仍留着一块约 707 kB 的纯 faker chunk**，
  当时我记的是「741 kB 死 chunk，浏览器从不取它」——**现象对，成因与范围都没查**。
  这次把它查到底了。
- **成因**：`src/lib/supabase/middleware.ts` 里的 `await import("@/lib/mock/data")`。
  那段代码的注释原本写着「**动态 import：避免把 faker 等 mock 数据依赖打进 Edge bundle**」——
  而这句话**只对了一半**：
  - 它做到了「faker 不进**主** Edge bundle」（变成独立 chunk，懒加载）；
  - 它**没做到「faker 不进产物」**：条件分支里的 `await import(...)` 本身**就是一个引用点**，
    写在死分支里也会照常**发射 chunk**。
  **换句话说，这里的 `import()` 恰恰是「折不掉」的原因，而不是「折得掉」的手段。**
  对照 `supabase/client.ts`：那边能被摇掉是因为用的是**静态** import，
  `NODE_ENV` 折叠后 `createMockSupabaseClient` 没有引用点，整块随之消失。
- **订正一：一块注释在陈述一个构建器做不到的事。**
  已把那段注释按实测改写（并写明为什么**不能**像 `client.ts` 那样折掉）。
  这与本轮主线同源：**一条声称某件事的记录，如果它声称的事不成立，就是在制造信心**——
  代码注释也是记录，而且是最容易被信的那一种。
- **订正二：我说过「这个 chunk 被任何东西引用都没有」——错的。**
  我那次只查了 `build-manifest.json` 与同级 chunk，所以下了「无人引用」的结论。
  实测：它被 **37** 个 `page_client-reference-manifest.js` 引用，
  也就是**它在客户端模块图内**，只是**没有任何页面会去请求它**。
  台账里原有的「被 5 个 auth 页面列出」也偏小（实测 auth 下 6 个、合计 37 个）。
  **而且这个数字本身不稳定**：chunk 名是内容哈希，每次构建都可能变——
  所以正确的记法是「**实测 37 个页面清单引用它、浏览器 0 次请求**」，而不是把某个数字当成事实钉住。
  这条数字订正写在这里而不是去改历史条目，是因为本台账是**只追加**的：
  改旧条目会让「当时测到的是什么」变得不可查。
- **为什么不动它**：彻底不发射它只能让 mock 会话不依赖 faker（例如用一份写死的 mock session），
  而 mock 的种子身份要与种子数据保持一致——那是**改 mock 系统的行为**，不在本次范围。
  当前判断：**用户侧影响为 0**（Playwright 复核 8 个生产页面 0 次请求），代价只是部署体积，
  故保留。**这与 #178 的结论一致**：「产物里存在」与「用户会下载」是两件事，
  所以仍然**不设**「产物里不许出现 mock 记号」那条门禁。
- 读数：`pnpm lint` / `pnpm type-check` / `CI=true pnpm check:all` → 全 exit 0；
  `pnpm build` → exit 0，产物读数不变（`check:bundle` 2925.5 kB、`check:perf` 三格全绿）。
- 下一项：不变——「判据在环境里偷换含义」那一类已扫过（仓库本来就处理得很好，
  `check:security` 甚至有一条名叫 *never reads a missing or failed report as a clean audit* 的用例）；
  剩 2 条内联门禁但**不预设该怎么做**；三条阻塞不变。

- 更新时间：2026-09-30（UTC）。

## 2026-09-30 — 「我以为的漏洞」与「真的漏洞」：一次必须记下来的自我纠正

- 里程碑 / 版本：v0.12.0。分支：`fix/admin-client-evidence-nonempty`（PR #190）。基线 `20e6dd29`。
- 状态：DONE。
- **起点是一个高价值审计**：service-role 客户端（`createAdminClient()`）**绕过 RLS**，
  所以每个调用点都是一次信任边界决定。我挑了风险最高的一类——`trust: { kind: "session" }`
  （**只凭「有人登录」就拿到绕过 RLS 的访问**，全清单仅 2 处），逐行读了
  `actions/team.ts` 的 `removeMember`：
  认证 → 取**自己的** team → 查**自己的** membership（并把「读失败」与「没权限」分开）→
  目标成员的读与删**都带 `.eq("team_id", team.id)`** → 禁止移除 owner。
  **结论：这条边界是干净的，`session` 信任有真实代码支撑。**
- **然后我做了一件错事，并且差点让它变成一次大改**：我做了个变异——把 `team.ts` 里的
  `.auth.getUser()` 换成 `.auth.getClaims()` ——**门禁 exit 0**。于是我判定
  「`admin-client-boundary.ts` 声称会在丢失授权证据时失败封闭，**但它根本没检查 evidence**」，
  并准备写一条新规则去「修」它。
- **那个判定是错的。** `ADMIN_CLIENT_TRUST_EVIDENCE_MISSING` 就在 `compareEntry` 后面十几行
  （`source.includes(alt)` 逐条比对）。**我的变异太弱**：`team.ts` 里有 **5 处** `auth.getUser()`，
  我只改了 1 处，子串仍在，门禁当然绿。把 5 处**全部**换掉后：
  `❌ [ADMIN_CLIENT_TRUST_EVIDENCE_MISSING] src/lib/actions/team.ts: trust evidence
  "supabase.auth.getUser" is missing`。
  **如果我照着那个判定动手，就会给一个本来正确的门禁加一条「修复」，还配一段言之凿凿的注释。**
  这是本轮第 8 次「我自己的测量/推断错了」，也是**最贵的一次**——
  贵的不是写代码，是**一个错误的结论一旦被写进注释和 CHANGELOG，就会开始制造信心**。
- **真的漏洞只有一个，而且窄**：把 `evidence` **整段清空**，门禁**确实放行**。
  因为那个循环遍历一个空数组，什么都不做。而 `evidence` 是「凭什么相信这个调用点」的
  **唯一书面理由**——清空它之后，`trust: { kind: "session" }` 还在，**记录看起来仍然有效**，
  支撑它的理由没了。这正是本轮主线那一类失效，只是**这次落在安全边界上**。
- **修法**：非 `server-internal` 的 kind 必须带 evidence（`ADMIN_CLIENT_TRUST_EVIDENCE_EMPTY`）。
  `server-internal` 是唯一例外并写明为什么：它没有外部调用者，**没有授权判断这回事**，
  空数组是正确描述而不是漏填。实测今天 **0 条**违反（18 条 `server-internal` 之外全部带 evidence），
  所以这条规则**今天就是绿的**，它防的是将来。
  顺带把模块头改准：原文只声称覆盖「登记的符号消失」，现在两种都覆盖。
- **本条不覆盖的残余缺口，明写出来而不是假装堵住**：
  把 `trust.kind` 从 `session` **改成** `server-internal` 再清空 evidence，**门禁会放行**——
  没有任何规则钉住「这个模块应该属于哪一类」，而 kind 恰恰是清单里**由人复核的那条决策**。
  要堵它就得把 kind 也登记两遍，那既不解决根因（决策仍在人手里）又增加维护面。
  **实测确认**（不是推测），结论是显式记录。
- 读数：`pnpm lint` / `pnpm type-check` / `CI=true pnpm check:all` → 全 exit 0；
  `src/lib/security/admin-client-boundary.test.ts` → **21 passed**（新增 4 条）。
- **下一项**：不变。剩下的高价值面都已量过；三条阻塞不变（A05 产品决策、B02–B05 外部权限、
  `/api/health` 响应契约）。

- 更新时间：2026-09-30（UTC）。

## 2026-09-30 — 上一条我漏掉的那件事：只**读**过的门禁从来没有被变异核对过

- 里程碑 / 版本：v0.12.0。分支：`fix/agents-index-table-gate`（PR #191）。基线 `82fc1f6d`。
- 状态：DONE。**内联门禁 2 条 → 1 条**；**251 文件 / 3,004 用例**。
- **上一条我判「没有可执行工作」，那个判断下得太早。** 理由是：本轮**最近 8 次狩猎全部以测量
  证明「无缺口」收场**。但重读自己的记录时发现一处**方法上的漏洞**：
  我对 `check:perf` / `check:i18n` / `check:workflows` / `check:changelog-tags` /
  `check:supabase-security` 都做了**变异核对**，而对剩下那两条内联门禁
  ——`check:agents` 与 `check:release-docs`——**只读过、没验过**，
  就写了「它们看起来结构上没问题」。
  **「读过」和「验过」不是一回事，而这一轮的全部教训都指向这件事。**
- **变异一做就抓到东西。** `check:agents` 原来的判据是「在 `AGENTS.md` 全文里正则搜
  `agents/xxx.md`」，只要求 agent 文件**至少被引用一次**。
  而**每个 agent 在那份文件里被引用两次**（Quick Reference 索引表一行、
  When to Use Which 表一行）。于是**只从索引表删掉一行、表里另一处引用还在 → 门禁照样绿**。
  实测确认：删掉 `09-ui-ux` 的索引表行，输出仍是
  `✅ Agent 索引一致：10 个文件全部正确索引`。
  **而 `AGENTS.md` 是本仓库所有人（包括我）开工前读的第一份文件**——
  它的索引表少一行，意味着那个 agent 按 ID 查不到。
- **修法不是加一条判断，而是把判据换掉**：从**全文搜索**改成**结构化解析那张索引表**
  （`src/lib/docs/agents-index.ts`，15 项单测）：
  - 索引表必须**逐个**列出 `agents/` 下的每个文件（不多不少）；
  - **编号必须与文件名的数字前缀一致**（`09` ↔ `09-ui-ux.md`）——
    **全文搜索永远查不出「编号写错了但链接是对的」**，这是换判据换来的第二个能力；
  - 同一行重复出现 → 报错并指出首次行号；
  - **索引表整张不见了 → 报错**（表没了，上面每条判据都会因为「没有行」而空转，
    这与本轮反复出现的「量不到东西必须出声」同源）；
  - 表外的坏链接仍然报错。
- **一处刻意的「不判」**：**不判「When to Use Which」那张表**。它是**用法指南**不是索引——
  行没有编号、一行对应「什么时候用哪个」而不是「有哪些 agent」，**行数本来就不等于 agent 数**。
  判它就要把「用法」和「清单」混成一件事，而那张表少一行同样值得注意——
  **所以本条不假装它被覆盖了**：这一格留给人眼，`check:agents` 只保证「索引表是全的、对的」。
- 变异核对五种（真实仓库上做、做完复原）：
  | 变异 | 结果 |
  |---|---|
  | `agents/` 多一个未索引文件 | ❌ `AGENTS_TABLE_MISSING_ROW` |
  | 正文一条指向不存在文件的链接 | ❌ `AGENTS_LINK_TARGET_MISSING` |
  | **只删索引表那一行（旧门禁漏掉的洞）** | ❌ `AGENTS_TABLE_MISSING_ROW` |
  | 编号写错但链接对（全文搜索查不出的那种） | ❌ `AGENTS_ID_MISMATCH`「表里写 99，应为 09」 |
  | 索引表整张不见 | ❌ `AGENTS_TABLE_MISSING` + 每文件一条 `MISSING_ROW` |
- **顺带**：判定从 29 行内联脚本搬进规则模块，**内联门禁 2 → 1**（剩 `check:release-docs`）。
  但**搬动不是重点**——重点是它顺带暴露了判据选错。**先有洞，搬动才是自然的**。
- 读数：`pnpm lint` **0 warning**；`pnpm type-check` exit 0；`CI=true pnpm check:all` exit 0；
  **251 文件 / 3,004 用例**（上一条 250 / 2,989）；`check:gate-rule-tests` →
  **52 个规则模块 / 44 条走规则模块 / 1 条内联**。
- **方法论补一条（本轮第 9 条）**：
  **「我读过它、看起来没问题」和「我验过它、它会红」之间，隔着一次变异。**
  这一轮我因为「最近 8 次量出来都是干净的」而判了停止条件，
  而漏掉的恰恰是**唯一没被量过的那两条**——**「连续 8 次干净」本身会让人不去查第 9 次。**
- **下一项**：`check:release-docs` 是最后一条内联门禁，**同样还没被变异核对过**——
  按本条的方法，下一步就该验它（它按 `package.json` 版本解析发布产物，形态与 `check:agents` 不同，
  可能有另一种失效）。三条阻塞不变。

- 更新时间：2026-09-30（UTC）。

## 2026-09-30 — 最后一条内联门禁：`check:release-docs` 同样有错判据。**内联门禁归零**

- 里程碑 / 版本：v0.12.0。分支：`fix/release-docs-gate`（PR #192）。基线 `0d6a016b`。
- 状态：DONE。**内联门禁 1 → 0**：全部 **45** 条门禁的判定逻辑现在都在有单测的规则模块里。
- **上一条我写「下一项该验 `check:release-docs`」，本条就是那件事**——按 #191 立下的方法：
  **「读过」和「验过」之间隔着一次变异。**
- **原实现的判据**：只做两件事——① 当前 `package.json` 版本对应的三份发布文档存在吗；
  ② 几份文档里各含某几个关键词吗。于是**删掉
  `docs/operations/production-smoke-v0.9.0.md` 之后门禁照样绿**（实测确认，输出仍是
  `✅ release documentation checks passed (v0.11.0, 7 artifacts)`）。
- **为什么这一格重要**：**历史版本的发布证据才是发布审计真正要读的东西**，而它完全在门禁视野之外。
  本仓库其实**刻意**维护着一套完整矩阵——v0.6.0–v0.11.0 每版三份
  （release / rollback / production-smoke），**6 × 3 = 18 份**。
  「三族覆盖同一批版本」这个性质**是可判定的**，删掉任何一份都会破坏它。
- **规则**（`src/lib/release/release-docs.ts`，13 项单测）：
  三族必须覆盖同一批版本；删一份或多一份孤立文档都报错**并点名是哪一族缺哪个版本**；
  自述行把覆盖范围报出来（`6 个版本的三族发布证据齐全，共 18 份分版本文档`）——
  **让「覆盖了几版」与「结论」同屏**。
- **一处刻意的「不判」，并且写明它没做**：**不要求「CHANGELOG 里每个已发布版本都有这三份」**。
  CHANGELOG 声明 11 个已发布版本，而这 18 份只覆盖 v0.6.0 之后的 6 个；
  0.1.0–0.5.0 没有的**理由与 tag 台账里写的是同一条**（标签纪律那时还不存在）。
  **把那条理由在这里再抄一遍，就是本项目反复在消灭的「同一份数据有两个来源」**——
  所以只判三族自洽，跨到 CHANGELOG 的那一格明确留白。
- **一处刻意的「不升级」**：关键词判据沿用 `includes` 子串，**不升级成语义判据**。
  那批关键词是「这一节必须在」的检查点，子串足够；而语义判断会变成一条
  **没人能反驳、也修不动的**门禁。
- **过程中被自己的单测抓到两个真 bug（都写进了规则注释）**：
  1. **模板匹配错了**：`template.replace("{v}", "")` 得到 `production-smoke-v.md`，
     而真实文件名是 `production-smoke-v0.9.0.md`——**它根本不是前缀**，
     于是整族永远匹配不上、**这道判据永远空转**。正确写法是把模板拆成前缀/后缀
     （`{v}` 在中间时，删掉它不会留下一个前缀）。
  2. **关键词里的 `{v}` 没替换**：`RELEASE_NEEDLES` 写成 `[{v}]` / `runbook-v{v}` 是为了
     「换版本只改一处」，而我**只替换了路径没替换关键词**，于是拿字面量 `[{v}]` 去比对文档——
     **那永远匹配不上，CHANGELOG 与 checklist 两条会永久报错**。
     是单测在写 fixture 时发现「六版本齐全」竟然报 4 条才暴露的。
  **两个都是「判据写错了」而不是「判据选错了」，而两者都不会自己变红。**
- 变异核对五种（真实仓库上做、做完复原）：
  | 变异 | 结果 |
  |---|---|
  | 删掉一个**历史**版本的 smoke 文档（旧门禁漏掉的洞） | ❌ `VERSION_FAMILY_MISMATCH`「production-smoke 族缺 0.9.0」 |
  | 多出一份孤立文档（只有 release 一族） | ❌ 两族各报一次「缺 0.5.0」 |
  | rollback runbook 删一个关键词 | ❌ `MISSING_NEEDLE` |
  | README 删一个关键词 | ❌ `MISSING_NEEDLE` |
  | 版本改成 0.12.0（产物不存在） | ❌ 三份 `MISSING_FILE` |
- 读数：`pnpm lint` **0 warning**（中途撞到 `auditReleaseDocs` 复杂度 18 > 15，按仓库既有做法
  拆成 `missingRequiredFiles` / `familyMismatches` / `missingNeedles` 三个函数，**不加 disable 注释**）；
  `pnpm type-check` exit 0；**252 文件 / 3,017 用例**；
  `CI=true pnpm check:all` exit 0；`pnpm build` exit 0；`check:perf` 三格全绿；
  `check:gate-rule-tests` → **53 个规则模块 / 45 条走规则模块 / 0 条内联**。
- **这一轮的一条完整线索**（值得留给下一个人）：
  #183 我加了 `check:gate-rule-tests`，它会把「判定内联在脚本里」的门禁**点名**；
  但**它只点名，不催促**。于是「还剩几条内联」这件事，靠的是我后来又去数了一遍。
  **一条门禁能告诉你「这里不合规」，但不能替你决定「什么时候去修」**——
  而「什么时候去修」这次是靠 #191 立的另一条方法（「读过 ≠ 验过」）才推动的。
- 下一项：门禁判据这条线**已经走到头**（45 条全部有单测兜底、内联归零）。
  三条阻塞不变（A05 产品决策、B02–B05 外部权限、`/api/health` 响应契约）。

- 更新时间：2026-09-30（UTC）。

## 2026-10-01 — 把一个「能悄悄涨回去的绿色数字」换成一条会红的规则

- 里程碑 / 版本：v0.12.0。分支：`fix/inline-gate-hard-fail`（PR #193）。基线 `7f5b4fd6`。
- 状态：DONE。
- **上一条刚把内联门禁从 1 降到 0**，顺手问一句：**这个 0 守得住吗？**
  守不住——`check:gate-rule-tests` 对内联门禁的处置是**计数并打印**，不是失败。
  也就是说**再加一条把判定写在脚本里的门禁，它会绿着进来**，然后那个数字悄悄从 0 涨回 1，
  而门禁**不会有任何反应**。
- **这就是本轮主线那一类失效的最小形态**：
  #178–#192 处理的都是「一份记录看起来仍然有效，但它已经不成立」；
  这一条更朴素——**一个曾经有意义的计数，在条件变了之后变成了一个没人看的数字**。
  #183 当初只能计数，是因为**当时确实有 10 条**，报红会让仓库一直红着；
  现在条件变了（归零），**处置方式就该跟着变**，否则就是把一个临时的妥协凝固成了永久的门禁缺口。
- **改法**：非零即失败，并**点名是哪几条**（不点名的话，「有条内联门禁」这件事仍然不好查）。
  文档头同步改写，把「只能计数」的理由（当时有 10 条）与「现在为什么可以失败」一起写清，
  **免得后来人以为这是从一开始就有的严格规则**。
- 变异核对：真的加一条判定写在脚本里的门禁 → 红并点名 `check:zz-inline`（做完复原）。
- 顺带记一条**测试写法上的教训**：那个「一条规则模块都没检出时报红」的 fixture 里
  **所有门禁都是内联的**，所以新规则加上后它会触发**两条**。我第一版把断言写成 `toEqual([...])`
  于是它红了——那不是规则的问题，是**断言把「只应该触发这一条」固化进了用例**。
  改成 `toContain` 并在注释里写明理由：这样以后再加规则时，这个用例不必再同步更新。
  **一条过紧的断言会变成以后每加一条规则都要改一遍的负担**，而那种负担正是让人不去加规则的原因。
- 读数：`pnpm lint` **0 warning**；`pnpm type-check` exit 0；**252 文件 / 3,019 用例**；
  `CI=true pnpm check:all` exit 0；
  `check:gate-rule-tests` → **53 个规则模块 / 45 条走规则模块 / 0 条内联**。
- **这一轮的一条完整弧线**（值得留给下一个人，因为它跨了 10 条 PR）：
  #183 发现「门禁的判定逻辑没有单测兜底」→ 加门禁点名内联门禁 → **但只计数**；
  #184 / #186 搬了 2 条；#191 / #192 才发现剩下的 2 条**判据本身也是错的**，
  于是「读一遍觉得没问题」被换成「变异一次」；搬完之后计数归零，#193 才把它变成硬失败。
  **真正的教训不是「要变异」，是「一个临时的处置方式必须被标明是临时的」**——
  #183 那时写下「不算错，但必须被计数」是诚实的，**缺的是把「临时」两个字在条件变化时兑现**。

- 更新时间：2026-10-01（UTC）。

## 2026-10-01 — 量掉最后一个没量过的轴：「有单测」是不是等于「单测会失败」

- 里程碑 / 版本：v0.12.0。分支：`docs/rule-tests-falsify-verification`（PR #194）。基线 `e1e8b3b8`。
- 状态：DONE（**这是一次验证，不是一处改动**）。
- **这个轴是 #183 立下来的**：`check:gate-rule-tests` 断言「门禁的判定逻辑放在有单测的规则模块里」。
  但它验的是**文件存在**，不是**测试会失败**——一个只跑 happy path 的规则模块照样满足它，
  而那个门禁等于没有测试。**这个疑点从 #183 起就摆在那里，我一直没量。**
- **量法：把判定函数 neuter 掉，再跑它自己的套件。**
  给函数体开头插一行 `return undefined as never;`——它「永远判合格」——
  于是**凡是真在测这条规则的套件必然变红**。
- **结果（12 个规则模块，真实跑出来）**：
  | 规则模块 | 变红的测试数 |
  |---|---|
  | `query-columns` | 22 |
  | `perf-audit` | 16 |
  | `route-auth` | 14 |
  | `storage-policies` | 14 |
  | `changelog-tag-reconciliation` | 14 |
  | `native-theme` | 12 |
  | `state-rules` | 10 |
  | `translation-usage` | 10 |
  | `release-docs` | 10 |
  | `gate-rule-tests` | 10 |
  | `agents-index` | 9 |
  | `admin-client-boundary` | 17 |
  | `client-artifact-env` | 5 |
  **无一例外全部变红。** 也就是说 #183 那条门禁的**前提是真的**：
  「规则模块有单测」在本仓库里确实等于「规则的强度被兜住了」，而不只是名义上成立。
  **这与 #183 当时「33/33 全覆盖」的静态结论相比，是从「文件在」升级到「会响」。**
- **这一条同时记下我自己犯的三个测量错误**——它们**每一次都得出「这些测试是假的」这个
  最耸动的结论**，所以值得逐条留档：
  1. **补丁根本没打上**：`pathlib.write_text(content, errors)`——我多传了第二个参数，
     它被当成 `encoding`，于是抛 `unknown encoding` 而**文件从未被修改**；
     而我的脚本把「没有输出」当成「0 个测试变红」，于是报出 7 条全绿。
  2. **ANSI 颜色码吃掉了 grep**：真实输出里 `Tests` 与数字之间夹着转义序列，
     `-oE "Tests +[0-9]+ failed"` 匹配不到，于是又全部判成「0 个变红」。
  3. **插在 `(` 之后破坏了多行签名**：模块变成**语法错误**、测试文件根本加载不了
     （输出是 `Tests no tests`），我又把它读成「没变红」。
  **三次都是「工具坏了」被读成「结论不好」。** 而这三次如果被我直接写进 CHANGELOG，
  就是一条**方向完全相反、且看起来极有说服力的错误结论**——
  「本仓库的门禁测试有一半是摆设」这种话，一旦写下来就很难再被纠正。
  **这比本轮任何一次真正的 bug 都更危险。**
- **为什么不做成常驻门禁**：这个测法要**改源码再跑测试**，放进 CI 既慢又不自洽
  （一条门禁靠临时改坏别的文件来工作）。它的正确形态是**人工/按需跑的取证**，
  就像 #180 / #182 / #184 / #186 / #190 / #191 / #192 / #193 的变异核对那样。
  **把它做成常驻门禁会为了「自动化」而牺牲「结论可信」**——本轮已经为这件事付过代价。
- 读数：`pnpm lint` **0 warning**；`pnpm type-check` exit 0；**252 文件 / 3,019 用例**；
  `CI=true pnpm check:all` exit 0；工作树干净（12 次变异全部复原，已逐个确认）。
- **这一轮的门禁类工作到此为止**：45 条门禁全部走规则模块、0 条内联、
  **抽样 12 个核心规则模块的测试全部真的会红**。三条阻塞不变。

- 更新时间：2026-10-01（UTC）。

## 2026-10-01 — 换一个维度：不再问「门禁对不对」，而是问「文档链接到的东西在不在」

- 里程碑 / 版本：v0.12.0。分支：`feat/doc-links-gate`（PR #195）。基线 `9d059af5`。
- 状态：DONE。门禁数 45 → **46**。
- **为什么换维度**：门禁判据这条线在 #194 已经走到头（45 条全部走规则模块、0 条内联、
  抽样 12 个核心规则模块的测试全部真的会红）。再往下审是**边际收益递减**，
  所以换一个**从没量过的面**。
- **选它的理由**：本仓库是**给别人用的模板**，文档是它的产品。而我量到
  `docs/` + `docs-site/` + 两份 README + `AGENTS.md` 共 **135 个 markdown 文件、150 条内部链接**，
  **没有任何门禁核对它们指向的文件是否存在**——
  也就是 **150 个「这里有一份文档」的断言从未被验证过**。
  同一类缺陷在 `AGENTS.md` 上已经真实发生过一次（#191：索引表少一行，而门禁只要求
  「至少被引用一次」）。**一次真实发生过的缺陷形状，不该在另一个地方裸奔。**
- **量的时候自己踩了两个假红陷阱**（都已成为规则的用例）：
  1. **markdown 链接省略扩展名**。我第一版只试「原样拼接」，于是报出**「28 条断链」**——
     而那 28 条的目标文件**全部存在**（`./storage` 指向的是 `storage.md`）。
     **一条会随框架惯例变化的规则，如果不把那个惯例写进代码，它就只是一条随机报红的规则。**
  2. **`/x` 是站点根 URL，不是文件系统根**。VitePress 里 `/quickstart` 是合法写法；
     按 `path.resolve('/quickstart')` 去查文件系统会全灭。
  修好之后：**150 条内部链接，0 条断链**。
  **也就是说仓库今天是干净的——但「干净」不等于「被守着」**，所以做成门禁。
- **一处刻意的「不判」，写明理由**：**不判锚点是否存在**。
  锚点要复刻 VitePress 的标题 slug 生成规则（大小写、标点、emoji、重复标题后缀），
  **那是一条会随生成器版本漂移的规则**——而本项目反复在消灭的正是「看起来有约束、
  实际会漂移」的判据。锚点坏了是「点了没跳」，文件没了是「点了 404」，**后者严重得多**。
- **失败封闭**：一个 markdown 文件都没扫到时报红（「什么都没在看」与「全都可达」长得一模一样）。
- **又一次被自己的单测抓到**：`linkCandidates` 会给带 `.md` 的路径再造出
  `README.md.md` 与 `README.md/index.md` 两个**永远不可能存在**的候选——
  它们只会在报错信息里多两个噪音词、**掩盖真正试过的候选**。
  第一版只挡了 `.md`、漏了 `index.md`，是第二条用例补上的。
- 变异核对四种（做完复原）：省略 `.md` 的断链 → 红并列出试过的三个候选；
  带 `.md` 的精确断链 → 红；站点根 URL 断链 → 红；扫描范围扫空 → 红（`DOC_LINKS_NOTHING_SCANNED`）。
- 读数：`pnpm lint` **0 warning**；`pnpm type-check` exit 0；**253 文件 / 3,038 用例**；
  `CI=true pnpm check:all` exit 0；`check:gates` → **46 个门禁**（本地 43 / CI 45 / 豁免 3）；
  `check:gate-rule-tests` → **54 个规则模块 / 46 条走规则模块 / 0 条内联**。
- 下一项：三条阻塞不变（A05 产品决策、B02–B05 外部权限、`/api/health` 响应契约）。
  可继续量的面还有：**外部链接的可达性**（现在只跳过不验证，而那 30 条外链同样会腐烂）、
  **README 里的命令是否真的能跑**。

- 更新时间：2026-10-01（UTC）。

## 2026-10-01 — 文档教用户做的事，本身有没有被验证过

- 里程碑 / 版本：v0.12.0。分支：`feat/doc-commands-gate`（PR #196）。基线 `cbc76c31`。
- 状态：DONE。门禁数 46 → **47**。
- **接着 #195 的思路往下问一层**：#195 验了「文档里的**链接**指向的文件在不在」，
  那么「文档里的**命令**能不能跑」呢？一条写错的命令（`pnpm verifiy:build`）
  **不会让任何门禁变红**——它只会让模板用户在 clone 之后的**第一条命令**上撞墙。
- **量之前先量了假红风险**（这一步决定了这条门禁能不能成立）：
  把范围放到全部 135 个 markdown 上，同一套判据报出 **12 条「不存在的命令」**——
  而它们**全都合理**：`pnpm install` / `pnpm exec` / `pnpm audit` 是**内建命令**；
  `pnpm check:x` / `pnpm xxx` 是**模板与推演记录里的占位**。
  也就是说**朴素的版本是一台假红机器**。
- **于是受审范围刻意缩到四份入门文档**（两份 README + 两份 quickstart），理由写进规则头：
  那三类被排除的文件是**记录与计划**，不是**给用户的指令**。
  **这条门禁判的是「文档教用户做的事存在吗」，不是「文档里出现过的字符串存在吗」**——
  后者是一个没有意义的问法，而它恰好是朴素版本会做的事。
- **实测**：这四份文件里共 **90 条 pnpm 命令，全部有落点**。干净——但**「干净」不等于「被守着」**。
- **一处由单测逼出来的判据修正**（重要）：第一版把 `pnpm exec vitest` 也丢给 scripts/builtins 判，
  于是它被报成「不存在的命令」——**而 vitest 明明在 devDependencies 里**。
  `pnpm exec <x>` 问的是「这个依赖装了吗」，问「仓库有没有这个 script」是**问错问题**，
  **那样的门禁只会教人加豁免**。改成按 dependencies/devDependencies 判定后，
  两种写法的报错信息也各自说清自己在问什么。
- **一处刻意的「不判」**：命令的**参数**（`pnpm vitest --wat` 里的 `--wat`）。
  判参数要复刻每个底层工具的 CLI 表面，**那是一条会随依赖升级漂移的规则**——
  与 #195 不判锚点是同一条理由。**看起来有约束、实际会漂移的判据，本项目一直在消灭。**
- 变异核对（做完复原）：脚本名拼错 → 红并说清「补脚本还是改文档」；
  `pnpm exec <未安装的包>` → 红并点名它问的是依赖。
- 读数：`pnpm lint` **0 warning**；`pnpm type-check` exit 0；**254 文件 / 3,051 用例**；
  `CI=true pnpm check:all` exit 0；`check:gates` → **47 个门禁**（本地 44 / CI 46 / 豁免 3）；
  `check:gate-rule-tests` → **55 个规则模块 / 47 条走规则模块 / 0 条内联**。
- **一处刻意的范围留白，写明它没做**：另外 131 份文档里的命令**不在本门禁视野内**。
  那不是遗漏，是上面那条「记录与计划 ≠ 给用户的指令」的判断——但也意味着
  **运维手册里写错命令仍然不会被发现**。这是本条**已知不覆盖**的一格。

- 更新时间：2026-10-01（UTC）。

## 2026-10-03 — 一条正确的判据撞上不可修的现实：把「暂无补丁」登记成会自己到期的例外

- 里程碑 / 版本：v0.12.0。分支：`fix/dependency-audit-exception-ledger`。基线 `b7637787`。
- 状态：DONE。门禁数 47 → **48**。
- **这一轮的起点是一次「门禁红了但没人能修」**：`CI=true pnpm check:all` 在 `check:security` 上报
  `0 critical, 1 high vulnerabilities`，来路是 `braces` 的 GHSA-vfj7-8cjw-p6xm（CVE-2026-93687，递归爆栈 DoS）。
  按本仓库的优先级，「安全失败」排在最前面那一档，所以先量它到底能不能修：
  - 路径 `.>eslint-config-next>@next/eslint-plugin-next>fast-glob>micromatch>braces`——
    `eslint-config-next` 是 devDependencies，**仅开发期可达**，不进运行时依赖图、不进产物；
  - 公告的 patched range 写 `>=3.0.4`，而 `npm view braces versions` 的**最新发布版就是 3.0.3**；
    GitHub Advisory Database 那一条的 Patched versions 一栏是 **None**。也就是说
    「有个已发布版本能修」这句话本身就是假的；
  - 往上游看也堵不住：`fast-glob` 最新 3.3.3 仍依赖 `micromatch@^4.0.8`，`micromatch` 最新 4.0.8 仍依赖 `braces@^3.0.3`。
  **结论：这不是「有人忘了升依赖」，而是一个正确的判据撞上了一个没有补丁的现实。**
  一条没人能修的门禁不是严格，是**失效**——它会训练所有人忽略这一格红灯。
- **处置方式沿用仓库既有纪律，而不是新造一条**：C08 的错误通道台账、C12 的限流两态台账、
  以及 #193「内联门禁从计数升级为硬失败」都是同一句话——
  **一个临时的处置方式必须被标明是临时的，并在条件变化时自己兑现**。
  所以这里没有把判据从「high/critical 必须为 0」放宽，而是把「已知且暂时无法修复」登记成
  `DEPENDENCY_AUDIT_EXCEPTIONS`（`src/lib/security/dependency-audit.ts`），每条必须写清可达性结论、
  「为什么现在修不了」，以及 `reviewedOn` / `reviewBy`。
- **让它不可能悄悄变成永久豁免的四条**（这是本条真正的价值所在，不是那个台账本身）：
  1. **未登记即失败**并点名 id/模块/依赖路径——台账**不是白名单**，它是登记簿；
  2. **条目写不完整即失败**（理由空、日期不是 `YYYY-MM-DD`、`reviewBy < reviewedOn`）；
  3. **反向断言**：台账里的公告**不再出现在报告里**就红（修复落地后请删条目）；
     「仅开发期可达」不再成立也红；台账与报告对模块/级别的说法不一致也红。
     第 3 条与 `KNOWN_GAPS` 那条反向断言同形，是这套机制里最要紧的一条——
     **文档腐化是静默的，而这条不是**；
  4. **`reviewBy` 早于今天即红**：逼人重新看一眼上游有没有发补丁。
- **两条失败封闭是这一轮量出来的，不是一开始想到的**：
  - blocking 计数大于 0 却给不出公告明细 → 红（「无法判断是否已登记」必须读成「未登记」）；
  - 计数与可枚举公告条数对不上 → 红。**「存在但看不见」无法登记，也就无法豁免**，
    而注册表改一次计数口径就能制造出这一格；宁可因为口径变化而红，也不要在口径变化后安静地放过漏洞。
- **一处必须记下来的实现错误**（它一度让门禁输出 `[object Object]`）：
  `readBlockingAdvisories` 最初返回 `BlockingAdvisory[] | string[]`，
  而**两种形状都是数组**，`Array.isArray` 分不开——于是公告对象被当成问题串打印，
  台账那条真实例外同时被判成「不再出现在报告里」。
  **看起来像门禁在抱怨、实际什么也没判**，这比报红更坏。改成 `{ advisories, error? }` 后消失。
  这与 #194 那次「工具坏了被读成结论不好」是同一族：**坏掉的工具会说出听起来很像结论的话**。
- **一处 CI 层面的发现**：security-config job 里那一步此前是裸的 `pnpm audit --audit-level high`。
  裸命令不看台账，所以**无论本仓库怎么改，那一步都会永远红**——也就是说这条红不是「门禁太严」，
  是**门禁本身不可执行**。已改为 `pnpm check:audit`，判定只有一份实现（`src/lib/security/dependency-audit.ts`），
  `check:security` 与它不会各判各的；`check:security` 的配置面要求同步从裸命令改成 `pnpm check:audit`，
  并补一条**反向断言单测**：把裸命令塞回去不算接线。
- **这处修复自己被抓了第二次，而这一条比第一次更值得记**：第一次只改了 `security-config.yml`
  （当时 grep 的是「哪些工作流提到 `check:security`」），推上去之后同一个 PR 的 CI 仍然红——
  日志里是 `ci.yml` 静态门禁作业里**一模一样**的裸审计。
  也就是说**我修掉的是「我查到的那一处」，而门禁红的是「所有那一类」**；
  这正是本仓库反复付过学费的形状（#191 的 `AGENTS.md` 索引、#195 的文档链接都是它的同型）。
  - `ci.yml` 那一步删掉：它与紧随其后的 `pnpm check:all`（内含 `check:security`）重复判定同一件事，
    而那一步下面本来就写着「一份清单」的约定；删掉比再加一次 `pnpm check:audit` 更符合那条约定，
    也少一次注册表请求。
  - 补 `inspectBareAuditCommands`：**任何工作流都不许再出现裸的 `pnpm audit`**
    （`pnpm check:audit`、`pnpm audit:storage-orphans` 不算）。它问的是「有没有绕开台账的入口」，
    **不是**「审计有没有跑」——后者归 `check:gates` 与 `SECURITY_GATE_REQUIREMENTS`，
    两条判据问的不是同一件事，所以都要留着。
  - 注释里的字样不算命令（判定先去掉整行注释）：不这么做，我们为解释这条规则而写下的那串
    `pnpm audit --audit-level high` 会把门禁顶红——**注释不是配置**，这与 `workflow-policy` 踩过的
    同一类假红同形。
  - 真实仓库上的变异核对：把 `ci.yml` 那一步加回去 → `check:security` 红并点名文件与那行命令（做完复原）。
- **通过时的输出改成自报读数**（`1 条已登记例外（GHSA-vfj7-8cjw-p6xm）`）：
  「门禁绿了」与「有 1 条是靠登记过的例外放行的」是两句话，只说前一句就丢了后者。
- 变异核对六处（做完复原，逐个确认文件已还原）：抹掉 STALE 反向断言 → 2 条红；
  抹掉复核期限 → 1 条红；抹掉 dev-only 判定 → 1 条红；抹掉计数与明细对账 → 1 条红；
  抹掉台账理由校验 → 9 条红；把裸审计加回 `ci.yml` → `check:security` 红并点名。
- 变更文件：`src/lib/security/dependency-audit.ts`（新增）、`dependency-audit.test.ts`（新增，35 条）、
  `src/lib/security/dependency-audit-check.test.ts`（新增，4 条）、
  `scripts/check-dependency-audit.js`（新增）、`scripts/lib/dependency-audit-check.js`（新增）、
  `src/lib/security/security-config.ts`（审计判定改为委托 + 配置面要求换掉裸命令）、
  `.github/workflows/ci.yml`（删掉重复的裸审计步骤）、
  `security-config.test.ts`、`security-config-check.test.ts`、
  `src/lib/release/gate-wiring.ts`（`check:audit` 登记免于本地聚合，理由写明）、
  `gate-wiring.test.ts`（临时仓库 fixture 补上这个门禁）、
  `package.json`、`.github/workflows/security-config.yml`、`docs/testing.md`、
  `docs-site/scripts.md` + `docs-site/zh-CN/scripts.md`、`CHANGELOG.md`、本条目。
- 验证命令与结果：`pnpm lint` **0 warning**（中途撞到 `inspectDependencyAudit` 复杂度 19 > 15，
  按仓库既有做法拆成 `collectBlocking` / `collectUnidentifiable` / `collectUnregistered`
  三个函数，**不加 disable 注释**）；`pnpm type-check` exit 0；
  **256 文件 / 3,096 用例**；`CI=true pnpm check:all` exit 0；
  `pnpm build` exit 0；`check:gates` → **48 个门禁**（本地 44 / CI 47 / 豁免 4）；
  `check:gate-rule-tests` → **56 个规则模块 / 48 条走规则模块 / 0 条内联**；
  `pnpm check:audit` 与 `pnpm check:security` 都自报那一条例外。
- 阻塞 / 风险：**这一条本身会在 2026-11-02 之后自己变红**，那是设计而不是故障——
  到时候要么删条目（补丁已发），要么更新 `reviewedOn` / `reviewBy` 并把查证过程写回 `justification`。
  风险是有人为了让它绿而直接调大 `reviewBy`：那时台账就退化成一句没人再看的话，
  而唯一的反制是 review 时要求写清「查了 npm 的哪个命令、看到什么」。
  回滚 = revert 本次提交（会回到「红且不可修」的状态，这一条本身不构成回滚理由）。
- 下一项：三条阻塞不变（A05 产品决策、B02–B05 外部权限、`/api/health` 响应契约）。
  可继续量的面：把「例外台账」这条思路套到别的「条件变了但没人守着」的地方
  （例如 `RATE_LIMIT_LEDGER` 的 28 条理由是否有同类到期机制）。
- 更新时间：2026-10-03（UTC）。

## 2026-10-03 — #196 亲手记下的那一格留白：受审范围从 4 份扩到 130 份

- 里程碑 / 版本：v0.12.0。分支：`feat/doc-commands-full-scope`。基线 `829baf81`（#197 合并后的 main）。
- 状态：DONE。门禁数仍 **48**（这一条改的是既有门禁的覆盖面与判据，不是新增）。
- **起点是上一条自己写下的句子**：`check:doc-commands`（#196）明确把受审范围限定在四份入门文档，
  并写下「另外 131 份文档里的命令不在本门禁视野内……**运维手册里写错命令仍然不会被发现**。
  这是本条**已知不覆盖**的一格」。**一个自己记下的已知缺口，就是下一次该动的位置。**
- **先量范围，再动判据**（顺序很重要，因为量范围会暴露判据的问题）：
  - **范围**：把同一套判据放到 `docs-site/**`（54 份用户文档）、`docs/architecture`、`docs/adr`、
    `docs/db`、`docs/design`、`docs/reference`、`docs/testing.md` 与根级三份 md 上，
    **真实问题 0 条**。也就是说这 126 份文档此前一直没人核对，而它们是模板用户的全部读物。
    真正该排除的只有三类**记录与计划**：`CHANGELOG.md`（它会**故意**引用不存在的命令来说明门禁在抓什么——
    第一版忘了排除它，于是它自己被报出 5 条）、`docs/progress.md`、`docs/roadmap-*.md`，
    外加两个用 `check:x` 充当占位的模板与封存报告。
  - **判据**：扩范围后一次报出 12 条，逐条查下去**全是假红**，而它们分属同一个根因——
    pnpm 对未知命令的语义是**当 shell 命令执行，并把 `node_modules/.bin` 放进 PATH**。
    所以「这条命令能不能跑」的答案是「那个二进制在不在 `.bin` 里」，
    而前两版问的是「`package.json` 里有没有同名 script」（第一版补过 `pnpm exec <x>` 这一种写法，
    但那只是同一个问题的六分之一）。实测 `pnpm vitest run …`、`pnpm playwright test`、
    `pnpm exec supabase start` **全都完全能跑**，却被报成「不存在」。
- **这里最该记的是那句话：一台只会喊假红的门禁只会教人加豁免。**
  #196 已经为 `pnpm exec <x>` 写过同一句教训，但当时把它当成「一个写法的问题」修掉了；
  这一轮才看清它是**「判定基准选错了地面」**。**同一条教训被读成两个不同的问题修了两遍**，
  而第二遍才是根因——教训被复述一遍不等于被理解一遍。
- **放宽的是依据，不是结论**：现在放行四条（scripts / pnpm 内建 / **`.bin` 里真的有那个文件** /
  依赖名同名作为退化路径），而**不在 `.bin` 里、又没登记的外部命令仍然报红**。
  `.bin` 读不到时（没跑过 `pnpm install`）退回按依赖名判，并**在读数与报错里明说降级了**——
  「没装依赖」与「一个二进制都没有」的处置完全不同（先 install vs 补依赖）。
- **顺带补两条会红的规则**（都是「配置自己会烂掉」的形状）：排除项**理由为空**即红
  （空理由等于「我不想看这个文件」）；排除项**一个文件都没命中**即红
  （文件改名之后排除项就失效，而失效的排除项仍留在配置里，下一个人会以为那里仍然没被审）。
- **一处自嘲式的收口**：把这一轮的说明写进 `docs/testing.md` 时，我在正文里写了
  `pnpm verifiy:build` 与 `pnpm check:x` 当例子——**扩范围后的门禁当场把这两行顶红了**。
  改法是把例子写成「`verify:build` 被手抄成少一个 e 的 `verifiy:build`」与「`check:x` 这种形状」。
  **一条门禁第一次运行就抓到写它自己文档的人**，这比任何变异核对都有说服力。
- **顺带补上一个登记缺口**：`check:doc-commands` 与 `check:doc-links` 此前存在于仓库，
  却**不在任何一份贡献者测试矩阵里**——也就是改文档的人不知道要跑它们。
  现在两条都进了 `src/lib/testing/test-matrix.ts` 的「文档」领域与两份矩阵文档（108 → 112 条门禁）。
- 变异核对五处（做完复原，逐个确认已还原）：README 里造真 typo → 红并点名行号；
  `docs-site/testing.md` 里造 typo（旧范围外，正是这一轮要覆盖的那一格）→ 红；
  排除项理由置空 → `DOC_EXCLUSION_REASON_MISSING`；排除项改名失效 → `DOC_EXCLUSION_STALE`；
  抹掉 `.bin` 判定 → 报出 6 条假红（证明那 12 条假红的根因确实是它）。
  **一处测量事故也记下来**：第一次跑「docs-site 里造 typo」时挑的文件里根本没有 `pnpm` 命令，
  于是那次变异**什么都没改**，门禁照绿——**一次没打上的补丁被读成了「门禁没抓到」**。
  重挑文件并把匹配到的命令打印出来才作数（与 #194 那三次同族）。
- 变更文件：`src/lib/docs/doc-commands.ts`（范围改为 glob + 排除项 + `.bin`/外部 CLI 判定）、
  `doc-commands.test.ts`（22 条）、`scripts/lib/doc-commands-check.js`（列文件 / 读 `.bin`）、
  `src/lib/testing/test-matrix.ts`、`docs-site/testing.md` + `docs-site/zh-CN/testing.md`、
  `docs/testing.md`（新增该门禁的一节——此前它只在 CHANGELOG 与本台账里）、
  `CHANGELOG.md`、本条目。
- 验证命令与结果：`pnpm lint` **0 warning**（中途撞到 `auditDocCommands` 复杂度 26 > 15，
  按仓库既有做法拆成 `inspectExclusions` / `hasLanding` 两个函数，**不加 disable 注释**）；
  `pnpm type-check` exit 0；**257 文件 / 3,112 用例**；`CI=true pnpm check:all` exit 0；`pnpm build` exit 0。
  新读数：**1,010 条 pnpm 命令 / 130 份受审文档，全部有落点**（另排除 8 份记录与计划）。
- 阻塞 / 风险：受审范围现在覆盖 `docs/operations/**`，那里面是**已完成版本的 runbook 快照**
  （v0.6–v0.10）。它们今天全部干净，但**将来某个脚本被删或改名时，红的会是历史文档**——
  处置方式应当是把该命令在那份快照里改成指向现行命令，而不是把文件加进排除表。
  风险是有人为了让它绿而随手加排除：所以排除项必须写理由、且失效即红。
  回滚 = revert 本次提交（会回到「4 份文档 + 6 条假红」的状态）。
- 下一项：三条阻塞不变（A05 产品决策、B02–B05 外部权限、`/api/health` 响应契约）。
- 更新时间：2026-10-03（UTC）。

## 2026-10-03 — 最后一类还没接上「会到期」纪律的处置：那条已知缺口

- 里程碑 / 版本：v0.12.0。分支：`fix/rate-limit-gap-review-date`。基线 `ac0c089e`（#198 合并后的 main）。
- 状态：DONE。门禁数仍 **48**（改的是既有门禁的判据，不是新增）。
- **找它的方式不是「我觉得该加」，而是数「哪些临时处置还没有到期日」**：
  `#197` 那天给依赖审计的例外台账定了纪律——**一个临时的处置方式必须被标明是临时的，
  并在条件变化时自己变红**。于是同一个问题就该问全仓：`C08` 错误通道台账（按数量对账，条件变了会红）、
  `C12` 限流两态台账里的豁免（调用图看得见窗口就报 `RATE_LIMIT_STALE`）、文档排除项（失效即红）——
  **数到最后剩下一类：标了 `RATE_LIMIT_GAP_MARKER` 的「已知缺口」。**
  它有一半纪律：`GAP_CLOSURE` 要求「说出怎么关」；但**那一条不会过期**——
  一条写着判据的缺口可以躺三年，每次 CI 仍只报「1 条已知缺口」，没人被要求再看它一眼。
- 改法与那条例外台账同形：缺口正文必须写「复核期限：YYYY-MM-DD」，
  缺日期即 `RATE_LIMIT_GAP_REVIEW_MISSING`，过期即 `RATE_LIMIT_GAP_REVIEW_OVERDUE`（判据接受注入的 `today`，
  单测因此是确定的）。`GET /api/health` 那条已补 `复核期限：2026-11-15`，
  到期时的正确处置是**重新确认这个缺口是否还成立、判据是否还正确**，而不是把日期往后推——
  它的关法涉及 `/api/health` 的响应契约，属产品决策（见三条阻塞之一）。
- **顺带修掉一处「抄下来的数字」**：`docs/testing.md` 的 C12 那一节写着
  「45 个 handler = **14 个有窗口 + 31 个写明理由**」与**两条**已知缺口，
  而门禁现在的真实输出是 **17 + 28** 与**一条**——`GET /api/og` 的缺口在 #136 之后已经关掉，
  抄下来的数字却留到了今天。
  已按 roadmap D04 自己的处方改成**指向门禁输出**（`check:route-auth` 每次都把两个分母与缺口条数打出来）。
  **一个抄下来的数字会一直错到有人去核对它**——而这一格之所以能活这么久，
  是因为**没有任何门禁核对文档里的数字**（#196 那条只核对命令与链接）。
- 变异核对两处（做完复原）：抹掉「期限过了」判定 → 1 条红；抹掉「缺日期」判定 → 1 条红。
- **顺手量了一条轴，结论是「不可信的上界」，因此不据它动工**（记下来是为了让下一个人别重走）：
  主题是「有多少翻译键根本没人用」。用仓库自己的 `findStaticKeys` + `findDynamicTemplates` 量，
  得到 **1,260 个键 / 静态用到 683 / 挂在 12 个已登记动态前缀下 / 疑似死键 578**——
  **这个数字不可信**，因为第一版脚本漏了两件事：
  ① 键要带命名空间前缀才比得上（漏了 → 「全部死键」这种一眼假的结论）；
  ② `t.raw("…")` / `t.rich("…")` **按子树取用**，它们的叶子不会单独出现在代码里
  （`pricing` 页的 `t.raw("faq.questions")` 就是这一类）。补上之后降到 **325**，
  而 325 仍然是上界——`useTranslations(<变量>)` 这类绑定方式我没有覆盖。
  **中途还推翻过自己的一个推断**：我以为 `findStaticKeys` 不收 `t.raw` 会让
  `check:dynamic-keys` 的孤儿规则误报，写完才发现按子树取的键要么不是动态前缀的直接子键、
  要么 `tail.includes(".")` 已经跳过，**那条推断不成立**，所以没有据此改代码。
  这与 #194 那三次、#198 那一次同族：**一个会说话但没被核对的数字，比没有数字更贵。**
- 变更文件：`src/lib/security/rate-limit-policy.ts`（两个新规则码 + 期限判定 + 那条缺口的期限）、
  `rate-limit-policy.test.ts`（4 条新用例，含「仓库里那条真实缺口」）、`docs/testing.md`、
  `CHANGELOG.md`、本条目。
- 验证命令与结果：`pnpm lint` **0 warning**；`pnpm type-check` exit 0；
  `check:route-auth` → **45 个 handler = 17 个有窗口 + 28 个写明理由（其中 1 条标注为已知缺口）**；
  全量 `pnpm test` / `CI=true pnpm check:all` 见 PR。
- 阻塞 / 风险：**这一条会在 2026-11-15 之后自己变红**，那是设计而不是故障。
  风险是有人为了让它绿而直接把日期往后推——所以规则文案要求「把查证过程写回理由」，
  与例外台账那一条的抗辩方式相同。
  翻译死键那条轴**没有结论**，因此没有动任何代码或消息文件。回滚 = revert 本次提交。
- 下一项：三条阻塞不变（A05 产品决策、B02–B05 外部权限、`/api/health` 响应契约——最后这一条
  同时是上面那个缺口的关法，需要产品决策）。可继续量的面：翻译死键（需要先把 `t.raw`/`t.rich`
  与变量绑定两种形状补进抽取器，再重量）。
- 更新时间：2026-10-03（UTC）。

## 2026-10-03 — 把「变异核对」从一次性脚本固化成工具，并且当天又踩了它要防的那个坑

- 里程碑 / 版本：v0.12.0。分支：`feat/rule-falsification-tool`。基线 `847c845d`（#199 合并后的 main）。
- 状态：DONE。门禁数仍 **48**（刻意**不新增** `check:*`，理由见下）。
- **起点是 #194 留下的一句话**：那次手工量过 12 个规则模块，结论是「有单测」在本仓库等于
  「单测会失败」。但那个测法是**一次性脚本**，里面记着三次测量事故，
  其中一次正是「ANSI 颜色码吃掉了 grep → 把全部变红的模块读成全部存活」。
  **结论是对的，过程里藏着一个会说出相反结论的错误**——而结论不会被记录，过程会，
  于是下一次有人重做这件事时很可能再踩一次。**把结论留下而不把过程留下，等于把坑留下。**
- **做法**：把这件事的两半都做成可单测的纯函数（`src/lib/testing/rule-falsification.ts`），
  再加一层只管 IO 的 runner（`scripts/lib/rule-falsification-run.js`）。
  三条纪律各对应一种真实踩过的坑：先确认**工作树干净**（脏树上复原会连带丢掉未提交改动）；
  复原放在 `finally` 并**逐字节校验**（中途失败会留下一处「永远判合格」留在树上——**而它会绿**）；
  **「读不出结论」与「存活」分成两档**。
- **一个没法抵赖的事实**：写这个工具的当天，我跑第一遍批量核对，六个模块**全部报「存活」**。
  手工复核其中一条（`inspectRlsCoverage`）才发现是 **8 条红**——ANSI 序列吃掉了正则。
  **这与 #194 记下的那一次是同一个坑，同一个位置，同一个方向**（把「全红」读成「全绿」）。
  所以那个 `unreadable` 档不是理论上的严谨，而是**当天就要用的**：
  一个会说反话的读数必须有一个「我不知道」的出口，否则它只能被当成结论。
- **登记表只放真的跑过红的判定**：它是证据清单，不是待办清单。
  当前 **17 条判定 / 12 个规则模块全部会红**（合计 211 条用例变红）；
  #194 手工核对过的是另外 13 个模块——**两张表不重叠**，合计覆盖 25 个规则模块。
- **刻意不做成常驻门禁**：这个测法要改源码再跑测试，放进 CI 既慢又不自洽
  （一条门禁靠临时改坏别的文件来工作）。`pnpm falsify:rules` 是手动取证入口，
  它的产物是上面那张表，而那张表贴在本文件里。
- 变异核对（本轮新增规则的自我验证）：`neuterFunction` 找不到导出函数 → `changed=false`
  且调用方必须明说「没打上」；`summarizeFalsification` 对无法解析的输出 → `unreadable` 而**不是** `survived`。
- 变更文件：`src/lib/testing/rule-falsification.ts`（新增）、`rule-falsification.test.ts`（新增，12 条）、
  `src/lib/testing/rule-falsification-run.test.ts`（新增，3 条复原保证）、
  `scripts/lib/rule-falsification-run.js`（新增）、`scripts/falsify-rule-modules.js`（新增）、
  `package.json`（`falsify:rules`）、`docs/testing.md`、`CHANGELOG.md`、本条目。
- 验证命令与结果：`pnpm falsify:rules` → **17/17 会红**（逐条读数见 PR），跑完 `git status` 干净；
  `pnpm lint` **0 warning**；`pnpm type-check` exit 0；全量 `pnpm test` / `CI=true pnpm check:all` 见 PR。
- 阻塞 / 风险：登记表覆盖 12 个模块，**剩下的规则模块仍未做过变异核对**——
  这不是遗漏，是「登记表只登记跑过红的」这条纪律的代价：每加一条都要真跑一遍（约 1 分钟）。
  风险是有人为了省事把「应该会红」直接写进登记表——所以 runner 只信运行结果，
  而 `RULE_FALSIFICATION_TARGETS` 的形状由单测守着（路径、return 语句、不得重复）。
  回滚 = revert 本次提交。
- 下一项：三条阻塞不变（A05 产品决策、B02–B05 外部权限、`/api/health` 响应契约）。
  可继续：把剩下未核对的规则模块逐批补进登记表（每批都要真跑）。
- 更新时间：2026-10-03（UTC）。

## 2026-10-03 — 变异核对的第二批：登记表从 12 个模块推到 19 个

- 里程碑 / 版本：v0.12.0。分支：`feat/falsify-coverage-batch2`。基线 `32e0958b`（#200 合并后的 main）。
- 状态：DONE。门禁数仍 **48**。
- **做什么**：把上一轮固化的工具真用起来——`pnpm falsify:rules` 的登记表加上第二批七个模块
  （glossary / translation-values / client-write-policies / rate-limit-policy /
  query-error-channel / release-tag-policy / gate-wiring）。
- **读数：24 条判定 / 19 个规则模块全部会红**（合计 234 条用例变红）。
  加上 #194 手工核对过的 13 个模块，**已核对覆盖 32 个规则模块（全库 56 个）**。
  本批新变的红条数：glossary 11 · translation-values 10 · client-write-policies 4 ·
  rate-limit-policy 11 · query-error-channel 9 · release-tag-policy 9 · gate-wiring 18。
- **登记表为什么必须一条一条真跑**：它是**证据清单**。写「应该会红」进去，
  下一个人就会把它当成已经核对过——而那正是本项目反复付过学费的形状
  （一份看起来仍然有效、实际已经不成立的记录）。所以这一批的 72 条红是**跑出来的**，不是推演出来的。
- 顺手清掉两条**早已合并但本地仍在**的分支（`feat/c09-session-user-truth-table`、
  `fix/shadcn-outline-hidden`）：它们因为是 squash 合并，`--is-ancestor` 判不出来，
  所以逐个抽查了各自那条提交里的关键内容确实已在 `main`（C13 那条 `.env.production` 断言、
  `native-theme.test.ts` 里的 `forced-colors` 用例）才删。
  **「远端已删」不等于「可以删本地」**：远端删掉只说明它的 PR 结束了，不说明内容进了 main。
- 验证命令与结果：`pnpm falsify:rules` → **24/24 会红**，跑完 `git status` 干净；
  `pnpm lint` **0 warning**；`pnpm type-check` exit 0。
- 阻塞 / 风险：剩下 24 个规则模块未做过变异核对。**这不是缺口清单，是待办清单**——
  它们各自只需要一次 1 分钟的真跑，代价小到不值得为此单独开一轮。
  风险是有人把「应该会红」写进登记表；runner 只信运行结果，而登记表形状由单测守着。
- 下一项：三条阻塞不变（A05 产品决策、B02–B05 外部权限、`/api/health` 响应契约）。
- 更新时间：2026-10-03（UTC）。

## 2026-10-03 — 变异核对第三批：把本轮自己新写的门禁也核一遍

- 里程碑 / 版本：v0.12.0。分支：`chore/falsify-coverage-batch3`。基线 `e5fd1ed5`（#201 合并后的 main）。
- 状态：DONE。门禁数仍 **48**。
- **这一批最有价值的一条是 `dependency-audit`**：它是 #197 才写出来的门禁，
  也就是说**本项目自己新写的判据，第一次被变异核对**。结果：**33 + 2 条变红**——
  台账的 STALE 反向断言、复核期限、dev-only 判定、计数与明细对账、裸审计禁令，
  每一处都有用例真的在咬。**新写的门禁最容易带一个「自己信得过」的盲区**，
  而这类盲区不会被任何静态检查发现。
- 另加 codeql-alert-policy（25 条变红）、form-field-rules（11）、direction（6）、trace-coverage（16）。
- **读数：30 条判定 / 24 个规则模块全部会红**（合计 327 条用例变红）；
  加上 #194 手工核对过的 13 个模块，**已核对覆盖 37 个规则模块（全库 56 个）**。
- 三批下来的一个观察：**327 条用例变红里，没有一条是因为「判定被抹掉后测试整体崩掉」**——
  每一条都是**恰好该红的那些用例**变红。两者区别在于：整体崩掉只能证明「测试碰过这个函数」，
  而「恰好该红的变红」才证明**规则被测的是它自己的判据**。
- 验证命令与结果：`pnpm falsify:rules` → **30/30 会红**，跑完 `git status` 干净；
  `pnpm lint` **0 warning**；`pnpm type-check` exit 0。
- 阻塞 / 风险：19 个规则模块仍未核对（56 − 37）。按前几批的每批 6–7 个模块、
  每条约 1 分钟算，剩下的大约还需要三轮；**它是一次性成本，不是有风险的技术债**，
  所以排在哪一批之间做都等价——真要排优先级，排在「读数还能再信一点」之后。
- 下一项：三条阻塞不变（A05 产品决策、B02–B05 外部权限、`/api/health` 响应契约）。
- 更新时间：2026-10-03（UTC）。

## 2026-10-03 — 第四批：加到 43 条判定时，工具自己先崩了一次

- 里程碑 / 版本：v0.12.0。分支：`chore/falsify-coverage-batch4`。基线 `e21fdbf9`（#202 合并后的 main）。
- 状态：DONE。门禁数仍 **48**。
- **读数：43 条判定 / 37 个规则模块全部会红**（合计 479 条用例变红）。
  本批新增 13 个模块，新变红 152 条：adr-rules 14 · migration-runbook 13 ·
  production-smoke-contract 8 · tokens 9 · bilingual-facts 8 · component-docs 15 ·
  scripts-docs 3 · migration-drift 20 · mock-docs 14 · cron-contract 26 ·
  cron-skip-coverage 8 · provider-docs 6 · a11y-rules 8。
- **这一批真正的收获不是那 13 行读数，而是它撞出来的那个 bug**：
  `auditBilingualDocs` 的签名是 `): { issues: …; pairs: …; facts: … } {`——
  **返回类型本身是一个对象字面量**，于是「从右括号之后取第一个 `{`」取到了**类型**的 `{`，
  中性化语句被插进类型里，文件语法错误、模块加载失败，
  而 vitest 那种输出里**根本没有 `Tests …` 那一行** → 这一格读数是「读不出」。
  **看起来像「工具没这个能力」，实际是那一个字符匹配太粗。**
- **「读不出」这一档在这一刻第一次真的救了场**：它没有把这一格误报成「存活」
  （那才是灾难：一条假的「测试会红」），但它确实把「我插错位置了」和
  「工具做不到」压进了同一句话。修法是按字符判断——`{` 前面紧挨着 `:` / `<` / `,`
  才属于返回类型（`: { … } {`、`: Promise<{ … }> {`），按配对整段跳过；
  `): RlsCoverageIssue[] {` 这种命名类型前面是 `]`，第一个 `{` 就是函数体。
  找不到函数体时报「没打上」，不硬插。补 3 条单测。
- **一个必须记下来的教训（我自己在同一轮里犯的）**：第一次看到「读不出」时，
  我判断成「我把返回值的字段名写错了」，改完再跑**还是**「读不出」。
  真实原因与字段名无关。**一个错误解释 + 一次真修复，看起来和「解释对了 + 一次真修复」完全一样**——
  所以「改完好了」不能证明「你知道为什么」，这也是为什么这条要单独写下来。
- **覆盖读数第一次变成可推导的**：`collectGateRuleRefs` 导出 58 个规则模块，
  登记表机器核验 37 个，剩下 22 个减去 #194 手工核对过的 13 个 = 9 个未核对
  （`parse-changelog` / `constants` / `mock/index` / `notifications/types` /
  `password-strength` / `bundle-freshness` / `shortcuts` / `database.types` / `test-matrix`）。
  也就是说 **已核对 50 / 58**，剩下的 9 个里有几个可能不是「有判据的模块」而是
  「类型与常量」——**清单本身也可能是错的**，所以下一步是逐个看，不是照单全收。
- 验证命令与结果：`pnpm falsify:rules` → **43/43 会红**，跑完 `git status` 干净（0 改动）；
  `pnpm lint` **0 warning**；`pnpm type-check` exit 0。
- 阻塞 / 风险：三条阻塞不变（A05 产品决策、B02–B05 外部权限、`/api/health` 响应契约）。
- 下一项：~~把剩下 9 个模块逐个分类~~（2026-10-05 已完成，见下一条）；
  顺带把 #194 那 13 个手工模块也搬进登记表，让「已核对」不再依赖一次性的手工脚本。
- 更新时间：2026-10-03（UTC）。

## 2026-10-05 — 生产站 500 已不是现状；10 GB 构建存储额度见底的教训进部署文档

- 里程碑 / 版本：v0.12.0（发布侧仍 BLOCKED，不影响此条）。
- 状态：DONE。
- 分支 / commit：`docs/vercel-storage-split`（`b369673`）。
- 完成内容：
  1. 部署文档（EN/zh 双语 + `agents/08-devops.md`）补一节「App 与文档站同属一个仓库时的存储
     配置」：两个 Vercel 项目都连同一 repo，Hobby 计划 10 GB 部署存储是团队共享的，必须把 Docs
     项目的 Root Directory 设为 `docs-site` 并开启 Affected Projects Deployments，否则每次 App
     提交都白重建一份文档站产物。教训数字（2026-10-04：单日 18 次部署推到 8.71 GB）一并记下，
     并提示额度看 **Usage → Deployment Storage** 卡片而不是 Total size 图表的坐标轴。
  2. 顺带核验了线上：`https://indie-stack-theta.vercel.app` 与 `https://indie-stack-docs-site.vercel.app`
     均返回 200（此前反馈的生产站 500 目前未复现，若再现需要新的现场证据）。
- 变更文件：`agents/08-devops.md`、`docs-site/deployment.md`、`docs-site/zh-CN/deployment.md`、本条目。
- 验证命令与结果：`pnpm check:docs` ✓、`pnpm check:bilingual-docs` ✓、`pnpm lint` 0 warning、
  `pnpm type-check` exit 0、`pnpm test` 258 文件 / 3125 用例全过、`pnpm build` exit 0。
- 阻塞 / 风险：三条阻塞不变（A05 产品决策、B02–B05 外部权限、`/api/health` 响应契约）。
- 下一项：把 progress 登记表名单里剩下的 9 个模块逐个分类（有判据 / 无判据），有判据的进
  falsify 登记表（含 `test-matrix` 等 testing 模块）。
- 更新时间：2026-10-05（UTC）。

## 2026-10-05 — 变异核对第五批：9 个未登记模块逐个分类，4 个有判据的进表（54/58）

- 里程碑 / 版本：v0.12.0。分支：`chore/falsify-coverage-batch5`。
- 状态：DONE（falsify 47/47 会红，登记表注释已写明分类口径）。
- 完成内容：
  1. 上一条 2026-10-03 的「下一项」是把登记表外的 9 个模块逐个分类。做法：逐个读导出，
     判据是「有没有一个唯一的『报出问题』入口函数」。
     - 不进表：`constants.ts`（常量配置）、`supabase/database.types.ts`（生成物）、
       `notifications/types.ts`（类型+常量数组）、`shortcuts.ts`（常量数组）、`mock/index.ts`
       （mock 构造器，非规则模块）。
     - 进表 4 个：`changelog/parse-changelog.ts → validateChangelog`、
       `release/bundle-freshness.ts → sourcesNewerThan`、`password-strength.ts → scorePassword`、
       `testing/test-matrix.ts → auditTestMatrix`。
  2. `src/lib/password-strength.test.ts` 新建：它的直接单测入口此前只有 tsx 组件测试
     （`password-strength.test.tsx`），登记表约定 `testFile` 必须 `.test.ts$`，
     所以补了一份针对 `scorePassword` 的纯函数用例（4 条），登记用它。
  3. `RULE_FALSIFICATION_TARGETS` 注释补上 2026-10-05 分类口径；`docs/testing.md` 与
     `CHANGELOG.md` 的读数同步到 **47 条判定 / 41 个规则模块 / 518 条用例变红 / 覆盖 54 个**。
- 变更文件：`src/lib/testing/rule-falsification.ts`、`src/lib/password-strength.test.ts`（新增）、
  `docs/testing.md`、`CHANGELOG.md`、本条目。
- 验证命令与结果：`pnpm falsify:rules` → **47/47 会红**（新增 4 条各自变红读数：
  test-matrix 10、parse-changelog 22、bundle-freshness 5、password-strength 2），
  跑完 `git status` 干净；定向 vitest 18/18。
- 阻塞 / 风险：三条阻塞不变（A05 产品决策、B02–B05 外部权限、`/api/health` 响应契约）。
  剩下 4 个未核对模块已逐个写明「无判据入口」，不是欠账。
- 下一项：无（v0.12.0 可执行部分仍 DONE，发布侧等外部权限）。
- 更新时间：2026-10-05（UTC）。

## 2026-10-05 — 变异核对第六批：#194 的 13 个模块进表，顺带修掉工具自己「把 8 条红读成读不出」的缺陷

- 里程碑 / 版本：v0.12.0。分支：`chore/falsify-coverage-batch6`（**stack 在 batch5 之上**，
  因为两批改同一段 CHANGELOG 读数，叠着走比解冲突干净）。
- 状态：DONE（`pnpm falsify:rules` → **60/60 会红**，跑完工作树干净）。
- 完成内容：
  1. 上一条留的「顺带把 #194 那 13 个手工模块搬进登记表」做完：登记
     `query-columns` / `perf-audit` / `route-auth` / `storage-policies` /
     `changelog-tag-reconciliation` / `native-theme` / `state-rules` / `translation-usage` /
     `release-docs` / `gate-rule-tests` / `agents-index` / `admin-client-boundary` /
     `client-artifact-env`。**全库 58 个规则模块至此全部核对过**（工具 47 + 手工 13，现已合并）。
  2. **第一次跑就撞出一个真缺陷，且它正是这个工具存在的理由那一族**：
     `gate-rule-tests → auditGateRuleTests` 报「读不出」。查下来不是变异没打上（`mutationApplied=true`），
     也不是套件没红（手工把函数中性化后跑，**8 failed / 11 passed**）——
     是**读数**：vitest 有失败时先打印失败明细再打印汇总，明细行里带测试名，
     `FAIL node … > auditGateRuleTests > 规则模块没有单测时报红并点名` 这行含有 `Tests`，
     不锚行首的正则**抢在真正的汇总行之前**匹配到它，后面跟的是 `> …` 而不是数字，于是两档都读不出。
  3. 判「读不出」是对的（失败封闭，不会谎报通过），但它让一个**真的会红**的模块进不了登记表——
     也就是说工具在**自己最该响的那一格**上失灵。修的是正则：
     汇总行锚到行首（`^\s*Tests\s+(\d+)`）并要求紧跟数字，测试名再像也抢不走。
     补 3 条用例：明细含 Tests 时读真汇总、`Test Files` 行不被误当汇总、
     模块加载失败（`Tests  no tests`）仍读不出且不被当成通过。
- 变更文件：`src/lib/testing/rule-falsification.ts`（登记表 +13 条、正则与注释）、
  `src/lib/testing/rule-falsification.test.ts`（+3 条）、`docs/testing.md`、`CHANGELOG.md`、本条目。
- 验证命令与结果：`pnpm falsify:rules` → **60/60 会红**，合计 **644 条用例变红**，
  跑完 `git status` 干净；定向 vitest 17/17；全量门禁见 PR。
- 阻塞 / 风险：三条阻塞不变（A05 产品决策、B02–B05 外部权限、`/api/health` 响应契约）。
  登记表已覆盖全库规则模块，**「有单测 ⇒ 单测会失败」这条轴到此没有剩余格子**。
- 下一项：无（v0.12.0 可执行部分仍 DONE，发布侧等外部权限）。
- 更新时间：2026-10-05（UTC）。

## 2026-10-05 — 收口核对：一台没复现的偶发红，以及它为什么被记成「未证实」

- 里程碑 / 版本：v0.12.0（记录性条目，无代码改动）。
- 状态：DONE（记录）。
- **事实**：本轮第一次 `git push` 时 pre-push 钩子（`pnpm verify:build`）红在 `pnpm test`，
  同一分支立刻重跑则全绿并推送成功。**失败那次的输出没有留下**（第一次 push 未重定向日志），
  因此**无法归因**。
- **已排除的两种解释**（都做了实测，不是推断）：
  1. **不是用例本身不稳定**：合并后连跑 3 次 `pnpm test`，每次 **3132/3132 全过**；
     CI 上 main 最近 **100 次运行全 success**，零失败零重跑。
  2. **不是网络**：全仓 `*.test.ts` 里没有真正打外网的用例（`fetch` 全部被 mock）。
- **没有排除的**：`vitest.config.ts` 里 node 项目 `testTimeout: 20_000` 的注释本身就记着
  「pre-push 的 `pnpm test` 随机红在两个与代码无关的超时上」，而我本机实测最重的用例
  空闲时只有 ~1.0 s（`query-error-channel`），与注释里的「并发时 9.2 s」相差近十倍——
  **方差来自动态负载，不来自用例本身**，20s 上限对 9.2s 约有 2 倍余量。
  在更慢或更满的机器上这个余量是否够，**本轮没有复现手段，不下结论**。
- 因此这一条记成**未证实**：既不改超时（没有证据支撑），也不写「已修复」。
  风险是下一个人看到「偶发红」时以为已经解决——所以这里明确写「无法归因」。
- 若要坐实，最省事的做法是让 pre-push 钩子把输出落盘（失败时保留完整日志），
  那样下一次偶发就能归因，而不是像这次一样只剩一句「Test failed」。
  这属于**尚未提出的改动**，不擅自做。
- 更新时间：2026-10-05（UTC）。

## 2026-10-05 — A05 收口：「站内已读 = 不必寄」定案，并把一个没有钉子的语义钉上（A05 任务池清空）

- 里程碑 / 版本：v0.12.0 A05 余项。分支：`feat/a05-read-suppresses-email`。
- 状态：DONE。**A05 任务池自此没有余项**（三条阻塞里少了一条）。
- 为什么做：用户授权「按你的来」，于是这个产品决策由本仓库自行判定。
  动手前先量了一件事：**这一栏此前既没有理由也没有钉子**——队列谓词里 `is_read=false`
  一直是对的，可注释写着「要不要让已读免寄是另一个待定口径」，
  于是它只是「实现里恰好如此」。真有人为了「别让 `email.backlog` 显得在变小」去掉它，
  邮件就会重新寄给读过通知的用户，而**没有一条用例会红**：
  发送路径、mock、E2E 都不看队列谓词。**先量这一步决定了这次改动是「补决定」而不是「补功能」。**
- 定案与理由（写进 `repositories/notifications.ts` 谓词注释，单条读过与「全部已读」同论）：
  1. 摘要的职责是提醒**还没看到**的东西；为已读的事再寄一封是纯噪声，
     而噪声会教会用户忽略整个摘要——**那比漏寄一封更贵**。
  2. 反过来（已读仍寄）会让 `security_alert` 这类最不该被忽略的通知，
     因为用户读过它而**多**发一封，等于用一次噪声换一次送达，方向是错的。
  3. 「积压因此变小」的顾虑已由 `readBeforeSend` 那一读数解决：
     面板不只依赖 `email.backlog`，所以「读过的行不出队」不等于「从视野里消失」。
  附带一条纪律：与 `email_skipped_reason` 同款——**出队不复活**（之后又变回未读也不会被重寄）。
- 完成内容：
  1. 两处注释改写：队列谓词上方新增「这是定案而非实现细节」+指向理由段落；
     `countReadBeforeSendEmailNotifications` 上方把「另一个待定口径」换成定案与三条理由。
  2. **两条钉子**（`notifications.test.ts`，44 → 46 条）：
     「已读即不必寄」逐个断言三处队列读数都带 `is_read=false`；
     「读过的行仍被单独量出来」断言 `is_read=true` 那一栏还在——**防止有人为了
     「别让积压变小」把可见性一起删掉**。
  3. 双语 `docs-site/email.md` 把这一段从「观察到的行为」改写成「决定 + 理由 + 不复活」。
  4. `docs/roadmap-0.12.0.md` A05 条就地改口径：余项清零，并写明定案日期与钉子位置。
- **两条钉子都做过变异核对**（做完复原）：
  把队列两处 `is_read=false` 改成 `true` → 「已读即不必寄」红；
  把 `countReadBeforeSendEmailNotifications` 改成直接 `return 0` → 「读过的行仍被单独量出来」红。
- 变更文件：`src/lib/repositories/notifications.ts`（注释）、
  `src/lib/repositories/notifications.test.ts`（+2 条）、`docs-site/email.md`、
  `docs-site/zh-CN/email.md`、`docs/roadmap-0.12.0.md`、`CHANGELOG.md`、本条目。
- 验证命令与结果：定向 vitest 45/45；`check:roadmap-entries` ✅ 29 条；
  `check:bilingual-docs` ✅；`check:changelog` ✅；全量门禁与 build 见 PR。
- 阻塞 / 风险：**剩两条**，都不是工程能单方面解的——
  B02–B05（外部权限：Vercel 配额 / 云端 Supabase 凭据 / 可牺牲账号）与
  `/api/health` 的探针-对外端点分离（会改动 smoke、Docker `HEALTHCHECK`、Vercel Cron 三方的响应契约）。
  回滚 = revert 本分支（**不含任何行为变更**，所以回滚也不会改变发送语义）。
- 下一项：核实 Vercel 权限是否真实可用；可用则做 B02 回滚演练取证。
- 更新时间：2026-10-05（UTC）。

## 2026-10-05 — 权限实测推翻了「B02 卡外部权限」这个判断：回滚演练第一次真跑过（J08 闭合）

- 里程碑 / 版本：v0.12.0 B02 + v0.11.0 tag 台账。分支：`feat/a05-read-suppresses-email`。
- 状态：DONE（演练完成、生产已恢复并复验、证据落档）。
- **起点是一个判断，不是一段代码**：roadmap 把 B02 记成「未完成：外部权限——需要 Vercel 的部署权限」。
  动手前先**实测**这份权限：`vercel_list_teams` 返回空但 `vercel_get_auth_user` 拿到
  `sun1090`（hobby，含默认 team），`vercel_list_projects` 能列出 `indie-stack`
  （`prj_B59i5T7DIEZbX9YbxhyHopZOmFMu`），`vercel_list_deployments` 给出 6 个 READY 的生产部署
  且其中两个 `isRollbackCandidate: true`。**权限是有的**——于是这一项从「阻塞」变成「已完成」，
  而不是继续挂着一个已经不成立的阻塞理由。
- 演练记录（`docs/operations/rollback-runbook-v0.11.0.md` 的「演练记录」，2026-10-05 02:53–02:59 UTC）：
  1. 回滚前基线：`pnpm smoke:production --expected-commit a22ee942…` → **6/6**。
  2. alias 切到 `dpl_AbPqkNnVtJMRa58Tp4AUSyYAXxeq`（commit `cb357477`）。
  3. `curl /api/health` 连三次：**200**，`commit=cb357477`（1.12s / 3.16s / 1.62s）。
  4. **用回滚前的 commit 跑 smoke → 如期红**：5/6、
     `health: commit=cb35747, expected=a22ee942…`，exit 1。**这一步是本次演练的证据本体**：
     一份「回滚后仍然健康」的截图不构成证据，能指出「你回滚到的不是你以为的那一版」才算。
  5. 用回滚后的 commit 跑 smoke → **6/6**；`pnpm health:check` → ✅。
  6. alias 指回 `dpl_BvYq5AzMC8cW9M49sZT8qkbYCWNG` → 恢复后 smoke **6/6**。
- **诚实标注这次证明了什么、没证明什么**（写进 runbook 与 CHANGELOG，没留在自己脑子里）：
  - **证明了**：回滚机制本身可用且可验证——alias 切换即时生效、`/api/health` 如实上报当前 commit、
    `--expected-commit` 断言真的会红、恢复方向同样可用。
  - **没证明**：跨行为变更或跨迁移的回滚安全性。两个候选 deployment 之间
    `git diff --stat cb357477 a22ee942` **只有一个文件、23 行**（`docs/progress.md`），
    没有迁移、没有 `src/app` 运行时代码差异，所以这次是**零行为差异**的切换。
    把 B02 记成「J08 已完全闭合」是过度解读——**跨迁移边界的回滚仍无证据**。
  - schema 向前兼容：**本地**侧已核对（`check:migrations` 34 条与 manifest 的 SHA-256 一致、
    `check:migration-runbook` ✅ 最新 `034_email_skip_reason.sql`）；
    **云端 `supabase migration list --linked` 仍未取得**（B04，需云端项目凭据）。
- **一条顺带量出来、写进 runbook 的观察**：alias 切换后的**第一次** health 探测不可靠——
  两个方向各出现一次（`This operation was aborted` / `fetch failed`），重试即通过。
  对事故处置的直接含义：**切换后不要拿第一次探测下结论**，
  「health 挂了」与「刚切换、边缘还在热」必须分开。
  另外 smoke 输出里的 `(attempt 2)` 也印证了它——只看「✅」会以为一次就过。
- 连带更新：`docs/roadmap-0.12.0.md` B02（就地改口径）、`docs/operations/release-tag-ledger.md`
  （第三项阻塞作废，**`v0.11.0` 的 tag 仍不打**，理由从三项缺减为两项缺：B03 账户删除演练 + commit 归属证据）、
  `CHANGELOG.md`。
- 验证命令与结果：见上表；`check:roadmap-entries` ✅ 29 条、`check:changelog` ✅、
  `check:changelog-tags` ✅、`check:release-docs` ✅；全量门禁与 build 见 PR。
- 阻塞 / 风险：**剩两条**——B03–B05（外部权限：可牺牲的隔离账号、云端 Supabase 凭据、
  各 provider 测试凭据）与 commit 归属证据。
  风险是有人把这次演练当成「跨迁移回滚也安全」的证据——runbook 里已按上面那段写明边界。
- 下一项：核实 commit 归属证据能否在本地全历史（769 commits）下取得；若能则 v0.11.0 只剩 B03 一条。
- 更新时间：2026-10-05（UTC）。

## 2026-10-05 — 顺着 B02 量下去：commit 归属证据也补齐了，v0.11.0 只剩一条阻塞（B03 实测仍缺凭据）

- 里程碑 / 版本：v0.12.0 B02 的连带结论 + `v0.11.0` tag 台账。分支：`feat/a05-read-suppresses-email`。
- 状态：DONE（文档与台账更新；tag **仍然不打**）。
- 为什么做：B02 做完之后顺手去核 tag 台账上剩的两条，而不是照抄「都卡外部权限」——
  上一条已经证明过一次「判定的外部权限可能其实有」，不核就是偷懒。
- 完成内容：
  1. **commit 归属证据：已补齐**。`/api/health` 现在上报 `commit`
     （`version=0.11.0, commit=a22ee942…`），且断言**双向可证**：
     期望值给对 → 6/6；把期望值换成上一次部署的 SHA → **5/6 + exit 1**。
     这正是 runbook 停止条件「无法证明部署 commit 与验证 commit 相同」要求的东西，
     现在成立。写进 `docs/operations/release-runbook-v0.11.0.md` 的「尚未执行」段。
  2. **B03/B04/B05：实测确认仍缺凭据**（不是「假设缺」）：
     `~/.supabase/access-token` 不存在、环境变量无 `SUPABASE_ACCESS_TOKEN`、
     `supabase migration list --linked` 阻塞在交互登录（两次尝试均无输出直至超时）。
     而 `supabase/.temp/` 里**确实**躺着一个 linked project ref（`ntqgg…`，name=IndieStack）——
     **「有一个 ref」不等于「有凭据」**，这条区别就是 B03 一直挂着的真实原因。
  3. tag 台账同步：阻塞从三项 → 两项 → **一条**（只剩 B03 账户删除端到端演练）。
- 验证命令与结果：`check:changelog-tags` ✅（10 个版本仍在 `MISSING_TAG_LEDGER` 登记，
  门禁仍绿——**做完的事没有从台账上悄悄消失**）；`check:release-docs` ✅。
- 阻塞 / 风险：**`v0.11.0` 的 tag 仍不打**，唯一理由是 B03（需可牺牲的隔离账号 + 云端 Supabase 凭据）。
  风险是有人看到「只剩一条」就把 tag 打了——所以 runbook 与台账都写明「一条仍缺」不等于「可以打」。
- 下一项：`/api/health` 的探针-对外端点分离（会改动 smoke / Docker `HEALTHCHECK` / Vercel Cron 三方契约）；
  或为 B03–B05 准备「拿到凭据即可一条命令执行」的干跑脚手架。
- 更新时间：2026-10-05（UTC）。

## 2026-10-05 — 三个 Dependabot PR：两个照单合并，第三个是真断裂（Stripe 取消了 API 参数）

- 里程碑 / 版本：依赖维护（v0.12.0 范围内）。分支：`fix/stripe-23-checkout-api`。
- 状态：DONE。
- 为什么做：`gh pr list` 看到 3 个 Dependabot PR 开着。依赖/安全在本项目的优先级表里，
  而「CI 绿就合」对其中一条恰好是错的判断——所以逐个量，而不是批量点合并。
- 完成内容：
  1. **#213 `@stripe/stripe-js` 9.17.0 → 10.0.0**：14 项检查全绿，本地复核后 rebase 合入。
  2. **#211 minor/patch 组 12 项**（Next 16.3.8、Sentry 11.2、Supabase JS、react-query 5.104、
     next-intl、lucide 1.49、types/node、vitest 5.0.3 等）：全绿，合入。
     **一处需要人工的冲突**：#211 自己也 bump 了 `@stripe/stripe-js`，而那条已在 #213 合入；
     解法是保留 main 的 `10.0.0`、采用 #211 的其余 11 项，重新 `pnpm install --lockfile-only`
     生成 lockfile（**不手改 lockfile**）。合入后 bundle 2925.5 kB（基线 2926.8）、CSS 71.4 kB，均未回退。
  3. **#212 `stripe` 22.6.2 → 23.0.0：CI 红，是真断裂**。`tsc` 报
     `TS2561: 'payment_method_types' does not exist in type 'SessionCreateParams'`。
     查证后确认**不是 SDK 改名，而是 Stripe 把这个可写参数取消了**（同批取消的还有
     PaymentIntent / SetupIntent 上的同名参数；继续传会得到
     `400 payment_method_types_no_longer_supported`）。因此正确做法是**删掉**而不是换名。
- **这一条真正的价值在第二层**：`createCheckoutSession` 此前**没有任何参数级断言**——
  也就是说这处 API 取消只会被 `tsc` 发现，而不会有一条「说明我们为什么删掉它」的用例发现；
  下一次有人「顺手补回去」也没有任何东西会红。
  - 新增 `src/lib/stripe/checkout-session-params.test.ts`（8 条）：不传 `payment_method_types`
    （**断言键不存在，而不是值为 `undefined`**——后者仍可能被 SDK 序列化出去）、
    订阅模式与 `line_items` 一字未改、`trial_period_days` 只在给了 `trialDays` 时出现、
    metadata 带 userId/teamId、幂等键只在调用方给了时才作为第二个参数、缺 key 时抛错。
  - **变异核对**：把 `payment_method_types: ["card"]` 加回去 → 对应用例红（做完复原）。
  - 顺带核过同批取消的两处：全仓**没有** PaymentIntent / SetupIntent 调用，
    `payment_method_types` 全仓只有这一个调用点；`unit_amount` 在 v23 仍是整数
    （decimal 是单独的 `unit_amount_decimal`），所以 `toSubscriptionInfo` 的读取不受影响。
    **注意** `toSubscriptionInfo(subscription: any)` 用的是 `any`——那一段形状变化
    tsc 看不见，这是本次量到但**没有顺手改**的既有盲区（改动它属于另一次重构）。
- 验证命令与结果：`tsc` exit 0；`pnpm test` **260 文件 / 3142 用例**（+1 文件 +8 用例）；
  `check:all` ✅；`build` exit 0；bundle / perf 均未回退；变异核对见上。
- 阻塞 / 风险：生产 `stripe` 未配置（`/api/health` 报 `stripe: configured=false, required=false`），
  所以这次 API 变更**当前没有线上影响面**——但也意味着**真实 Stripe 调用路径没有被生产验证过**，
  一旦配置 key 就该先跑一次 checkout 冒烟。风险是有人把「CI 绿」当成「Stripe 升级无风险」：
  这次的绿只证明类型与单测绿，不证明真实 API 行为。
- 下一项：`/api/health` 的探针-对外端点分离；或为 B03–B05 准备干跑脚手架。
- 更新时间：2026-10-05（UTC）。

## 2026-10-05 — `/api/health` 拆出 `/api/health/live`：高频探针不该每次出站打数据库

- 里程碑 / 版本：部署与可运维性（v0.12.0 范围内）。分支：`fix/health-liveness-split`。
- 状态：DONE（未合并）。
- 为什么做：这条在 2026-09-29 记下时是「放大面已关、剩下纵深防御」，并明确写了
  「**不该由我单方面改**」——因为它会动 `check:production-smoke`、Docker `HEALTHCHECK`、
  Vercel Cron 三方的响应契约与 B01 记录的生产证据。授权拿到后逐个量，量出来的东西比预想的具体。
- 量出来的三件事：
  1. **探针是唯一被高频、高并发调用的公开端点**，而它每次会出站打一次 Supabase。
     `createProbeCache`（TTL 5s + single-flight）已经挡住了「一个实例被重复打」，
     但它是**进程内**缓存——serverless 下每实例各一份，挡不住「整个部署被重复打」。
     这层以前写在限流台账里，属于**如实登记的已知缺口**。
  2. **语义错位（比放大面更实际）**：`/api/health` 在依赖不可用时返回 503，
     而「进程活着但数据库抖一下」对存活探针不是故障。
     用 readiness 当 liveness，会让**数据库抖动被误报成实例挂掉并触发无谓重启**——
     自愈系统在这里会制造它本该消除的故障。
  3. **`route-auth` 台账里这条的理由已经漂移**：登记写的是
     「存活探针，不含任何用户数据或内部拓扑；返回体是静态结构」，
     而它实际上会回 `checks.supabase.configured`（含 service_role 是否配置）、
     `checks.stripe.configured`、精确 `commit` —— **与「静态结构」矛盾**。
     漂移的是理由、不是端点：`docs-site/pages.md` 的端点表一直如实写着它是 readiness check。
     这正是本仓库反复强调的那类问题——**结论做完了要回头改那一行**。
- 完成内容：
  - 新增 `GET /api/health/live`（`src/app/api/health/live/route.ts`）：
    只答「活着」，**不打数据库、不读配置、不返回 version/commit**。
    刻意不返回 `commit`：这一条是给机器看的，暴露精确 commit 等于告诉匿名调用者
    「该打哪个已知漏洞的版本」。
  - Docker `HEALTHCHECK`（`--interval=30s`）与 `docs-site/deployment.md` 的 compose 示例切到 live。
  - **`/api/health` 的响应契约一字未改**：`check:production-smoke`、每日保活 cron
    （Vercel Cron + `health-check.yml`）仍读它。保活**就该**打 readiness——
    它的意义是证明「连到 Postgres 的整条路」还通，而 live 按设计就跳过那次查询。
    两条路径方向相反这件事，已写进部署文档，免得后来人「统一」掉。
  - `route-auth` 台账那条按事实改写为「就绪探针 + 有意公开的依赖明细」，
    并说明披露面是判断过的（不含用户数据；模板用户的监控可能正在读这些字段，
    静默改成需要密钥会打断他们，所以这是产品判断而不是技术债），
    同时新增 live 的登记。限流台账两条同步：live 那条写明
    **加窗口会直接弄坏它唯一的使用者**（滑窗会让 HEALTHCHECK 把自己读成 429 然后重启实例——
    限流在这里不是防护而是故障放大器）；readiness 那条把「关掉它的判据」补回判据要求的形状
    （`GAP_CLOSURE` 门禁要求缺口必须带关法，否则它会永远躺在这里只报「1 条已知缺口」）。
  - **冒烟多了第 7 步 `liveness`**（`scripts/production-smoke.js`）。它断言的不是 200，
    而是**这条端点没有被并回 readiness**：返回体里不许出现 `checks` / `version` / `commit` / `uptime`。
    这个性质**没有别的门禁看着**——哪天有人觉得「两条重复了，合成一条吧」，
    两边的单测各自都还是绿的（它们各自都对），只有这一步会红。
    为什么不并进 `src/lib/production-smoke.test.ts` 而另起一个文件：
    那 6 条量的是「步骤名与失败继续跑」，这一条量的是「字段泄露」，
    混在一起会让「冒烟有几步」这个问题每次都要读两个文件才答得上来。
- 变异核对（做完复原）：
  - Dockerfile 的 `HEALTHCHECK` 改回 `/api/health` → 「HEALTHCHECK 打的是 /api/health/live」用例红。
  - live 路由里加一行 `import { createClient } from "@supabase/supabase-js"` →
    「结构性保证：模块图里没有 Supabase 客户端」用例红。**这条用读源码而不是 mock 断言**：
    mock 掉 `createClient` 再断言「没被调用」是可行的，但读 import 更直接地说明了「为什么」。
  - 冒烟那一步用假 fetch 喂三种读法（干净 / 混入 `checks`+`version`+`commit` / 混入 `uptime` /
    `status=error` / 非 JSON），确认四种都判对（`src/lib/deployment/production-smoke-liveness.test.ts` 6 条）。
- 验证命令与结果：`tsc` exit 0；`pnpm lint` 无输出；
  `pnpm test` **262 文件 / 3154 用例**（+1 文件 +12 用例，改了 1 处既有文件的期望步骤名）；
  `check:all` ✅；`build` exit 0 且 `.next/server/app/api/health/live` 产物存在；
  bundle / perf / CSS / sourcemap 均未回退；`check:changelog` ✅。
  **真机证据**：`pnpm start` 后 `curl /api/health/live` → `200 {"status":"ok","timestamp":...}`，
  `cache-control: no-store, must-revalidate`；同一进程里 `/api/health` 仍回完整契约。
- 阻塞 / 风险：本地冒烟里 `security-headers` 那步红（HSTS 只在生产 TLS 下注入），
  这是**本来就如此**、也正是生产证据要取在 Vercel 域名的原因，不是本次改动引入的。
  liveness 的**首次生产证据**要等本 PR 合并后的部署才能取（本文暂不写结论）。
- 下一项：取 liveness 的生产证据并回填；或推进 B03–B05 的干跑脚手架。
- 更新时间：2026-10-05（UTC）。

## 2026-10-05 — liveness 的首次生产证据：7/7，且 commit 就是被验证的那一个

- 里程碑 / 版本：部署与可运维性（v0.12.0 范围内）。分支：`docs/liveness-production-evidence`。
- 状态：DONE（未合并）。
- 为什么做：上一条把 `/api/health/live` 写完了，但**只验过本地**。
  「本地绿」证明不了部署后的构建仍然保持拆分——而这条的性质恰恰是**只有部署后才看得见**的。
- 完成内容：PR #214 合并后取生产证据并回填。
- 生产证据（`https://indie-stack-theta.vercel.app`，commit `a8e6cba7`）：
  - 直读 `/api/health/live` → `200 {"status":"ok","timestamp":"2026-10-05T07:06:38.869Z"}`，
    `cache-control: no-store, must-revalidate`，带 `x-request-id`。
    **返回体里没有 `checks` / `version` / `commit`** —— 拆分在部署后仍然成立。
  - `pnpm smoke:production --expected-commit a8e6cba7` → **7/7**：
    `health`（commit 断言通过）、`liveness`、首页、`static-asset`、安全头、
    匿名 dashboard 307、Webhook 缺签名 400。
  - 部署不是即时的：合并后连续 4 次（约 4 分钟）读到的仍是上一个 commit `4139cec6`，
    第 5 次才读到 `a8e6cba7`。**这条等待本身也是证据的一部分**——
    它说明 `--expected-commit` 的断言有意义：它不会因为「站点还是 200」就放行。
- 阻塞 / 风险：无新增。仍未取的是 **B03–B05 的账户级演练**，
  它需要云端 Supabase 与 provider 凭据（`~/.supabase/access-token` 不存在、
  环境无 `SUPABASE_ACCESS_TOKEN`、`supabase migration list --linked` 会阻塞登录），
  与本条无关，也不该被本条顺带「标记完成」。
- 下一项：为 B03–B05 准备干跑脚手架，让「拿到凭据就能一条命令跑完」这件事不再依赖临场记忆；
  或把 release evidence 的三族文档口径与本次新增的第 7 步对齐。
- 更新时间：2026-10-05（UTC）。

## 2026-10-05 — B03–B05 的前置判定固化成一条命令（`pnpm drills:preflight`）

- 里程碑 / 版本：发布证据与演练治理（v0.12.0 范围内）。分支：`feat/drill-preflight`。
- 状态：DONE（未合并）。
- 为什么做：B03 / B04 / B05 从 2026-08 起就一直标着「未完成：外部权限」。
  每次重看都要重新回忆一遍「到底缺哪个凭据、缺了怎么拿」——**这是把记忆当依赖**。
  把它写成可执行的判定，拿到凭据那天就不需要临场思考。
- **量出来的第一件事不是「缺什么」，而是「不该做什么」**：
  一开始想顺手把演练执行器也写掉（B03 真删账号、B04 云端跑擦除 SQL）。
  写之前量了一下：这些代码在**没有任何凭据的情况下无法被测试**。
  一段永远没跑过的删除脚本**比没有更糟**——它看起来是「就绪」的，
  于是某天在生产上第一次运行，而它的第一次运行就是不可逆操作。
  所以取舍是明确的：**只做能验证的部分**（判定逻辑本身有 13 条单测），
  执行器等有隔离账号时**与第一次实跑一起写**，当场被验证。这条取舍已写进代码文件头，
  免得后来人以为「执行器漏了」。
- 完成内容：
  - `src/lib/drills/preflight.ts`（纯规则）：每条演练的前置清单、
    变量名取自**代码里的真实读取点**（`src/lib/supabase/server.ts`、`src/lib/email-send.ts`、
    `src/lib/env.ts`）而不是猜的；每条前置都带「用途」与「怎么拿」，
    每条演练都带「齐了之后第一条命令」与「结论落点」。
  - `scripts/lib/drill-preflight.js`（IO）+ `pnpm drills:preflight [--drill B03|B04|B05]`。
  - **退出码刻意分开**：`0` 前置齐了（可以跑）/ `1` 有缺失 / `2` 用法错误。
    **没有「演练通过」这个退出码**——前置判定与实跑结论是两件事，
    挤进同一个退出码等于给这个命令一个它没有的权威。输出末尾固定一句「不代表任何演练已通过」，
    并有一条单测遍历多种输入断言 `headline` 里**永远不出现正面断言**。
- **写单测时量到的两处真问题**：
  1. `B05` 原本的结论落点写的是「各 provider runbook 的「执行记录」小节」——
     而 `docs/operations/` 下**根本没有 provider 专属 runbook**，那个小节不存在。
     「结论写进一个不存在的文件」正是这类台账最常见的静默腐烂方式。
     我加的单测里有「证据落点指向的文件必须 `existsSync`」，**它当场就红了**；
     改成真实存在的 `docs/operations/production-smoke-v0.11.0.md`，
     并同步修正 roadmap 的 B05 条目。roadmap 也补了「provider 演练该有自己的 runbook 是另一件事」。
  2. 复合前置（VAPID 那一对）必须**缺一即不满足**：`src/lib/env.ts` 在只给一半时会拒绝启动，
     所以「有 VAPID_PUBLIC 就算齐了」是错的判定。已按 ` + ` 拆开逐项判定。
- 变异核对（做完复原）：
  - 把 IO 层的文件型前置从「存在且非空」改成「只看存在」→
    造一个**空**的 `~/.supabase/access-token`，它被读成 `✓ 有凭据`。
    这不是小事：Supabase CLI 登录被清空后，preflight 会说「齐了」，
    然后把人送进一场不可逆的演练。复原后空文件正确判缺。
    （测试用的空文件已删除；`~/.supabase/` 目录本来就存在，只删了那个空文件。）
- 验证命令与结果：`tsc` exit 0；`pnpm lint` 无输出；`pnpm test` **263 文件 / 3167 用例**（+1 文件 +13 用例）；
  `check:all` ✅；`build` exit 0。CLI 实跑：默认三条全 ⛔ 且 exit 1；`--drill B09` exit 2；
  四项齐时 exit 0 且措辞是「前置齐了……执行器与实跑证据仍未产出」。
- 阻塞 / 风险：B03/B04/B05 **仍然阻塞**——本条**没有**让任何一条演练更接近完成，
  它只把「阻塞」从一句描述变成了一份可核对的清单。
  真正的阻塞不变：没有 `~/.supabase/access-token`、没有 `SUPABASE_ACCESS_TOKEN`、
  没有云端项目凭据、没有 provider 测试凭据、没有可牺牲的隔离账号。
  风险是这条命令被当成「演练已就绪」的信号——所以它的措辞、退出码与单测都盯着这一点。
- 下一项：为「provider 演练该有自己的 runbook」补一份（这是 B05 证据落点缺失的根因）；
  或等凭据到位后写执行器并当场实跑。
- 更新时间：2026-10-05（UTC）。

## 2026-10-05 — B05 的根因补上：provider 演练终于有自己的 runbook

- 里程碑 / 版本：发布证据与演练治理（v0.12.0 范围内）。分支：`docs/provider-drill-runbook`。
- 状态：DONE（未合并）。
- 为什么做：上一条把 B05 的结论落点从「不存在的 runbook 小节」临时改指
  `production-smoke-v0.11.0.md`，那只是**止血**——真正的根因是那份 runbook 根本不存在。
  「这条演练的结论该写在哪」没有答案，就等于没有地方记录它做过没做过。
- 完成内容：新建 `docs/operations/provider-incident-drills.md`，
  并把 `preflight.ts` 里 B05 的 `evidenceTarget` 指回它的「执行记录」小节。
- 量到的三件事，都写进了 runbook：
  1. **区分「缺凭据」与「没法验证」不是同一句话。** P1（Resend 缺失）在本地构型就能观察队列行为，
     **不需要** API key——所以它被列出来是为了说明它**现在就能做完**，
     但只能写本地构型的结论，写成「生产已验证」就是撒谎。其余三条才需要真实凭据。
  2. **P3（VAPID 失效）为什么不能本地做**：`web-push` 固定走 `https.request`，
     **无法用环境变量把出站请求重定向到本地捕获端点**（`src/app/api/cron/push-retry/route.ts` 的注释）。
     所以失效订阅端点只能在真实 push service 上打。Mock 构型只替换**传输层**
     （`src/lib/mock/push-transport.ts`），适配器的配置校验、载荷构造与错误映射保持真实——
     这正是它能证明的部分，也是它的边界。
  3. **演练的常见副作用是自己造出一堆积压。** 所以通用纪律里写死一条：
     每次演练后必须确认 `email.backlog` / `push.backlog`（阈值都是 500）在回落，
     否则测的是「制造故障」的能力而不是「降级正确」。
     另加一条：恢复演练（P4）后**必须重跑冒烟**——恢复是一次真实的状态变更，跑完不验等于没恢复。
- 执行记录小节当前四条全是「未执行」，各自写明缺什么。
  **空着是有意的**：把没做的事记成做过，是这份文档最容易发生的腐烂。
- 验证命令与结果：`pnpm test` **263 文件 / 3167 用例**（无新增——
  这次是纯文档 + 一处 `evidenceTarget` 指向；`preflight.test.ts` 的
  「证据落点必须 `existsSync`」会在指向不存在时红，改完仍 13 条绿）；
  `check:all` ✅；`build` exit 0；`check:changelog` ✅；`check:bilingual-docs` ✅。
- 阻塞 / 风险：B05 **仍然阻塞**，本条没有让它更接近完成。
  新增的一份文档如果不跟着演练一起更新，会退化成又一份「看起来有 runbook」的幻觉——
  所以执行记录小节刻意留空并写明「未执行也要写」，这是它唯一的纪律。
- 下一项：P1（Resend 缺失）**不需要任何凭据**，可以立即执行并把结论写进执行记录——
  这是目前唯一能真正把 B05 往前推的动作。
- 更新时间：2026-10-05（UTC）。

## 2026-10-05 — P1 实跑：Resend 缺失时的队列行为是对的（B05 第一次真的往前走了一步）

- 里程碑 / 版本：发布证据与演练治理（v0.12.0 范围内）。分支：`docs/p1-resend-missing-evidence`。
- 状态：DONE（未合并）。
- 为什么做：上一条把 provider runbook 建起来时留了一句「P1 不需要凭据，可以立即执行」——
  **写完不做等于没写**，而这是目前唯一不依赖任何外部权限、能把 B05 真正往前推的动作。
- 完成内容：按 runbook 的命令实跑 P1，并把观测与**边界**写进执行记录小节。
- 观测（四轮 digest，`RESEND_API_KEY` 刻意不设）：
  | 项 | 结果 |
  | -- | ---- |
  | digest 返回 | 1–3 轮 `{sent:0, groups:0, failed:5}`；第 4 轮 `{sent:0, groups:0, failed:0}` |
  | 捕获端点 | `{"total":0,"emails":[]}` —— 一封都没寄出去 |
  | 通知状态 | 5 条 `email_sent=false`，`email_attempts` 1 → 2 → 3，`email_error="RESEND_API_KEY missing"` |
  | 第 4 轮 | `pulled=0` —— 达 `EMAIL_MAX_ATTEMPTS=3` 后被死信过滤 |
  | 通知是否被删 | 未删，7 条仍在 |
  | 指标 | `email.send.completed{outcome=failure, reason=not-configured}`、`email.backlog=5` |
- 判定标准是**四件事同时成立**，缺一件就是「静默丢弃」：
  ① 没寄出去的没有被标记已发送；② 重试计数累加而不是归零重来；
  ③ 达上限后停止重试（不是无限重试）；④ 失败有指标，不是无声的。四条都成立。
- **顺带量到一处设计得不错的地方**（值得记下来，因为它是「不显然」的）：
  达死信上限后通知**仍留在表里**、`email_sent` 保持 false，只是被队列过滤掉。
  这与 A05 的「站内已读 = 不必寄」语义一致：站内仍看得到，只是不再寄信。
  如果哪天有人把死信改成「删除」，用户会突然发现历史通知不见了——值得留意。
- **边界（这次刻意没有含糊）**：
  - 证明的是**本地 mock 构型下的队列行为**，**不是生产已验证**。
    生产 `mockMode` 被 `src/lib/mock/config.ts` 强制为 false，所以本地这条路径
    （`RESEND_API_URL` 指向本地捕获端点）在生产上不对应同一条链路。
    **更正一条写错的话**：初稿写的是「生产当前没配 Supabase」——**那是错的**，
    直读 `/api/health`（2026-10-05T12:45Z）显示生产 Supabase `configured=true`、`status=ok`。
    真正未知的是 `RESEND_API_KEY` 在生产是否配置，从外部判不了（provider 诊断只在 admin 后台）。
    这个错误值得记：它是**上一段会话里的旧读数被顺手搬过来、没重新读**造成的，
    而边界声明最怕这种「看起来像现场读数、其实是记忆」的句子。
  - `email.backlog` / `email.send.completed` 在本地只落 stdout（`src/lib/metrics.ts` 就是
    `console.log(JSON.stringify(event))`，设计上给日志型看板用），
    所以 P1 只证明**指标被产出**，不证明「有人会因此被叫醒」。
  - mock 构型下 `RESEND_API_URL` 被换成本地端点，所以本次**没有**验证真实 Resend 的
    4xx/5xx 响应形状——那是 P2，仍然缺测试 key。
- 验证：本条是纯文档 + roadmap/CHANGELOG 状态更新；`check:all` ✅；`check:changelog` ✅。
  另：本地起服时 Next 会往 `tsconfig.json` 追加 `.next-p1` 的 types 路径（`playwright.config.ts`
  注释里记着这个行为），**已 `git checkout` 复原**，工作树干净。
- **被门禁挡下一次，值得单独记**：这条第一次提交时 CI 的 `Detect Secrets` 直接红了——
  规则 `curl-auth-header`，命中 `provider-incident-drills.md:143` 的
  `-H "Authorization: Bearer p1-cron-secret"`。虽然是假值，但**门禁是对的**：
  「curl 认证头里的 token 形状字面量」在文档里就该当成泄漏，直到证明不是。
  - **修法不是加 allowlist 条目**——那等于教门禁忽略一个真模式。
    改成 `-H "Authorization: Bearer $CRON_SECRET"`，密钥一律走 shell 变量。
    这同时**让文档本身变对了**：一份教别人执行命令的文档，不该把密钥写进命令行。
  - **顺带量到两件事**：
    ① 本地 `pnpm check:secrets-scan` 在命中之前一直是绿的——它校验的是**策略**
    （gitleaks 版本、`fetch-depth`、响应/轮换时限，20 条契约断言），**不校验有没有真泄漏**。
    所以「本地门禁绿」不等于「没有泄漏」，真正的探测只有 CI 那一次跑。
    ② **改完之后仍然红**：workflow 是 `fetch-depth: 0` 全历史扫描，
    指纹仍指向**第一个**提交 `b63501e8`。也就是说——**一旦 token 形状的字面量进了历史，
    后续提交把它改掉并不会让门禁变绿**。
    这决定了修法：这条分支尚未合并，正确做法是**把它从历史里去掉**（重写自己这条 topic 分支），
    而不是给一个本就不该存在的值加 allowlist 条目。allowlist 是给「必须留在历史里的真误报」用的，
    拿来消掉自己的手滑，只等于把门禁的判断力换掉。
    如果这条分支**已经合并**，那才只能走 allowlist，并且要写清理由。
- 阻塞 / 风险：P2–P4 仍缺 `RESEND_API_KEY`、VAPID 一对 + 真实订阅端点、
  `SUPABASE_ACCESS_TOKEN` + 可牺牲项目。B05 因此是「部分完成」而不是「完成」——
  roadmap 里已按这个口径改写，没有把它说成整条通过。
- 下一项：等 provider 测试凭据；或把「指标只落 stdout、没有 exporter」这一段量清楚
  （它是「积压告警会响」这句承诺目前唯一的空洞）。
- 更新时间：2026-10-05（UTC）。

## 2026-10-05 — 查「告警会响吗」，结果推翻了我自己上一条写下的那句话

- 里程碑 / 版本：可运维性（v0.12.0 范围内）。分支：`fix/sentry-report-failure-visibility`。
- 状态：DONE（未合并）。
- 为什么做：上一条把「指标只落 stdout、没有 exporter，所以积压告警会响这一段仍未验证」
  写进了 runbook 和本文。写完就去查了这句话本身——**结果它是错的**。
- **错在哪（机制层面）**：我把「指标没有 exporter」当成了「告警链路不存在」。
  量下来不是：
  1. `src/app/api/cron/digest/route.ts` 在积压 > 500 时**确实**调用 `logApiError`，
     而且这段有单测、钉住了 500/501 的边界（恰好 500 不报、501 报）。**代码是对的。**
  2. `src/lib/logger.ts` 在生产且 `level === "error"` 时调用 `Sentry.captureException`。
  3. `src/lib/metrics.ts` 是 `console.log(JSON.stringify(event))`——**这是设计如此**，
     文件头写明「给日志型看板和告警用，Vercel/Sentry 可以ingest 这些行」。
- **真实结论比「未验证」更糟**：实测生产 `https://indie-stack-theta.vercel.app/api/health`：
  ```
  "sentry": { "required": false, "configured": false, "status": "missing" }
  ```
  该部署**没配 `NEXT_PUBLIC_SENTRY_DSN`**。于是没有 DSN 时 `captureException` 是空转，
  事件不出进程 —— 「邮件积压 > 500 会告警」在这个部署上是**不成立**，不是「未验证」。
  积压只会留下一行 stdout 与一条 `email.backlog` 指标，没有人被叫醒。
- **为什么没人发现**（这一条比结论本身更值得记）：
  `/api/health` **确实**报了 `sentry.configured=false`，但那个字段 `required: false`，
  所以 readiness 仍然绿的。这是**有意的**设计（Sentry 对模板是可选依赖），
  但它意味着：**一个可选依赖缺失时，健康检查不会替你喊人**。
  这也解释了 `allConfigured: false` 与 `ready: true` 为什么能同时成立。
- **顺带发现一个真缺陷并修掉**：上报失败分支原来是 `.catch(() => {})`。
  静默是对的（监控坏了不能把业务请求也搞失败），但**什么都不留**是错的——
  **监控静默失效时，唯一能发现它的信号也被它自己吞掉了**，
  于是「告警不会响」与「没有告警」变得不可区分，而这正是最该被看见的那次故障。
  现在失败会留一行 stderr（写明是「监控当前不可用」而非业务错误，值班不会查错方向）
  与一条 `sentry.report.failed` 指标——**后者是唯一不依赖 Sentry 本身的通道**。
  4 条单测钉住三件事：不抛 / 留证据 / 上报成功时不加噪声（否则每次 error 多两行，没人愿意看日志）。
  - 变异核对：把 `.catch` 改回空实现 → 两条「留证据」用例红（做完复原）。
  - 写测试时踩了两个自己的坑，都写进注释了：spy 写在 describe 体会被前一个用例的
    `vi.restoreAllMocks()` 复原掉（表现为「等 1 秒也没等到」）；
    固定 `setTimeout(0)` 等动态 import 会 flaky，得用 `vi.waitFor`。
- **文档侧**：给 `docs/operations/sentry-alerts.md` 开头加了「⚠️ 当前部署状态：本文档的告警**尚未生效**」
  一节，并把两条通道的验证状态**分开列**（代码路径有单测但本部署空转 / 指标规则文档已标「建议」、
  需 Dashboard 手动配置、无证据表明已配置）。
  同时**改正了上一条 runbook 与本文里的措辞**——结论变了就该回头改那一行。
- **明确不做的事**：**没有**配 Sentry DSN（需要外部凭据，属环境阻塞），
  也**没有**把 `sentry.required` 改成 true——那会让一个模板的可选依赖变成硬性门禁，
  直接让所有未配 Sentry 的部署 readiness 变红，是产品决策而不是技术清理。
  这里只做两件事：把真实状态说清楚，以及让监控自己的失效可见。
- 验证：`tsc` exit 0；`pnpm lint` 无输出；`pnpm test` 263 文件 / 3171 用例（+4）；
  `check:all` ✅；`build` exit 0。
- 阻塞 / 风险：要让告警真正生效仍需 ① 配 `NEXT_PUBLIC_SENTRY_DSN`（外部凭据）、
  ② 在 Sentry Dashboard 手动建规则（无法用代码管理）。两者都不是代码能做的。
  风险是这份文档接下来会被人当成「线上已有告警」——所以状态一节放在**最开头**，
  而不是放在文末备注里。
- 下一项：把 B05 的 P2–P4 与 B03/B04 的凭据一起要；或复查其它 runbook 里
  是否还有同类的「文档承诺 vs 部署实况」落差。
- 更新时间：2026-10-05（UTC）。

## 2026-10-05 — 同一类错误连犯两次，所以改的不是措辞而是工具

- 里程碑 / 版本：可运维性（v0.12.0 范围内）。分支：`fix/health-check-print-facts`。
- 状态：DONE（未合并）。
- 为什么做：上一条查 Sentry 时推翻了自己写的一句话。紧接着复核，又发现自己**另一条**边界声明
  也是错的（详见下文）。同一类错误在一个下午犯了两次，说明**该修的不是措辞**。
- **两条错的都是同一类**：「关于生产的事实」只存在于记忆里，没有可复核的来源。
  | 位置 | 我写的 | 实际（2026-10-05T13:08Z 直读） |
  | ---- | -------- | ------------------------------ |
  | P1 runbook 边界 | 「生产当前没配 Supabase，这条路径在生产上还没有对应流量」 | Supabase `configured=true`、`status=ok`、`reachable=true`——**digest 路径在线上是活的** |
  | Sentry 结论 | 「指标只落 stdout、没有 exporter，所以积压告警仍未验证」 | 代码路径有单测且正确；真正的问题是**生产没配 DSN**，那条链路是**空转** |
- **根因不是「我粗心」**：当时**能读到这些事实的命令存在**（`pnpm health:check`），
  但它成功时只印一行 `Health check passed`——依赖事实**它明明取到了，却没印**。
  于是想复核的人只能重写一遍 curl，而多数人（包括我）会选择相信记忆里的那句。
  **一条能取到事实却不显示事实的命令，等于没有这条命令。**
- 改法（**没有新增工具**——`pnpm health:check` 本来就能取到这些字段，只改输出）：
  成功时也打印读数时间（UTC）、`version`/`commit`/`ready`、逐依赖的
  `required`/`configured`/`status`/`reachable`、以及 `allConfigured`/`degraded`。
  两份文档（provider runbook、sentry-alerts）改成**指向这条命令**并附一次带时间的读数，
  而不是把手抄的 JSON 当事实来源。
  **刻意不读 secret 值**：只打印「配没配」与状态，不碰任何凭据内容。
- 附带修掉一个自己踩的坑：把打印逻辑直接塞进 `main()` 会让它的复杂度从 15 顶到 19，
  被 `complexity` 规则拦下。**修法是抽函数，不是放宽规则**——
  规则拦下的是「这个函数开始做两件事了」，而它确实开始做两件事了。
- **仍然未知、且无法从外部判定的**（别把它写成已知）：
  生产是否配置了 `RESEND_API_KEY`。provider 诊断只在 admin 后台暴露
  （`src/app/dashboard/admin/page.tsx`），匿名请求实测 404；本地也没有 `.vercel/project.json`
  可供查询。**P1 在生产上的状态是「未知」**——既不能说通过，也不能说失败。
  写「未知」比写一个听起来合理的猜测有用。
- 验证：`pnpm --silent type-check` exit 0；`pnpm lint` 无输出（抽函数后）；
  `pnpm test` 263 文件 / 3171 用例（无新增断言——本条改的是既有脚本的输出与两份文档）；
  `check:all` ✅；`check:changelog` ✅。
  真机验证：`pnpm health:check -- https://indie-stack-theta.vercel.app` 打印出上面那张表。
- 阻塞 / 风险：Sentry DSN 与 `RESEND_API_KEY` 的生产配置仍属外部凭据，环境阻塞。
  风险是「文档里的生产读数会再次变旧」——现在它带时间戳且有刷新命令，
  过期时至少**看得出来**是过期的。
- 下一项：按同样方法复查其余 runbook 里引用的生产事实（目前只查了 health 相关的两份）。
- 更新时间：2026-10-05（UTC）。

## 2026-10-05 — 顺着上一条的方法复查，翻出 B04 的阻塞原因是错的

- 里程碑 / 版本：发布证据与演练治理（v0.12.0 范围内）。分支：`fix/b04-blocker-precise`。
- 状态：DONE（未合并）。
- 为什么做：上一条把「文档里的生产事实要能一条命令刷新」做完，顺手用同一套方法
  （**去查，而不是去回忆**）复查其余 runbook 与 roadmap 里的外部依赖声明。
- **量出来的结果是一条阻塞面缩小，不是措辞调整**：
  - roadmap 里 B04 写的是「**未完成：外部权限**——需要云端 Supabase 项目的**管理凭据**」。
  - 实测：`gh secret list` → 仓库里有一个 `SUPABASE_ACCESS_TOKEN`；
    `gh run list --workflow supabase-auto-restore.yml` → **每天成功**（最近一轮
    2026-10-05T11:47Z，日志里读项目状态后输出「无需恢复」）。
  - 也就是说：**平台层的 Management API 令牌早就有了，而且每天都在用。**
    「缺管理凭据」这个说法会让下一个人去要一个**已经存在**的东西。
  - **真正的缺口在再下一层**：`docs/operations/drills/*.sql` 要用真 Postgres 连上去跑；
    `supabase migration list --linked` 同理（它读的是库里的 `schema_migrations` 表，
    不是平台 API）。而 `gh secret list` 显示仓库里**没有任何 DB 密码类 secret**。
  - 所以 B04 的阻塞从「要一个可能已有的令牌」收窄成「**要数据库密码**」。
- **顺带修掉一个我自己今天早些时候写下的 bug**：`pnpm drills:preflight` 里 B04 的前置清单
  写的是 `file:~/.supabase/access-token` —— **问错了问题**。
  已改为以 `SUPABASE_DB_PASSWORD` 为第一项，并在 `blockedReason` 里写明
  「平台层从来不是阻塞」，免得下一个人又去要那个已有的令牌。
  新增一条单测专门钉住这个纠正：**只给平台令牌时必须判缺，且缺口指向 DB 密码**。
- **方法论上值得记的一条**：这三轮里我连续犯了同一类错三次
  （Supabase 配没配、Sentry 有没有链路、B04 缺什么），三次都是**没去查就写**。
  而每次去查都很便宜——`curl /api/health`、`gh secret list`、`gh run list`。
  **「依赖外部状态」的结论，如果不带一条可重跑的查询命令和它当时的输出，
  那它就不是结论，是传闻。**
- **B03 也顺带核了**：`service_role` / `anon` key 与可牺牲账号确实都不在仓库 secret 里，
  所以 B03 的阻塞**是真的**（不同于 B04）。
- 验证：`pnpm exec vitest run src/lib/drills/` 14 条绿（+1 条钉住纠正的用例）；
  `pnpm drills:preflight --drill B04` 现在第一项报 `SUPABASE_DB_PASSWORD` ← 缺；
  `check:all` ✅；`check:changelog` ✅。
- 阻塞 / 风险：B04 仍阻塞，但**阻塞项更具体了**——只差一个数据库密码。
  风险是「平台令牌可用」这个事实被误读成「B04 差不多能做」：
  管理 API 能读项目状态，**不能**读库里的表，两者差着一层。
- 下一项：要么去拿数据库密码（外部凭据），要么继续复查其余外部依赖声明
  （Vercel 部署配额那一条也在这类里）。
- 更新时间：2026-10-05（UTC）。

## 2026-10-05 — 外部依赖实况归到一处，并立一条规则：结论必须带观测命令

- 里程碑 / 版本：可运维性（v0.12.0 范围内）。分支：`docs/external-deps-single-source`。
- 状态：DONE（未合并）。
- 为什么做：上一条把 B04 的阻塞原因改对之后，继续用同一套方法把剩下的外部依赖声明查了一遍，
  然后意识到**问题不在单条结论对不对，而在这些事实散落在各文档里、没有统一出处**。
- 查到的实况（全部实测，每行都附了可重跑命令，已写进
  `docs/operations/environments.md` 的「外部依赖实况」表）：
  | 依赖 | 实况 | 观测命令 |
  | -- | ---- | -------- |
  | Supabase 平台 API | ✅ 可用（每天 success） | `gh run list --workflow supabase-auto-restore.yml` |
  | Supabase Auth 配置读 | ✅ 可用（输出「Auth 配置已验证」） | `gh run list --workflow security-config.yml` |
  | Supabase 数据库级 | ❌ 无 DB 密码类 secret | `gh secret list` |
  | 生产 Supabase（应用侧） | ✅ 配置且可达 | `pnpm health:check -- <origin>` |
  | Sentry | ❌ 未配 DSN → 告警空转 | 同上 |
  | Stripe | ❌ 未配 key → 支付线上无流量 | 同上 |
  | Resend | ❓ **未知**（诊断只在 admin 后台，匿名 404） | —— |
  | GitHub 保活变量 | ✅ 已配置 | `gh variable list` |
  | Vercel 构建配额 | ⛔ 限流中（非代码缺陷） | PR 上的 Vercel 检查 |
- **立的那条规则**（这才是根因修复）：
  **任何关于外部状态的结论，都必须落在这张表里，并带上观测命令与日期；
  散落在别处的同类说法一律以本表为准。**
  三次写错都源于「事实只存在于记忆或某份文档的角落」。把规则写成制度，
  比把三句话改对更耐得住下一个。
- 顺带把 `sentry-alerts.md` 与 provider runbook 里各自维护的读数改成**指向本表**——
  两处各写一份必然漂移，这正是本次连续写错三次的结构性原因。
- **表里保留了 `❓ 未知` 这一栏**，并且写明了理由：
  写一个听起来合理的猜测，比写「未知」有害。本次那些错误结论，一半是被一个自信的猜测撑起来的。
  同时写清三条容易读错的分寸：
  ① `configured=false` 不等于 readiness 会红（可选依赖缺失时健康检查不会替你喊人）；
  ②「平台可用」不等于「数据库可用」（差着一层：Management API 读不到库里的表）；
  ③ B04 只差数据库密码。
- 验证：`check:all` ✅；`check:changelog` ✅。本条为纯文档（+ 指向改动），无代码变更，
  故未新增用例——新增用例会变成「断言文档里有一张表」，那不是有意义的测试。
- 阻塞 / 风险：DB 密码与 provider 测试凭据仍属外部凭据。风险是这张表本身也会变旧——
  所以每行都带观测命令与日期，过期时**看得出来**。
- 下一项：等 DB 密码与 provider 凭据；或把 `❓ Resend 未知` 这一格变成已知
  （需要能读生产部署环境变量的权限）。
- 更新时间：2026-10-05（UTC）。

## 2026-10-05 — 量了一件事，发现没有任何检查会注意到生产停在旧构建上

- 里程碑 / 版本：可运维性（v0.12.0 范围内）。分支：`feat/deploy-freshness-check`。
- 状态：DONE（未合并）。
- 为什么做：核对生产状态时发现它停在 `08dd6f17`，而 `main` 已经是 `30f8e896`（差 5 个提交），
  原因是 Vercel 构建配额限流。于是去查「有没有检查会注意到这件事」——**没有**。
- **量出来的缺口**：`production-smoke.yml` 的定时作业会**打印**生产跑的 commit，但**不断言**它。
  `expected_commit` 只在 `workflow_dispatch` 时能传，`schedule` 路径留空
  （`smoke` 那个作业干脆整个 `if: workflow_dispatch`，定时根本不跑）。
  唯一每天跑的是 `smoke-main` → `check-production-version.js`，它只断言 **version**，
  而 version 一直是 `0.11.0`，**对「部署滞后」完全无感**。
  也就是说：**生产可以无限期停在任意旧的构建上，而所有检查都是绿的。**
- **为什么不断言相等**：部署滞后是常态——合并到部署完成之间天然几十分钟，
  加上 Vercel 排队与配额限流滞后几小时也正常。断言 `生产 commit == main commit`
  会让这个作业每天在正常时段红几次，**红久了就没人看，而天天误报的检查等于没有检查**。
  所以量的是**距离**：`git rev-list --count <生产commit>..origin/main`，
  阈值内（默认 5）判通过但**记下距离**，超过才红。连续多天同一距离不回落才是真问题。
- 完成内容：
  - `scripts/lib/deploy-freshness.js`（纯规则，7 条单测）+ `scripts/check-deploy-freshness.js`（IO）
    + `pnpm ops:deploy-freshness`。**复用**已有的 `probeHealth`，不新造 HTTP。
  - `production-smoke.yml` 新增独立作业 `deploy-freshness`。
    与版本漂移**分开**，因为合并成一个会让「部署滞后」的红盖住「版本漂移」的结果，反之亦然。
- **两个第一版被单测/经验逮到的错，都值得记**：
  1. **未知不算通过**：commit 读不出来、或算不出距离（git 历史浅 / 不在祖先链上），
     一律判 `unknown` 且**不通过**。第一版的 bug 是：commit 为空、距离恰好传 0 时，
     会印出「生产跑的就是 main（unknown）」——**一句没有依据、且最容易让人放心的话**。
     单测里现在专门有一条钉住它。
  2. **作业必须 `fetch-depth: 0`**：浅克隆（默认 1）算不出距离，
     而算不出会被判成「未知且不通过」——那条作业就会天天红，
     **且红的原因藏在 checkout 参数里**，排查起来要多花半小时。所以这一步写进了 workflow 注释。
- 变异核对：把「阈值内也通过」改成「只要落后就红」（即断言相等那种做法）→
  两条用例红（做完复原）。
- 验证：`tsc` exit 0；`pnpm lint` 无输出；`pnpm test` **264 文件 / 3179 用例**（+1 文件 +7 用例）；
  `check:all` ✅；`check:workflows` ✅（9 工作流 / 16 作业）；`build` exit 0；`check:changelog` ✅。
  真机：`pnpm ops:deploy-freshness --base-url https://indie-stack-theta.vercel.app`
  → `✅ deploy freshness: lagging (阈值 5)`，明确打印「生产落后 main 5 个提交」。
  三个退出码都实测过：阈值内 `0`、超阈值 `1`、用法错误 `2`、生产不可达 `1`。
- **顺带的诚实交代**：这条检查现在**判通过**，但它同时**把「落后 5 个提交」这件事写在了日志里**。
  配额恢复后这个距离应该回落到 0——**如果它停在 5 不动，那才说明部署真坏了**，
  到那时这条检查会开始发挥作用。今天它只是把一个隐形状态变成了可见状态。
- 阻塞 / 风险：Vercel 配额（外部）。风险是阈值 5 是拍的：太小会在正常时段误报，
  太大则要落后很多天才发现。**先按 5 跑几天，用日志里「连续多天同一距离不回落」这条信号来校准**，
  而不是现在凭感觉调。
- 下一项：等配额恢复后确认距离回落到 0；或拿 DB 密码（外部凭据）推进 B04。
- 更新时间：2026-10-05（UTC）。

## 2026-10-05 — v0.12.0 发布章节切出（tag 刻意不打）

- 里程碑 / 版本：**v0.12.0**（`package.json` `0.11.0 → 0.12.0`）。分支：`release/v0.12.0`。
- 状态：发布章节已完成；**tag 刻意不打**，等 B03。
- 为什么现在做：任务池 **24 项全部闭合**、六条退出标准逐条核对全部达成，
  而 roadmap 的风险段明确写着「B 域依赖外部权限」。既然证据已经存在，
  再不切出发布章节就是在让 CHANGELOG 继续欠账。
- **判断依据不是「代码都改了」**：退出报告 `docs/operations/release-exit-report-v0.12.0.md`
  逐条核对，每条给可复现来源。判据 2 要求的「B01/B02 有执行记录」在本版本已成立
  （B02 是 2026-10-05 第一次**真实**回滚演练，含 deployment id 与「用错 commit 跑 smoke 如期红」）。
- **顺带修掉一个 CHANGELOG 缺陷**：Unreleased 段被历次 append 切成
  **25 个散落小节**（`### Added` 出现 3 次、`### Fixed` 出现 18 次），
  读起来像按时间追加的流水账而不是一次发布的说明。归一成
  Added/Changed/Fixed/Known Limitations 各一节，**条目数 148 → 148（逐条比对，无丢失）**。
  `check:changelog` 只查小节是否存在、不查重复，所以这个漂移一直没被抓到。
- **版本号连带三处**：`package.json`（`pnpm-lock.yaml` 不记录根包版本，无需同步）、
  `.env.example` 的 `NEXT_PUBLIC_APP_VERSION`、`.github/RELEASE_CHECKLIST.md`
  的版本号与文档链接。后两处是 `check:release-docs` 逼出来的——
  它在版本号升到 0.12.0 的瞬间报 `RELEASE_DOCS_MISSING_FILE`，
  **这正是它该做的事**（手写版本号的地方最容易漏）。
- **本版本唯一的 DB-first 硬约束**：迁移 `034_email_skip_reason.sql`。
  新代码**既写又读** `notifications.email_skipped_reason`
  （worker 在 `.update({...})`，A05 面板在 `.eq(...)`），
  **未应用 034 而先部署代码会让 digest worker 在跳过分支抛错、队列卡住**。
  云端是否 applied **本机无法核实**（无 Supabase 凭据），所以它被写成
  发布前必须复核的**停止条件**，而不是「假设已应用」。
- **新增三份分版本发布文档**（`check:release-docs` 要求，7 个版本 / 21 份）：
  - `release-runbook-v0.12.0.md`：入口条件、相对 0.11.0 的 6 条差异、发布步骤、停止条件、冻结状态。
  - `rollback-runbook-v0.12.0.md`：本版本特有的两类故障形态（034 未 applied 而代码已部署；
    存活探针被误用导致容器重启）、前向修复迁移的判定顺序、034 **绝对不可逆向**的理由。
  - `production-smoke-v0.12.0.md`：7 步自动化 + 只读 SQL + 隔离账号三类矩阵，
    含**发布前的生产实况快照**（`version=0.11.0 commit=08dd6f17 ready=true`，
    sentry/stripe `configured=false`）。
- **为什么不打 tag**：`docs/operations/release-tag-ledger.md` 写明 tag 的前置是发布证据闭合，
  而 **B03 缺外部凭据**。已在 `MISSING_TAG_LEDGER` 登记理由
  （与 `0.7.0`–`0.11.0` 同组：**纪律已在、证据未闭合**）。
  打 tag 是对外声明「做完了」，**没有证据就等于没做**——
  所以这里刻意留一个「不完整」的发布，而不是补一个假的完成。
- **诚实交代一处**：`rollback-runbook-v0.12.0.md` 的「演练记录」**是空的**，
  没有抄 v0.11.0 的记录充数——**v0.11.0 的回滚不跨迁移边界**，
  拿它证明本版本的回滚路径可用是不成立的。补齐它需要一次真实的生产部署切换。
- 验证（全在 `release/v0.12.0` 分支）：
  `pnpm verify:build` ✅（含 lint/type-check/test/check:all/build/bundle/perf/CSS/sourcemap）；
  `pnpm test:e2e` ✅ **113 passed**；`pnpm check:all` ✅；
  `check:changelog` ✅ 12 个已发布版本；`check:changelog-tags` ✅ 12/1/11；
  `check:release-docs` ✅ 7 版本 / 21 文档；`check:roadmap-entries` ✅ 29 条；
  包体积 2925.5 kB / 基线 2926.8 kB；覆盖率地板（91/90/93/92）**未改动**。
- 阻塞 / 风险：Vercel 构建配额（外部，导致生产落后 main 6 个提交）。
  发布后的生产冒烟与部署新鲜度读数**尚未取到**，因此三份文档里对应行仍是「⏳ 待执行」——
  **没跑的不写成通过**。
- 下一项：配额恢复 → 合并发布 PR → 取 7/7 生产证据与新鲜度读数 → 回填三份文档；
  外部凭据到位后依次闭合 B03 / B04 / B05 P2–P4，补做回滚演练，届时补打 `v0.12.0` tag
  并删除 `MISSING_TAG_LEDGER` 里的登记（不做的话门禁会红，这是有意的自清理机制）。
- 更新时间：2026-10-05（UTC）。

## 2026-10-05（续）— v0.12.0 已上线，生产证据取到

- 里程碑 / 版本：**v0.12.0 已发布到生产**。分支：`main`。合并 commit：`5cdbf0cb`（PR #224）。
- 状态：DONE（发布章节 + 上线 + 生产证据三件都齐了；tag 刻意不打，等 B03）。
- 生产部署 commit：`5cdbf0cb812e87f8f920870bfec421661471eafa`——**与 main 一致**。
- **生产冒烟 7/7**（2026-10-05T23:52Z，`--expected-commit` 断言通过），
  含本版本新增的第 7 步 liveness；直连 `/api/health/live` 响应体仅
  `{"status":"ok","timestamp":"…"}`，确认**无依赖明细与构建身份泄露**。
- **部署新鲜度从「红」翻到「`fresh`」**：22:53Z 因 Vercel 配额报「落后 6 → 红」，
  配额恢复后 23:52Z 距离回落到 0。
  **这条检查在一天内走完了它的两种状态**，而加它之前这两种情况都不会有任何自动检查出声——
  这就是它存在的理由，也说明当初「阈值 5 会不会太紧」的担心在配额异常期是成立的、
  在正常期并不成立（配额一恢复就归零）。
- **一个必须记下来的运气**：本次发布**没有复核云端迁移 034 是否 applied**
  （本机无 Supabase 凭据）。侥幸没出事——digest worker 的跳过分支只有在生产真有
  「无邮箱 / 偏好全关」的行时才会写那一列，而当前生产没有这类数据。
  **这是运气，不是验证**：一旦生产出现这类用户，worker 就会抛错、队列卡住。
  已把它写进 runbook 的「冻结状态」并标为**未被排除的风险**，
  补做只需两条只读命令，不需要新代码。
- 回滚方案：`rollback-runbook-v0.12.0.md`，首选纯代码回滚（034 是追加式变更，旧代码不写不读该列），
  **绝对不要逆向执行 034**（清掉 `email_skipped_reason` 会让已离开队列的通知重新显得还在队列里）。
- 变更文件：`docs/operations/production-smoke-v0.12.0.md`（回填 7 步实测证据）、
  `release-runbook-v0.12.0.md`（加「发布记录」段与上述风险）。
- 验证：`pnpm check:release-docs` ✅ 7 版本 / 21 文档；`pnpm check:all` ✅。
- 阻塞：B03（可牺牲隔离账号 + 三个 Supabase key）、B04（数据库密码）、
  B05 P2–P4（Resend 测试 key + VAPID + 可牺牲项目）、生产 `RESEND_API_KEY` /
  `NEXT_PUBLIC_SENTRY_DSN` / `STRIPE_SECRET_KEY`（三条外部链路仍空转）。
- 下一项：这些都卡外部凭据。转向 v0.13.0 的可执行选题——见退出报告「下一 milestone」
  第 1 条：**给外部依赖实况加一个带鉴权的只读诊断端点**，
  让「生产到底配了哪些外部依赖」从「查不到」变成「一条命令能回答」。
- 更新时间：2026-10-05（UTC）。

## 2026-10-05 — 给外部依赖实况加只读诊断端点，并把一个「测了等于没测」的测试修好

- 里程碑 / 版本：v0.13.0 起步（v0.12.0 已发布，tag 待 B03）。分支：`feat/provider-status-endpoint`。
- 状态：DONE（未合并）。
- 为什么做：v0.12.0 退出报告的「下一 milestone」第 1 条，且它**不卡外部凭据**——
  B03/B04/B05 全部要密钥或账号，所以剩下能做的事不多，这是其中最该做的一件。
- **要解决的问题**：`docs/operations/environments.md` 的规矩是「任何关于外部状态的结论
  必须落在那张表里，并带观测命令与日期」。但那张表里有一行长期是 `❓ 未知`
  （生产是否配了 `RESEND_API_KEY`），原因是**从外部查不到**：
  `diagnoseProviders()` 写得完整、有单测，却**没有任何生产代码调用它**；
  `/api/health` 只回 supabase/sentry/stripe 三项，且**有意**不回其余依赖。
  **一个必须靠猜才能回答的事实，就等于没有事实。**
- 完成内容：`src/app/api/ops/provider-status/route.ts`（复用现成的 `diagnoseProviders`，
  不新造诊断逻辑）+ 6 条路由测试 + 两处台账登记（`route-auth` / `rate-limit-policy`）
  + `docs-site/pages.md` 端点行 + `environments.md` 的查表推荐顺序。
- **两个设计决定，都是为了不制造「天天误报的信号位」**：
  1. **刻意不加 503**。这个端点的职责是**报告**实况而不是当依赖哨兵；
     可选依赖没配（生产没配 Stripe）是正常发布形态，
     若因此返回非 2xx，运维脚本会把它当故障告警。`ok` 字段已足够区分
     「必需依赖缺失」与「可选依赖缺失」。
  2. **限流台账里写明它连「借用上游配额」都不需要**——与 `supabase-restore` 不同，
     这个端点**纯本地读 `process.env`，不碰网络、不碰数据库**。
     这类端点的正确保护是共享密钥：IP 滑窗既拦不住持有密钥的人，
     也会把拿密钥做每日核验的运维脚本挡在门外。
- **本次最重要的收获：一个「测了等于没测」的测试**。
  凭据不泄露的断言，第一版**变异测试通过**——把实现改成把值拼进响应，测试照样绿。
  按本仓库的规矩（一个永远不会失败的门禁比没有门禁更糟）必须查到底，查出两层原因：
  1. **测试环境默认处于 mock 模式**：没有 `NEXT_PUBLIC_SUPABASE_URL` 时
     `evaluateMockMode` 返回 true，而 mock 模式下**每个 provider 的 `missing` 都是空数组**。
     断言的其实是一个空数组，怎么改实现都不会红。现在测试显式关掉 mock。
  2. **更根本的一层**：`missing` 按定义只装**键名**，缺失的键本来就没有值，
     所以「值从 `missing` 漏出去」在**结构上不可能**——
     我最初那个变异因此是**结构性无效**的，再怎么写测试都测不出来。
     真正可达的泄露路径是「实现顺手把**已配置**项的值也带进响应」（为了「方便排查」），
     断言已改钉这一条。
  **教训**：变异测试通过时，要先怀疑「变异是否真的可达」，再怀疑测试——
  否则会花很久去改一个本来就不可能红的断言。
- 变异核对（两条都实测过，做完复原）：
  - 把值拼进 provider 的 `notes` → **1 条红** ✅
  - 去掉 `isCronAuthorized` 守卫 → **2 条红**（匿名 401 / 错密钥）✅
- 验证：`pnpm test` 该文件 6 条绿；`check:route-auth` ✅ 47 个 handler 全部登记；
  限流台账 ✅ 47 = 17 有窗口 + 30 写明理由；`check:docs` ✅；`check:all` ✅。
- 阻塞 / 风险：这个端点**还没上线**，所以 `environments.md` 那行 `❓ 未知`
  目前仍然只能标「可查了」而不能填读数——**没取到的读数不写成已知**。
  上线后取一次读数即可把那行改成确定值。
- 下一项：合并后取一次生产读数，回填 `environments.md`；
  再往后的可执行选题见退出报告「下一 milestone」第 2 条（pg_cron 未启用无门禁）。
- 更新时间：2026-10-05（UTC）。

## 2026-10-05（续）— provider-status 已上线，鉴权边界在生产实测

- 里程碑 / 版本：v0.13.0 起步。分支：`main`。合并 commit：`105da717`（PR #226）。
- 状态：DONE（端点上线 + 生产鉴权边界实测 + 7/7 冒烟）。
- **生产实测（2026-10-06T00:57Z，commit `105da717`）**：
  - `GET /api/ops/provider-status` **匿名 → HTTP 401**、**错密钥 → HTTP 401**。
    这是这个端点唯一真正要紧的性质，**在生产上验过**，不是只在单测里绿。
  - `pnpm smoke:production --expected-commit 105da717` → **7/7**。
  - `pnpm ops:deploy-freshness` → **`fresh`**，生产与 main 同为 `105da717`。
- **但读数本身仍然未知，而且我把它如实写成未知**：
  取 `/api/ops/provider-status` 的内容需要 `CRON_SECRET`，本机环境变量里没有。
  **「鉴权被验证」不等于「内容被读到」**——这两件事很容易被合并成一句
  「端点已上线所以实况已知」，而那正是本项目开头那批错误结论的形状。
  所以 `environments.md` 里 Resend 那一行**照旧是 `❓ 未知`**，
  只在旁边注明「端点已上线且鉴权已验，取读数需要 CRON_SECRET」。
- 补做这一条需要的只有一样东西：一个 `CRON_SECRET`。
  取到之后那行就能从「未知」变成确定值，**不需要任何新代码**。
- 阻塞：B03（可牺牲隔离账号 + 三个 Supabase key）、B04（数据库密码）、
  B05 P2–P4（Resend 测试 key + VAPID + 可牺牲项目）、
  本地缺 `CRON_SECRET`（只需一个值，不需要账号）、生产 `RESEND_API_KEY` /
  `NEXT_PUBLIC_SENTRY_DSN` / `STRIPE_SECRET_KEY`（三条外部链路仍空转）。
- 下一项：v0.12.0 退出报告「下一 milestone」第 2 条——
  **pg_cron 未启用这件事目前只有文档说明、没有门禁**：
  两个环境都没装 \`pg_cron\`，每周清理被守卫静默跳过，
  迁移成功、门禁全绿、\`/api/health\` 正常，**但一行都不会删**。
  这是可执行且不卡凭据的下一个选题。
- 更新时间：2026-10-06（UTC）。

## 2026-10-06 — pg_cron：函数在、调度不在、门禁全绿、数据不删

- 里程碑 / 版本：v0.13.0。分支：`feat/retention-cron-gate`。
- 状态：DONE（未合并）。
- 为什么做：v0.12.0 退出报告「下一 milestone」第 2 条，且不卡外部凭据。
- **先量，再判断**（本项目的硬规矩）：去查了本地栈，而不是照抄文档。
  `docker exec supabase_db_indiestack psql` 三条实测：
  - `select count(*) from pg_extension where extname='pg_cron'` → **0**
  - `select count(*) from cron.job` → **relation does not exist**（所以 0 个调度被注册）
  - 6 个保留期函数**全部存在**：`cleanup_old_api_usage`、`cleanup_old_email_worker_runs`、
    `cleanup_old_notifications`、`cleanup_old_webhook_events`、
    `cleanup_resolved_contact_messages`、`prune_deleted_upload_objects`
- **结论**：迁移成功、`check:migrations` 绿、`/api/health` `ready=true`、
  清理函数全在——**而保留期一周一行都不会删**。
  而在加这条门禁之前，**没有任何一个既有门禁会发现这件事**（`grep -rl pg_cron scripts/ src/lib/release/` 为空）。
- 完成内容：
  - `src/lib/db/retention-cron-audit.ts`（纯判定，18 条单测）
    + `scripts/lib/retention-cron-check.ts`（CLI，thin wrapper 起它，与
    `check-changelog-tags.js` 同一套 `--experimental-strip-types` 做法）
    + `scripts/check-retention-cron.js` + `pnpm check:retention-cron`（已进 `check:all`）。
- **三个刻意的设计决定**：
  1. **静态审计永远可跑**：`--probe` 才连库。查 `pg_extension` 要真 Postgres，
     而本机没 DB 密码（B04 的阻塞）——**一个需要凭据才跑得起来的检查，
     迟早因为没人有凭据而长期不跑**。
  2. **探不到就说「不等于已安装」**：拿不到读数时**绝不**据此推断「没装」。
  3. **一条调度都扫不到也判红**：扫描规则与实际写法脱节时必须出声，
     否则就是「一个扫不到东西的检查等于没有检查」。
- **门禁自己第一版报了 4 条假警，全被当场核掉**——这一段最值得记：
  - `010_webhook_events.sql` 的 `cron.schedule('cleanup-webhook-events')` 在 **SQL 注释**里
    （给 Supabase Dashboard 的建议片段，不是活代码）。扫描没剥行注释 → 报成「未守卫的真调度」。
  - `032_data_retention_erasure.sql` 的说明写在**第 33–34 行**，超出固定 1200 字符的截断窗口
    → 3 条「未写明跳过」。
  **修的是扫描逻辑**（剥行注释且**保留字符位置**，文档窗口改成**按行数**而非字节），
  **不是把发现压下去**——一个会误报的检查迟早被人加白名单关掉，那比没有检查更糟。
- **另一个真实缺陷（在测试跨块时被逮到）**：`isGuarded` 最初只从调用位置往上找最近的
  `pg_cron` 字样，于是**同一文件里前一个 `do` 块的守卫会把后一个裸调用也判成「已守卫」**
  ——只要文件里有一处守卫，该文件所有调度就都合规。真实迁移 `027` 正是 `do $do$ … end $do$`
  结构，所以这不是假想。现在守卫**必须与调用同块**。
- 变异核对（两条都实测，做完复原）：
  - 不剥行注释 → **2 条红** ✅
  - 文档窗口退回 1200 字符 → **1 条红** ✅
- **顺带处置两个新依赖告警**（与本任务无关，但它们让 `check:security` 红了）：
  - `source-map-js`（需 >=1.2.2）、`@vue/server-renderer`（需 >=3.5.42）
    → 有上游修复，走 `pnpm-workspace.yaml` override（与既有 fast-uri / brace-expansion 同理），
    **不登记进例外表**——例外表是给「上游根本没有可升级版本」用的。
  - `braces` **不动**：advisory 编号没变（仍是已登记的 `GHSA-vfj7-8cjw-p6…`，只是
    npm audit 本地 id 变了），且上游 3.0.4 至今未发布（最新 3.0.3 是 2024-04）。
    **第一版这里错加了 override，是 `pnpm install` 直接失败才发现的**——先核对编号再动手。
- 验证：`pnpm test` 该文件 18 条绿；`pnpm check:retention-cron` exit 0（34 份迁移 / 6 处调度）；
  `pnpm check:security` ✅（1084 tracked files，1 条已登记例外）；
  `pnpm type-check` 0 error；`pnpm lint` 0（`main` 一度 complexity 16 超限 15，
  把探测结果展示抽成 `reportProbe()` 后回落到限制内）；`pnpm check:all` ✅。
- 阻塞 / 风险：**生产是否安装 pg_cron 仍未核实**（需 DB 密码）。
  本地未安装是**本地**的实况，不能直接推到生产——这条我特意没写成「生产也没装」。
  若生产也没装，处置是 Supabase Dashboard 启用扩展（外部运维动作），
  而**不是**改代码：守卫本身是对的。
- 下一项：合并后确认 CI 里 `check:retention-cron` 也绿；
  再往后的可执行选题仍是外部凭据相关（B03/B04/B05）或等 DB 密码核实生产 pg_cron。
- 更新时间：2026-10-06（UTC）。

## 2026-10-06 — A05 观察窗口：先把一个一直在说谎的数修对

- 里程碑 / 版本：v0.13.0。分支：`feat/a05-observation-window`。
- 状态：DONE（未合并）。
- 为什么做：v0.12.0 退出报告「下一 milestone」第 3 条（候选 1、2 已由 #226、#228 做完），
  且不卡外部凭据。
- **动手前先量，发现真正的问题比预期严重**：
  `cron.digest.skipped{reason}` 这个指标一直存在，跳过多少条一清二楚；
  但 `DigestProgress` 里**没有 `skipped` 字段**，而响应体是 `return jsonNoStore(result)`。
  **也就是说任何基于「跳过率」的判断都取不到数**——
  而 A05 的全部观察口径（「跳过涨、积压降」）正是建立在跳过率上的。
  第一版我写的是 `result.skipped ?? 0`：**恒等于 0**。
  **一个恒为 0 的「跳过率」指标比没有这个指标更坏——它看起来是被测过的。**
  已改成两个跳过分支真的累加 `progress.skipped`，并进响应体。
- **顺带修掉一个契约不一致**：空队列那条早返回硬编码 `{sent,groups,failed}`，
  于是**同一个端点会因走哪条 return 而返回两种形状**。
  而读日志、写脚本的人正是按「形状固定」来解析它的。已补齐 `skipped`。
- **第二个真问题：「积压高」与「队列卡死」原来只有前者会喊。**
  积压高但每轮都在发出 = 正常业务量；积压高且「拉满 limit 100 却一封没发」=
  队首被不可投递的行占死（`created_at` 升序 + limit 100，可投递的新通知再也拉不到）。
  **两种形态在积压数字上长得一样**，所以新增独立信号
  `cron.digest.verdict{code, attention}` 与一条指向 034 的告警。
- 完成内容：
  - `src/lib/notifications/digest-verdict.ts`（纯判定，14 条单测）。
    **判定与取数分开**：这样它能被穷举，而不必先有一个能用的指标后端。
  - digest 每轮落 verdict 指标 + 对 `attention=true` 报一条可定位的告警。
  - 路由测试 +1（新信号端到端），既有 6 处响应体断言按新契约更新。
- **最要紧的一条口径写死在代码里**：「跳过率上升」**本身不是故障**。
  A05 落地后那些行从「卡在队首」变成「被判定出队」，跳过率**必然上升**——
  任何「跳过率涨了就告警」的规则，都会在 A05 上线后变成一个天天误报的信号位。
  只有「跳过涨 **且** 积压不降」才告警。
- **未知一律不算通过**：空序列、读数不可信（`sent > pulled` / 负数 / 日期格式错）、
  日期重复（同一天两次读数的抖动**不构成趋势**）都判 `INSUFFICIENT_DATA` 且 `attention=true`。
  这与 `check-deploy-freshness` 的「未知不算通过」是同一条原则。
- 变异核对（两条都实测，做完复原）：
  - 把「跳过涨且积压降」判成告警（即 A05 上线后天天误报的那种规则）→ **1 条红** ✅
  - 积压卡死阈值从 100 放宽到 10000 → **3 条红** ✅
- 验证：`pnpm test` 该文件 14 条绿、digest 路由 20 条绿；
  全量 **267 文件 / 3218 用例**（本会话起点是 263 / 3179）；
  `pnpm check:all` ✅；`pnpm type-check` 0 error；`pnpm verify:build` ✅。
- 阻塞 / 风险：**这套判定目前只落指标与告警，还没有接指标后端做趋势**——
  `judgeDigestSeries`（跨天看积压是否在降）已有单测，但**没有生产数据源喂它**，
  所以跨天趋势**尚未真正跑起来**。单轮判定已经在线上生效。
  另外生产未配 Sentry DSN，告警仍无处可去（同前）。
- 下一项：把 `judgeDigestSeries` 接到一个有数据的地方（例如每日 workflow 拉一次指标，
  或 A05 面板复用同一判定）；再往后仍是外部凭据相关（B03/B04/B05、DB 密码、CRON_SECRET）。
- 更新时间：2026-10-06（UTC）。

## 2026-10-06 — 「队列卡死」有两处判定，把它们的关系钉住

- 里程碑 / 版本：v0.13.0。分支：`fix/digest-verdict-cross-consistency`。
- 状态：DONE（未合并）。
- 为什么做：上一条 PR（#229）加了 A05 观察窗口之后，回头核对它与既有面板的关系，
  发现**同一个概念在两处各有一套判定**，而两边对 `failed` 的处理不同。
  这不是重复，是**各自会漂**——一旦漂移，同一份数据会给出互相矛盾的读数。
- **两处判定的真实差异**（先量，不猜）：
  | 位置 | 口径 | 性质 |
  | --- | --- | --- |
  | `digest-verdict.ts` `QUEUE_STUCK` | `pulled >= 取数上限 && sent === 0` | **严重性判定**（要不要喊人） |
  | `queue-diagnostics.ts` `emptySendRounds` | `pulled > 0 && sent === 0 && failed === 0` | **展示口径**（面板上的数字） |
  - `pulled=5, sent=0, failed=0`：面板算 1 轮空发，我的判定**不算卡死**（没到上限）。
  - `pulled=100, sent=0, failed=5`：我的判定**算卡死**，面板**不算空发**（failed>0）。
- **决定：不合并，改为钉住关系。**
  强行统一会让其中一个失真——把 `failed>0` 也算进「空发」会把发送失败淹没在展示口径里；
  把上限要求塞进面板则会让「空发轮次」这个计数变得难以解释。
  新增 `digest-verdict.cross.test.ts`（5 条）钉住**包含关系**：
  **告警不比面板更钝**（凡判卡死的轮次，面板要么也算空发、要么因 failed>0 而另有其因）。
- **顺带修掉一个会静默漂移的口径**（这才是真正值得记的）：
  取数上限原本是 `listUnsentEmailNotifications` 的**默认参数** `limit = 100`，
  而 `QUEUE_STUCK` 另写了一个 100。**改了一处，这条判定就会静默变成
  「永远抓不到真正的卡死形态」**——而没有任何测试会红。
  现在导出 `EMAIL_PULL_LIMIT` 作为唯一出处（与 `EMAIL_MAX_ATTEMPTS`、
  `EMAIL_BACKLOG_ALERT_THRESHOLD` 同属「有第二个消费者的口径」），
  绑定关系由跨模块测试**从外面**核对。
- **一个自己踩的坑，值得记**：为了让判定直接用上那个常量，我一度让
  `digest-verdict.ts` 去 `import` 仓储模块——**结果把 Supabase 客户端拖进了一个
  纯判定模块**，digest 路由的测试直接 500（10 条用例挂了才注意到，
  而且它在单跑与全量跑都挂，说明不是并发/顺序问题）。
  **纯判定最值钱的地方正是「不用 mock 就能穷举」**，所以退回「导出常量 + 外部测试绑定」。
  这也解释了为什么绑定关系要由**同时 import 两边**的测试来守，而不是让被测方 import 常量。
- 变异核对（两个方向都实测，做完复原）：
  - `DIGEST_PULL_LIMIT` 漂到 250 → **3 条红** ✅
  - `EMAIL_PULL_LIMIT` 漂到 250 → **1 条红** ✅
  （只守一个方向是不够的：只守 repositories 的话，把 verdict 侧数字改大同样会让判定失效。）
- 验证：该文件 5 条绿、`queue-diagnostics` 14 条绿、digest 路由 20 条绿；
  全量 **268 文件 / 3223 用例**（上一条 PR 后是 267 / 3218）；
  `pnpm check:all` ✅；`pnpm type-check` 0 error；`pnpm verify:build` ✅。
- 阻塞 / 风险：无新增阻塞。跨天趋势（`judgeDigestSeries`）仍**没有生产数据源**，
  与上一条 PR 记的边界相同。
- 下一项：把 `judgeDigestSeries` 接到有数据的地方；再往后仍是外部凭据
  （B03 需 3 个 Supabase key + 可牺牲账号、B04 需 DB 密码、B05 需 Resend 测试 key + VAPID、
  以及 CRON_SECRET 才能读 provider-status）。
- 更新时间：2026-10-06（UTC）。

- **CI 如实记录**：PR #230 是 **11 绿 / 2 红**，两个红都是
  `Vercel – indie-stack` 与 `Vercel – indie-stack-docs-site`，
  原因是 **build rate limited — retry in 24 hours**（Vercel 构建配额，与本次改动无关）。
  11 个代码检查全绿：Analyze、Build、Build Docs Site、CodeQL、Detect Secrets、
  E2E（+ 两个 shard）、Lint & Type Check、Unit Tests、security-config。
  **合并理由**：本次改动是纯测试与文档 + 一个导出常量，
  且 digest 路由的 CI Build 与 E2E shard 都已在 CI 里跑过同一条路径，
  不依赖 Vercel preview 部署；配额类红灯与代码正确性无关，
  但**它确实是红的**，不记成 13/13。

## 2026-10-06 — 把上一条记下的边界补上：跨天趋势判定终于有数据源

- 里程碑 / 版本：v0.13.0。分支：`fix/digest-series-data-source`。
- 状态：DONE（未合并）。
- 为什么做：上一条 PR 的「阻塞 / 风险」里如实记了一句
  「`judgeDigestSeries` 已有单测，但**没有生产数据源喂它**，所以跨天趋势尚未真正跑起来」。
  **记下的边界就该被补上**，否则它会一直挂在那儿变成一句自我安慰。
- **量出来的缺口**：`listRecentEmailWorkerRuns` 只 `select` 了 `pulled, sent, failed` 三列，
  而 `judgeDigestSeries` 判「积压是在降还是不降」**必须有日期**——
  它对重复日期直接判 `INSUFFICIENT_DATA`（同一天两次读数的抖动不构成趋势）。
  **所以那个判定当时只能判单轮，跨天部分是一段没有输入的代码。**
- **好消息：这是接线漏了，不需要新迁移。**
  表 `email_worker_runs` 的 `created_at` 早在迁移 017 就有了、而且已建索引，
  只是取数时没 select。所以：
  - `.select("pulled, sent, failed")` → 加上 `created_at`；
  - `EmailWorkerRunRow` 增加可选 `date`（只取 UTC 日期部分，不带时间戳）。
- **一条刻意的取舍**：`created_at` 缺失时 `date` 为 `undefined`，**不编一个日期出来**。
  编日期比没有日期更坏——`judgeDigestSeries` 会拿它排序、判重复日期，
  凭空来的日期会让「积压下降」这句话建立在一个**不存在的读数**上。
  这与本项目反复用到的「未知不算通过」是同一条原则。
- **一条被我顺手改掉的过时意图**：仓库里原有一条用例叫
  「只取算空发送轮次用得上的三列」，它把「三列」当成了正确做法。
  那个意图**已经过时**（趋势判定需要第四列），所以改成
  「取三列计数 + created_at（跨天趋势判定需要日期）」，
  并补两条：`created_at` 缺失时 `date` 为 `undefined`、只取日期部分不把时间戳带进来。
  **测试的意图本身会过时，而过时的意图比过时的实现更难发现**——
  因为它看起来只是一条断言。
- 变异核对（实测，做完复原）：
  - 去掉 `created_at` 的 select 与 `date` 映射 → **2 条红** ✅
- 验证：`worker-runs` 7 条绿（+2）、跨模块 6 条绿（+1）、`queue-diagnostics` 14 条绿；
  全量 **268 文件 / 3226 用例**（上一条 PR 后 268 / 3223）；
  `pnpm check:all` ✅；`pnpm type-check` 0 error；`pnpm verify:build` ✅。
- 阻塞 / 风险：**跨天趋势现在有数据源了，但还没有一处真的去调它**——
  面板目前只用 `emptySendRounds`（单轮计数），没有把 `judgeDigestSeries` 的结论显示出来。
  也就是说数据通了、判定有了，**「谁来看」这一步还空着**。
  另外本地 Supabase 栈已停（本轮读表结构时 docker socket 不通），
  所以 `created_at` 的存在是靠**迁移 017 的 SQL** 核的，不是靠本地库——这一点如实记下。
- 下一项：把 `judgeDigestSeries` 的结论接到 admin 面板（与 `emptySendRounds` 并排，
  让「面板说 0 轮空发、趋势说还在涨」这种矛盾读数能被一眼看到）；
  再往后仍是外部凭据（B03 / B04 / B05 / CRON_SECRET）。
- 更新时间：2026-10-06（UTC）。

## 2026-10-06 — 把A05 趋势结论摆上面板；再次验证「变异测试通过先怀疑是否可达」

- 里程碑 / 版本：v0.13.0。分支：`feat/admin-email-queue-trend`。
- 状态：DONE（未合并）。
- 为什么做：上一条 PR 的「阻塞 / 风险」白纸黑字写着
  「跨天趋势现在有数据源了，但还没有一处真的去调它——**「谁来看」这一步还空着**」。
  **空着就补上。** 面板此前只有 `emptySendRounds`（单轮计数），
  一个挂在那儿没人解释的 `pending=812`。
- **先量，不猜**：面板组件里全仓搜索 `emailQueue.trend` → **0 处**。
  结论已经存活在 `queue-observability` 的返回值里，**它一直没人看**。
- 串联起来的接线：取数 → `toDailyDigestReadings` → `judgeDigestSeries`
  → `EmailQueueReading.trend` → 面板「队列趋势」卡。
- **本条 PR 最值得记的不是代码，是这一点**：
  第一版映射逻辑（按天去重 + 拼判定序列）写在取数函数里，
  然后我去做变异核对——**两个变异全部全绿**（删掉去重全绿、读 BeforeSend 混进 skipped 也全绿）。
  按本项目的变异纪律，「变异通过」的第一怀疑**永远先是「变异是否可达」**，这次是真的。
  不可观测的根因：① 测试数据里同日多轮的 pulled/sent **完全相同**，
  所以留哪一轮看不出来；② 所有天共用同一个 `skipped` 值，
  所以 skipped 的算法换了也看不出来。
  **于是把映射抽成导出的纯函数 `toDailyDigestReadings`，然后断言直接钉「留的是最新一轮」。**
  再做一遍变异：三个变体全部逮到。**解药是「让变异可观测」，不是「加更多测试」。**
- **同样的教训又出现一次**：之前直接在 `AdminPage` 里写趋势文案 switch，
  ESLint complexity 16 > 15 被拦；改用模板拼 `trend${code}`→ `check:i18n` 的动态键门禁拦下；
  改抽成 `trend-copy.ts`→ 又漏掉了「数据不足要说不知道」这条。
  **文案组装独立成 `trend-copy.ts` 之后，这三件事才分别有了落点。**
  default 分支的「读数不足」由单测钉住：
  「**未来新增一个 code 落到 default，显示「读数不足」而不是拼出一个错误的键**」。
- 变异核对（全部实测过，复原）：
  - 删掉按天去重 → 1 红 ✅
  - 不过滤无日期轮次 → 3 红 ✅
  - 同日保留最旧一轮 → 3 红 ✅
  - 数据不足时回落 `OK` → 1 红 ✅
  - QUEUE_STUCK 不再共用一句话→ 1 红 ✅
- 验证：全量 **269 文件 /3242 用例**（上一条 268 /3226）；
  `pnpm check:all` ✅；`pnpm lint` 0 error；`pnpm type-check` 0 error；
  `pnpm exec vitest run src/app/dashboard/admin/page.test.tsx` 8/8；
  `pnpm verify:build` ✅（i18n 静态键已进 SSG）。
- 阻塞 / 风险：
  - `toDailyDigestReadings` 对 `backlog` 与 `skipped` 用**当前唯一取值**贯穿全序列——
    这是**近似**（历史轮次的真实 backlog 并没有进 worker_runs 表），
    所以下面把 `trendRounds` 一起展示，**一个只基于两天的「趋势」不该被当成趋势看**。
    这一点已在实现注释与 CHANGELOG 里说清。
  - 生产仍落后 main 多个提交（Vercel 构建排队 24h 配额窗口），
    `ops:deploy-freshness` 依旧 `lagging`（阈值内）。
- 下一项：等配额窗口过去，取生产证据（freshness + smoke），
  并把这张图截一遍进来（不是「它能渲染」而是「上面真的是人能读的那条」）；
  再往后仍是外部凭据：B03 需 3 个 Supabase key + 可牺牲账号、
  B04 需 DB 密码、B05 需 Resend 测试 key + VAPID、CRON_SECRET 才能读 provider-status 内容。
- 更新时间：2026-10-06（UTC）。
