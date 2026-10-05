# v0.12.0 回滚 Runbook

> 回滚优先恢复服务，**不自动回滚数据库**。数据库逆向迁移可能造成数据丢失，必须经过 DBA 与发布负责人共同决定。
> 通用流程见 [migration-rollback-runbook.md](./migration-rollback-runbook.md)；本文件只写 v0.12.0 的差异。

## 触发条件

触发条件包括：持续 5xx、认证/上传/删号关键路径不可用、数据完整性风险、迁移导致请求失败、
错误率超过发布前基线两倍且持续 5 分钟，或 health check 连续失败。

v0.12.0 特有的两类形态（其余沿用 v0.11.0）：

- **digest worker 卡在队列**：`pulled=100, sent=0` 且 `email.backlog` 单调上升。
  这正是 A05 要修的症状——若它**在发布后出现**，说明迁移 034 未 applied 而代码已部署
  （worker 在 `.update({ email_skipped_reason })` 上抛错），**回滚应用即可**：
  旧代码不写也不查这一列，队列恢复原状。详见「数据库向前兼容」。
- **存活探针与就绪探针被误用**：若容器编排层被改成用 `/api/health` 做存活检查，
  一次 Postgres 抖动就会触发**容器重启**。恢复办法是把 `Dockerfile` 的 `HEALTHCHECK`
  指回 `/api/health/live`，**不是**回滚应用版本。

## 决策树

1. **代码回滚即可修复**：将部署平台切换到上一个已验证 deployment；保留当前数据库 schema，
   确认旧代码能兼容 034 的最终态（见下「数据库向前兼容」）。**这是本版本的首选止血手段。**
2. **迁移 034 未 applied 而代码已部署**：回滚应用 deployment，数据库不动；
   然后按 [migration-rollback-runbook.md](./migration-rollback-runbook.md) 补应用 034，再重新部署。
   不要为了绕过这个错误去改代码里的列名或去掉该列。
3. **仅邮件/provider 故障**（Resend、Stripe、Sentry 之一不可用）：保持应用版本，
   关闭对应 provider 开关，启用已验证 fallback；**不要为了外部服务故障回滚无关代码**。
   本版本的生产环境本就未配置 `RESEND_API_KEY` / `STRIPE_SECRET_KEY` / `NEXT_PUBLIC_SENTRY_DSN`，
   也就是说这三条链路回滚前就已经是空转的——**它们的故障不能作为回滚本版本的理由**。
4. **A05 的跳过率异常升高**：`cron.digest.skipped{reason}` 或按原因的计数上升本身**不是故障**
   （A05 之后跳过率必然上升，原来那些行是卡在队列里而不是被判定为不可投递）。
   只有当 `email.backlog` 上升且 `pulled=100, sent=0` 时才是故障（见第 2 条）。
5. **数据损坏或误删**：立即停止相关 worker，按第 1 条回滚，保留日志与数据库快照，
   按备份恢复演练流程处理，并记录影响范围；**只有用户/负责人明确授权后**才执行 PITR。
6. **仅部署新鲜度检查变红**：不回滚。该检查量的是「生产落后 main 多少个提交」，
   超阈值说明部署没跟上（常见原因是 Vercel 构建配额限流），处理方式是等配额恢复或重新触发部署。

## 操作步骤

```bash
# 记录当前状态（先保存，不要覆盖证据）
date -u
curl -fsS "$PRODUCTION_URL/api/health" > /tmp/indiestack-health-before-rollback.json
curl -fsS "$PRODUCTION_URL/api/health/live" > /tmp/indiestack-live-before-rollback.json
supabase migration list --linked > /tmp/indiestack-migrations-before-rollback.txt   # 只读
# 在部署平台选择上一个已验证 deployment / commit SHA
# 回滚后再次执行
a=0; while [ "$a" -lt 3 ]; do curl -fsS "$PRODUCTION_URL/api/health"; a=$((a+1)); sleep 10; done
pnpm health:check -- "$PRODUCTION_URL"
# 本版本特有的新鲜度核对：确认回滚后的生产确实在预期的旧提交上
pnpm ops:deploy-freshness --base-url "$PRODUCTION_URL" --main <回滚目标提交>
```

实际平台切换必须由有权限的发布人员执行；命令中的 URL、deployment ID 和输出必须写入 incident 记录。

## 回滚后验证

- `/api/health` 返回成功且 `version` 与 `commit` 符合预期（回滚到 `0.11.0` 时应报告
  `version=0.11.0`）；**注意 `0.11.0` 的 commit 是 `08dd6f17`**，不要凭记忆写 SHA，
  以回滚前保存的 `/tmp/indiestack-health-before-rollback.json` 为准。
- `/api/health/live` 返回 200，且响应体**不含** `checks`/`version`/`commit`/`uptime`
  （若含，说明两端点又被合并了，容器重启问题会回来）。
- `supabase migration list --linked` 显示 001–034 全部 applied，无半完成迁移；
  `pnpm check:migrations` 与仓库 manifest 一致。
- **digest worker 恢复**：`pnpm smoke:production` 全绿，且队列指标回到回滚前形态
  （回滚后 `email.backlog` 会停止按 A05 的方式清空——这是**预期**的，因为旧代码没有那套语义）。
- 5xx、延迟、队列积压恢复到发布前基线；新写入和后台 worker 没有重复执行。
- 至少一条关键业务 smoke test 通过。
- `pnpm ops:deploy-freshness` 对回滚目标提交的读数为 `fresh` 或在阈值内的 `lagging`
  （**故意断言一个更旧的提交是有意义的**：这能证明 `--main` 参数确实在比较指定的基准，
  而不是碰巧返回 0）。

## 数据库向前兼容（迁移不兼容时的前向修复迁移）

**首选永远是不动 schema 的代码回滚。** 只有当旧代码无法在当前 schema 上正确运行时，
才考虑**前向修复迁移**：再写一条迁移把数据库推到**新**代码能用的状态，
而不是把数据库退回旧代码期望的样子。理由是逆向迁移会丢数据
（`034` 的逆向尤其危险，见下），而前向修复迁移只追加、不删除。

判定顺序（本版本）：先试第 1 条纯代码回滚 → 不行才评估前向修复迁移 →
**任何情况下都不要执行已基线化迁移的 `down` SQL**。

`034_email_skip_reason.sql` 是**追加式**变更，回滚应用、保持数据库向前 schema 是安全的：

- 它给 `notifications` 增加一个**可空**列 `email_skipped_reason` 与一个 CHECK 约束。
  旧代码既不写也不读这一列，多出来的列对旧读写路径无影响。
- **绝对不要逆向执行这条迁移**：该列的语义是「这行已经离开待发队列，
  原因是不可能寄出去」，而不是「哪一次发送失败了」（后者由
  `metadata.email_attempts` / `email_error` 与死信门槛表达）。
  把非空值清掉或删列，会让已经离开队列的通知**重新显得还在队列里**，
  A05 的面板计数随之失真——**回滚代码不等于回滚数据**。
- 该迁移已进 `supabase/migration-manifest.json` 基线。删除或改写已基线化的迁移文件会让
  `pnpm check:migrations` 失败，**也不是回滚手段**。

## 演练记录

**（空）** —— 本版本尚未做过真实的生产回滚切换演练。

这不是疏漏，而是边界：回滚演练需要一次**真实的生产部署切换**（Vercel deployment 回切），
而 v0.11.0 周期已证明「跨迁移边界的真实生产回滚证据」在本项目里仍缺一块
（当时的记录在 `docs/operations/rollback-runbook-v0.11.0.md`，其回滚**不跨迁移边界**，
因此不能用来证明本版本的回滚路径可用）。

**没有证据就等于没做**，所以这里留空而不是抄上一版的记录。
补齐它需要：Vercel 部署切换权限 + 一个非高峰窗口 + 本版本的迁移已在云端 applied。