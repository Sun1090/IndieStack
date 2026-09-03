-- =============================================================================
-- 013: MFA 备用恢复码
-- 仅 service_role 可读写（RLS 开启但不建任何 anon/authenticated 策略）；
-- 明文只在生成时返回一次，库中仅存 SHA-256 哈希；兑换成功即消费并解绑 TOTP。
-- =============================================================================

create table if not exists public.mfa_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  code_hash text not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  constraint mfa_recovery_codes_user_hash_unique unique (user_id, code_hash)
);

alter table public.mfa_recovery_codes enable row level security;

create index if not exists idx_mfa_recovery_codes_user_id
  on public.mfa_recovery_codes (user_id);
