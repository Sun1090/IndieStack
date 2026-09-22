## 2026-09-22 — 把 digest 的调度限制写进注册表本身，并核对 push 链路没有同型缺陷

- 里程碑 / 版本：v0.11.0 之后的 `[Unreleased]`；对应 v0.12.0 的 A03（核对）与 A01 的文档面。
- 状态：DONE。
- 分支 / commit：`docs/cron-cadence-truthfulness`（基于 main `82d24b0`）。
- 为什么做：`CRON_WORKERS` 的 `cadence` 是运维读 worker 时唯一会看的一行，digest 那里仍写着
  「每天 09:00 UTC 拉取一次，按用户本地时间错峰发送摘要」——**这句话读起来像已经做到了错峰**，
  而退出报告核对出的事实恰恰相反：每天一个固定 UTC 时刻只命中 UTC-1 时区带。同一句乐观描述也
  在 `sentry-alerts.md` 的调度表里。既然刚为这条修了指标，就把描述一起改对，免得下一个读者
  再靠看板反推一遍。顺带完成 v0.12.0 的 A03：push 链路是否有同型缺陷。
- 完成内容：
  1. `cron-contract.ts` 的 digest `cadence` 改为「只向本地时刻恰为 08:00 的用户发送；每天一次的
     调度意味着其余时区的条目每轮被跳过」，并在上方注释写明原因与指向 A01。
  2. `docs/operations/sentry-alerts.md` 的 `/api/cron/digest` 调度行同口径改写，并指向
     `cron.digest.deferred`。
  3. **A03 核对结论：push 链路没有同类问题**——`src/lib/push-retry.ts` 与
     `src/app/api/cron/push-retry/route.ts` 里没有任何按小时/时区的门控
     （`grep -n "hour\|timezone\|local"` 两个文件零命中），出队条件是单调的
     `next_attempt_at <= now`（`src/lib/repositories/push-delivery-attempts.ts:104`，
     按 `next_attempt_at` 升序取 50 条），到点的行不会因为调度落在哪个 UTC 时刻而永远错过；
     失败侧另有 `PUSH_MAX_ATTEMPTS` → `dead`/`revoked` 与 `push.delivery.dead`、`push.backlog`。
     结论已写进 `docs/roadmap-0.12.0.md` 的 A03，避免将来重复调查。
- 变更文件：4 个——`src/lib/observability/cron-contract.ts`、`docs/operations/sentry-alerts.md`、
  `docs/roadmap-0.12.0.md`、本条目。不改判定逻辑，只改描述与候选池状态。
- 验证命令与结果：`pnpm check:cron-contract` →
  `✅ 3 个 worker（digest、push-retry、retention）/ 15 个指标 / 调度表达式与 vercel.json 及运维文档一致 / 2 个平台级豁免`。
- 风险 / 回滚：纯文本；revert 即回滚。
- 下一项：v0.12.0 的 A01（digest 投递语义）仍是需要用户定方向的第一阻塞项。

