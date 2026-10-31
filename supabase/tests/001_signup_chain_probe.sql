-- =============================================================================
-- 注册触发链：一个 auth.users 行应该连带产生什么
--
-- 为什么补这一份：`handle_new_user` 与 `handle_new_team` 是**所有注册的必经之路**——
-- 它们不跑或跑错，每个新用户都会缺 profile、缺个人团队、或缺 owner 成员行，
-- 而报错点会落在很久之后（第一次写项目时才发现「你的团队不存在」）。
-- 这两个函数此前只有读代码这一种验证方式：它们没有 TS 实现，也没有 mock 镜像，
-- 连 `check:rls` 都只是把它们当静态文本扫过去。
--
-- 还有一格是安全面的：Supabase 注册时 `options.data` 会进 `raw_user_meta_data`，
-- 那是**客户端可控**的。`handle_new_user` 如果照着 metadata 里的 role 写 profiles.role，
-- 任何人注册时自称 super_admin 就成了超管。这一格必须钉住。
-- =============================================================================

begin;

truncate probe.case;
\o /dev/null

-- 新用户 1：metadata 里自称 super_admin（这是攻击者能控制的那一段）
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-000000200001', 'newbie@probe.local',
   '{"full_name":"New Bie","avatar_url":"https://x/y.png","role":"super_admin"}'::jsonb);

-- 新用户 2：metadata 里什么都没有（最小注册）
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000200002', 'plain@probe.local');

/* ---------- handle_new_user -------------------------------------------- */
select probe.expect(
  '注册后自动建 profile（2 个用户 2 行）',
  (select count(*)::int from public.profiles
     where id in ('00000000-0000-4000-8000-000000200001', '00000000-0000-4000-8000-000000200002')),
  2
);
select probe.expect(
  '新用户默认角色是 member',
  (select count(*)::int from public.profiles
     where id = '00000000-0000-4000-8000-000000200002' and role = 'member'),
  1
);
-- 这一格是本文件最要紧的一条：metadata 里的 role 必须被忽略。
select probe.expect(
  '**metadata 里自称 super_admin 不被采纳**（仍是 member）',
  (select count(*)::int from public.profiles
     where id = '00000000-0000-4000-8000-000000200001' and role = 'member'),
  1
);
select probe.expect(
  'profile.email 与 auth.users.email 一致',
  (select count(*)::int from public.profiles p
     join auth.users u on u.id = p.id
     where p.id = '00000000-0000-4000-8000-000000200001' and p.email = u.email),
  1
);
select probe.expect(
  'full_name / avatar_url 从 metadata 取到了',
  (select count(*)::int from public.profiles
     where id = '00000000-0000-4000-8000-000000200001'
       and full_name = 'New Bie' and avatar_url = 'https://x/y.png'),
  1
);
select probe.expect(
  '没有 metadata 的用户不会被写坏（full_name 为 null 而不是空串/报错）',
  (select count(*)::int from public.profiles
     where id = '00000000-0000-4000-8000-000000200002' and full_name is null),
  1
);

/* ---------- handle_new_team -------------------------------------------- */
select probe.expect(
  '注册后自动建个人团队（2 个用户 2 个团队）',
  (select count(*)::int from public.teams
     where owner_id in ('00000000-0000-4000-8000-000000200001', '00000000-0000-4000-8000-000000200002')),
  2
);
select probe.expect(
  '个人团队的 slug 是 personal-<uuid 去掉横线>',
  (select count(*)::int from public.teams
     where slug = 'personal-00000000000040008000000000200001'),
  1
);
select probe.expect(
  '注册后自己在团队里是 owner',
  (select count(*)::int from public.team_members tm
     join public.teams t on t.id = tm.team_id
     where tm.user_id = '00000000-0000-4000-8000-000000200001' and tm.role = 'owner' and t.owner_id = tm.user_id),
  1
);
select probe.expect(
  '每个用户恰好一个团队成员行（没重复插）',
  (select count(*)::int from public.team_members
     where user_id = '00000000-0000-4000-8000-000000200002'),
  1
);

\o
select probe.verify('注册触发链：profile / 个人团队 / owner 成员行 / 角色不可自报');

rollback;
