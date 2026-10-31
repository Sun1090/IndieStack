-- =============================================================================
-- 033 的引用判定：`referenced` 到底怎么算，以及「删号后元数据活着」
--
-- 为什么补这一份：033 的核心主张有两句，都只在 mock 上被验过
-- （`src/lib/mock/index.ts` 的 `listMockUserObjects` / `listMockOrphanObjects`）：
--
--   1. `upload_object_is_referenced(key)` 用**后缀相等**判断引用，而不是 LIKE ——
--      理由写在迁移注释里：对象键里的 `_` 在 LIKE 里是单字符通配符。
--      这句话对不对，只有真跑一次 `a_b.png` vs `axb.png` 才知道。
--   2. `owner_id` 从 `on delete cascade` 改成 `on delete set null`，理由是
--      「删号越彻底，孤儿越不可见」——元数据必须活过账户删除。
--      这条更只能靠真库验：它是外键行为，mock 里根本没有外键。
--
-- 后果的分量：`referenced=false` 的对象才允许被删。判错的代价是双向的——
-- 把 true 判成 false，删号会弄坏别人团队页面上正在用的封面；
-- 把 false 判成 true，孤儿永远删不掉、隐私声明里「删除所有数据」无从证明。
-- =============================================================================

begin;

truncate probe.case;
\o /dev/null

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000100001', 'uploader@probe.local'),
  ('00000000-0000-4000-8000-000000100002', 'other@probe.local');

-- 四行对象：
--   used.png      —— 被 profiles.avatar_url 指着（referenced=true）
--   a_b.png       —— 没有被引用；同时还有一个 url 以 axb.png 结尾（LIKE 会误判成引用）
--   cover.png     —— 被 projects.logo_url 指着，但上传者是别人（团队封面场景）
--   xavatars/...  —— 尾巴巧合：url 里 `.../xavatars/u/y.png` 的结尾看起来像 `avatars/u/y.png`
insert into public.upload_objects (bucket, object_key, owner_id, byte_size, content_type, checksum, status) values
  ('avatars', 'avatars/u1/used.png', '00000000-0000-4000-8000-000000100001', 11, 'image/png', repeat('1', 64), 'active'),
  ('avatars', 'avatars/u1/a_b.png', '00000000-0000-4000-8000-000000100001', 12, 'image/png', repeat('2', 64), 'active'),
  ('avatars', 'avatars/u2/cover.png', '00000000-0000-4000-8000-000000100002', 13, 'image/png', repeat('3', 64), 'active'),
  ('avatars', 'avatars/u/y.png', '00000000-0000-4000-8000-000000100001', 14, 'image/png', repeat('4', 64), 'active'),
  ('avatars', 'avatars/u1/gone.png', '00000000-0000-4000-8000-000000100001', 15, 'image/png', repeat('5', 64), 'deleted');

-- 引用关系只存在于完整 URL 字符串里（031 的设计），所以这里必须写完整 URL。
insert into public.profiles (id, avatar_url) values
  ('00000000-0000-4000-8000-000000100001',
   'https://cdn.example.com/storage/v1/object/public/avatars/avatars/u1/used.png')
on conflict (id) do update set avatar_url = excluded.avatar_url;

-- 尾巴巧合：这个 url 以 `avatars/u/y.png` 结尾，但它的真实路径是 `xavatars/u/y.png`。
-- 迁移注释说「要求前面是 `/` 则排除这类巧合」——这一格就是那句话的读数。
insert into public.profiles (id, avatar_url) values
  ('00000000-0000-4000-8000-000000100002',
   'https://cdn.example.com/storage/v1/object/public/avatars/xavatars/u/y.png')
on conflict (id) do update set avatar_url = excluded.avatar_url;

-- 项目封面：由 u2 建、指着 u2 上传的 cover.png
insert into public.teams (id, name, slug, plan, owner_id) values
  ('00000000-0000-4000-8000-00000010a001', 'Probe Team', 'probe-team', 'free', '00000000-0000-4000-8000-000000100002')
on conflict (id) do nothing;
insert into public.team_members (team_id, user_id, role) values
  ('00000000-0000-4000-8000-00000010a001', '00000000-0000-4000-8000-000000100002', 'owner')
on conflict do nothing;
insert into public.projects (id, team_id, name, slug, logo_url, created_by) values
  ('00000000-0000-4000-8000-00000010b001', '00000000-0000-4000-8000-00000010a001', 'Probe Project', 'probe-project',
   'https://cdn.example.com/storage/v1/object/public/avatars/avatars/u2/cover.png',
   '00000000-0000-4000-8000-000000100002')
on conflict (id) do nothing;

/* ---------- referenced 的判定 ------------------------------------------- */
select probe.expect(
  'used.png 被 avatar_url 指着 -> 1',
  case when public.upload_object_is_referenced('avatars/u1/used.png') then 1 else 0 end,
  1
);
select probe.expect(
  'cover.png 被 projects.logo_url 指着 -> 1',
  case when public.upload_object_is_referenced('avatars/u2/cover.png') then 1 else 0 end,
  1
);
-- 库里没有 `axb.png`，但即使有：`a_b.png` 的判定不能因为 `_` 而误解成引用。
-- 这一条读的是「没有被任何 url 引用」这个事实本身。
select probe.expect(
  'a_b.png 没有被引用 -> 0（`_` 在 LIKE 里是通配符，后缀相等不会被它骗）',
  case when public.upload_object_is_referenced('avatars/u1/a_b.png') then 1 else 0 end,
  0
);
select probe.expect(
  '尾巴巧合 xavatars/u/y.png 不算引用 avatars/u/y.png -> 0',
  case when public.upload_object_is_referenced('avatars/u/y.png') then 1 else 0 end,
  0
);

/* ---------- 删号前给应用侧的那份清单 ------------------------------------ */
-- 只看 active、只看自己的；referenced 要逐行算对。
select probe.expect(
  'list_user_objects_for_erasure(u1) 返回 3 条 active',
  (select count(*)::int from public.list_user_objects_for_erasure('00000000-0000-4000-8000-000000100001')),
  3
);
select probe.expect(
  'list_user_objects_for_erasure(u1) 里 referenced=true 的只有 used.png',
  (select count(*)::int from public.list_user_objects_for_erasure('00000000-0000-4000-8000-000000100001') where referenced),
  1
);
select probe.expect(
  'list_user_objects_for_erasure 不含已删除的对象（gone.png）',
  (select count(*)::int from public.list_user_objects_for_erasure('00000000-0000-4000-8000-000000100001')
     where object_key = 'avatars/u1/gone.png'),
  0
);

/* ---------- 孤儿集合：active 且没被引用 -------------------------------- */
select probe.expect(
  'find_orphan_upload_objects 找出 a_b.png 与 u/y.png 两条',
  (select count(*)::int from public.find_orphan_upload_objects()),
  2
);
select probe.expect(
  '孤儿集合里没有 referenced 的对象（used.png / cover.png）',
  (select count(*)::int from public.find_orphan_upload_objects()
     where object_key in ('avatars/u1/used.png', 'avatars/u2/cover.png')),
  0
);
select probe.expect(
  '孤儿集合里没有 status=deleted 的行（元数据由保留期清理管，不是孤儿）',
  (select count(*)::int from public.find_orphan_upload_objects() where object_key = 'avatars/u1/gone.png'),
  0
);

/* ---------- 033 的核心主张：删号之后元数据活着 -------------------------- */
delete from auth.users where id = '00000000-0000-4000-8000-000000100001';

select probe.expect(
  '删号后 upload_objects 的 5 行元数据还在（外键是 set null，不是 cascade）',
  (select count(*)::int from public.upload_objects),
  5
);
select probe.expect(
  '删号后 owner_id 变成 null 的正是 u1 的 4 行',
  (select count(*)::int from public.upload_objects where owner_id is null),
  4
);
select probe.expect(
  '删号后「谁上传的」这条线索没了，但对象键与哈希还在（孤儿仍可补删）',
  (select count(*)::int from public.upload_objects
     where owner_id is null and object_key = 'avatars/u1/a_b.png' and length(checksum) = 64),
  1
);

\o
select probe.verify('033 引用判定与删号后的元数据留存');

rollback;
