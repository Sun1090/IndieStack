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

