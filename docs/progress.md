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

