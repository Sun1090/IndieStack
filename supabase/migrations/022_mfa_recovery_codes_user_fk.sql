-- Keep recovery codes bound to a real auth user and remove them with the account.
-- The explicit orphan check makes a bad production state fail loudly instead of
-- installing a constraint that only partially reflects the data model.
do $$
begin
  if exists (
    select 1
    from public.mfa_recovery_codes codes
    left join auth.users users on users.id = codes.user_id
    where users.id is null
  ) then
    raise exception 'Cannot add mfa_recovery_codes.user_id foreign key: orphan rows exist';
  end if;
end
$$;

alter table public.mfa_recovery_codes
  add constraint mfa_recovery_codes_user_id_fkey
  foreign key (user_id)
  references auth.users(id)
  on delete cascade;
