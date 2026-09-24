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
- 分支 / commit：`test/e2e-per-worker-servers`（PR #77）第三个 commit `3d624e5`。
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
  `docs/testing.md` 与 roadmap C02。回滚 = revert `3d624e5`（预热与 eslint ignore 要一起回退）。
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
  - **并行基线两轮**（同一 ref `30ec139`，手动 dispatch）：run `35742942744` = 106 passed / 1 failed；
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
- 分支 / commit：`test/e2e-parallel-baseline-first-run` 的第二个 commit（基于 `ea9489f`）。
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
  回滚 = revert 本 commit（两个 commit 可分别 revert：`481f357` 是 C07 的重构跟进）。
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
  **失去本 PR 在 `main` 上真跑过的必需 CI**——两种代价都换不到任何东西，因为解法本身没有待定的部分。
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
- 验证：以上每一条都是当场跑的命令 + 打印出来的数（钩子的 `-L`/`-x`/`-e` 三态、`ls .husky/_` 不存在、
  `node -e` 读 package.json 与 lockfile 的命中数、`grep .github/workflows`、200/40 个 commit 的规则核对）。
- 风险 / 回滚：本条只是文档；唯一的环境改动是 `.git/hooks/pre-push` 从悬空软链改成指向仓库自己的 `.husky/pre-push`，
  反向操作是 `rm .git/hooks/pre-push`。
- 下一项：门禁形态的 commit 校验排在 #113/#114/#126/#131 落地之后；
  `AUTH_ERROR_CHANNEL` 与「已装钩子存在性」两条也排在同一批之后。
- 更新时间：2026-09-24。

