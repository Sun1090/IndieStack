-- =============================================================================
-- 019: WebAuthn/Passkey 凭据（v0.5.0 D01 试点，ADR-012，feature flag 门控）
-- credential_id 为 Base64URL 编码（唯一）；sign_count 用于克隆检测；
-- 每用户可注册多把（不同设备）。
-- =============================================================================

create table if not exists public.webauthn_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  credential_id text not null unique,
  public_key text not null,
  counter bigint not null default 0,
  device_name text,
  transports text[],
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists idx_webauthn_credentials_user
  on public.webauthn_credentials (user_id);

alter table public.webauthn_credentials enable row level security;

create policy "users_select_own_passkeys"
  on public.webauthn_credentials for select
  using (auth.uid() = user_id);

create policy "users_insert_own_passkeys"
  on public.webauthn_credentials for insert
  with check (auth.uid() = user_id);

create policy "users_delete_own_passkeys"
  on public.webauthn_credentials for delete
  using (auth.uid() = user_id);
