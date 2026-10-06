# v0.12.0 发布 Runbook

- 适用范围：本仓库 v0.12.0（`package.json` 版本 `0.12.0`，CHANGELOG 章节日期 2026-10-05）
- 基线：v0.11.0（2026-09-22）
- 退出标准核对：`docs/operations/release-exit-report-v0.12.0.md`（逐条核对，含每条的可复现来源）

## 发布前入口条件

1. `pnpm install` 成功，且 `pnpm verify:build` 全绿。**这一步必须在发布分支上跑**——
   它含 `lint`、`type-check`、`test`、`check:all`、`build`、包体积与 sourcemap 检查，
   是发布前唯一一次把全部门禁串起来的机会。
2. `pnpm test:e2e` 全绿（Playwright）。E2E 单独跑，不含在 `verify:build` 里。
3. `pnpm audit` 无 high/critical 漏洞。
4. **迁移已先于应用部署应用到云端项目**（本版本有 `034_email_skip_reason.sql`，见下）。
5. `CHANGELOG.md` 有 `## [0.12.0]` 章节，`pnpm check:changelog` 通过。
6. `pnpm check:changelog-tags` 通过——本版本**刻意不打 tag**（理由见 tag 台账），
   所以这一条要绿的是「登记已存在」，不是「tag 已存在」。
7. 工作树干净，且分支已 rebase 过 `origin/main`。

## v0.12.0 相对 v0.11.0 的差异

v0.12.0 的范围是「把已经接上的线真正跑通一次，并留下证据」：通知投递语义（A 域，
A01–A05）、发布与演练证据闭环（B 域，B01–B05）、mock 请求级隔离与并行基线（C 域，
C01–C02）、文档事实门禁与版本收口（D 域，D01–D02）。

1. **本版本含一条数据库迁移：`034_email_skip_reason.sql`，因此迁移必须先于应用部署
   （DB-first）。** 与 v0.11.0 的 `032`/`033` 同性质，但**这次的失败面更大**：
   迁移给 `notifications` 加了可空列 `email_skipped_reason`，而新代码会**写它也会查它**——
   digest worker 在两个跳过分支上 `.update({ email_skipped_reason })`
   （`src/lib/repositories/notifications.ts:200`），A05 队列诊断面板按它做分组计数
   （同文件 `countEmailSkippedByReason`）。**若在未应用 034 的环境上先部署代码，
   digest worker 会在跳过分支上抛错**，队列随之卡住；A05 面板会整块报错。
   这是本版本唯一的 DB-first 硬约束，发布顺序不能反。

   **先复核再发布**（需要 Supabase 凭据；本机没有时**不要跳过这一步直接部署**）：
   ```bash
   supabase migration list --linked            # 期望 034 出现在 applied 列表末尾
   supabase db push --linked --dry-run         # 期望输出为空
   ```

2. **`/api/health` 拆成两个端点，Docker HEALTHCHECK 改指 liveness。**
   `/api/health` 是**就绪探针**（打 Postgres、返回逐依赖明细与 `commit`），
   每日保活 cron 与人工核验走它；`/api/health/live` 是**存活探针**
   （不打 DB、不读配置、不返回 `version`/`commit`），Docker `HEALTHCHECK` 走它。
   拆分理由：容器健康检查每 30 秒一次，原先每次都打一次 DB，
   **一次 DB 抖动就会被 orchestrator 判成容器已死并重启它**。
   发布后观察：`/api/health/live` 应始终 200 且**响应体里没有**
   `checks`/`version`/`commit`/`uptime`；冒烟第 7 步会断言这一点，
   若两端点被重新合并，冒烟会红。

3. **通知投递语义已定案并落地（A01–A05）。** 其中 A05 的产品决策是
   **「站内已读 = 不必寄」**：用户已在站内读过该通知，就不再发邮件。
   A05 的另一半由迁移 `034` 承载（见上一条）——「根本不可投递」的邮件通知
   现在显式离开待发队列并记原因，而不是永远占住队首导致
   `pulled=100, sent=0`。**观察窗口新增 `email.backlog` 与按原因的跳过计数**，
   以及 `cron.digest.skipped{reason}`：A05 后跳过率会**上升**，这是预期的
   （原来那些行是卡在队列里而不是被判定为不可投递）。

4. **Sentry 上报失败不再静默。** `src/lib/logger.ts` 原先对上报失败 `.catch(() => {})`，
   于是「监控挂了」这件事本身也是静默的。现在会留一行 stderr 并打
   `sentry.report.failed` 指标。**注意：生产仍未配置
   `NEXT_PUBLIC_SENTRY_DSN`**（见 `docs/operations/environments.md` 的外部依赖实况表），
   所以这条链路目前**不产生任何告警**——本次发布不改变这个事实。

5. **新增两条运维门禁与一条冒烟步骤。**
   - `pnpm ops:deploy-freshness`：量「生产落后 main 多少个提交」，
     超过阈值（默认 5）失败。**刻意量距离而不是断言相等**——
     部署滞后是常态，断言相等会天天误报。
   - `pnpm drills:preflight`：判定 B03/B04/B05 的外部前置是否齐备。
     **退出码 0/1/2 里没有「演练通过」**——这个命令只回答「还缺什么」，
     别把它的 0 当成演练已通过。
   - 冒烟从 6 步增至 7 步（新增 liveness）。

6. **未变化的既有约束**（发布时不要重新评估）：Vercel Hobby 的 cron 预算仍是每路径每天一次
   （`digest` 09:00 UTC、`push-retry` 22:00 UTC、`retention`、`supabase-restore`），
   `pnpm check:cron-contract` 会拒绝任何「每天多次」的表达式；本版本未新增 cron 路由。
   service-role 边界与 v0.11.0 相同，`pnpm check:supabase-security` 的模块/调用点计数未变。

## 发布步骤

```bash
git fetch origin
git rebase origin/main                       # 功能分支必须先 rebase
pnpm verify:build                             # 必须在 rebase 之后跑
pnpm test:e2e
pnpm audit
```

推送并走 PR，**不要直接推 `main`**。合并后按顺序：

1. 确认云端迁移已 applied（见上一节第 1 条的命令）。
2. 等生产部署完成，取实际 commit：
   ```bash
   curl -sS https://indie-stack-theta.vercel.app/api/health | head -c 400
   ```
3. 用**实际 commit** 跑生产冒烟（不要用 `git rev-parse HEAD`，那会断言一个还没部署的提交）：
   ```bash
   pnpm smoke:production --expected-commit "<上一步读到的 commit>"
   ```
   期望 7/7 全绿。
4. 核对部署新鲜度（预期此时应为 0 或极小）：
   ```bash
   pnpm ops:deploy-freshness --base-url https://indie-stack-theta.vercel.app
   ```

## 打标签与发布说明

**本版本不打 tag**，这是刻意决定而非遗漏。理由：`docs/operations/release-tag-ledger.md`
记录了 tag 的前置是发布证据闭合，而 **B03（隔离账号的账户删除全链路演练）仍缺外部凭据**。
打 tag 是对外声明「做完了」，**没有证据就等于没做**。
该决定已登记在 `MISSING_TAG_LEDGER`（`src/lib/release/changelog-tag-reconciliation.ts`），
由 `pnpm check:changelog-tags` 强制对账：B03 闭合、tag 补上之后，
必须回头删掉那条登记，否则门禁会红。

若将来 B03 闭合并决定补打 tag：notes 必须来自 `CHANGELOG.md` 的 `[0.12.0]` 章节
（`pnpm check:release-tag` 会校验，禁止 `--generate-notes`）。

## 停止条件

出现下列任一情况，**停止发布并回退到功能分支**，不要在 `main` 上修：

- `pnpm verify:build` 或 `pnpm test:e2e` 任一红。
- 云端迁移列表里 034 不是 applied（→ 先迁移，别先部署）。
- 生产冒烟 7 步里任何一步红，或用**上一个已部署的 commit** 冒烟也红
  （后者说明问题不在本次改动）。
- `/api/health` 返回 `ready=false`，或 `supabase` 依赖项 `status != ok`。
- 部署后 `cron.digest.skipped{reason}` 或 `email.backlog` 出现**与 A05 语义矛盾**的读数
  （例如 `email.backlog` 单调上升且 `pulled=100, sent=0`——那正是 A05 要修的症状没修掉）。

## 发布记录（2026-10-05 实际执行）

```text
版本：0.12.0
发布 commit（main）：5cdbf0cb812e87f8f920870bfec421661471eafa（PR #224 rebase 合并）
生产部署 commit：5cdbf0cb812e87f8f920870bfec421661471eafa（从 /api/health 读出）
生产冒烟：7/7（UTC 2026-10-05T23:52Z，--expected-commit 断言通过）
部署新鲜度：fresh（距离 0；发布前曾因 Vercel 配额报「落后 6 → 红」）
/api/health/live 直连响应体：{"status":"ok","timestamp":"…"}（无 checks/version/commit）
迁移：034 云端 applied 状态 **本机未复核**（无 Supabase 凭据）——见「冻结状态」第 5 条
tag：未打（理由见 release-tag-ledger.md）
回滚：见 rollback-runbook-v0.12.0.md（其「演练记录」仍为空）
```

## 冻结状态与未完成步骤（2026-10-05）

- **未打 tag**：见上一节，理由是 B03 缺外部凭据。
- **B03 未闭合**：需要 `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` /
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` 与一个**可牺牲**的隔离账号。
  `auth.admin.deleteUser` 不可逆，**禁止用真实用户演练**。
- **B04 / B05 的 P2–P4 未闭合**：B04 缺数据库密码（平台令牌早已具备），
  B05 的 P2–P4 需要 Resend 测试 key、VAPID 一对与可牺牲项目。
- **生产未配置 `RESEND_API_KEY` / `NEXT_PUBLIC_SENTRY_DSN` / `STRIPE_SECRET_KEY`**：
  邮件、告警、支付三条外部链路在生产上是空转的。这些是外部凭据，不是代码问题。
- **跨迁移边界的真实生产回滚证据**仍不存在（`rollback-runbook-v0.12.0.md` 的
  「演练记录」为空）。本次发布不制造它——回滚演练需要真实部署切换。
- **⚠️ 本次发布没有复核云端迁移 034 是否 applied**（本机无 Supabase 凭据，
  `~/.supabase/access-token` 不存在）。发布**侥幸**没出问题：digest worker 的跳过分支
  只有在真的有「无邮箱 / 偏好全关」的行时才会写到那一列，而生产当前没有这类数据。
  **但这是运气，不是验证**——一旦生产出现这类用户，worker 就会抛错。
  **补做这一条不需要新代码，只需要一个有 Supabase 凭据的环境执行两条命令**：
  ```bash
  supabase migration list --linked      # 期望 034 applied
  supabase db push --linked --dry-run   # 期望为空
  ```
  在此之前，`034` 未 applied 是一项**未被排除**的风险。

## 发布记录模板

```text
版本：0.12.0
发布 commit（main）：<sha>
生产部署 commit：<sha>（从 /api/health 读出）
生产冒烟：7/7（UTC 时间 <ts>）
部署新鲜度：<fresh | lagging N>
迁移：034 已 applied（复核命令与输出）
tag：未打（理由见 release-tag-ledger.md）
回滚：见 rollback-runbook-v0.12.0.md
```