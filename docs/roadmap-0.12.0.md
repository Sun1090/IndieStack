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

1. A01 digest 投递语义定案（需产品决策，三选一已在退出报告列出：放宽窗口 / 按时区带多条调度 /
   外部逐小时调度器）。验收：决策写进 `docs-site/{,zh-CN/}email.md` 与 `docs/db/retention.md`
   同级的运维说明，并给出**一条能证明「非 UTC-1 用户真的收到」的**执行证据
2. A02 按定案实现窗口或多调度，并把 `cron.digest.deferred` 从「能看到」变成「正常运行为 0」
3. A03 （2026-09-22 已核对，**push 链路没有同型缺陷**）：`src/lib/push-retry.ts` 与
   `src/app/api/cron/push-retry/route.ts` 里没有任何按小时/时区的门控（`grep -n "hour\|timezone\|local"`
   无命中），出队条件是单调的 `next_attempt_at <= now`（`repositories/push-delivery-attempts.ts:104`，
   按 `next_attempt_at` 升序取 50 条），到点的行不会因为调度时刻而永远落在窗口外；
   失败侧另有 `PUSH_MAX_ATTEMPTS` → `dead`/`revoked` 与 `push.delivery.dead`、`push.backlog` 兜底。
   **仍需盯的是 digest（A01）而不是这里**，本条按已完成收口
4. A04 为 A01 的定案补契约：新增纯函数规则（`src/lib/**`）+ 门禁或单测，使「窗口与调度不匹配」
   这类配置错误在 PR 阶段失败，而不是靠看板发现
5. A05 死信与积压的可操作路径：admin 面板能看到被窗口挡住的队列规模与最早一条的年龄

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

1. A01–A04 完成，且 `cron.digest.deferred` 在一个真实调度周期内为 0（或有明确豁免记录）。
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
