-- Marketing token security: hash tokens at rest and expire links after seven days.
-- pgcrypto 在 Supabase（本地与托管）安装在 extensions schema，因此显式解析扩展
-- 所在 schema，不依赖 search_path，避免部署到托管环境时 migration 失败。
create extension if not exists pgcrypto with schema extensions;

alter table public.marketing_subscriptions
  add column if not exists token_hash text,
  add column if not exists token_expires_at timestamptz;

do $do$
declare
  crypto_schema text;
begin
  select n.nspname into crypto_schema
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pgcrypto';

  if crypto_schema is null then
    raise exception 'pgcrypto extension is required for marketing token hashing';
  end if;

  execute format(
    $sql$
      update public.marketing_subscriptions
      set token_hash = encode(%1$I.digest(token, 'sha256'), 'hex'),
          token_expires_at = coalesce(token_expires_at, updated_at + interval '7 days')
      where token is not null
        and token_hash is null
    $sql$,
    crypto_schema
  );
end
$do$;

create unique index if not exists idx_marketing_subscriptions_token_hash
  on public.marketing_subscriptions (token_hash)
  where token_hash is not null;

create index if not exists idx_marketing_subscriptions_token_hash_expiry
  on public.marketing_subscriptions (token_hash, token_expires_at)
  where token_hash is not null;
