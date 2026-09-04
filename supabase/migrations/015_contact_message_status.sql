-- =============================================================================
-- 015: 联系消息处理状态
-- status: new（新提交）→ in_progress（处理中）→ resolved（已解决），单向流转由应用层约束。
-- 存量行默认 new。
-- =============================================================================

alter table public.contact_messages
  add column if not exists status text not null default 'new';

do $do$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'contact_messages_status_check'
  ) then
    alter table public.contact_messages
      add constraint contact_messages_status_check
      check (status in ('new', 'in_progress', 'resolved'));
  end if;
end
$do$;

create index if not exists idx_contact_messages_status
  on public.contact_messages (status);
