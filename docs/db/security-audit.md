# Supabase 安全审计基线

`pnpm check:supabase-security` 是迁移与服务端权限的静态门禁，检查：

- 所有 `public` 表是否在迁移中启用 RLS；
- `SECURITY DEFINER` 函数是否固定 `search_path`；
- 应用使用的 Supabase Storage bucket 是否有版本化的 `storage.objects` policy；
- `service_role` 管理客户端是否泄漏到 `use client` 模块。

## 当前状态（2026-09-09）

静态审计已通过：`pnpm check:supabase-security` 检查 24 个迁移、18 张 public 表、Storage policy 和 service-role 客户端边界均通过。迁移 `024_storage_avatars_policies.sql` 已将 `avatars` bucket（公共读）及按 `auth.uid()` 前缀约束的 INSERT/UPDATE/DELETE policy 纳入版本控制。

静态检查不等价于数据库运行时 RLS 回归。当前工作区执行 `pnpm db:status` 仍因本机 Docker 缺少 `supabase_db_indiestack` 容器而无法启动本地 Supabase，因此尚未产生真实数据库身份矩阵证据。发布前必须在本地 Supabase 或受控 staging 数据库中，以 `anon`、`authenticated`、`service_role` 三种身份执行并保存以下矩阵：

| 身份 | avatars 读取 | 写入自身前缀 | 写入他人前缀 | 删除自身 | 删除他人 |
|---|---:|---:|---:|---:|---:|
| anon | 按公共桶设计允许读取 | 拒绝 | 拒绝 | 拒绝 | 拒绝 |
| authenticated | 允许读取 | 允许 | 拒绝 | 允许 | 拒绝 |
| service_role | 允许 | 允许 | 允许 | 允许 | 允许 |

如果选择 private bucket，必须同步修改 `src/lib/storage/index.ts` 的 `getPublicUrl()` 为 signed URL，并更新上述矩阵与 smoke test；当前实现明确选择公共读以保持现有图片 URL 兼容性。

## 迁移与回滚说明

`024_storage_avatars_policies.sql` 是前向迁移：创建/更新 `avatars` bucket 并添加四条对象策略。发布前应先确认现有 bucket 的 public 属性与应用的 `getPublicUrl()` 访问模型一致。不要直接删除 `storage.objects` policy 或 bucket 作为常规回滚，因为这会改变现有对象的可读性并可能造成数据不可见；代码回滚应保留兼容的 schema。若确需撤销，必须在维护窗口内执行经审查的前向修复/逆向 SQL，并先导出 bucket 配置与策略快照。
