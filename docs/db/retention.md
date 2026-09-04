# 数据保留策略

> v0.4.0 D05。定时清理靠 pg_cron（迁移 `014_retention_cleanup.sql` 守卫式调度）；
> pg_cron 未安装的环境自动跳过，生产需在 Supabase Dashboard 确认扩展已启用。

| 数据 | 保留期 | 机制 | 调度 |
|------|--------|------|------|
| notifications（已读） | 90 天 | `cleanup_old_notifications()`（003 建） | 每周日 04:00 |
| notifications（未读） | 永久（用户手动标已读后进入 90 天窗口） | 同上 | 同上 |
| webhook_events（全部状态） | 90 天 | `cleanup_old_webhook_events()`（014 建） | 每周日 04:00 |
| audit_logs | 永久（合规需要，删改走变更流程） | 无自动清理 | — |
| contact_messages | 永久（归档后手动清理） | 无自动清理（E/J 域归档功能配套） | — |

## 运维检查

```sql
-- 确认调度存在
select jobname, schedule, active from cron.job;
-- 手动触发一次（演练）
select public.cleanup_old_notifications();
select public.cleanup_old_webhook_events();
```
