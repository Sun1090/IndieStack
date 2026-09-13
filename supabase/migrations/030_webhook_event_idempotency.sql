-- =============================================================================
-- 030: Webhook 幂等约束（H06）
-- 背景：webhook_events 此前只是"日志"——处理器先执行全部副作用，最后才 upsert 一行。
--   Stripe 是 at-least-once 投递且会对非 2xx 主动重试，因此同一 event.id 可能被反复投递，
--   而重复投递会**重复执行副作用**（重复写入订阅状态、重复发送"付款成功"通知），
--   日志表只能掩盖症状、不能阻止副作用。F05 的"重复 event id 幂等"用例实际只断言了
--   日志行数，无法发现副作用重复。
--
--   本迁移引入"先占位、再处理、后落状态"的租约模型：
--     - claim_webhook_event() 是原子占位。首次投递插入 received 行并返回 claimed；
--     - 重复投递返回 duplicate，调用方跳过副作用并回 200，让 Stripe 停止重试；
--     - 上一次处理失败（status='failed'）或占位超时（received 超过 15 分钟，进程崩溃）
--       时允许重新占位，attempts 累加，保证瞬时故障仍能被 Stripe 重试救回。
--   同时把 event_id 的**全局**唯一约束收窄为 (provider, event_id) 复合唯一，
--   避免将来接入第二个 provider 时 event id 互相碰撞。
--
--   门禁：scripts/check-supabase-security.js 要求 SECURITY DEFINER 函数固定 search_path
--   且只授予 service_role（与 028 的处理一致）。
-- =============================================================================

-- 幂等元数据：attempts 记录占位次数（历史行至少被处理过一次，因此默认 1）
alter table public.webhook_events
  add column if not exists attempts integer not null default 1,
  add column if not exists last_attempt_at timestamptz not null default now();

-- 幂等键从 event_id 收窄为 (provider, event_id)
alter table public.webhook_events
  drop constraint if exists webhook_events_event_id_key;
alter table public.webhook_events
  drop constraint if exists webhook_events_provider_event_id_key;
alter table public.webhook_events
  add constraint webhook_events_provider_event_id_key unique (provider, event_id);

create or replace function public.claim_webhook_event(
  p_provider text,
  p_event_id text,
  p_event_type text
)
returns table (outcome text, attempts integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- 占位租约：停留在 received 超过该时长视为进程崩溃，允许后续重试重新占位
  lease constant interval := interval '15 minutes';
  v_status text;
  v_attempts integer;
  v_stale boolean;
begin
  insert into public.webhook_events (
    provider, event_id, event_type, status, attempts, last_attempt_at
  )
  values (p_provider, p_event_id, p_event_type, 'received', 1, now())
  on conflict on constraint webhook_events_provider_event_id_key do nothing;

  if found then
    return query select 'claimed'::text, 1;
    return;
  end if;

  -- 已存在：加行锁串行化同一事件的并发投递，再判断能否重新占位
  select
    w.status,
    w.attempts,
    coalesce(w.last_attempt_at, w.created_at) < now() - lease
    into v_status, v_attempts, v_stale
    from public.webhook_events w
    where w.provider = p_provider and w.event_id = p_event_id
    for update;

  if not found then
    -- 行在写入与加锁之间被删除（例如 E2E reset）：按重复处理，不执行副作用
    return query select 'duplicate'::text, 0;
    return;
  end if;

  if v_status <> 'failed' and not (v_status = 'received' and v_stale) then
    return query select 'duplicate'::text, v_attempts;
    return;
  end if;

  update public.webhook_events
    set status = 'received',
        attempts = v_attempts + 1,
        error_message = null,
        last_attempt_at = now()
    where provider = p_provider and event_id = p_event_id;

  return query select 'claimed'::text, v_attempts + 1;
end;
$$;

comment on function public.claim_webhook_event(text, text, text) is
  'Webhook 幂等的原子占位：claimed 表示本次调用获得处理权，duplicate 表示应跳过副作用。';

-- 与 028 一致：只允许 service_role（服务端）调用，收回 PUBLIC / anon / authenticated
revoke all on function public.claim_webhook_event(text, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_webhook_event(text, text, text) to service_role;
