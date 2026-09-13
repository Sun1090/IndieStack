# v0.9.0 回滚 Runbook

> 回滚优先恢复服务，不自动回滚数据库。数据库逆向迁移可能造成数据丢失，必须经过 DBA 与发布负责人共同决定。

## 触发条件

触发条件包括：持续 5xx、认证/支付/上传关键路径不可用、数据完整性风险、迁移导致请求失败、错误率超过发布前基线两倍且持续 5 分钟，或 health check 连续失败。

## 决策树

1. **代码回滚即可修复**：将 Vercel/部署平台切换到上一个已验证 deployment；保留当前数据库 schema，确认旧代码能兼容新增列。
2. **迁移不可兼容**：先暂停写入或关闭受影响 feature flag，再恢复应用；不得直接执行 `down` SQL。
3. **数据损坏或误写**：停止相关 worker，保留日志和数据库快照，按备份恢复演练流程处理，并记录影响范围。
4. **仅 provider 故障**：保持应用版本，关闭 provider 开关，启用已验证 fallback；不要为了外部服务故障回滚无关代码。

## 操作步骤

```bash
# 记录当前状态（先保存，不要覆盖证据）
date -u
curl -fsS "$PRODUCTION_URL/api/health" > /tmp/indiestack-health-before-rollback.json
# 在部署平台选择上一个已验证 deployment / commit SHA
# 回滚后再次执行
a=0; while [ "$a" -lt 3 ]; do curl -fsS "$PRODUCTION_URL/api/health"; a=$((a+1)); sleep 10; done
pnpm health:check -- "$PRODUCTION_URL"
```

实际平台切换必须由有权限的发布人员执行；命令中的 URL、deployment ID 和输出必须写入 incident 记录。

## 回滚后验证

- `/api/health` 返回成功且版本符合预期；
- 匿名首页与登录流程可用；
- 最近一次迁移状态明确，无半完成迁移；
- 5xx、延迟、Sentry、队列积压恢复到发布前基线；
- 新写入和后台 worker 没有重复执行；
- 至少一条关键业务 smoke test 通过；
- 通知相关 provider 若被关闭，用户可见降级行为已记录。

## 迁移处理原则

迁移必须先做备份/快照并确认孤儿数据。只有存在经过测试的逆向迁移、明确的锁定窗口和 DBA 批准时才允许逆向迁移；否则采用前向修复迁移。每次回滚都要更新事故记录、CHANGELOG 的已知问题和后续修复 issue。

## 演练记录

- 演练日期（UTC）：
- 目标版本 / 回滚版本：
- 使用的 deployment：
- 数据库是否保持向前 schema：
- 检查结果与耗时：
- 失败点 / 改进项：
- 负责人 / 审查者：

## v0.9.0 回滚补充

本版本的五个迁移全部是追加式的，但其中**两个改变了应用与新 schema 的耦合方式**，回滚顺序必须区分：

### 迁移 027 `027_email_worker_runs_retention.sql`

- 纯新增：`cleanup_old_email_worker_runs()` 函数 + 可选 `pg_cron` 任务。回退应用后该函数不再被调用，
  数据库可保持向前 schema。
- 停止定时清理：`select cron.unschedule('cleanup_old_email_worker_runs');`（该任务名见迁移内守卫）。
  未安装 `pg_cron` 时无需处理。
- `email_worker_runs` 表本身自更早版本存在，数据不随回滚删除。

### 迁移 028 / 029 权限收口

- **不要**用回滚来"恢复"权限。这两个迁移收回了 `PUBLIC` / `anon` / `authenticated` 对
  `cleanup_old_*` / `log_audit_action` 的 `EXECUTE` 以及 `audit_logs` 的写权限，回滚代码不需要撤销它们；
  重新放开会恢复已知的越权写入路径。
- 若回滚后出现 `permission denied for function` 或 `permission denied for table audit_logs`，
  先确认调用方是否误用 anon/authenticated key，再走**前向修复迁移**收敛到 service_role 路径，
  而不是给客户端重新授权。

### 迁移 030 `030_webhook_event_idempotency.sql`（关键顺序）

- **不可用纯代码回退兼容**：新代码依赖 `claim_webhook_event()` 与 `(provider, event_id)` 唯一键；
  旧代码依赖旧的单列唯一键与"先副作用后 upsert"。**必须先回滚应用 deployment，再决定 schema**。
- 默认建议**保留 schema**：在应用回滚后，旧代码对 `webhook_events` 的 upsert 会因为唯一键变化而
  击中 `(provider, event_id)` 约束——若旧代码写入 `provider` 为空，可能报非空/唯一冲突。
  回滚决策必须由 DBA 与发布负责人共同确认；若确认要退回到旧约束，只能在锁定的维护窗口内以
  **前向修复迁移**重建旧唯一键（`drop constraint` + `create unique constraint`），并在迁移前
  去重 `(provider, event_id)` 冲突行。
- 真实故障恢复优先：若问题是副作用重复，正确做法是保留 schema，修 `claim_webhook_event()` 的占位
  逻辑并重发 Stripe 事件，而不是回滚唯一键。

### 迁移 031 `031_upload_objects.sql`（关键顺序）

- **不可先删表**：新代码的每次上传都会写 `upload_objects`，先删表会让所有上传返回 `uploadFailed`。
- 正确顺序：先回滚应用 deployment（`git revert` 服务层与仓储提交），确认上传路径不再写元数据，
  再（如确认长期不需要）执行 `drop table if exists public.upload_objects;` +
  `notify pgrst, 'reload schema';`。这是**破坏性操作**，会丢失孤儿巡检数据，必须经 DBA 与发布负责人
  共同批准并记录。
- 表内既有行的 `status='deleted'` 只是"应用认为已删除"，删除表**不会**删除 Storage bucket 中的实际对象；
  需要清理孤儿对象时走巡检流程而非 drop。

### 通用原则

- **前向修复优先**：若问题来自应用逻辑而非 schema，优先以**前向修复迁移/代码补丁**修复，而不是回滚数据库。
- 回滚期间停止相关 cron/worker，避免回滚后的旧代码读到新 schema 的中间状态。
- 每次回滚都要更新事故记录、CHANGELOG 的已知问题与后续修复 issue。
