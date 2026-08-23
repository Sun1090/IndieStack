# 查询索引复审清单

> 需要连接 Supabase（本地或 staging）执行 `EXPLAIN ANALYZE` 后逐项确认。
> 复审日期：2026-08-23 · 基于代码中实际查询模式梳理。

## 高频查询与索引对照

| 来源 | 查询模式 | 现有索引 | 待验证 |
|------|----------|----------|--------|
| guards / 多处 | `profiles WHERE id = ?` | PK ✅ | - |
| inviteMember (team.ts) | `profiles WHERE lower(email) = ?` | ? | 是否有 email 索引；函数索引需匹配 `lower()` |
| notifications page | `notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 10` | 003 建了 (user_id, created_at)? | 确认复合索引顺序 |
| audit-logs admin | `audit_logs WHERE user_id/entity` + 分页 | 002 | created_at 范围扫描 |
| analytics API | `api_usage WHERE user_id AND created_at >= ?` | 003 | 复合 (user_id, created_at) |
| api-keys list | `api_keys WHERE user_id = ?` | 002 | - |
| teams 成员列表 | `team_members WHERE team_id = ?` | 001/002 | user_id + team_id 双向 |

## 执行方式

```bash
supabase db start   # 本地起库
psql ... -c "EXPLAIN ANALYZE SELECT ..."
```

逐项粘贴执行计划，关注 `Seq Scan` 出现在大表上的情况。
发现缺失索引用新迁移文件补充（编号顺延），禁止修改已应用的迁移。

## 复审结果（2026-08-23 已执行）

| 查询 | EXPLAIN 结论 |
|------|--------------|
| notifications (user_id + created_at 排序) | ✅ idx_notifications_user_id（Bitmap Index） |
| api_usage 窗口计数 | ✅ idx_api_usage_user_id |
| profiles lower(email) | ⚠️ 原 Seq Scan → **已修复**：迁移 011 增加 `idx_profiles_lower_email`，复验为 Index Scan |
| api_keys by user | ✅ idx_api_keys_user_name |
| team_members by team | ✅ idx_team_members_team_id |

结论：除 email 函数索引缺口（已补 011）外，其余高频查询均命中索引。
复审方法：`echo "EXPLAIN (FORMAT JSON) <SQL>" | supabase db query --linked`
