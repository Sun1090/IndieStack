-- =============================================================================
-- 012: 联系表单消息表
-- 匿名可插入、不可读取（RLS 仅放行 INSERT），管理端经 service_role 查看新消息。
-- =============================================================================

create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  subject text not null,
  message text not null,
  created_at timestamptz not null default now()
);

alter table public.contact_messages enable row level security;

-- 仅放行匿名/登录用户的 INSERT；无 SELECT 策略 = 写入后任何人（除 service_role）都读不到
create policy "Anyone can submit contact messages"
  on public.contact_messages
  for insert
  to anon, authenticated
  with check (
    char_length(name) between 1 and 100
    and email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    and char_length(subject) between 1 and 200
    and char_length(message) between 1 and 5000
  );

create index if not exists idx_contact_messages_created_at
  on public.contact_messages (created_at desc);
