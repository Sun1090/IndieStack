-- =============================================================================
-- 038 的口径：`visibility='public'` 是「站内共享」还是「站外可读」
--
-- 背景：projects 的 SELECT 策略是
--     using (auth.uid() in (团队成员) or (visibility = 'public'))
-- 而**没有 `to` 子句** ⇒ 角色是 `public`，也就是 anon 也算在内。
-- 于是「公开项目」这一支对**未登录访客**成立。
--
-- 今天不可利用：`createProject` 把 visibility 硬编码成 'private'，
-- `updateProject` 不接受这个字段，也没有任何 UI 能改它——所以库里没有一行是 public。
-- 但这是「靠没人走到」而不是「靠策略挡住」：将来谁接上公开项目的写入路径，
-- 未登录访客就立刻能读到该项目的全部列。
--
-- 本文件把三件事钉住：
--   1. 团队成员读自己团队的项目 → 可见；
--   2. 非成员的**登录用户**读 public 项目 → 可见（站内共享，保持原语义）；
--   3. 非成员的**未登录访客**读 public 项目 → 不可见（这是 038 收紧的部分）。
-- 第 3 条在 038 之前读数是 1，之后是 0。
-- =============================================================================

begin;

truncate probe.case;
\o /dev/null

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000300001', 'owner@probe.local'),
  ('00000000-0000-4000-8000-000000300002', 'member@probe.local'),
  ('00000000-0000-4000-8000-000000300003', 'outsider@probe.local');

insert into public.teams (id, name, slug, plan, owner_id) values
  ('00000000-0000-4000-8000-00000030a001', 'Vis Team', 'vis-team', 'free',
   '00000000-0000-4000-8000-000000300001')
on conflict (id) do nothing;

insert into public.team_members (team_id, user_id, role) values
  ('00000000-0000-4000-8000-00000030a001', '00000000-0000-4000-8000-000000300001', 'owner'),
  ('00000000-0000-4000-8000-00000030a001', '00000000-0000-4000-8000-000000300002', 'member')
on conflict do nothing;

-- 一行 private、一行 public（public 那行是「将来的公开项目」的形状）
insert into public.projects (id, team_id, name, slug, visibility, created_by) values
  ('00000000-0000-4000-8000-00000030b001', '00000000-0000-4000-8000-00000030a001',
   'Secret Project', 'secret-project', 'private', '00000000-0000-4000-8000-000000300001'),
  ('00000000-0000-4000-8000-00000030b002', '00000000-0000-4000-8000-00000030a001',
   'Shared Project', 'shared-project', 'public', '00000000-0000-4000-8000-000000300001')
on conflict (id) do nothing;

-- anon 那个用户是 null：probe.read(null, …) 就是「未登录访客」
select probe.expect(
  '团队成员读自己团队的 private 项目 -> 可见',
  probe.read('00000000-0000-4000-8000-000000300002', $$select id from public.projects where id = '00000000-0000-4000-8000-00000030b001'$$),
  1
);
select probe.expect(
  '非成员读别人的 private 项目 -> 不可见',
  probe.read('00000000-0000-4000-8000-000000300003', $$select id from public.projects where id = '00000000-0000-4000-8000-00000030b001'$$),
  0
);
select probe.expect(
  '非成员的登录用户读 public 项目 -> 可见（站内共享）',
  probe.read('00000000-0000-4000-8000-000000300003', $$select id from public.projects where id = '00000000-0000-4000-8000-00000030b002'$$),
  1
);
select probe.expect(
  '**未登录访客**读 public 项目 -> 不可见（038 收紧）',
  probe.read(null, $$select id from public.projects where id = '00000000-0000-4000-8000-00000030b002'$$),
  0
);
select probe.expect(
  '未登录访客读 private 项目 -> 不可见',
  probe.read(null, $$select id from public.projects where id = '00000000-0000-4000-8000-00000030b001'$$),
  0
);

\o
select probe.verify('038 projects 可见性：站内共享 vs 站外可读');

rollback;
