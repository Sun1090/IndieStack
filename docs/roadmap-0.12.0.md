# IndieStack v0.12.0 Roadmap

> 主题：**把已经接上的线真正跑通一次，并留下证据**
> 基线：v0.11.0（2026-09-22 发布章节已冻结；同日生产已部署 `0.11.0`，但 `v0.11.0` tag 仍未打——
> 缺账户删除演练与 commit 归属证据，见 B01/B02）→ 目标：v0.12.0
> 输入：`docs/operations/release-exit-report-v0.6.0.md`（v0.6.0 任务池 100 项的逐条核对结果，
> 含 7 项部分达成与 2 项未达成）与本文件下方的来源标注。
>
> **排期原则**：先做「没有证据就等于没做」的收口项（投递语义、发布证据、演练），再做隔离与门禁补强；
> 任何条目的完成都要留下可复现命令或执行记录，不接受「文档已写」。

> 任务名沿用领域前缀，但**不再与版本号绑定**：v0.6.0 的任务池一半是在 v0.7.0–v0.11.0 期间交付的，
> 而 roadmap 文件里的 `（完成：…）` 标注与开头的进度汇总无人维护，最后要靠一份退出报告重新核对
> （见退出报告「与 roadmap 文本的矛盾」）。因此本文件要求：状态只在退出报告里维护，
> roadmap 只写目标与验收口径。

## 任务池（引用一律用 ID；条数不写在这里，现量：`awk '/^## 任务池/{f=1;next} /^## 里程碑/{f=0} f && /^[0-9]+\. [A-Z][0-9]+/' docs/roadmap-0.12.0.md | wc -l`）

### A. 通知投递语义（P0，来自 E03 与退出报告遗留项 1）

1. A01 （**2026-09-22 已定案并完成**：用户选「放宽窗口、接受一天一封」。`isDigestHour` 门控与
   `DIGEST_LOCAL_HOUR`/`DIGEST_DEFAULT_TIMEZONE` 已删除，语义为每轮每人一封、固定 09:00 UTC 发送；
   双语 `docs-site/email.md` 与 `docs/design/email-templates.md` 已按新语义改写，
   回归钉子是「上海/纽约/圣保罗同一时刻各收到一封」那条路由测试）
   - **这条留下的新决策**：`profiles.timezone` 从此**没有任何功能性消费者**——digest 不再读它，
     全仓剩下的引用只有资料页展示与编辑（`dashboard/profile/page.tsx:98`、
     `dashboard/profile/edit/page.tsx:35,60`、`components/forms/profile-edit-form.tsx:65`）、
     写入校验（`api/user/route.ts:29`、`lib/actions/profile.ts:32`）和完整度计分
     （`profile-completeness-card.tsx:18`）。也就是说用户仍被要求填一个**当前什么都不影响**的字段。
     要么在文档与 UI 上说明它只是偏好，要么删掉这条链路——属产品决策，不与其他条目耦合
2. A02 （随 A01 完成：门控既然移除，临时指标 `cron.digest.deferred` 已删除，注册表回到 14 个指标；
   若将来重新引入任何「按条件跳过」的门控，必须同时带回对应的可见性指标与告警规则）
3. A03 （2026-09-22 已核对，**push 链路没有同型缺陷**）：`src/lib/push-retry.ts` 与
   `src/app/api/cron/push-retry/route.ts` 里没有任何按小时/时区的门控（`grep -n "hour\|timezone\|local"`
   无命中），出队条件是单调的 `next_attempt_at <= now`（`repositories/push-delivery-attempts.ts:104`，
   按 `next_attempt_at` 升序取 50 条），到点的行不会因为调度时刻而永远落在窗口外；
   失败侧另有 `PUSH_MAX_ATTEMPTS` → `dead`/`revoked` 与 `push.delivery.dead`、`push.backlog` 兜底。
   **仍需盯的是 digest（A01）而不是这里**，本条按已完成收口
   - **2026-09-23 更正这条的结论范围**：「push 没有同型缺陷」只对**按小时/时区门控**这一类成立。
     同一轮里发现的 push 缺陷是另一类：终止条件只有一个 `attempt_count`，而它依赖重排回执写成功才前进，
     写失败时计数器冻结 → 行永远到不了上限，会长期占住按 `next_attempt_at` 升序拉取的队首。
     已修（绝对上界 `PUSH_RETRY_MAX_AGE_MS` → `failure_code=max-age`，并新增
     `push.delivery.retry_failed`），见 CHANGELOG 与 `docs-site/web-push.md`。
     **邮件侧核对过，不是同一个形状，且已在 2026-09-23 单独收口**：`recordEmailFailures` 里的
     `markEmailFailed` 当时没有包 try/catch（`cron/digest/route.ts:84`、`repositories/notifications.ts:151`
     出错即 throw），所以回执写失败会让整轮抛错、返回 500 并落 `cron.digest.failed`——计数器一样没前进，
     但它是**响亮地**卡住，不会像 push 那样装作在正常重试。那条「响亮」现在也修了：两处回执各自隔离并
     上报 `cron.digest.receipt_failed{stage}`，轮次记录改为照实累加（`DigestProgress`），不再把**已经寄出
     邮件**的轮次记成 `sent=0`（那会让 A05 的「空发送轮次」报假信号，比看不见更糟）。
     **邮件仍然没有行龄上界，这是有意的**：丢掉一封排了 N 天的信改变的是送达语义。
     邮件真正缺的还是 A05 那道口径：一行待发被跳过或反复失败时，它凭什么离开队列；那是产品决策，
     不在本条的工程收口里。
4. A04 （**2026-09-22 已完成**）：任何 cron worker 路由里**按用户条件跳过投递**的分支，
   都必须同时上报一个跳过计数指标。落地为
   `src/lib/observability/cron-skip-coverage.ts`（TypeScript 解析器核对带条件的 `continue`
   是否留下计数证据）+ 注册表新增 `skipMetrics`（必须是 `metrics` 子集）+ 接进
   `pnpm check:cron-contract`，成功日志自报「N 处条件跳过均有计数证据」。
   验收证据：删掉 digest 路由里的 `recordMetric` → `CRON_SKIP_UNCOUNTED`，去掉 `reason` 维度 →
   `CRON_SKIP_REASON_MISSING`（两条都在真实仓库上跑过，不是 fixture 推演）；
   规则本身 11 条单测 + 契约 6 条 + IO 2 条。「静默不投递」从此在 PR 阶段失败。
5. A05 死信与积压的可操作路径：admin 面板能看到未发送队列的规模、最早一条的年龄，
   以及「有队列但整轮 `sent=0`」的轮次（原因只会是无邮箱或偏好全关，两者都该看得见）。
   **2026-09-22 核对时补一条更要紧的事实**：被跳过的条目**永远出不了队列**——
   两个 skip 分支（`cron/digest/route.ts` 的 `!profile?.email` 与偏好过滤后 `filtered.length === 0`）
   都不调用 `markEmailSent`，也不调用 `markEmailFailed`，所以 `metadata.email_attempts` 不增长、
   达不到 `EMAIL_MAX_ATTEMPTS`（`repositories/notifications.ts:32`）的死信门槛；
   实时通道 `email-notify.ts:90-91` 对同样两种情况也是早退，条目会持续产生。
   后果：`listUnsentEmailNotifications` 是 `created_at` 升序 + `limit 100`
   （`repositories/notifications.ts:57-73`），这些永久不可投递的行会一直占住最前面的名额，
   攒够 100 条之后**新产生的、可投递的通知再也拉不到**，表现为每天 `pulled=100, sent=0`
   且 `email.backlog` 单调增长（阈值 500 的告警只说明规模、不说明原因）。
   本条因此包含一个决策：偏好关闭/无邮箱的行应当以什么语义出队
   （复用死信、新增 `email_skipped_reason` 过滤，还是拉取侧翻页跳过），
   三者都会改变 admin 面板与既有指标口径，不接受顺手用 `markEmailSent` 掩盖。
   **2026-09-23：可观测那一半已落地**——admin 概览页新增「邮件待发队列」卡片，报队列条数、
   最老一条的年龄（48h = 两个日调度周期以上算「已卡住」）、以及最近几轮
   `pulled>0 && sent===0 && failed===0` 的空发送轮次（`src/lib/notifications/queue-diagnostics.ts`）。
   三个读数刻意与 worker 的拉取口径共用同一段过滤，并由一条「三处过滤调用逐项相等」的用例钉住。
   **2026-09-23 修掉一个会污染该读数的缺陷**：digest 整轮抛错时，轮次记录曾把 `sent/groups/failed`
   写死成 0，于是一轮**已经给若干用户真的寄出摘要**的运行正好落进「空发送轮次」的定义里——
   那不是漏报而是假信号，比看不见更糟。现在进度就地累加、两处回执各自隔离
   （`cron.digest.receipt_failed{stage}`，见 CHANGELOG），该读数只剩它应当表达的那一件事。
   邮件侧刻意**没有**跟着 push 加行龄上界：丢掉一封排了 N 天的信是送达语义变化，归本条决定。
   **出队语义仍未决**：本条没有改变任何发送行为，被跳过的条目依旧永远出不了队列。
   **2026-09-23 审计又量出第二条静默出队路径**：队列条件含 `is_read=false`
   （`repositories/notifications.ts:66,85,103`），而 `markAllNotificationsRead`
   （`:222-231`）不带类型地把用户全部未读通知标成已读、也不写 `email_sent`——
   站内先读过一条 `security_alert`，它就再也不会被 digest 寄出，同时**从 `email.backlog` 里消失**。
   也就是说这条路径会**掩盖上面那条积压**：队列越堵，读数越小。它此前既没有文档也没有用例。
   文档已经补上（双语 `docs-site/email.md`），但「已读是否等于不必寄」是同一个待决产品决策的一部分：
   A05 定出队语义时必须把这两条路径一起判，不要只修 `no_email`/`preference` 那两条。

### B. 发布证据闭环（来自 J06 / J08 / E09）

6. B01 （**2026-09-22 已完成**：无副作用冒烟取到本地与 CI 两份证据，`/api/health` 返回
   `version=0.11.0`。注意这条**不**等于「`main` 已部署」——生产当时停在 `a322a4e`，
   构建身份的判定改走部署记录与 `commit` 字段，见 `docs/operations/production-smoke-v0.11.0.md`
   的「冷启动与部署配额」。
   本地 `pnpm smoke:production --expected-version 0.11.0` 与 CI `workflow_dispatch` run `35702965727`
   各取一次 6/6，状态码、header 快照、JSON 与 artifact 指纹已写进
   `docs/operations/production-smoke-v0.11.0.md`；定时 run `35700843878` 的 `smoke-main` 同步转绿。
   取证据的过程本身抓出一条缺陷——手动 `smoke` 作业在每次定时运行里都因空 `inputs` 崩溃，
   已由 `check:production-smoke` 的两条新规则钉住。**B01 只覆盖无副作用面**：
   只读凭证类 3 项与隔离账号 14 项仍未执行，它们是 B03/B04 的内容，也是打 tag 的前置）
7. B02 执行一次真实回滚演练（切回上一 deployment、验证 health 与 schema 向前兼容），
   填 `docs/operations/rollback-runbook-*.md` 的「演练记录」——这是 v0.6.0 起从未闭合的 J08。
   **2026-09-22 补的那条硬事实已经修掉**：`/api/health` 现在上报 `commit`（构建时内联的
   `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA`），`pnpm smoke:production --expected-commit <SHA>` 会断言它，
   缺失即失败。剩下的是时间问题——2026-09-22 部署的那版构建不带这个字段，
   所以 B02 的「切回上一 deployment 并证明回到了哪个 commit」要等下一次部署才有可比对象
8. B03 隔离账号上的账户删除全链路（真实 `auth.admin.deleteUser` + 真实 bucket 对象删除），
   替换目前用 `delete from auth.users` 的等价替代（记录在 `docs/db/retention.md` 的「仍未取得的生产证据」）
9. B04 云端 Supabase 上的保留期与擦除同型演练（把本地两份 `docs/operations/drills/*.sql` 在云端跑一遍）
10. B05 provider 与 incident 演练各一次：Resend 缺失/限流、Web Push VAPID 失效、Supabase 恢复链路，
    结论写进对应 runbook 的执行记录小节

### C. 测试与门禁基建（来自 F01 / F02 / F04 / J01 / C03 / A02 / A10）

11. C01 （**2026-09-22 已完成，但结论和这条当初的假设相反**）先测后改，量出两点：
    ① `createMockRequestStore` **早就接进了** client / query / auth —— `from()` 建
    `MockQueryBuilder(table, "*", this.store)`、`rpc()` 与整个 `auth.mfa.*` 都用 `this.store`，
    所谓「第二阶段」没有待接的线；② 被点名「仍是进程全局」的 `_mockMfaFactors` /
    `_mockMfaChallenges` 是一批**只被写入、从不被读取**的模块级镜像，同形状的共有 21 个，
    它们不承载任何状态，真正的进程级状态只有一份：默认 store（`MOCK_GLOBAL`）。
    因此本条的交付是：删掉那 21 个镜像（store 自此是唯一来源）、补齐 MFA 的**可证伪**隔离测试
    （共享 store 的可见性、challenge 失败计数与锁定的 store 私有性、同 store 内两个 challenge
    各自计数、`listFactors` 返回副本），并在 `docs/architecture/13-mock-system.md` 写清
    「默认 store 是假数据库，运行时故意共享」这条边界——把它改成请求级会重演 v0.5.0 的
    「Action 写进去、RSC 读不到」
12. C02 （**2026-09-22 已完成：基线可复跑 ✅，共享状态冲突清零 ✅，全量并行 107/107 绿 ✅**）
    `.github/workflows/e2e-parallel.yml` 已落地——`PW_FULLY_PARALLEL=true`、全量（不带 `--shard`）、
    强制 `--retries=0`，手动触发 + 每周一 `30 7 * * 1`。F04 欠的「可复跑」这一半已经还上。
    **首跑红了**（run `35727094401`，12:25:42Z→12:29:18Z，job `10674329401`），4 条 spec 失败，
    机制是同一条：`next dev` 只有**一个**进程、一份 `MOCK_GLOBAL`，而 `fullyParallel` 连同一个文件里
    的用例都会拆到不同 worker，于是彼此打断——
    ① `webhook-events.spec.ts:114`：本 spec 先清空通知表、投递一条付款事件，断言通知数 `toBe(1)`，
    实测 **2**（另一个 worker 在这两步之间 seed 了通知；它前面那句「清空后 `toBe(0)`」倒是过了，
    所以这不是清理没做，而是清理与断言之间的窗口不收）；
    ② `notifications-realtime.spec.ts:53`：等不到「暂无通知」空态。失败快照里多出来的那条叫
    「E2E Push 种子通知」，出自 `src/app/api/e2e/push-queue/route.ts:105`——并行的 `push-retry.spec`
    往同一张 `notifications` 表种的种子；
    ③④ `mail-flow.spec.ts` 的前两条用例：`:49` 读到收件箱 `total` 为 0，`:187` 的 `email_attempts`
    poll 停在 0 超时。凶手在**这个文件自己身上**——它把清理写在文件顶层（`beforeAll` 第 27、30 行
    DELETE `/api/e2e/email-inbox` 与 `/api/e2e/seed-notifications`，`beforeEach` 第 41、44 行同一对），
    而 `fullyParallel` 下这类钩子不是「每个文件一次」而是**每个 worker 各跑一次**：同一文件的三条用例
    被拆到不同 worker 后，彼此的清理删光了对方刚种下的数据，它既是受害者也是加害者。
    证据指到的共享状态只有两处：`notifications` 表与本地 email inbox。`webhook_events`（去重断言全过）
    和 `email_worker_runs`（读它的那条失败路径用例没红）这次不在证据里，只是同类风险。
    **隔离已经做掉，走的是进程边界而不是 store 命名空间**（PR #77）：既然默认 store 是**进程级**的，
    就让并行单位与进程单位对齐——`E2E_SERVERS=N` 起 N 台 `next dev`，`workers` 直接等于 N，
    spec 侧所有应用地址走 `e2e/support/base-url.ts` 的 `appUrl()`（按 `TEST_WORKER_INDEX` 选端口）。
    两台服务器要各自的 `NEXT_DIST_DIR`：Next 用 `<distDir>/dev/lock` 判断「这个工作副本已经有一个
    dev server」，同一份源码上第二台会直接退出 1。代价是 `next.config.ts` 多一个 distDir 开关，
    换来的是那 4 条按机制必然复现的冲突全部消失。
    **复跑三轮，把两种红分开**（用例总数 107，与本机 `playwright test --list` 一致）：
    run `35742942744`（ref `30ec139`）106/1，run `35744080784`（同 ref）105/2——红的分别是
    `uploads`（登录导航 15s 超时）、`smoke`（`page.goto` 60s 超时 + `ERR_ABORTED`）、
    `webhook-events`（同一个 event id 的第二次投递没被认成 duplicate）。**没有一条是首跑那类
    「别人往我表里种数据」**，三条各不相同、换轮次就换一批；共同点只有一个：它们都是
    **第一个打到某台服务器的用例**，在付 `next dev` 的按路由冷编译。于是加了 `globalSetup` 预热
    （`e2e/support/warm-up.ts`，只在 `E2E_SERVERS>1` 时生效），run `35746785602`（ref `3d624e5`）
    **107 passed / 0 failed**。结论分两层：并行不成立的根因是进程级共享 store，靠「一个 worker
    一台服务器」解决；解决之后剩下的红是冷编译计时，靠预热解决——两者都**不需要**动 mock 的
    状态模型，也**不需要**放宽任何断言。
    默认 CI 的 2 个 shard 一直全绿，与本条无关；也**不要**为了让基线变绿
    把运行时的默认 store 改成请求级（见 C01 与 `docs/architecture/13-mock-system.md`）。
    退出标准第 3 条里的「C02 完成」按这条的口径判定：**有可复跑的运行记录只是下限，
    并行全绿才算完成**——2026-09-22 达成，证据是 run `35746785602`；
    **2026-09-23 在 `main` 上复跑一次**（run `35757758491`，`--exit-status` 通过，零重跑）：
    那次改的正是并行依赖的东西（spec 里 8 处导航/请求改走 `appUrl()`，加一条 admin 概览页的队列用例），
    用例数因此是 108 而不是 107。基线只在 topic branch 上绿过，等于还没有在 main 上的基线
13. C03 （**2026-09-22 已完成**：组件层 13 条 + 真走一遍挑战流程的 E2E `e2e/mfa-challenge.spec.ts` 3 条）
    原文把它挂在「Mock 的 MFA 状态在 E2E 之间可隔离」上是错的，那是 C01 的前置，与这条无关。
    实测的阻塞有三处，都在仓库内，也都在这次改掉了：
    ① `/auth/mfa` 只有两个入口，都在 `src/components/auth/login-form.tsx`——密码登录（第 86～92 行，
      读 `signInWithPassword` 响应里的 `user.factors`，有 `status==="verified"` 才跳）与 passkey
      （第 179～182 行，`/api/auth/passkey/auth-verify` 返回 `mfaRequired`）。mock 的
      `signInWithPassword` 返回的是不带 `factors` 的 `getMockUser()`，真实 Supabase 会带——
      所以 mock 下密码登录永远不会把人送到挑战页。现在响应带回 store 里因子的副本。
    ② 浏览器侧的 mock store 挂在 `globalThis.__indiestackMockCache__`，也就是 `window`，整页导航即重置，
      所以 `e2e/admin-contact-mfa.spec.ts:104` 那种「同一页里 enroll→verify」的状态活不到下一次登录，
      `/api/e2e/*` 那套服务端端点也种不到浏览器里那份 store。E2E 用 `page.addInitScript` 在页面脚本
      之前写入已验证因子，等价于真库里「这个账号开了 2FA」。
    ③ **mock 客户端根本没有 `auth.refreshSession`**：挑战页 `page.tsx:85` 在 verify 成功后 await 它，
      于是 mock 下「验证码明明对了，页面却报通用登录失败」。组件级用例（`page.test.tsx`）把整个
      client 桩掉了，看不见这个缺口——只有真跑 mock 客户端的 E2E 能撞见。
      同类的还有 `auth.resend`、`auth.verifyOtp`（`src/lib/auth/passkey-session.ts:62`，需要
      `user.factors`）、`auth.exchangeCodeForSession`、`auth.admin.mfa.listFactors/deleteFactor`
      （恢复码自救要删因子，缺这段就是「兑换成功、随后报错」），本次一并补齐。
      并把这件事做成了一条**静态自检** `src/lib/mock/auth-surface.test.ts`：扫 `src/**` 里的
      `<client>.auth.<路径>(` 调用点，逐个对回 `new MockSupabaseClient().auth` 的对象形状，
      缺一个就报出「哪个文件 → auth.xxx（缺哪一段）」。它跑在 `pnpm test` 里（那本来就是 push 的
      硬性前置），所以不再往 `scripts/check-*` + CI + 双语 docs-site 那套接线抄第三遍。
      两条 passkey magiclink 的 admin 方法（`admin.generateLink` / `admin.getUserById`）暂时挂在
      `KNOWN_GAPS` 里带理由豁免，并且有**反向断言**钉住：谁补上了实现，那条豁免就会因为
      「它已不再是缺口」而变红，逼着删行——静默生效的豁免清单正是这类缺口能活久的原因
    passkey 那条入口另需 Chromium 的虚拟 WebAuthn authenticator，仓库现在**没有任何** passkey E2E
    （`grep -rn virtualAuthenticator e2e playwright.config.ts` 为空），它和 ①②③ 是两件事，不要混做
14. C04 （**2026-09-23 已完成**）：`node scripts/check-bundle.js` 先接进 CI Build job（2026-09-22），
    `check:bundle` 的 CI 豁免随之删除；本次把 `Lint & Type Check` job 里逐个写的 30 步 `pnpm check:*`
    换成一步 `pnpm check:all`——本地聚合与 CI 从此只有一份清单。约束的落点不是 `check:gates`：
    它按「任意 workflow」判定接线，`release.yml` 也跑聚合，删掉 ci.yml 那一步它照样绿（变异核对量出来的），
    因此规则加在 CI 拓扑门禁上——静态作业正文必须出现 `pnpm check:all`，缺即 `CI_TOPOLOGY_DRIFT`。
    作业名保持 `Lint & Type Check` 不变，因为分支保护按名字匹配必需检查
15. C05 孤儿巡检补上 provider 侧 `list()` 与数据库的集合差，覆盖 031 之前从未落元数据的存量对象
16. C06 定夺 `src/lib/actions/uploads.ts` 两个 Server Action：保留为编程入口（补调用方与文档）
    或删除（同步 service-role inventory、错误码门禁与 docs-site）
17. C07 （**2026-09-23 已完成**）：`pnpm check:query-columns` 把 `src/**` 每条 `.from("<表>")` 查询链上的
    字面量列名对回 `src/lib/supabase/database.types.ts` 的 `Row` 类型。存在的理由是一条真实缺陷：
    `/api/e2e/email-worker-runs` 按 `email_worker_runs.started_at` 排序，而这张表从建表（迁移 017）起就
    只有 `created_at`——生成的类型只约束查询**结果**、单测里查询链是 mock 的、Mock 客户端对未知排序列
    静默 no-op，lint / type-check / 单测 / E2E 四层全部失明，只有真库会给 400。规则位于
    `src/lib/db/query-columns.ts`（TypeScript AST、纯函数、11 项变异核对），文档见
    `docs/testing.md`「查询列名一致性门禁（C07）」。
    - **运行期同型防线试过但没采纳**。探针：让 Mock 客户端在「结果非空却没有任何一行含该排序列」时抛错。
      量到的事实：`--project node` 的 2104 条单测全绿；`e2e/account-deletion.spec.ts` 单跑 5/5 绿且探针
      一次都没触发。**全量 E2E 那次不作数**——跑到一半 `:3100` 被另一个项目（`~/Projects/trade-buty` 的
      `next-server`）占用，`webServer` 起不来，那条 1 failed 无法归因于本改动，也没有复跑。
      不采纳的理由不是成本而是**判据不同源**：静态门禁比的是 `database.types.ts` 的行类型，探针比的是
      fixture 的键集合；稀疏种子会把合法列判成错误，于是它产生的失败信号比它要保护的那类缺陷更难查。
      真要做，前置条件是先把 mock 的表结构对齐生成类型——那是另一件事，别顺手塞进这条。

18. C08 （**2026-09-23 已完成，债务按文件登记**）把「被断言抹掉 `error` 通道的 awaited 查询结果」变成门禁：
    这类写法在类型上宣称「这条查询不会出错」，于是编译期再也逼不出 `error` 分支，运行期一次故障就被答成
    一个确定的结论。落地为 `pnpm check:query-errors`（规则 `src/lib/security/query-error-channel.ts`，
    IO `scripts/lib/query-error-channel-check.js`，文档 `docs/testing.md`「查询错误通道门禁（C08）」）。
    重测之后**先前那份规模估计不成立**：早期脚本用单行 grep 数，漏掉了多行断言；换成 AST 后判据改成
    「`await` 一条 `.from()/.rpc()` 链的结果、且断言类型里没有 `error` 成员」，未 await 的构造器断言
    （`… as unknown as FilterChain`）不再算数，`x as unknown as T` 只算一处而不是两处。
    接线前实测（修掉鉴权路径之后）：358 个非测试文件里 37 处 awaited 断言，22 处抹掉 `error`，分布在 12 个文件。
    本条修掉鉴权/管理路径上四个文件里的**五处**断言：`lib/auth/guards.ts`（两处，改为 `SERVICE_UNAVAILABLE` + `guardHttpStatus` 503，
    读失败不再答成「你没登录」）、`app/dashboard/admin/layout.tsx`、`app/dashboard/admin/audit-logs/layout.tsx`
    （不再把管理员静默降级成 member）、`actions/admin.ts`（读失败不再答 `userNotFound`）。
    其余 22 处进台账：`permission-gate.tsx` 两处标为 justified（客户端组件无法 5xx，回落最低权限是刻意的），
    其余 20 处标为 `debt (C08-b)`。台账按文件计数并双向对账——加一处红，修一处不改数字也红，
    所以它既不会悄悄长胖也不会悄悄烂成永久豁免表。另加一条 `QUERY_ERROR_CHANNEL_PARSE`：
    语法树不完整的文件必须点名，因为「解析不动」在门禁眼里等于「不存在」，这条是被自己的测试 fixture
    抓出来的（`as` 换行会被 ASI 截断成语法错误，第一版因此悄悄不判那一处）
19. C08-b 偿还错误通道台账：按影响面从大到小清 `ERROR_CHANNEL_EXEMPTIONS` 里标 `debt` 的 20 处。
    顺序是**逐个读过代码之后**定的，不是按文件或字母序：① 会把**没提交的数据写掉**的两处——
    `actions/projects.ts:183`（config 合并读失败后写入 `{ ...(current?.config ?? {}), ...input.config }`，
    项目 config 里其他键静默消失）与 `dashboard/profile/edit/page.tsx:33`（表单预填 `""` / `UTC` / `en`，
    用户点保存就把真实资料覆盖掉；`notifications/page.tsx:46` 同型，开关全渲染成关，保存即落库）；
    ② 鉴权与所有权判定（`lib/uploads/service.ts` 封面上传把角色读失败答成 `onlyAdminsCreateProject`、
    `api/invitations/route.ts` 五处、`lib/actions/projects.ts` 另两处、`lib/actions/sessions.ts` 把读失败答成
    `sessionNotFound`、`lib/actions/api-keys.ts` 让「密钥不存在」与「读失败」共用一个 `databaseError`）；
    ③ 页面读数（`dashboard/team/page.tsx` 渲染成「你还没有团队」、`dashboard/billing/page.tsx`
    把套餐显示成 `free`、`dashboard/profile/page.tsx` 把角色显示成 `member`）。
    每清一处必须同时下调台账数字，否则 `QUERY_ERROR_CHANNEL_EXEMPT_STALE` 会红
20. C08-c 邻居缺陷：解构 awaited 查询结果时**压根不取** `error`（不是断言掉的，是漏看的），
    接线时按同一套 AST 实测到 12 处：`api/e2e/push-queue/route.ts:86,230`、`api/invitations/route.ts:56,166`、
    `api/stripe/checkout/route.ts:58,68`、`api/webhooks/stripe/route.ts:256,263`、
    `dashboard/admin/page.tsx:47,50,53`、`dashboard/team/page.tsx:110`。C08 看不见它们（判据是断言），
    要么把门禁扩成「awaited 查询结果必须绑定 `error` 或使用它」，要么单独一条——扩之前先量误报

21. C09 会话读取的错误通道（`auth.getUser()` / `getSession()` / `getClaims()`）：C08 的**同形状邻居**，
    只是数据源从 PostgREST 换成 Auth——**这个客户端也是把失败装在 `error` 里返回而不是抛出**，所以
    「连 `error` 都不取」在这里同样会把一次基础设施抖动说成一个关于用户的事实。
    读数（2026-09-24，AST 扫 `src/**` 非测试文件；判据：调用形如 `supabase.auth.getUser()`、结果做解构绑定、
    绑定成员里没有 `error`）：**62 处**，其中 **1 处绑定 `error`**（`src/app/auth/callback/page.tsx`）、
    2 处不是解构绑定（`reset-password-form.tsx`、`dashboard/settings/page.tsx`，都当布尔用）。
    剩下 59 处按下游第一个 `if (!user)` 分支答复什么归类：**39 处答「没登录」/401**、**4 处 redirect 到登录页**、
    **1 处返回 null**（`actions/team.ts` 的 `getCurrentTeam()`，调用方据此回答 `noTeam`——「你没有团队」
    也是读出来的事实）。**没有一处把 `error` 当成「已登录」**，路由层同样是 fail-closed
    （`src/proxy.ts` 里 `isProtected && !user` 一律重定向登录页），所以这条不是 P0。
    第二遍判读换了判据（下游 45 行内「有没有自己的判空」vs「有没有 `user!.` 强解引用」），
    并且是在本 PR 修完守卫层之后量的（`main` 上 62 处，这里 61 处）：**45 处有自己的判空**（上面那三档）、
    **8 处没有判空却直接 `user!.id`**（`dashboard/page.tsx`、`billing`、`notifications`、`profile`、`projects`、
    `projects/[id]`、`settings`、`team` —— 读失败时抛 `TypeError` 由错误边界兜住：不是撒谎，
    但是一次没有分类的崩溃，修法和守卫层同一形状——先判空、再答「暂时不可用」）、
    **3 处两者都没有**（`api/auth/callback/route.ts`、`hooks/use-user.ts`、`lib/supabase/middleware.ts`：
    前两处把 null 当合法值往下传，第三处只是把 `user` 交回 `proxy.ts` 做重定向判定，方向仍是拒绝）。
    还有一处形状不同：`actions/audit.ts` 用 `user?.id ?? null` 直接落审计表——**「读不到会话」与
    「失败登录时本来就没有会话」在 `user_id` 这一列上完全同形**，而取证时这是两件相反的事；
    本条已修（审计照写，但 metadata 打 `sessionReadFailed`，见 CHANGELOG）。
    **已收口的部分**：守卫层（`src/lib/auth/guards.ts`）改走 `readSessionUser()`，`requireAuth/Role/Permission`
    与三个 `safely*` 变体全部受益，`guardHttpStatus` 的 503 一档由本池的 C08 早就备好；
    审计侧 `actions/audit.ts` 打上 `sessionReadFailed` 标记；两个登出按钮读 `signOut` 的 `error`；
    恢复码自救读 `listFactors` / `deleteFactor` 的 `error`，并把扣码挪到解绑成功之后。
    **按「这个文件在几条在审 PR 里被动过」量的零重叠口径**（2026-09-24 重跑，41 条 open PR 全部本地可测、
    无一条取不到对象；判据 = `git diff --name-only <merge-base origin/main <head>> <head>` 对文件全名匹配，
    也就是**把栈上 PR 下游带来的改动也算进去**的保守口径——只看单个 PR 自己的 delta 会把 `notifications/page.tsx`
    从 18 条读成 1 条，那样选站点会选错）：C09 的站点里只有 `actions/recovery-codes.ts` 是 **0 条**，
    所以本条只收它。同一把尺下 `guards.ts` 20 条、`logout-all-button.tsx` 1 条（就是 #92 自己新建的）。
    **射程随后从 `getUser/getSession` 扩到整个 Auth 客户端**（同一条判据：`await x.auth.<method>()`
    的结果有没有绑定并使用 `error`）：**90 处** awaited 调用里 **27 处绑定**、**63 处不绑定**；
    不绑定的按方法分：`getUser` 55、**`signOut` 4**、`admin.mfa.listFactors` 1、`admin.mfa.deleteFactor` 1、
    `refreshSession` 1、`getSession` 1。**`signOut` 那一档方向最坏**——两个承诺「所有设备 /
    其他设备登出」的按钮过去无条件往下走，Auth 抖动时**在没登出的情况下报告已登出**
    （一个把用户送去登录页，一个把界面切成完成态，而后者正是共用电脑上要防的那件事）；
    **本条已修**：读 `error`、失败留在原地给可重试文案（`logoutAllFailed` / `signOutOthersFailed`）。
    **`admin.mfa.*` 那两处是同一个调用点**——`actions/recovery-codes.ts` 的 `redeemRecoveryCode` 用
    `listFactors` + `deleteFactor` 解绑该用户的全部 TOTP 因子。它比 `signOut` 那一档更糟，因为这里抹掉的
    不是一个可以重试的提示，而是一次**不可逆的扣减**：原次序是「扣恢复码 → 写审计 → 解绑」，恢复码一次性、
    扣掉回不来，而解绑失败只出现在返回的 `error` 上（`listFactors` 那处连绑定都没有），于是动作照样回
    `{ ok: true }`——用户烧掉了唯一的自救码，并且仍然被锁在**他丢掉的那把验证器**后面，也就是这条功能
    存在的理由没有被解决、还少了一次重试机会。现在次序反过来：**先解绑、成功后才扣码**，两步的 `error`
    都读，任一失败记日志并回 `recoveryUnenrollFailed`（en / zh-CN 各一条，文案明说码没有被扣、可以重试）。
    偏向保守一侧的代价只是一次失败的兑换把码留在库里；「账号本来就没有 TOTP 因子」是合法状态，照常扣码。
    **这是目前 C09 里唯一一处「抹掉 `error` 之外还要靠调顺序才能修」的站点**，其余都是补绑定 `error` 即可。
    **同一次重叠测量里剩下的 0 重叠站点也收了**（`site-header.tsx`、`api/auth/callback/route.ts`、
    `hooks/use-user.ts`、`lib/supabase/middleware.ts` 各 **0** 条；`app/auth/mfa/page.tsx` 是 **1** 条 = #119）：
    ①`components/layout/site-header.tsx` 的 `handleSignOut` 丢掉 `signOut()` 的返回值后照样跳首页——
    入口比设置页那两个按钮更常被打到，读 `error`、失败弹可重试 toast（`common.signOutFailed`）；
    ②`api/auth/callback/route.ts` 在 `exchangeCodeForSession` **成功之后**再 `getUser()`，那一处不取 `error`
    就把 `user?.id ?? null` 落审计——一次确实成功的登录被写成没有主人，与「失败登录时本来就没有 session」同形。
    改成绑定 `error` + metadata `sessionReadFailed` + `logApiError`（跳转方向不动：拦一次已经成功的登录
    不是这条路由的职责），并补上该路由的第一份测试（4 条用例）。
    **两处量完之后不改，理由各不相同**：`hooks/use-user.ts` 的修法要么改钩子契约
    （`{ user, loading }` → 多一个「没读到」），要么在三个消费者里判空——三个文件都是 0 重叠
    （`use-is-admin.ts`、`use-unread-notifications.ts` 各 0），但这不是补一处 `error` 绑定的形状，
    是一次接口决定，方向上也全是拒绝侧（头像是登出态、`useIsAdmin()` 为假、未读数为 0），所以留在这里等决定。
    `lib/supabase/middleware.ts` **这条判据在它身上不成立，理由是它答的其实不是同一个问题**：
    那里的 `getUser()` 走的是**浏览器带来的 cookie**，读失败最常见的成因就是「这份会话已经不再有效」
    （access token 过期且刷新失败、token 被撤销）——对中间件而言那不是基础设施抖动，而是关于用户的真事实。
    所以 `user = null` → `proxy.ts` 重定向登录页**是正确答案**；把「error」单独拎出来放行，
    会把一次普通的过期会话变成一个错误边界页。它不该进债务清单，该记在这里——`proxy.ts` 本身也是 0 重叠，
    也就是说不动它不是因为动不了，是因为动它会把对的行为改错。
    `lib/auth/passkey-session.ts:72` 是 magic link 校验失败后的清理，`.catch(() => undefined)` 之后
    照样 throw，属于**已判定**的吞掉而不是漏看；`app/auth/mfa/page.tsx:85` 的 `refreshSession`
    在 `try` 里、外层 catch 读的是**异常**而不是 `error` 对象，「服务端返回 `error`」这条路径会静默往下走——
    它要连 MFA 流程一起判，单独改一处会把成功路径改坏，而且 #119 正在改这个文件。
    **那 8 处 `user!.id` 现在不能动，原因是重叠而不是难度**（2026-09-24 量的：逐条 open PR 的
    `git diff --name-only <merge-base origin/main <head>> <head>` 对文件全名匹配，即上面那条保守口径）
    ——`dashboard/notifications/page.tsx`
    与 `profile/page.tsx` 被 **18 条**在审 PR 各自改过，`billing`、`team` 14 条，`page.tsx` 5 条，
    `settings` 4 条。也就是这一批改法会同时在整条 C08-c 栈上造出 8 条需要作者出场的边。
    时机是**等那批 PR 落地之后**，按同一形状（先判空、再答「暂时不可用」）一次收完。
    **暂不接门禁**，理由与 C08-c 同源：合法状态（确实没有会话 → 回落登录页是对的）与「没读到」在 AST 上
    都只是「没取 `error`」，先接会把正常写法一并点掉；先照 C08-b 的办法立台账再逐文件偿还。
    两个已知消费者不在本条射程：`api/analytics/route.ts` 与 `api/stripe/checkout/route.ts` 现在仍把
    守卫失败一律写成 401，那两处分别由 #103（analytics，#44 前半）与 #96（checkout）处理。
    顺带一条治理观察，不在本条范围内但记下来免得重新发现：**本池的序号已经不复用不行了**——
    C08 / C08-b / C08-c 在源码里占 18 / 19 / 20，而 D01 / D02 / D03 也是 18 / 19 / 20（本条写作 21，
    与 D04 撞号）。渲染时有序列表按位置重编号，所以只有源码读者会被误导；引用一律用 ID（C09、D04），
    别用序号。要不要给任务池加一条「ID 唯一 + 序号不撞」的门禁，等有第二次踩到再说。

### D. 文档事实与治理（来自 I01 与退出报告的文档矛盾清单）

18. D01 （**2026-09-22 已完成，范围按实测收窄**）：`pnpm check:cron-contract` 现在核对
    `docs-site/**` 与 `docs/**` 里的 cron 表达式与 `/api/cron/*` 路径是否真的存在于仓库
    （注册表 ∪ `vercel.json` ∪ workflow `schedule`），带日期的快照排除，抽不到文档即失败封闭；
    表达式抽取与 D02 共用同一个函数。**没有**做环境变量名与表名/迁移号两类：
    前者要求 feature flag 名能识别 `flag("PASSKEY")` 这类组合写法与前缀（`NEXT_PUBLIC_FEATURE_*`），
    后者要和 SQL 关键字、平台变量名做停用表，两者都是先量到误报才有依据的扩展，
    留作后续按需追加，而不是第一版就把门禁做成噪音
19. D02 （**2026-09-22 已完成**）双语一致性最小检查：同一页面的 EN/zh 若提到 cron 表达式或
    `HH:MM UTC` 时刻，两边集合必须完全相等（一边提到一边没有也算失败）。落地为
    `pnpm check:bilingual-docs`（规则 `src/lib/docs/bilingual-facts.ts` + IO + CI/check:all 接线）。
    接线时当场查出三处存量漂移并修掉：`docs-site/web-push.md` 英文版的「every 15 minutes」
    （`vercel.json` 早于 2026-09-21 改为 `0 22 * * *`）、`docs-site/v0.8.0.md` 双语互相矛盾、
    中文版缺 cron 表达式。故意不比对文案（"hourly" vs「每小时」这类同义表达经实测误报率高，
    会把门禁退化成翻译质量检查），只比对结构化事实
20. D03 （**2026-09-22 已完成**）：`docs/operations/release-gap-audit-v0.11.0.md` 补上断档的系列，
   `docs/operations/release-audit-template.md` 把退出报告/缺口审计共用的判定规则写成可复用模板
   （三档状态各要什么证据、「文档已写」不算证据、门禁自身要做变异复核、范围由 CHANGELOG 章节生成、
   「代码合并 / 已部署 / 已发布 / 演练过」四件事不得互相冒充）。
   审计当场量出三处口径问题并如实记录：runbook 声称范围内有 5 项其实更早就完成了、J06 只做到
   「无副作用 6/6 + 只读 3/6」，而整个 D 域（5 道 i18n/a11y 门禁 + 逻辑方向迁移）交付了却没进范围段；
   另外记录 `D01` 这类编号在 v0.6.0 池与 v0.12.0 池含义不同，引用必须带池子名。
   防断档机制：`.github/RELEASE_CHECKLIST.md` 的文档段新增一条「本版本缺口审计已按模板产出」，
   由人工在冻结时勾选（`check:release-docs` 按版本拼路径，本来就无法强制这个系列存在）
21. D04 （**2026-09-22 已完成**）清除剩余文档里的易漂移数字，统一改为「指向命令」或「指向门禁输出」：
    `docs/testing.md` 的规则文件单测条数全部去掉、约定显式扩展到「局部计数」，覆盖率阈值改指
    `vitest.config.ts`；扫描中另发现两处**已经错了**的陈述并修掉（`supabase db reset` 示例注释
    写「25 个迁移」而仓库当时 33 个，出现在 `docs/testing.md` 与 `docs/db/security-audit.md`），
    `docs/db/security-audit.md` 的门禁状态段改为列类别不列数量。
    **保留不动的**：历史版本页（`docs-site/v0.*.md`）、roadmap 与退出/演练/Runbook 记录里的数字——
    那些是带日期的证据而非当前断言；service-role 清点表保留为快照，但已在其上方与开头标注
    「以 `pnpm check:supabase-security` 与清单文件为准」

## 里程碑

| 里程碑 | 内容                                   | 任务域 |
| ------ | -------------------------------------- | ------ |
| M1     | 通知投递语义定案并修到「正常运行为 0」 | A      |
| M2     | 发布与演练证据闭环                     | B      |
| M3     | mock 请求级隔离与并行基线              | C      |
| M4     | 文档事实门禁与版本收口                 | D、B01 |

## 退出标准（全部满足方可发布 v0.12.0）

1. A01–A04 完成（A01/A02/A04 已于 2026-09-22 收口）：摘要在真实调度周期内每人至多一封、
   且 `sent=0 而 pulled>0` 的轮次要么为 0、要么有明确解释；跳过类分支一律带可见性指标。
2. B01、B02 有执行记录（UTC 时间、命令、状态码、artifact 指纹或 deployment id），
   「演练记录」小节不再是空模板。
3. C01、C02 完成：mock 状态（含 MFA）的隔离边界只剩 store 一处，且 CI 里有一份全量并行的运行记录。
4. `pnpm check:all`、`pnpm verify:build`、`pnpm test:e2e` 全绿，覆盖率阈值不降低
   （地板见 `vitest.config.ts`）。
5. 新增或改动的门禁都要能通过「故意做坏」的变异测试变红——一个永远不会失败的门禁比没有门禁更糟。
6. D01、D02 落地：docs-site 中与调度/环境变量有关的事实由门禁守住，不再靠人工订正。

## 风险

- B 域全部依赖外部权限（Vercel 部署与 build 配额、云端 Supabase 凭据、可牺牲的隔离账号）。
  若权限未到位，v0.12.0 不得因为「代码都改了」而宣布退出标准达成。
- ~~C02 一旦解锁并行，历史共享状态缺陷会一次性暴露，需要预留排障时间。~~ **已发生并按预期处理**：
  解锁并行（一个 worker 一台服务器）后首跑红 4 条，全部归因到进程级共享 store；清零后又红过 3 条，
  归因是冷编译计时而不是状态。两种红分开记录，见 C02 与 run `35727094401` / `35746785602`。
- A01 无论选哪条路都会改变用户可感知的发送时刻，需要同时改 docs-site 与告警文档的期望值。
