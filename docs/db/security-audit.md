# Supabase 安全审计基线

`pnpm check:supabase-security` 是迁移与服务端权限的静态门禁，检查：

- 所有 `public` 表是否在迁移中启用 RLS；
- `SECURITY DEFINER` 函数是否固定 `search_path`；
- 应用使用的 Supabase Storage bucket 是否有版本化的 `storage.objects` policy；
- `service_role` 管理客户端是否泄漏到 `use client` 模块。

## 静态审计状态（2026-09-12）

`pnpm check:supabase-security` 通过：24 个迁移、18 张 public 表、Storage policy 和
service-role 客户端边界均通过。迁移 `024_storage_avatars_policies.sql` 已将 `avatars`
bucket（公共读）及按 `auth.uid()` 前缀约束的 INSERT/UPDATE/DELETE policy 纳入版本控制。

## 运行时身份矩阵（2026-09-12）

静态检查不等价于数据库运行时 RLS 回归，因此本仓库补上了真实运行时的身份矩阵脚本：

```bash
# 前置：本地 Supabase 已启动并完成迁移 + seed
pnpm exec supabase start
pnpm exec supabase db reset        # 24 个迁移 + supabase/seed.sql

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
