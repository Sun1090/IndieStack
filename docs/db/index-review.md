# 查询索引复审清单

> 需要连接 Supabase（本地或 staging）执行 `EXPLAIN ANALYZE` 后逐项确认。
> 复审日期：2026-08-23（首轮）· 2026-09-13（H07 `audit_logs` 复审补测）。

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
pnpm exec supabase start   # 本地起库
docker exec -i supabase_db_indiestack psql -U postgres -d postgres -c "EXPLAIN ANALYZE SELECT ..."
```

逐项粘贴执行计划，关注 `Seq Scan` 出现在大表上的情况。
发现缺失索引用新迁移文件补充（编号顺延），禁止修改已应用的迁移。

## H07：`audit_logs` 索引复审（2026-09-13）

### 实际生产查询面

全仓 grep 后，`public.audit_logs` 只有**一条**读路径：

- `src/lib/repositories/audit-logs.ts` → `listAuditLogsPage()`：
  `select * from audit_logs order by created_at desc limit N offset M`；
- `src/lib/actions/admin.ts` → `listAllAuditLogs()` = `listAuditLogsPage(1, 100)`；
- 管理页 `src/app/dashboard/admin/audit-logs/audit-logs-page.tsx` 在**客户端**做关键词/动作过滤，
  不向数据库下发 `user_id` / `action` / `entity` 过滤条件。

写入面只有 `appendAuditLog()`（service_role，`029` 后客户端已无写权限）。

### 测量方法

本地 Supabase，合成 **200,000 行**（覆盖约 18 个月、200 种 action、3 类实体、500 个用户），
全程在事务内 `insert → analyze → explain → rollback`，不污染本地库：

```bash
docker exec -i supabase_db_indiestack psql -U postgres -d postgres -f - < /tmp/h07.sql
```

表体积：`200,004` 行 / `39 MB total`。

### 结果

| 查询 | 计划 | 实际耗时 | Shared buffers |
|------|------|----------|----------------|
| Q1 `order by created_at desc limit 50`（**生产路径**） | Index Scan `idx_audit_logs_created_at` | **0.082 ms** | 53 |
| Q2 同查询 `offset 5000`（深分页） | Index Scan `idx_audit_logs_created_at` | 3.607 ms | 9,897 |
| Q3 `select count(*)`（原 `count: "exact"`） | **Parallel Seq Scan** | **12.987 ms** | 6,956 |
| Q4b `where user_id = ? order by created_at desc limit 50`（单列索引） | Bitmap Index Scan `idx_audit_logs_user_id` + top-N Sort | 0.999 ms | 403 |
| Q4c 同上，另建 `(user_id, created_at desc)` 复合索引 | Index Scan（新索引） | 0.131 ms | 53 |
| Q5 `where action = ?` | Bitmap Index Scan `idx_audit_logs_action` | 1.770 ms | 2,004 |
| Q6 `where entity_type = ? and entity_id = ?` | Index Scan `idx_audit_logs_entity` | 0.039 ms | 32 |

### 结论与处置

1. **生产分页路径已命中索引，无需新增索引。** Q1 走 `idx_audit_logs_created_at`，
   0.082 ms / 53 buffers；`offset` 的线性增长（Q2）是 OFFSET 分页的固有代价，
   而唯一调用方只用第 1 页（`listAuditLogsPage(1, 100)`），不构成问题。
2. **唯一随表无限增长的开销是 `count: "exact"`（Q3）。** `audit_logs` 属永久保留、
   只追加的表（见 [retention.md](./retention.md)），全表计数会随时间线性变慢且没有调用方
   读取 `total`（管理页显示的是 `filteredLogs.length`）。已改为**默认不请求精确计数**：
   `listAuditLogsPage(page, pageSize, { withExactTotal })`，仅在显式传 `true` 时下发
   `count: "exact"`，否则返回 `total: null`。若将来确需总量，优先用 `count: "planned"`
   （`pg_class.reltuples` 估算，近零成本）而不是 `exact`。
3. **复合索引 `(user_id, created_at desc)` 暂不添加。** 它在 Q4b → Q4c 上确实有
   ~7.6× 加速（0.999 ms → 0.131 ms）与 ~8× buffer 下降，但**当前没有任何服务端查询按
   `user_id` 过滤 audit_logs**（管理页在客户端过滤，且最多只取 100 行）。
   在只追加的高写入表上为无人调用的查询付写放大成本不划算。
   **触发条件**：一旦把"按用户过滤审计日志"下推到服务端（`where user_id = ? order by created_at desc`），
   立即按上述测量补一条编号顺延的迁移加该复合索引。
4. `idx_audit_logs_action` / `idx_audit_logs_entity` 同样只服务尚未存在的服务端过滤查询，
   但它们是已有基线（002），本次不动。

## 复审结果（2026-08-23 已执行）

| 查询 | EXPLAIN 结论 |
|------|--------------|
| notifications (user_id + created_at 排序) | ✅ idx_notifications_user_id（Bitmap Index） |
| api_usage 窗口计数 | ✅ idx_api_usage_user_id |
| profiles lower(email) | ⚠️ 原 Seq Scan → **已修复**：迁移 011 增加 `idx_profiles_lower_email`，复验为 Index Scan |
| api_keys by user | ✅ idx_api_keys_user_name |
| team_members by team | ✅ idx_team_members_team_id |
| audit_logs 分页 / 计数 / 过滤 | 见上一节 H07 表 |

结论：除 email 函数索引缺口（已补 011）外，其余高频查询均命中索引。
复审方法：`echo "EXPLAIN (FORMAT JSON) <SQL>" | supabase db query --linked`
