
-- =============================================================================
-- IndieStack — 开发环境种子数据
-- =============================================================================
-- 注意：种子数据仅供本地开发使用。
-- 生产环境中用户通过 auth.users 触发器自动创建 profile 和 personal team。
-- 
-- 使用说明：
--   1. 先在 Supabase Auth UI 或通过 API 注册测试用户
--   2. 从 auth.users 表中复制用户 UUID
--   3. 将下方的 'REPLACE_WITH_USER_UUID' 替换为实际 UUID
--   4. 运行: supabase db seed
-- 
-- 运行方式：  supabase db seed
-- 手动执行：  psql -h localhost -U postgres -d indiestack -f supabase/seed.sql
-- 
-- 关于 UUID 占位：
--   此文件使用 "00000000-0000-0000-0000-000000000000" 作为 user_id 占位。
--   本地开发时，需要先创建用户，然后从 auth.users 获取实际 UUID 替换之。
--   或在 Supabase Studio 中插入用户数据后再执行此种子脚本。
-- =============================================================================

-- 检查是否已有数据，避免重复插入
do $$
begin
  if exists (select 1 from public.profiles limit 1) then
    raise notice '数据库已有数据，跳过种子数据插入。';
    return;
  end if;
  raise notice '正在插入种子数据...';
end $$;

-- =============================================================================
-- 1. 模拟用户（仅开发环境）
-- 注意：生产环境不要手动插入 auth.users，应通过 Supabase Auth 注册
-- =============================================================================
-- 创建测试用户（需要 Supabase auth schema 中有对应记录时才生效）
-- 本地开发时，通过 Supabase Auth UI 注册用户后，profiles 和 personal team 会自动创建

-- =============================================================================
-- 2. 示例团队
-- 注意：实际使用中 personal team 由 handle_new_team 触发器自动创建
-- 这里额外创建一些示例团队用于展示多团队功能
-- =============================================================================
insert into public.teams (id, name, slug, owner_id, plan) values
  ('00000000-0000-0000-0000-000000000001', '个人团队', 'personal', '00000000-0000-0000-0000-000000000000', 'free'),
  ('00000000-0000-0000-0000-000000000002', '示例企业版', 'demo-enterprise', '00000000-0000-0000-0000-000000000000', 'pro')
on conflict (id) do nothing;

-- =============================================================================
-- 3. 示例订阅
-- =============================================================================
insert into public.subscriptions (team_id, status, plan, provider, period_end) values
  ('00000000-0000-0000-0000-000000000001', 'active', 'free', 'stripe', now() + interval '30 days'),
  ('00000000-0000-0000-0000-000000000002', 'active', 'pro', 'stripe', now() + interval '30 days')
on conflict (team_id) do nothing;

-- =============================================================================
-- 4. 示例 API 使用记录（最近 30 天）
-- =============================================================================
insert into public.api_usage (user_id, path, method, status_code, created_at)
select
  '00000000-0000-0000-0000-000000000000',
  case (random() * 4)::int
    when 0 then '/api/user'
    when 1 then '/api/projects'
    when 2 then '/api/analytics'
    when 3 then '/api/billing'
    else '/api/health'
  end,
  case (random() * 2)::int
    when 0 then 'GET'
    when 1 then 'POST'
    else 'PUT'
  end,
  case (random() * 10)::int
    when 0 then 500
    when 1 then 429
    else 200
  end,
  now() - (random() * interval '30 days')
from generate_series(1, 100);

-- =============================================================================
-- 5. 示例用户会话（最近 7 天）
-- =============================================================================
insert into public.user_sessions (user_id, ip_address, created_at)
select
  '00000000-0000-0000-0000-000000000000',
  '127.0.0.1',
  now() - (random() * interval '7 days')
from generate_series(1, 20);

-- =============================================================================
-- 6. 示例审计日志（最近 30 天）
-- =============================================================================
insert into public.audit_logs (user_id, action, entity_type, entity_id, metadata, created_at)
select
  '00000000-0000-0000-0000-000000000000',
  case (random() * 5)::int
    when 0 then 'user.login'
    when 1 then 'user.profile.update'
    when 2 then 'team.create'
    when 3 then 'project.create'
    else 'api.key.create'
  end,
  case (random() * 3)::int
    when 0 then 'user'
    when 1 then 'team'
    else 'api_key'
  end,
  'seed-data',
  '{"source": "seed.sql", "env": "development"}'::jsonb,
  now() - (random() * interval '30 days')
from generate_series(1, 30);

-- =============================================================================
-- 7. 示例 API 密钥
-- =============================================================================
insert into public.api_keys (user_id, name, key_prefix, key_hash, scopes) values
  ('00000000-0000-0000-0000-000000000000', '开发环境密钥', 'isk_dev_abc...', 'dev-hash-placeholder', '{project:read,user:read}'),
  ('00000000-0000-0000-0000-000000000000', '生产环境密钥', 'isk_prod_xyz...', 'prod-hash-placeholder', '{project:read,project:write,user:read,billing:read}')
on conflict (user_id, name) do nothing;

-- =============================================================================
-- 8. 示例项目（需要先有 team 数据）
-- =============================================================================
insert into public.projects (team_id, name, slug, description, status, visibility, created_at) values
  ('00000000-0000-0000-0000-000000000001', '官网', 'official-website', '公司官网和产品展示页面', 'active', 'public', now() - interval '20 days'),
  ('00000000-0000-0000-0000-000000000001', 'API 服务', 'api-service', '后端 API 微服务', 'active', 'team', now() - interval '15 days'),
  ('00000000-0000-0000-0000-000000000001', '移动端应用', 'mobile-app', 'iOS/Android 移动应用后端', 'paused', 'team', now() - interval '10 days'),
  ('00000000-0000-0000-0000-000000000002', '数据分析平台', 'analytics-platform', '数据分析和可视化平台', 'active', 'private', now() - interval '5 days')
on conflict (team_id, slug) do nothing;

-- =============================================================================
-- 9. 示例团队邀请
-- =============================================================================
insert into public.team_invitations (team_id, email, role, invited_by, token, status, created_at) values
  ('00000000-0000-0000-0000-000000000001', 'alice@example.com', 'member', '00000000-0000-0000-0000-000000000000', 'invite-token-alice-001', 'pending', now() - interval '2 days'),
  ('00000000-0000-0000-0000-000000000001', 'bob@example.com', 'admin', '00000000-0000-0000-0000-000000000000', 'invite-token-bob-002', 'accepted', now() - interval '5 days'),
  ('00000000-0000-0000-0000-000000000002', 'carol@example.com', 'member', '00000000-0000-0000-0000-000000000000', 'invite-token-carol-003', 'pending', now() - interval '1 day')
on conflict (token) do nothing;

-- =============================================================================
-- 10. 示例通知
-- =============================================================================
insert into public.notifications (user_id, type, title, body, is_read, created_at) values
  ('00000000-0000-0000-0000-000000000000', 'system', '欢迎使用 IndieStack！', '感谢你选择 IndieStack。查看文档了解如何开始。', false, now() - interval '7 days'),
  ('00000000-0000-0000-0000-000000000000', 'team_invite', '新的团队邀请', '你被邀请加入「示例企业版」团队。', false, now() - interval '3 days'),
  ('00000000-0000-0000-0000-000000000000', 'billing_update', '订阅即将到期', '你的 Pro 订阅将在 5 天后到期。', false, now() - interval '1 day'),
  ('00000000-0000-0000-0000-000000000000', 'deployment', '部署成功', 'API 服务已成功部署到生产环境。', true, now() - interval '12 hours'),
  ('00000000-0000-0000-0000-000000000000', 'security_alert', '新设备登录', '你的账户从新设备 Chrome / macOS 登录。', true, now() - interval '2 days')
on conflict do nothing;
