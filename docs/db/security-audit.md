# Supabase 安全审计基线

`pnpm check:supabase-security` 是迁移与服务端权限的静态门禁，检查：

- 所有 `public` 表是否在迁移中启用 RLS；
- `SECURITY DEFINER` 函数是否固定 `search_path`；
- `SECURITY DEFINER` 函数是否收回了客户端 `EXECUTE`（见下一节）；
- 应用使用的 Supabase Storage bucket 是否有版本化的 `storage.objects` policy；
- `service_role` 管理客户端是否泄漏到 `use client` 模块。

## 静态审计状态（2026-09-13）

`pnpm check:supabase-security` 通过：29 个迁移、19 张 public 表、39 条生效 RLS policy、
Storage policy、`SECURITY DEFINER` 执行权限、客户端写入策略与 service-role 客户端边界均通过。迁移
`024_storage_avatars_policies.sql` 已将 `avatars` bucket（公共读）及按 `auth.uid()` 前缀
约束的 INSERT/UPDATE/DELETE policy 纳入版本控制。

## SECURITY DEFINER 执行权限（2026-09-13 加固）

PostgreSQL 默认把新函数的 `EXECUTE` 授予 `PUBLIC`，Supabase 的默认权限再额外授予
`anon` / `authenticated` / `service_role`。因此**每个 `SECURITY DEFINER` 函数默认都能被
匿名用户通过 PostgREST `rpc()` 直接调用**，绕过 RLS。

实际受影响并已在 `028_revoke_security_definer_execute.sql` 收口：

| 函数 | 加固前风险 | 加固后 |
|---|---|---|
| `cleanup_old_notifications()` | anon 可强制删除 90 天内通知（数据破坏） | 仅 `service_role` + 属主 |
| `cleanup_old_webhook_events()` | anon 可强制删除 webhook 事件 | 仅 `service_role` + 属主 |
| `cleanup_old_email_worker_runs()` | anon 可强制删除 digest 运行记录 | 仅 `service_role` + 属主 |
| `log_audit_action(...)` | anon 可伪造审计日志行（审计完整性） | 仅 `service_role` + 属主 |

**未收口且必须保留客户端 `EXECUTE` 的函数**：`is_team_member` / `is_team_admin` /
`is_team_owner` / `get_profile_role` / `get_profile_email` / `get_project_team_id` /
`get_project_created_by` / `get_team_owner_id` / `get_team_member_count` / `get_team_plan`。
这些函数在 RLS 策略表达式内被引用，而策略以查询角色求值——撤销后策略会直接抛
`permission denied`。触发器函数（`handle_new_user` / `handle_new_team` /
`handle_project_created` / `handle_updated_at`）返回 `trigger`，PostgreSQL 拒绝直接调用，
因此无需撤权。门禁对这两类函数自动豁免，其余 `SECURITY DEFINER` 函数必须有显式
`revoke ... from public, anon, authenticated`，否则 `pnpm check:supabase-security` 失败封闭。

运行时证据（本地 Supabase，`http://127.0.0.1:54321`，真实 PostgREST `rpc` 路径）：

```bash
# 加固前（模拟 028 之前的默认授权）
grant execute on function public.cleanup_old_notifications() to anon;
curl -X POST .../rest/v1/rpc/cleanup_old_notifications -H "Authorization: Bearer $ANON" -d '{}'
# → HTTP 204（删除被执行）

# 加固后
revoke all on function public.cleanup_old_notifications() from public, anon, authenticated;
curl -X POST .../rest/v1/rpc/cleanup_old_notifications -H "Authorization: Bearer $ANON" -d '{}'
# → HTTP 401 {"code":"42501","message":"permission denied for function cleanup_old_notifications"}

# service_role 仍可用（应用侧与运维路径不受影响）
# → HTTP 204
```

同一批次的身份矩阵回归保持 `20/20 通过`（`/tmp/indiestack-identity-028.json`），确认撤权
没有破坏任何合法的 authenticated 路径。

## 客户端写入策略（2026-09-13 加固）

Supabase 会把每个 `public` 表暴露到 PostgREST，因此 RLS policy 是登录会话与"直接写行"
之间唯一的屏障。`src/lib/security/client-write-policies.ts` 对生效后的策略集合
（按版本顺序应用 `create policy` / `drop policy`，等价于数据库最终状态）做两类判定：

1. **server-only 表不得有客户端写策略。** 目前登记 `public.audit_logs`。`service_role`
   具备 `BYPASSRLS`，写入完全不需要策略，所以这类表上任何 `anon` / `authenticated`
   （或未写 `to` 而默认 `public`）的 INSERT/UPDATE/DELETE/ALL 策略都是伪造面，门禁失败封闭。
2. **INSERT policy 的 `WITH CHECK` 不得缺失或恒真。** PostgreSQL 在 `FOR INSERT` 省略
   `WITH CHECK` 时默认按 `true` 处理；`WITH CHECK (true)` 等价于"接受任意行"。

`029_audit_logs_write_lockdown.sql` 修复的就是第 1 类：

| 项 | 加固前 | 加固后 |
|---|---|---|
| `audit_logs` INSERT 策略 | `"Audit logs insertable by authenticated users"`，`with check (auth.role() = 'authenticated')` | 已删除 |
| `anon` / `authenticated` 表级写权限 | INSERT/UPDATE/DELETE/TRUNCATE | 已收回（保留 SELECT，仍由 super_admin 策略限定） |
| 伪造 `user_id` 指向他人 | 可行，`user_id` 无任何约束 | 不可行 |

原策略只判断"调用者是登录用户"，对行内容零约束，所以任意登录用户都能伪造审计记录并把
`user_id` 指向任意已存在用户，污染审计与事后取证。**`appendAuditLog()`
（`src/lib/repositories/audit-logs.ts`）走 `createAdminClient()`，即 `service_role`，
不受影响**；`log_audit_action()` 的客户端 `EXECUTE` 已在 028 收回，因此不存在被删策略打断的
客户端调用方（改前已 grep 全仓 `src/` 确认无其它 `audit_logs` 写入点）。

运行时证据（本地 Supabase，`http://127.0.0.1:54321`，真实 PostgREST 路径）：

```bash
# 加固前：登录用户伪造一条归属受害者的 team.delete
curl -X POST .../rest/v1/audit_logs -H "Authorization: Bearer $AUTHENTICATED" \
  -H "Prefer: return=minimal" \
  -d '{"user_id":"<victim-uuid>","action":"team.delete","entity_id":"victim-team"}'
# → HTTP 201，行落入 audit_logs（已复现后清理）

# 加固后
# → HTTP 403 {"code":"42501","message":"permission denied for table audit_logs"}
# anon INSERT          → HTTP 401 permission denied
# authenticated UPDATE → HTTP 403 permission denied
# service_role INSERT  → HTTP 201（服务端写入路径不变）
# service_role rpc log_audit_action → HTTP 200
```

```sql
-- 加固后权限矩阵
select r as role,
       has_table_privilege(r,'public.audit_logs','insert')   as can_insert,
       has_table_privilege(r,'public.audit_logs','update')   as can_update,
       has_table_privilege(r,'public.audit_logs','delete')   as can_delete,
       has_table_privilege(r,'public.audit_logs','truncate') as can_truncate
from unnest(array['anon','authenticated','service_role']) r;
-- anon          | f | f | f | f
-- authenticated | f | f | f | f
-- service_role  | t | t | t | t
```

同一批次身份矩阵回归保持 `20/20 通过`（`/tmp/indiestack-identity-029.json`）。

**已知边界**：该门禁是静态文本规则，只覆盖 `public` 表上显式书写的策略语句。它不解析
`alter policy`、动态 SQL 或 Supabase Dashboard 里手工改的策略；线上真实授权仍应以
`pg_policies` / `has_table_privilege` 查询为准。

## 运行时身份矩阵（2026-09-12）

静态检查不等价于数据库运行时 RLS 回归，因此本仓库补上了真实运行时的身份矩阵脚本：

```bash
# 前置：本地 Supabase 已启动并完成迁移 + seed
pnpm exec supabase start
pnpm exec supabase db reset        # 25 个迁移 + supabase/seed.sql

pnpm smoke:supabase-identity -- --output /tmp/indiestack-identity-matrix.json
```

脚本通过真实 Auth + PostgREST + Storage API 执行，不使用 mock：

- `anon` / `authenticated` / `service_role` 三种身份；
- 两个隔离租户与三张项目（含一张私有项目）；
- `profiles`、`teams`、`projects` 的跨租户可见性；
- `avatars` bucket 的公共读、按前缀写入/更新/删除、跨前缀拒绝；
- 临时对象与临时状态在结束时清理。

最近一次结果（`2026-09-12T05:12:32Z`，target `http://127.0.0.1:54321`）：

| 身份 | avatars 读取 | 写入自身前缀 | 写入他人前缀 | 删除自身 | 删除他人 |
|---|---:|---:|---:|---:|---:|
| anon | 允许（公共桶设计） | 拒绝 | 拒绝 | 拒绝 | 拒绝 |
| authenticated | 允许 | 允许 | 拒绝 | 允许 | 拒绝 |
| service_role | 允许 | 允许 | 允许 | 允许 | 允许 |

证据：`/tmp/indiestack-identity-matrix.json`（20/20 通过，0 失败）。运行器不提交该
JSON；发布记录需要附上本次输出或 CI artifact。

局限：本矩阵只在**本地 Supabase 或受控 staging** 上执行。生产环境有副作用的场景
（真实账号登录、合法/非法上传、邮件与通知发送）仍未被自动化覆盖，不能用本矩阵替代。

如果选择 private bucket，必须同步修改 `src/lib/storage/index.ts` 的 `getPublicUrl()`
为 signed URL，并更新上述矩阵与 smoke test；当前实现明确选择公共读以保持现有图片 URL
兼容性。

## 迁移与回滚说明

`024_storage_avatars_policies.sql` 是前向迁移：创建/更新 `avatars` bucket 并添加四条
对象策略。发布前应先确认现有 bucket 的 public 属性与应用的 `getPublicUrl()` 访问模型
一致。不要直接删除 `storage.objects` policy 或 bucket 作为常规回滚，因为这会改变现有
对象的可读性并可能造成数据不可见；代码回滚应保留兼容的 schema。若确需撤销，必须在
维护窗口内执行经审查的前向修复/逆向 SQL，并先导出 bucket 配置与策略快照。

## Seed 数据安全边界

`supabase/seed.sql` 现在是自包含、可重复执行的确定性种子：它先写入 `auth.users`
（`seed-owner-a@example.com` / `seed-owner-b@example.com` / `seed-member-a@example.com`，
统一密码 `indiestack-local`），再写入两个隔离团队、三个项目、订阅、邀请、API key、
会话、审计、通知与 usage 数据。

- 仅用于 **local / staging**；生产禁止执行该 seed。
- 密码是公开的固定值，不要在对外可访问环境使用。
- 身份矩阵脚本依赖这些固定 UUID 与密码，修改 seed 时需同步
  `scripts/verify-supabase-identity.js` 的常量。
