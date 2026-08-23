-- =============================================================================
-- 011: profiles 邮箱函数索引
-- 来源：#65 索引复审（docs/db/index-review.md）
-- inviteMember 按 lower(email) 精确查找用户，原表仅有 email 原值索引，
-- lower() 包裹后无法命中，EXPLAIN 显示 Seq Scan。
-- =============================================================================

create index if not exists idx_profiles_lower_email
  on public.profiles (lower(email));
