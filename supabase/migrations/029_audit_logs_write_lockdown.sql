-- =============================================================================
-- 029: audit_logs 写入面收口（审计完整性，H09 安全加固续）
-- 背景：002_rbac_audit.sql 为早期需求建了一条只校验角色的宽松 INSERT 策略：
--     create policy "Audit logs insertable by authenticated users"
--       on public.audit_logs for insert with check (auth.role() = 'authenticated');
--   该策略只判断调用者是登录用户，对写入行的 user_id / action / entity_type / entity_id /
--   metadata 不做任何约束，因此任何登录用户都可以直接
--     POST /rest/v1/audit_logs
--   插入任意审计记录，并把 user_id 指向任意已存在的用户（受害者），从而伪造“某人做了某事”。
--   本地实测（028 之后、本迁移之前）：伪造 team.delete 行返回 HTTP 201 并落入 audit_logs。
--   这条链路还能用于污染安全审计与事后取证，属于审计完整性缺陷而非单纯越权。
--
-- 事实基础（改前已核对）：
--   1. 应用侧唯一写入路径是 src/lib/repositories/audit-logs.ts 的 appendAuditLog()，
--      它走 createAdminClient()（service_role）；service_role 具备 BYPASSRLS，
--      不依赖任何策略即可写入，删除策略不会影响它。
--   2. 原 log_audit_action() 的客户端 EXECUTE 已在 028 收回，只剩 service_role，
--      因此不存在“删策略就断功能”的客户端调用方。
--   3. grep 全仓 src/ 后，除上述 repository 外没有其它 audit_logs 写入点。
--
-- 处理：
--   - 删除该宽松 INSERT 策略；
--   - 纵深防御：收回 anon / authenticated 在 audit_logs 上的表级写权限。audit_logs 是
--     只追加、只由服务端写入的表，客户端既不需要 INSERT / UPDATE / DELETE，也不需要
--     TRUNCATE。SELECT 保持原样，仍由 "Audit logs viewable by super_admin" 限定给
--     super_admin（管理端查询走 service_role）。
--
-- 门禁：scripts/check-supabase-security.js 新增客户端写入策略校验
--   （src/lib/security/client-write-policies.ts），对 server-only 表上残留的
--   anon / authenticated 写策略失败封闭，本迁移是其修复项。
-- =============================================================================

drop policy if exists "Audit logs insertable by authenticated users" on public.audit_logs;

revoke insert, update, delete, truncate on public.audit_logs from anon, authenticated;
