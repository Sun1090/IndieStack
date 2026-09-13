# 数据保留策略

> v0.4.0 D05 建立，v0.8.x 补齐 Push 队列与邮件 worker 运行记录（迁移 `027`）。
> 定时清理分两条链路：SQL 侧靠 pg_cron（迁移 `003` / `014` / `027`，守卫式调度，
> pg_cron 未安装的环境自动跳过，生产需在 Supabase Dashboard 确认扩展已启用）；
> 应用侧靠 cron worker 自身每轮回调（`/api/cron/push-retry`，无需 pg_cron）。

| 数据                                     | 保留期                                                  | 机制                                                        | 调度                    |
| ---------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------- | ----------------------- |
| notifications（已读）                    | 90 天                                                   | `cleanup_old_notifications()`（003 建）                     | 每周日 04:00            |
| notifications（未读）                    | 永久（用户手动标已读后进入 90 天窗口）                  | 同上                                                        | 同上                    |
| webhook_events（全部状态）               | 90 天                                                   | `cleanup_old_webhook_events()`（014 建）                    | 每周日 04:00            |
| email_worker_runs（digest 运行记录）     | 90 天                                                   | `cleanup_old_email_worker_runs()`（027 建）                 | 每周日 04:15            |
| push_delivery_attempts（`sent`）         | 7 天                                                    | `prunePushDeliveryAttempts()`（应用侧，worker 每轮调用）    | 每 15 分钟（cron 路由） |
| push_delivery_attempts（`dead`）         | 30 天                                                   | 同上                                                        | 同上                    |
| push_delivery_attempts（`pending`）      | 永久（失败重试的上限由 `attempt_count` + 死信状态约束） | 永不被清理（清理只按 `sent`/`dead` 状态与时间窗删除）       | —                       |
| audit_logs                               | 永久（合规需要，删改走变更流程）                        | 无自动清理                                                  | —                       |
| contact_messages                         | 永久（归档后手动清理）                                  | 无自动清理（E/J 域归档功能配套）                            | —                       |

## 设计约束

- **单一状态每轮最多清理 1000 行**（应用侧 Push 队列）：历史积压远超单轮上限时需要多轮 cron 收敛，
  每轮上报 `push.queue.pruned{status,retention_days}`，清理失败只上报
  `push.queue.prune_failed` 且**不影响投递**。
- **`pending` 永不清理**：待重试行代表尚未投递的用户通知，删除即静默丢消息。
- **SQL 侧清理是批量删除**：`security definer` + 空 `search_path`，只按 `created_at` 时间窗删除，
  不读取业务字段；pg_cron 任务名固定，重放迁移是幂等更新而不是新增任务。
- **清理函数只对服务端开放**：迁移 `028` 收回了 `cleanup_old_notifications()` /
  `cleanup_old_webhook_events()` / `cleanup_old_email_worker_runs()` 与 `log_audit_action()`
  对 `PUBLIC` / `anon` / `authenticated` 的 `EXECUTE`（PostgreSQL 默认授予 PUBLIC），
  只保留 `service_role` 与函数属主。pg_cron 任务以属主身份执行，不受影响；匿名用户此前可直接
  `rpc('cleanup_old_notifications')` 强制删除数据。细节与运行时证据见
  [security-audit.md](./security-audit.md)。
- 清理周期与业务表索引匹配：`email_worker_runs(created_at desc)`、`webhook_events(created_at)`、
  `notifications(created_at)`、`push_delivery_attempts(status, sent_at / last_attempt_at)`。

## 运维检查

```sql
-- 确认调度存在（应看到 cleanup-old-notifications / cleanup-old-webhook-events /
-- cleanup-old-email-worker-runs 三个任务）
select jobname, schedule, active from cron.job order by jobname;

-- 确认清理函数没有对匿名/登录用户开放（应全部为 f，service_role 为 t）
select p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('cleanup_old_notifications', 'cleanup_old_webhook_events',
                    'cleanup_old_email_worker_runs', 'log_audit_action');

-- 手动触发一次（演练，只影响早于保留期的行）
select public.cleanup_old_notifications();
select public.cleanup_old_webhook_events();
select public.cleanup_old_email_worker_runs();

-- 清理前后行数与最老时间戳
select count(*) as total, min(created_at) as oldest from public.email_worker_runs;
```

```bash
# Push 队列保留策略的端到端断言（Mock 模式，无需真实 Supabase）
pnpm test:e2e -- e2e/push-retry.spec.ts

# 队列清理与回执的单测
pnpm vitest run src/lib/repositories/push-delivery-attempts.test.ts \
  src/app/api/cron/push-retry/route.test.ts
```

## 变更痕迹

- `003_projects_notifications_indexes.sql`：`cleanup_old_notifications()`
- `014_retention_cleanup.sql`：`cleanup_old_webhook_events()` + pg_cron 调度
- `026_push_delivery_attempts.sql`：队列表与状态/时间索引（保留期由应用侧 worker 执行）
- `027_email_worker_runs_retention.sql`：`cleanup_old_email_worker_runs()` + pg_cron 调度
- `028_revoke_security_definer_execute.sql`：收回清理/审计写函数的客户端 `EXECUTE`
- `027_email_worker_runs_retention.sql`：`cleanup_old_email_worker_runs()` + pg_cron 调度
