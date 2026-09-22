# IndieStack v0.12.0 Roadmap

> 主题：**把已经接上的线真正跑通一次，并留下证据**
> 基线：v0.11.0（2026-09-22 发布章节已冻结，生产仍是 `0.10.0`）→ 目标：v0.12.0
> 输入：`docs/operations/release-exit-report-v0.6.0.md`（v0.6.0 任务池 100 项的逐条核对结果，
> 含 7 项部分达成与 2 项未达成）与本文件下方的来源标注。
>
> **排期原则**：先做「没有证据就等于没做」的收口项（投递语义、发布证据、演练），再做隔离与门禁补强；
> 任何条目的完成都要留下可复现命令或执行记录，不接受「文档已写」。

> 任务名沿用领域前缀，但**不再与版本号绑定**：v0.6.0 的任务池一半是在 v0.7.0–v0.11.0 期间交付的，
> 而 roadmap 文件里的 `（完成：…）` 标注与开头的进度汇总无人维护，最后要靠一份退出报告重新核对
> （见退出报告「与 roadmap 文本的矛盾」）。因此本文件要求：状态只在退出报告里维护，
> roadmap 只写目标与验收口径。

## 任务池（20 项）

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
4. A04 补契约（A01 的教训泛化）：任何 cron worker 路由里**按用户条件跳过投递**的分支，
   都必须同时上报一个跳过计数指标——新增纯函数规则（`src/lib/**`）+ 接进 `check:cron-contract`，
   使「静默不投递」在 PR 阶段就失败，而不是靠看板发现
5. A05 死信与积压的可操作路径：admin 面板能看到未发送队列的规模、最早一条的年龄，
   以及「有队列但整轮 `sent=0`」的轮次（原因只会是无邮箱或偏好全关，两者都该看得见）。
   **2026-09-22 核对时补一条更要紧的事实**：被跳过的条目**永远出不了队列**——
   两个 skip 分支（`cron/digest/route.ts` 的 `!profile?.email` 与偏好过滤后 `filtered.length === 0`）
   都不调用 `markEmailSent`，也不调用 `markEmailFailed`，所以 `metadata.email_attempts` 不增长、
   达不到 `EMAIL_MAX_ATTEMPTS`（`repositories/notifications.ts:31`）的死信门槛；
   实时通道 `email-notify.ts:90-91` 对同样两种情况也是早退，条目会持续产生。
   后果：`listUnsentEmailNotifications` 是 `created_at` 升序 + `limit 100`
   （`repositories/notifications.ts:46-59`），这些永久不可投递的行会一直占住最前面的名额，
   攒够 100 条之后**新产生的、可投递的通知再也拉不到**，表现为每天 `pulled=100, sent=0`
   且 `email.backlog` 单调增长（阈值 500 的告警只说明规模、不说明原因）。
   本条因此包含一个决策：偏好关闭/无邮箱的行应当以什么语义出队
   （复用死信、新增 `email_skipped_reason` 过滤，还是拉取侧翻页跳过），
   三者都会改变 admin 面板与既有指标口径，不接受顺手用 `markEmailSent` 掩盖

### B. 发布证据闭环（来自 J06 / J08 / E09）

6. B01 在部署了 v0.11.0+ 的生产上复跑 `pnpm smoke:production`，把 6 项结果与 artifact 指纹写进
   `docs/operations/production-smoke-v0.11.0.md`（前置：Vercel build 配额与部署权限）
7. B02 执行一次真实回滚演练（切回上一 deployment、验证 health 与 schema 向前兼容），
   填 `docs/operations/rollback-runbook-*.md` 的「演练记录」——这是 v0.6.0 起从未闭合的 J08
8. B03 隔离账号上的账户删除全链路（真实 `auth.admin.deleteUser` + 真实 bucket 对象删除），
   替换目前用 `delete from auth.users` 的等价替代（记录在 `docs/db/retention.md` 的「仍未取得的生产证据」）
9. B04 云端 Supabase 上的保留期与擦除同型演练（把本地两份 `docs/operations/drills/*.sql` 在云端跑一遍）
10. B05 provider 与 incident 演练各一次：Resend 缺失/限流、Web Push VAPID 失效、Supabase 恢复链路，
    结论写进对应 runbook 的执行记录小节

### C. 测试与门禁基建（来自 F01 / F02 / F04 / J01 / C03 / A02 / A10）

11. C01 把 `createMockRequestStore` 真正接进 mock 的 client/query/auth（F02 的第二阶段），
    并把 MFA 的 `_mockMfaFactors` / `_mockMfaChallenges` 从进程全局搬进请求级 store（F01）
12. C02 在 C01 之后建立 `PW_FULLY_PARALLEL` 的**可复跑**并行基线（CI 里跑一次全量并行，
    而不是历史上的一次实验），失败则记录具体共享状态并回退
13. C03 （2026-09-22 组件层已完成：`src/app/auth/mfa/page.test.tsx` 13 条，并修掉抛异常时
    `loading` 不复位导致按钮永久卡住的缺陷。剩一条真实走挑战流程的 E2E——它需要 Mock 的 MFA
    状态在 E2E 之间可隔离，属 C01 的前置）
14. C04 （2026-09-22 已完成一半：`node scripts/check-bundle.js` 接进 CI Build job，`check:bundle` 的 CI 豁免随之删除，
    CI 现在覆盖 `verify:build` 的全部组件。剩余部分是可选的——把 CI 的逐个 `check:*` 步骤换成 `pnpm check:all`，
    让本地聚合与 CI 只有一份清单）
15. C05 孤儿巡检补上 provider 侧 `list()` 与数据库的集合差，覆盖 031 之前从未落元数据的存量对象
16. C06 定夺 `src/lib/actions/uploads.ts` 两个 Server Action：保留为编程入口（补调用方与文档）
    或删除（同步 service-role inventory、错误码门禁与 docs-site）

### D. 文档事实与治理（来自 I01 与退出报告的文档矛盾清单）

17. D01 把 docs-site 里**可机器核对的事实**纳入门禁：cron 路径与调度表达式、环境变量名、
    表名/迁移号。做法是给 `check:cron-contract` 增加「文档来源」参数，而不是新造一个门禁
18. D02 双语一致性最小检查：同一章节的 EN/zh 若都提到某个 `HH:MM UTC` 或 cron 表达式，两者必须一致
    （v0.6.0 的 I01 正是因为 EN 写「hourly」、zh 写「每天 09:00 UTC」而长期无人发现）
19. D03 补 `docs/operations/release-gap-audit-v0.11.0.md`（该系列在 v0.10.0 之后断了），
    并把退出报告的核对方法写成模板，供后续版本复用
20. D04 清除剩余文档里的易漂移数字（F09 覆盖率基线、G02 token 数、G04/H05 的测试条数等），
    统一改为「指向命令」或「指向门禁输出」

## 里程碑

| 里程碑 | 内容                                   | 任务域 |
| ------ | -------------------------------------- | ------ |
| M1     | 通知投递语义定案并修到「正常运行为 0」 | A      |
| M2     | 发布与演练证据闭环                     | B      |
| M3     | mock 请求级隔离与并行基线              | C      |
| M4     | 文档事实门禁与版本收口                 | D、B01 |

## 退出标准（全部满足方可发布 v0.12.0）

1. A01–A04 完成（A01/A02 已于 2026-09-22 收口）：摘要在真实调度周期内每人至多一封、
   且 `sent=0 而 pulled>0` 的轮次要么为 0、要么有明确解释；跳过类分支一律带可见性指标。
2. B01、B02 有执行记录（UTC 时间、命令、状态码、artifact 指纹或 deployment id），
   「演练记录」小节不再是空模板。
3. C01、C02 完成：MFA mock 不再依赖进程全局，且 CI 里有一份全量并行的运行记录。
4. `pnpm check:all`、`pnpm verify:build`、`pnpm test:e2e` 全绿，覆盖率阈值不降低
   （地板见 `vitest.config.ts`）。
5. 新增或改动的门禁都要能通过「故意做坏」的变异测试变红——一个永远不会失败的门禁比没有门禁更糟。
6. D01、D02 落地：docs-site 中与调度/环境变量有关的事实由门禁守住，不再靠人工订正。

## 风险

- B 域全部依赖外部权限（Vercel 部署与 build 配额、云端 Supabase 凭据、可牺牲的隔离账号）。
  若权限未到位，v0.12.0 不得因为「代码都改了」而宣布退出标准达成。
- C02 一旦解锁并行，历史共享状态缺陷会一次性暴露，需要预留排障时间。
- A01 无论选哪条路都会改变用户可感知的发送时刻，需要同时改 docs-site 与告警文档的期望值。
