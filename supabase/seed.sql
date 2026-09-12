-- =============================================================================
-- IndieStack - deterministic local/staging seed data
-- =============================================================================
-- Local/staging only. Production users must be created through Supabase Auth,
-- which fires public.handle_new_user() and public.handle_new_team().
--
-- This file is intentionally self-contained so `supabase db reset` works from a
-- clean checkout. The deterministic users are also used by the runtime RLS and
-- Storage identity checks. Never reuse these credentials outside local/staging.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Auth users and email identities
-- -----------------------------------------------------------------------------
insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
) values
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'seed-owner-a@example.com',
    crypt('indiestack-local', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Seed Owner A"}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-0000-0000-000000000002',
    'authenticated',
    'authenticated',
    'seed-owner-b@example.com',
    crypt('indiestack-local', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Seed Owner B"}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-0000-0000-000000000003',
    'authenticated',
    'authenticated',
    'seed-member-a@example.com',
    crypt('indiestack-local', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Seed Member A"}'::jsonb,
    now(),
    now()
  )
on conflict (id) do update set
  email = excluded.email,
  encrypted_password = excluded.encrypted_password,
  email_confirmed_at = excluded.email_confirmed_at,
  raw_app_meta_data = excluded.raw_app_meta_data,
  raw_user_meta_data = excluded.raw_user_meta_data,
  updated_at = excluded.updated_at;

-- GoTrue scans these columns into strings. Supabase Auth normally writes empty
-- strings for unused tokens; direct local seed inserts must do the same.
update auth.users
set
  confirmation_token = coalesce(confirmation_token, ''),
  recovery_token = coalesce(recovery_token, ''),
  email_change_token_new = coalesce(email_change_token_new, ''),
  email_change = coalesce(email_change, ''),
  phone_change = coalesce(phone_change, ''),
  phone_change_token = coalesce(phone_change_token, ''),
  email_change_token_current = coalesce(email_change_token_current, ''),
  reauthentication_token = coalesce(reauthentication_token, '')
where id in (
  '10000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000003'
);

insert into auth.identities (
  user_id,
  identity_data,
  provider,
  provider_id,
  last_sign_in_at,
  created_at,
  updated_at
) values
  (
    '10000000-0000-0000-0000-000000000001',
    '{"sub":"10000000-0000-0000-0000-000000000001","email":"seed-owner-a@example.com","email_verified":true}'::jsonb,
    'email',
    'seed-owner-a@example.com',
    now(),
    now(),
    now()
  ),
  (
    '10000000-0000-0000-0000-000000000002',
    '{"sub":"10000000-0000-0000-0000-000000000002","email":"seed-owner-b@example.com","email_verified":true}'::jsonb,
    'email',
    'seed-owner-b@example.com',
    now(),
    now(),
    now()
  ),
  (
    '10000000-0000-0000-0000-000000000003',
    '{"sub":"10000000-0000-0000-0000-000000000003","email":"seed-member-a@example.com","email_verified":true}'::jsonb,
    'email',
    'seed-member-a@example.com',
    now(),
    now(),
    now()
  )
on conflict (provider_id, provider) do update set
  identity_data = excluded.identity_data,
  updated_at = excluded.updated_at;

-- Trigger normally creates these rows. The upserts also repair an existing local
-- auth user that was created before the app migration was installed.
insert into public.profiles (id, email, full_name, role)
values
  ('10000000-0000-0000-0000-000000000001', 'seed-owner-a@example.com', 'Seed Owner A', 'member'),
  ('10000000-0000-0000-0000-000000000002', 'seed-owner-b@example.com', 'Seed Owner B', 'member'),
  ('10000000-0000-0000-0000-000000000003', 'seed-member-a@example.com', 'Seed Member A', 'member')
on conflict (id) do update set
  email = excluded.email,
  full_name = excluded.full_name,
  updated_at = now();

-- -----------------------------------------------------------------------------
-- 2. Two isolated workspaces and one shared team
-- -----------------------------------------------------------------------------
insert into public.teams (id, name, slug, owner_id, member_count, plan) values
  (
    '00000000-0000-0000-0000-000000000001',
    'Seed Workspace A',
    'seed-workspace-a',
    '10000000-0000-0000-0000-000000000001',
    2,
    'free'
  ),
  (
    '00000000-0000-0000-0000-000000000002',
    'Seed Workspace B',
    'seed-workspace-b',
    '10000000-0000-0000-0000-000000000002',
    1,
    'pro'
  )
on conflict (id) do update set
  name = excluded.name,
  slug = excluded.slug,
  owner_id = excluded.owner_id,
  member_count = excluded.member_count,
  plan = excluded.plan,
  updated_at = now();

insert into public.team_members (team_id, user_id, role, invited_by) values
  (
    '00000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'owner',
    null
  ),
  (
    '00000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000003',
    'member',
    '10000000-0000-0000-0000-000000000001'
  ),
  (
    '00000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000002',
    'owner',
    null
  )
on conflict (team_id, user_id) do update set
  role = excluded.role,
  invited_by = excluded.invited_by;

-- -----------------------------------------------------------------------------
-- 3. Subscriptions / billing
-- -----------------------------------------------------------------------------
insert into public.subscriptions (
  id,
  team_id,
  provider,
  provider_id,
  status,
  plan,
  period_start,
  period_end
) values
  (
    '30000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'stripe',
    'seed_subscription_a',
    'active',
    'free',
    now() - interval '30 days',
    now() + interval '30 days'
  ),
  (
    '30000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000002',
    'stripe',
    'seed_subscription_b',
    'active',
    'pro',
    now() - interval '30 days',
    now() + interval '30 days'
  )
on conflict (id) do update set
  team_id = excluded.team_id,
  provider_id = excluded.provider_id,
  status = excluded.status,
  plan = excluded.plan,
  period_start = excluded.period_start,
  period_end = excluded.period_end,
  updated_at = now();

-- -----------------------------------------------------------------------------
-- 4. Tenant-scoped projects
-- -----------------------------------------------------------------------------
insert into public.projects (
  id,
  team_id,
  name,
  slug,
  description,
  status,
  visibility,
  created_by,
  created_at
) values
  (
    '40000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'Workspace A Website',
    'workspace-a-website',
    'Public project owned by workspace A',
    'active',
    'public',
    '10000000-0000-0000-0000-000000000001',
    now() - interval '20 days'
  ),
  (
    '40000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    'Workspace A API',
    'workspace-a-api',
    'Private project owned by workspace A',
    'active',
    'team',
    '10000000-0000-0000-0000-000000000001',
    now() - interval '15 days'
  ),
  (
    '40000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000002',
    'Workspace B Analytics',
    'workspace-b-analytics',
    'Private project owned by workspace B',
    'active',
    'private',
    '10000000-0000-0000-0000-000000000002',
    now() - interval '5 days'
  )
on conflict (id) do update set
  team_id = excluded.team_id,
  name = excluded.name,
  slug = excluded.slug,
  description = excluded.description,
  status = excluded.status,
  visibility = excluded.visibility,
  created_by = excluded.created_by,
  updated_at = now();

-- -----------------------------------------------------------------------------
-- 5. Invitations, API keys, sessions, usage, audit and notifications
-- -----------------------------------------------------------------------------
insert into public.team_invitations (
  id,
  team_id,
  email,
  role,
  invited_by,
  token,
  status,
  created_at
) values
  (
    '50000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'seed-invitee-a@example.com',
    'member',
    '10000000-0000-0000-0000-000000000001',
    'seed-invite-token-a',
    'pending',
    now() - interval '2 days'
  ),
  (
    '50000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000002',
    'seed-invitee-b@example.com',
    'member',
    '10000000-0000-0000-0000-000000000002',
    'seed-invite-token-b',
    'pending',
    now() - interval '1 day'
  )
on conflict (id) do update set
  email = excluded.email,
  role = excluded.role,
  invited_by = excluded.invited_by,
  token = excluded.token,
  status = excluded.status,
  updated_at = now();

insert into public.api_keys (
  id,
  user_id,
  name,
  key_prefix,
  key_hash,
  scopes,
  is_active
) values
  (
    '60000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'Seed owner A read key',
    'isk_seed_a',
    'seed-hash-owner-a',
    '{project:read}',
    true
  ),
  (
    '60000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000002',
    'Seed owner B read key',
    'isk_seed_b',
    'seed-hash-owner-b',
    '{project:read}',
    true
  )
on conflict (id) do update set
  name = excluded.name,
  key_prefix = excluded.key_prefix,
  key_hash = excluded.key_hash,
  scopes = excluded.scopes,
  is_active = excluded.is_active,
  updated_at = now();

insert into public.user_sessions (id, user_id, ip_address, user_agent, created_at) values
  (
    '70000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '127.0.0.1',
    'IndieStack seed',
    now() - interval '1 day'
  ),
  (
    '70000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000002',
    '127.0.0.2',
    'IndieStack seed',
    now() - interval '2 days'
  )
on conflict (id) do update set
  ip_address = excluded.ip_address,
  user_agent = excluded.user_agent,
  created_at = excluded.created_at;

insert into public.api_usage (user_id, path, method, status_code, created_at)
select
  '10000000-0000-0000-0000-000000000001',
  '/api/seed',
  'GET',
  200,
  timestamp with time zone '2026-01-01 00:00:00+00' + offset_value * interval '1 minute'
from generate_series(1, 5) as offset_value
where not exists (
  select 1
  from public.api_usage
  where user_id = '10000000-0000-0000-0000-000000000001'
    and path = '/api/seed'
    and method = 'GET'
);

insert into public.audit_logs (user_id, action, entity_type, entity_id, metadata, created_at)
select
  '10000000-0000-0000-0000-000000000001',
  'seed.workspace.created',
  'team',
  'seed-workspace-a',
  '{"source":"seed.sql","env":"local"}'::jsonb,
  now() - interval '2 days'
where not exists (
  select 1 from public.audit_logs where entity_id = 'seed-workspace-a'
);

insert into public.notifications (
  id,
  user_id,
  type,
  title,
  body,
  is_read,
  created_at
) values
  (
    '80000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'system',
    'Welcome to IndieStack',
    'Your local workspace A is ready.',
    false,
    now() - interval '7 days'
  ),
  (
    '80000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000002',
    'system',
    'Welcome to IndieStack',
    'Your local workspace B is ready.',
    false,
    now() - interval '6 days'
  )
on conflict (id) do update set
  user_id = excluded.user_id,
  type = excluded.type,
  title = excluded.title,
  body = excluded.body,
  is_read = excluded.is_read;

commit;
