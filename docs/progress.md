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

- 版本 / 里程碑：v0.12.0 安全面收口（C10）。分支 `fix/marketing-token-rate-limit`（base `main` = `ad4b029`）。
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
