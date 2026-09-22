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

