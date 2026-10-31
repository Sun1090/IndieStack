# Supabase 安全审计基线

`pnpm check:supabase-security` 是迁移与服务端权限的静态门禁，检查：

- 所有 `public` 表是否在迁移中启用 RLS；
- `SECURITY DEFINER` 函数是否固定 `search_path`；
- `SECURITY DEFINER` 函数是否收回了客户端 `EXECUTE`（见下一节）；
- 应用引用的每个 Storage bucket 是否已登记（`STORAGE_BUCKET_INVENTORY`）、是否有建行迁移，
  以及客户端读写策略是否按 `bucket_id` + `auth.uid()` 目录收敛（见 [storage-policy-audit.md](storage-policy-audit.md)）；
- `service_role` 管理客户端是否泄漏到 `use client` 模块；
- 每个 `createAdminClient()` 调用点是否都已分类并保留授权证据（见 service_role 最小权限清单）；
- 每张 `public` 表是否都已**分类**（见下一节 RLS 全表回归）。

## 静态审计状态（2026-09-13；service-role 清点更新至 2026-09-22）

`pnpm check:supabase-security` 通过：迁移与 public 表清单、生效 RLS policy、
Storage bucket 策略（应用引用的每个 bucket 都已登记、由迁移建行，且有按租户收敛的生效策略）、
`SECURITY DEFINER` 执行权限、客户端写入策略、service-role 客户端边界与全部已分类模块
（含每个模块的调用点数）都在门禁里逐条校验；**具体数量以 `pnpm check:supabase-security`
与 `src/lib/security/admin-client-boundary.ts` 为准，本文不复述**——这组数字在过去两周
已经漂移过三次，而复述它的文档不会自己报错。迁移
`024_storage_avatars_policies.sql` 已将 `avatars` bucket（公共读）及按 `auth.uid()` 前缀
约束的 INSERT/UPDATE/DELETE policy 纳入版本控制；bucket 清单、规则与运行时核对见
[docs/db/storage-policy-audit.md](storage-policy-audit.md)。

`031_upload_objects.sql` 新增的 `public.upload_objects` 是另一类 server-only 表：RLS 打开且
零策略，并额外收回了 `anon` / `authenticated` 的表级写权限，只有 service_role 能读写。
数据模型、写入协议与运行时身份矩阵见 [docs/db/upload-metadata.md](upload-metadata.md)。

## SECURITY DEFINER 执行权限（2026-09-13 加固）

PostgreSQL 默认把新函数的 `EXECUTE` 授予 `PUBLIC`，Supabase 的默认权限再额外授予
`anon` / `authenticated` / `service_role`。因此**每个 `SECURITY DEFINER` 函数默认都能被
匿名用户通过 PostgREST `rpc()` 直接调用**，绕过 RLS。

实际受影响并已在 `028_revoke_security_definer_execute.sql` 收口：

| 函数 | 加固前风险 | 加固后 |
|---|---|---|
| `cleanup_old_notifications()` | anon 可强制删除 90 天内通知（数据破坏） | 仅 `service_role` + 属主 |
| `cleanup_old_webhook_events()` | anon 可强制删除 webhook 事件 | 仅 `service_role` + 属主 |
| `cleanup_old_email_worker_runs()` | anon 可强制删除 digest 运行记录 | 仅 `service_role` + 属主 |
| `log_audit_action(...)` | anon 可伪造审计日志行（审计完整性） | 仅 `service_role` + 属主 |
| `claim_webhook_event(...)` | anon 可伪造/抢占 webhook 幂等事件（伪造 `claimed` 或置 `failed` 触发重放） | 仅 `service_role` + 属主 |

`032_data_retention_erasure.sql` 新增的四个函数在建函数的同一迁移里就完成收口，
不再依赖「先暴露、后补 `028`」：

| 函数 | 若未收口的风险 | 现状 |
|---|---|---|
| `erase_user_data(uuid)` | anon 可对任意 user id 触发个人数据擦除（数据破坏 + 越权删除他人审计关联与联系内容） | 仅 `service_role` + 属主 |
| `cleanup_old_api_usage()` | anon 可强制删除 API 使用记录 | 仅 `service_role` + 属主 |
| `prune_deleted_upload_objects()` | anon 可强制清理上传元数据（破坏孤儿巡检依据） | 仅 `service_role` + 属主 |
| `cleanup_resolved_contact_messages()` | anon 可强制删除联系内容 | 仅 `service_role` + 属主 |

`033_upload_object_orphan_audit.sql` 的三个函数同样建函数即收口（它们跨行读取
`profiles.avatar_url` / `projects.logo_url`，客户端可调用等于越权读取他人资料字段）：

| 函数 | 若未收口的风险 | 现状 |
|---|---|---|
| `upload_object_is_referenced(text)` | 探测某个对象键是否被某个人引用（枚举攻击面） | 仅 `service_role` + 属主 |
| `list_user_objects_for_erasure(uuid)` | 列出并进而删除他人对象 | 仅 `service_role` + 属主 |
| `find_orphan_upload_objects()` | 全库对象键与他人资料 URL 的读取 | 仅 `service_role` + 属主 |

**未收口且必须保留客户端 `EXECUTE` 的函数**：`is_team_member` / `is_team_admin` /
`is_team_owner` / `get_profile_role` / `get_profile_email` / `get_project_team_id` /
`get_project_created_by` / `get_team_owner_id` / `get_team_member_count` / `get_team_plan`。
这些函数在 RLS 策略表达式内被引用，而策略以查询角色求值——撤销后策略会直接抛
`permission denied`。触发器函数（`handle_new_user` / `handle_new_team` /
`handle_project_created` / `handle_updated_at`）返回 `trigger`，PostgreSQL 拒绝直接调用，
因此无需撤权。门禁对这两类函数自动豁免，其余 `SECURITY DEFINER` 函数必须有显式
`revoke ... from public, anon, authenticated`，否则 `pnpm check:supabase-security` 失败封闭。

运行时证据（本地 Supabase，`http://127.0.0.1:54321`，真实 PostgREST `rpc` 路径）：

```bash
# 加固前（模拟 028 之前的默认授权）
grant execute on function public.cleanup_old_notifications() to anon;
curl -X POST .../rest/v1/rpc/cleanup_old_notifications -H "Authorization: Bearer $ANON" -d '{}'
# → HTTP 204（删除被执行）

# 加固后
revoke all on function public.cleanup_old_notifications() from public, anon, authenticated;
curl -X POST .../rest/v1/rpc/cleanup_old_notifications -H "Authorization: Bearer $ANON" -d '{}'
# → HTTP 401 {"code":"42501","message":"permission denied for function cleanup_old_notifications"}

# service_role 仍可用（应用侧与运维路径不受影响）
# → HTTP 204
```

同一批次的身份矩阵回归保持 `20/20 通过`（`/tmp/indiestack-identity-028.json`），确认撤权
没有破坏任何合法的 authenticated 路径。

## 客户端写入策略（2026-09-13 加固）

Supabase 会把每个 `public` 表暴露到 PostgREST，因此 RLS policy 是登录会话与"直接写行"
之间唯一的屏障。`src/lib/security/client-write-policies.ts` 对生效后的策略集合
（按版本顺序应用 `create policy` / `drop policy`，等价于数据库最终状态）做两类判定：

1. **server-only 表不得有客户端写策略。** 目前登记 `public.audit_logs`。`service_role`
   具备 `BYPASSRLS`，写入完全不需要策略，所以这类表上任何 `anon` / `authenticated`
   （或未写 `to` 而默认 `public`）的 INSERT/UPDATE/DELETE/ALL 策略都是伪造面，门禁失败封闭。
2. **INSERT policy 的 `WITH CHECK` 不得缺失或恒真。** PostgreSQL 在 `FOR INSERT` 省略
   `WITH CHECK` 时默认按 `true` 处理；`WITH CHECK (true)` 等价于"接受任意行"。

`029_audit_logs_write_lockdown.sql` 修复的就是第 1 类：

| 项 | 加固前 | 加固后 |
|---|---|---|
| `audit_logs` INSERT 策略 | `"Audit logs insertable by authenticated users"`，`with check (auth.role() = 'authenticated')` | 已删除 |
| `anon` / `authenticated` 表级写权限 | INSERT/UPDATE/DELETE/TRUNCATE | 已收回（保留 SELECT，仍由 super_admin 策略限定） |
| 伪造 `user_id` 指向他人 | 可行，`user_id` 无任何约束 | 不可行 |

原策略只判断"调用者是登录用户"，对行内容零约束，所以任意登录用户都能伪造审计记录并把
`user_id` 指向任意已存在用户，污染审计与事后取证。**`appendAuditLog()`
（`src/lib/repositories/audit-logs.ts`）走 `createAdminClient()`，即 `service_role`，
不受影响**；`log_audit_action()` 的客户端 `EXECUTE` 已在 028 收回，因此不存在被删策略打断的
客户端调用方（改前已 grep 全仓 `src/` 确认无其它 `audit_logs` 写入点）。

运行时证据（本地 Supabase，`http://127.0.0.1:54321`，真实 PostgREST 路径）：

```bash
# 加固前：登录用户伪造一条归属受害者的 team.delete
curl -X POST .../rest/v1/audit_logs -H "Authorization: Bearer $AUTHENTICATED" \
  -H "Prefer: return=minimal" \
  -d '{"user_id":"<victim-uuid>","action":"team.delete","entity_id":"victim-team"}'
# → HTTP 201，行落入 audit_logs（已复现后清理）

# 加固后
# → HTTP 403 {"code":"42501","message":"permission denied for table audit_logs"}
# anon INSERT          → HTTP 401 permission denied
# authenticated UPDATE → HTTP 403 permission denied
# service_role INSERT  → HTTP 201（服务端写入路径不变）
# service_role rpc log_audit_action → HTTP 200
```

```sql
-- 加固后权限矩阵
select r as role,
       has_table_privilege(r,'public.audit_logs','insert')   as can_insert,
       has_table_privilege(r,'public.audit_logs','update')   as can_update,
       has_table_privilege(r,'public.audit_logs','delete')   as can_delete,
       has_table_privilege(r,'public.audit_logs','truncate') as can_truncate
from unnest(array['anon','authenticated','service_role']) r;
-- anon          | f | f | f | f
-- authenticated | f | f | f | f
-- service_role  | t | t | t | t
```

同一批次身份矩阵回归保持 `20/20 通过`（`/tmp/indiestack-identity-029.json`）。

**已知边界**：该门禁是静态文本规则，只覆盖 `public` 表上显式书写的策略语句。它不解析
`alter policy`、动态 SQL 或 Supabase Dashboard 里手工改的策略；线上真实授权仍应以
`pg_policies` / `has_table_privilege` 查询为准。

## RLS 全表回归（2026-09-13 加固）

`pnpm check:rls` 原先用一条正则把迁移收敛成"最终策略表"，但策略名捕获写成了
`"?([\w-]+)"?`——只吃**一个单词**。本仓库的策略几乎全部命名为带空格的句子
（`"Users can view own profile"`），于是名字被截断成 `Users`，同一张表上的多条策略在
`Map` 里互相覆盖：门禁只报了 **24** 条策略，实际生效 **35** 条，且漏掉的 11 条从未被校验
`USING` / `WITH CHECK`。

现在的 `pnpm check:rls` 由 `src/lib/security/rls-coverage.ts`（纯函数，单测覆盖）驱动，
与 `scripts/check-supabase-security.js` 共用同一套最终态模型：

| 规则 | 失败码 | 说明 |
|---|---|---|
| 建表后从未开 RLS | `TABLE_MISSING_RLS` | 后迁移里 `disable row level security` 也会命中 |
| RLS 已开但既无策略、也未登记为 server-only | `TABLE_UNCLASSIFIED` | 新表必须显式分类，避免"沉默 deny-all"或"顺手放宽" |
| server-only 表上出现任何生效策略 | `SERVER_ONLY_TABLE_HAS_POLICY` | 被登记为 deny-all 的表一旦出现策略就是一次有意的放宽 |
| `select` / `delete` 策略缺 `using` | `POLICY_MISSING_USING` | 缺 `USING` 等于匹配所有行 |
| `insert` / `update` / `all` 策略缺 `with check` | `POLICY_MISSING_WITH_CHECK` | PostgreSQL 会把缺省的 `WITH CHECK` 当作 `true` |

server-only 白名单（RLS 开启、**零**策略，仅 `service_role` 经 `BYPASSRLS` 访问）：
`email_worker_runs`、`mfa_recovery_codes`、`push_delivery_attempts`、`upload_objects`、
`webhook_events`。

```bash
pnpm check:rls
# ✅ RLS 全表回归通过：33 个迁移、20 张 public 表、35 条生效策略均带 USING / WITH CHECK，且每张表都已分类
```

**与线上目录的交叉验证**（本地 Supabase）：

```sql
select 'public.'||tablename, policyname, cmd, array_to_string(roles, ',')
from pg_policies where schemaname = 'public' order by 1, 2;
```

静态收敛结果与 `pg_policies` **逐条完全一致（35/35，双向零差集）**，说明"最终态"模型没有
多算或漏算策略。

**失败封闭验证**：临时插入 `099_probe_rls.sql` 后——

- `create table public.probe_widgets (...)`（不开 RLS）→ `TABLE_MISSING_RLS`，门禁退出码 1；
- 在 `public.teams` 上追加 `"Probe can write"`（UPDATE，只有 `USING`）与
  `"Probe can read"`（SELECT）→ 新门禁报 `POLICY_MISSING_WITH_CHECK`；
  **同一份迁移文本在旧正则下"无问题"**（两条名字都截断成 `Probe`，后者覆盖前者）。

**已知边界**：只解析迁移文本，不覆盖 `alter policy`、动态 SQL 与 Dashboard 手工策略；
`USING` / `WITH CHECK` 的**谓词是否真正约束租户**仍由运行时身份矩阵与代码评审保证。

## RLS 策略执行取证（`check:rls-probe`，2026-10-31 新增）

上一节的门禁只读文本，它回答的是「这条策略写全了没有」。它回答不了另一类问题：
**这张表压根没写这条策略**。两者在静态视角下几乎同形——`team_members` 有
SELECT / INSERT / DELETE 三条策略，全带 `USING` / `WITH CHECK`，`check:rls` 全绿；
少的那条 UPDATE 策略不违反任何一条静态规则。

代价是实打实的（迁移 036）：PostgREST 的 UPDATE 在 RLS 下**命中 0 行且 `error` 为 null**，
于是 `updateMemberRole()` 走到 `ok()` 返回——前端把下拉框刷成新角色，刷新打回原值。
**一个不报错的失败**，用户只会以为界面坏了，运维侧一行日志都没有。

现在由 `pnpm check:rls-probe` 把这些策略真的**执行**一遍：

```bash
pnpm check:rls-probe
# ✅ RLS 策略执行取证通过：38 个迁移应用成功，9 个探针 / 116 条用例在真库上跑通
```

做法（入口 `scripts/check-rls-probe.js`，IO 在 `scripts/lib/rls-probe-check.js`，
判定在 `src/lib/db/rls-probe.ts`）：

1. 用 `initdb` 起一个一次性 Postgres 集群（临时目录 + 随机空闲端口 + unix socket，跑完即拆）；
2. 应用 `supabase/tests/bootstrap.sql`——Supabase 面的**最小替身**：`auth.uid()` /
   `auth.role()` / `auth.users` / `storage.objects` / `foldername()` / 三个角色；
3. 按序应用 `supabase/migrations/*.sql`（真实迁移，一份不改）；
4. 逐个跑 `supabase/tests/*.sql` 探针，任何一个不通过即整道门禁失败。

**起库之前**还有一步盘点（`auditProbeInventory`），它回答的是「这道门禁自己会不会响」：
一个探针文件只要不抛异常，psql 就退 0，于是下面两种文件**永远是绿的**——

| 形状 | 为什么绿 |
|---|---|
| 只 `probe.expect(...)`、结尾忘了 `probe.verify(...)` | 登记了一堆期望，没有任何人读；psql 退 0 |
| 只 `probe.verify(...)`、一条 `expect` 都没有 | `verify` 里 `count(*) where rows is distinct from want` 在空表上是 0，它打印「0 条全部符合期望」 |

所以每个探针必须 `expect` 与 `verify` 同时存在且计数都不为 0（`--` 注释里的调用不算数）。
实跑取证：塞一个只有 `select probe.verify('空矩阵');` 的探针 → 盘点报
`PROBE_WITHOUT_EXPECTATION`、退出码 1；移除后退出码 0。

**然后是第一次真对账：静态策略集 ↔ 真库策略集。**

上一节的门禁（`check:rls`）读迁移文本，说出「应有 38 条策略、每条都带 `using` / `with check`」。
这句话到 2026-10-31 为止**从没和数据库里真有的策略比过一次**——门禁自己读自己，读法错了也照样绿
（`src/lib/security/rls-coverage.ts` 文件头就记着一次：策略名正则把带空格的名字截成一个词，
同一张表的策略互相覆盖，门禁一直绿着只验了一条）。

现在 `check:rls-probe` 在应用完全部迁移之后，把两边都拿到手比一遍：左侧是迁移文本经
`extractEffectivePolicies` 的结果，右侧是 `pg_policies` 的读数，比「有没有对方没有的策略」、
`command`、`roles`、`using` / `with check` 的有无（**不比表达式文本**：PostgreSQL 会把
`auth.uid()` 重排成 `(auth.uid() = user_id)`，比文本只会比出噪音；而「有没有」正是静态门禁唯一断言的东西）。
只比 `public` schema——`storage.objects` 的策略由 Supabase 初始化脚本创建，替身里没有那部分。

首次读数：**38 条 public 策略，逐条对齐，零处不一致**。

变异取证（两条，写法不同、结论正好说明这件事的性质）：

| 塞进 `supabase/migrations/038_tmp.sql` 的内容 | 读数 |
|---|---|
| `execute 'create policy "Tmp dynamic policy" on public.projects …'`（字面量里就有 `create policy`） | 静态 39 / 真库 39，**对齐** —— 静态提取器把字符串里的语句也当定义，于是两边"恰好"一致 |
| `execute 'create pol' \|\| 'icy "Tmp concat policy" …'`（拼接出来的） | 静态 38 / 真库 39，报 `只在真库：public.projects / Tmp concat policy`，退出码 1 |

第二行才是这条对账的价值：**静态提取是文本匹配**，只要策略不是在文本里以完整形状出现，
它就可能漏；而漏掉的那条会永远不在 `check:rls` 的视野里。第一行同时说明它也可能"多认"。

探针用 `set role authenticated` + `request.jwt.claims` 扮演 PostgREST，用 `row_count` 判读：

| 读数 | 含义 |
|---|---|
| `0` | `USING` 没放行——**安静地什么都没改**（036 之前的每一次更新都是这个读数） |
| `-1` | 命中 `WITH CHECK`，被拒绝（`42501 insufficient_privilege`） |
| `1` | 业务上合法的写入真的落库了 |

两者都不等于「成功」。`supabase/tests/036_team_members_update_probe.sql` 的 8 条矩阵
（普通成员改自己 / admin 改普通成员 / admin 自提 owner / admin 降级 owner /
admin 改 `user_id` / admin 改 `team_id` / 外部人改任意 / owner 降 admin）在 036 前后
分别是 `0,0,0,0,0,0,0,0` 与 `0,1,-1,0,-1,-1,0,1`——**连两条合法更新也命中 0 行**，
这是「假成功」最直接的证据。

**失败封闭验证**（实跑，撤掉 036 后复原）：

- 移走 `036_team_members_update_policy.sql` → 探针报 5 条不符合期望、退出码 1；
- 恢复后 8/8 通过。

**探针覆盖到哪**（九个文件 / 116 条用例）：`036` 的 `team_members` UPDATE 矩阵、
`037` 的 `user_sessions` 写入、`isolation_probe` 的 push / passkey / subscriptions 归属、
`rbac_matrix_probe` 的 30 条 RBAC 矩阵、`030_webhook_idempotency_probe` 的占位与租约接手、
`032_erase_user_data_probe` 的删号擦除（删什么 / 留什么 / 拒绝谁）、
`032_retention_windows_probe` 的三条保留期边界（89/91、29/31、364/366 天）、
`033_upload_objects_probe` 的引用判定与「删号后元数据活着」、
`038_projects_visibility_probe` 的可见性角色口径（见下一节）。

后两个值得单独说：`030` 与 `032` 的语义此前**只在 mock 上验过**——`src/lib/mock/index.ts`
里有 `claimMockWebhookEvent` 与 `eraseMockUserData` 两条 JS 镜像，e2e 与单测验的是镜像。
镜像与 SQL 一致是两处代码的巧合，不是可核对的事实；`032` 尤其危险，它承诺的是
「删号后 30 天内删除或匿名化个人数据」，而那唯一的执行者是 SQL 函数。

### `visibility = 'public'` 的口径（038，2026-10-31）

`projects` 的 SELECT 策略一直是：

```sql
using (auth.uid() in (本队成员) or (visibility = 'public'))
```

**没有 `to` 子句** ⇒ 角色是 `PUBLIC`，`anon` 也算在内。于是「公开项目」这一支对
**未登录访客**成立：任何人是 public 的项目，都能读到它的全部列。

这条通道从 003 起就没有人决定过它是特性还是缺陷——`createProject` 硬编码
`visibility: "private"`、`updateProject` 不接受这个字段、UI 只显示不修改、全仓也没有匿名读
`projects` 的消费方。所以它是**靠没人走到**而安全，不是靠策略挡住。

038 把它收窄成 `to authenticated`，口径取**站内共享**：`visibility = 'public'` 从此刻起
表示「任何登录用户可读」，未登录访客不可读。修前/修后读数（`038_projects_visibility_probe.sql`）：

| 用例 | 修前 | 修后 |
|---|---|---|
| 未登录访客读 public 项目 | **1** | **0** |
| 非成员的登录用户读 public 项目 | 1 | 1 |
| 团队成员读自己团队的 private 项目 | 1 | 1 |

要真做「站外公开」，正确做法不是把 `to authenticated` 删回去，而是：先定产品语义
（哪些列可公开、要不要反枚举与缓存），再单独加一条 `to anon` 的策略并把列收窄成视图或 RPC，
最后在 CHANGELOG 里把它记为对外暴露面的扩大。三步写在 038 的文件头里。

`rbac_matrix_probe.sql` 里那条「anon 读公开」的用例**期望值被有意从 1 改成 0**——
它原来守的是「潜力通道在明面上」，现在守的是**回归**：谁把 `to authenticated` 去掉，它立刻红。

**可用性与边界**：

- **先找，再判缺**：PATH 上凑不齐三件套时，会去 `/opt/homebrew/opt/postgresql@*/bin`、
  `/usr/lib/postgresql/*/bin`、`/usr/pgsql-*/bin` 找一个三件套齐全的目录并接到 PATH 前面。
  这一条来自 CI 的实际形状——GitHub 的 `ubuntu-latest` 自带 PostgreSQL，但 `psql` 在 `/usr/bin`
  而 `initdb` / `pg_ctl` 在 `/usr/lib/postgresql/<ver>/bin`（不在 PATH 上）。
  没有这一步，「缺件就跳过」这条友好设计在 CI 里等于**默认跳过**：门禁跑了、打了 ⚠️、退 0，
  而 RLS 一次没验。实跑取证（本机把 Homebrew 从 PATH 里去掉）：
  `ℹ️ PATH 上没有完整的 PostgreSQL 三件套，改用已安装的 /opt/homebrew/opt/postgresql@16/bin`
  → 116 条用例照跑通。
- 仍然找不到时：**CI（`CI=true`）按失败处理**，本机跳过并打印原因（不静默变绿）；
  也可用 `RLS_PROBE_REQUIRE=1` 显式强制。
- 替身不是 Supabase 的等价物：没有 PostgREST 那一层，所以「命中 0 行」必须靠 `row_count`
  判读而非 HTTP 状态码；`authenticated` 的表权限由探针按需 `grant`。
- 探针是**手写用例**，不是穷举：新增敏感表或策略时应同时补一个探针文件，否则这道门禁
  对它一无所知（这一点与 `falsify:rules` 同源——门禁的价值来自那条用例，不来自脚本本身）。

### 现有探针与读数

| 探针文件 | 覆盖 | 最近一次读数 |
|---|---|---|
| `000_helpers.sql` | 夹具（扮演 PostgREST 的 `probe.write` / `probe.read`） | — |
| `036_team_members_update_probe.sql` | `team_members` UPDATE 的越权矩阵 | 8/8（036 之前是 8 条全 0） |
| `rbac_matrix_probe.sql` | profiles / teams / projects / notifications / api_keys / team_invitations 的跨租户隔离与归属列不可变 | 21/21 |
| `037_user_sessions_probe.sql` | `user_sessions` 的登记 / 刷新 / 吊销（这组用例抓到的是「功能从来没工作过」，不是越权） | 10/10（037 之前是 6 条不符） |
| `isolation_probe.sql` | `push_subscriptions` / `webauthn_credentials` / `subscriptions` 的归属列与只读边界 | 13/13 |

**变异取证**（2026-10-31 实跑）：把 `Users can update own profile` 的 `with check` 从
「`role` 必须等于旧值」放宽成 `auth.uid() = id`，矩阵立刻报
`profiles: 改自己 role -> 拒绝 | 1 | -1` 并退出码 1；恢复原始谓词后重新通过。
这证明矩阵确实在读策略，而不是在复述策略文本。

### 一次读数与直觉不符：`visibility = 'public'` 对 anon 也成立

`rbac_matrix_probe.sql` 里有一条期望值是 **1** 的用例，它是本次审计**发现的一处潜在暴露**，
不是断言错误：

```sql
-- Team members can view projects
using (auth.uid() in (select user_id from team_members where team_id = projects.team_id)
       or visibility = 'public')
```

这条策略没有 `to authenticated`（本仓库全部策略都是 `to public`），
于是 `visibility = 'public'` 这一支对 **anon** 也成立：未登录的互联网用户可以
`GET /rest/v1/projects?visibility=eq.public`。

**今天不构成可利用的洞**：`src/lib/actions/projects.ts` 建项目时硬写 `visibility: "private"`，
没有 UI / Action 能把它改成 public，现存数据里没有公开项目（实测匿名读公开项目返回 1 行，
而这行是本探针自己造的夹具）。它是一条**潜力通道**：任何将来碰 `visibility` 的改动
——新功能、手工 UPDATE、迁移回填——都会让那些项目对匿名用户可读，且没有门禁会报警。

收口需要产品判断，所以没有在本轮单方面改策略。两条路：
① 把策略改成 `to authenticated`（「公开」只对登录用户公开）；
② 保留现状但明确 `visibility` 是「站内共享」，删掉这一支谓词。

## service_role 最小权限清单（2026-09-13 加固）

RLS 只约束 `anon` / `authenticated`；`service_role` 带 `BYPASSRLS`，因此**每一个
`createAdminClient()` 调用点都是一次显式的信任边界决策**。此前没有任何门禁证明这个集合
稳定：新路由只要 `import` 一次 admin client，就能悄悄读写真表，静态检查不会报警。

现在由 `src/lib/security/admin-client-boundary.ts` 做 AST 级清点，并接入
`pnpm check:supabase-security`（因此也在 `pnpm check:all` 内）：

```bash
pnpm check:supabase-security
# ✅ Supabase security audit passed: 33 migrations, 20 public tables,
#    server-only service role checks, 39 effective RLS policies,
#    32 classified service-role call sites
```

### 清点结果

**32 个模块 / 89 个调用点**（本表是清点快照，会随清单变化过期；数字与门禁输出不一致时以
`pnpm check:supabase-security` 与 `src/lib/security/admin-client-boundary.ts` 为准），
按 surface 与信任依据分布（2026-09-23：`teams.member_count` 的重算从 Action / Route 里收进
`src/lib/repositories/teams.ts`（`syncTeamMemberCount`），模块 31 → 32、`data-access` 15 → 16、
调用点 88 → 89——四段重算收进一个仓储模块，总数反而 +1 是因为邀请分支的计数原本走**用户作用域**
客户端（RLS 下只数得到自己可见的行）、写回却由 service_role 完成，现在两步都归到同一条 service_role 链上；
上一次是 2026-09-23 的 A05 给管理面板加了两个只读口径
（`oldestUnsentEmailCreatedAt`、`listRecentEmailWorkerRuns`），调用点 86 → 88，模块数不变；
再上次是 2026-09-22 随 digest 错峰门控删除，
`/api/e2e/profile-timezone` 从清单移除，`e2e-mock-route` 6 → 5、模块 32 → 31、调用点 87 → 86）：

| surface | 模块数 | 信任依据（trust kind） | 说明 |
|---|---:|---|---|
| `data-access` | 16 | `server-internal` | 仓储层，授权由调用方保证 |
| `e2e-mock-route` | 5 | `mock-bearer` | 仅 mock 模式，需 bearer token |
| `server-action` | 3 | `role` / `session` | Server Action 入口 |
| `request-handler` | 1 | `role` | Route Handler 入口 |
| `trusted-worker` | 1 | `cron-secret` | cron digest worker |
| `webhook-handler` | 1 | `webhook-signature` | Stripe 签名校验后处理 |
| `server-component` | 1 | `role` | 管理后台聚合页 |
| `auth-bridge` | 1 | `caller-validated` | 调用方校验 WebAuthn 断言 |
| `server-internal` | 2 | `server-internal` / `caller-validated` | 服务端通知辅助函数与账户删除编排 |
| `storage-adapter` | 1 | `server-internal` | 固定 `avatars` bucket |
| **合计** | **32** | 15 个模块带字面量授权证据 | **89 个调用点** |

被 service_role 触达的表面：15 张表、1 个 bucket（`avatars`）、10 个 RPC
（`claim_webhook_event`，见 [webhook-idempotency.md](./webhook-idempotency.md)；
`erase_user_data`，删号前的个人数据擦除，见 [retention.md](./retention.md)；
`list_user_objects_for_erasure` 与 `find_orphan_upload_objects`，删号前的对象枚举与孤儿审计，
见 [storage-policy-audit.md](./storage-policy-audit.md)；
以及 `/api/cron/retention` 每轮逐个调用的 6 个保留期清理函数
`cleanup_old_notifications` / `cleanup_old_webhook_events` / `cleanup_old_email_worker_runs` /
`cleanup_old_api_usage` / `prune_deleted_upload_objects` / `cleanup_resolved_contact_messages`，
全部 `security definer` + 空 `search_path`，见 [retention.md](./retention.md)），
以及 5 个 `auth.admin` 方法（`deleteUser` / `generateLink` / `getUserById` /
`listFactors` / `deleteFactor`）。`auth.admin` 与跨用户写入是这条清单里权限最高的操作，
都应保持"入口即校验"。账户删除链路因此被拆成
`src/lib/actions/account.ts`（会话 + 确认短语）与 `src/app/api/user/route.ts`（会话）
两个入口，共享同一个 `src/lib/account/deletion.ts` 编排，避免两条路径各自演化。

### 规则与失败模式

| 规则码 | 触发条件 |
|---|---|
| `ADMIN_CLIENT_UNCLASSIFIED` | 模块调用了 `createAdminClient()` 但不在清单里 |
| `ADMIN_CLIENT_STALE_INVENTORY` | 清单收录的模块已不再调用 service_role |
| `ADMIN_CLIENT_CALL_SITE_DRIFT` | 已分类模块新增/减少调用点 |
| `ADMIN_CLIENT_TABLE_NOT_ALLOWED` | 触达未登记的表 |
| `ADMIN_CLIENT_RPC_NOT_ALLOWED` | 触达未登记的 RPC |
| `ADMIN_CLIENT_STORAGE_BUCKET_NOT_ALLOWED` | 触达未登记的 storage bucket |
| `ADMIN_CLIENT_AUTH_ADMIN_NOT_ALLOWED` | 调用未登记的 `auth.admin` 方法 |
| `ADMIN_CLIENT_CLIENT_MODULE` | 含 `"use client"` 的模块引用 admin client |
| `ADMIN_CLIENT_TRUST_EVIDENCE_MISSING` | `trust.evidence` 里的字面量不再出现在源码中 |
| `ADMIN_CLIENT_TRUST_EVIDENCE_FILE_MISSING` | 跨文件证据（`path#symbol`）指向的文件不在审计源集合里 |

**失败封闭验证**（临时探针，验证后已清理，退出码均为 1）：

- 新增 `src/app/api/__gate-probe/route.ts` 调用 `createAdminClient()` →
  `ADMIN_CLIENT_UNCLASSIFIED`；
- 在 `cron/digest` 已分类模块内追加 `admin.from("secret_table")` →
  `ADMIN_CLIENT_TABLE_NOT_ALLOWED`（只报未登记的那一项，已登记的不误报）。
- 把 passkey 调用方的 `verifyAssertion` 改名（旧名只剩在新名里当子串）→
  `ADMIN_CLIENT_TRUST_EVIDENCE_MISSING`；把它整体挪进注释 → 同一条红。两者均已复原并 `cmp` 核对。

### 信任证据模型

清单条目记录 `surface`（模块在系统中的位置）、`trust.kind`（授权模型）与
`trust.evidence`（**必须保持存在的源码字面量**，例如 `isCronAuthorized`、
`constructEvent` + `STRIPE_WEBHOOK_SECRET`、`safelyRequireRole`、`timingSafeEqual`）。
证据缺失即 `ADMIN_CLIENT_TRUST_EVIDENCE_MISSING`，这样"把 guard 删掉"这种改动
不会因为清单文本没变而被静默放过。

`mock-bearer` 类入口要求 `isMockEnabled` 与 `E2E_BEARER_TOKEN` **同时**存在，
避免只留 mock 开关就暴露了跨用户读写。

证据匹配有三条硬规矩，都是 2026-10-12 实测出来的（此前每一条都能被绕过）：

1. **注释不算证据**。判定在 `stripComments()` 之后进行。原先拿原始文本做 `includes`，
   于是模块里任何位置——JSDoc、行注释、被注释掉的旧实现——出现过那串字符，
   这条授权判断就算"有据可查"。**一行注释就能关掉一道安全门禁，而门禁不会说**：
   实测把证据符号从真实代码里删干净、只在注释里留一句，门禁只剩 `CALL_SITE_DRIFT` 一条，
   evidence **全过**。已核对的爆炸半径：origin/main 的 24 条 evidence 里**只有 1 条**因此
   由绿转红——`src/lib/auth/passkey-session.ts` 的 `["调用方必须先确认"]`，
   一句只存在于 JSDoc 里的中文散文，也就是说那条门禁**一直在靠注释通过**。
2. **子串不算命中**。`requireAdmin` 不再被 `requireAdminToo()` 满足：匹配带 `[\w$]` 词边界
   （不用 `\b`，因为 JS 标识符允许 `$`，且证据可能以非词字符结尾，如 `deleteUser(userId)`）。
   实测加边界后 24 条 evidence **0 条**假红。
3. **跨文件证据写作 `path/in/repo.ts#symbol`**，沿用 `src/lib/security/route-auth.ts` 的既有约定。
   这是 `caller-validated` 唯一诚实的记法：授权本来就不在被审计的模块里。
   被引用文件**不在审计源集合里时判红**（`ADMIN_CLIENT_TRUST_EVIDENCE_FILE_MISSING`）而不是静默跳过——
   指向不存在之处的引用不是证据，静默跳过等于把这条登记降级成装饰性文字。

### 已知边界

- `surface` / `rationale` 是**审计文档**，不参与判定；门禁只校验调用点、操作集合与证据字面量。
- 证据是字面量存在性检查，**不评估谓词语义**：`if (!isCronAuthorized)`（取反）也能通过。
  真正约束由代码评审与运行时身份矩阵保证。
- 同理，跨文件证据只回答"那个符号还在那个文件里活着"，**不回答"它还在授权路径上被调用"**：
  实测删掉 `await verifyAssertion(...)` 而保留函数定义，门禁仍绿。
  要收紧到调用可达性，得复用 `route-auth.ts` 的闭包遍历，那是另一件事。
- 操作按**模块**而非变量收集：模块内只要有 `createAdminClient()`，其余 `.from(...)`
  也要求登记。这是刻意的保守选择，宁可多要一次评审。
- `Buffer.from()` / `Array.from()` 等内建 `.from()` 已加入豁免表；未知接收者仍保守计入。
- 只解析提交到仓库的 TypeScript；运行期拼接的表名、动态 SQL 与 Dashboard 侧配置不在范围内。

### 配套收口：健康检查不再持有 service_role

`/api/health` 是**未鉴权**的公开端点，此前用 `createAdminClient()` 做可达性探测。
现在改用 `anon` key（`auth: { autoRefreshToken: false, persistSession: false }`）
证明 PostgREST 可达，公开端点不再接触 `BYPASSRLS` 凭据。

readiness 仍要求三个 Supabase 凭据齐全并新增了回归用例：探测走 anon，但 webhook /
cron / 跨用户写入依赖 `service_role`，缺它属于部署配置错误，必须报 503 且**不发起探测**。

## 运行时身份矩阵（2026-09-12）

静态检查不等价于数据库运行时 RLS 回归，因此本仓库补上了真实运行时的身份矩阵脚本：

```bash
# 前置：本地 Supabase 已启动并完成迁移 + seed
pnpm exec supabase start
pnpm exec supabase db reset        # 全部迁移 + supabase/seed.sql

pnpm smoke:supabase-identity -- --output /tmp/indiestack-identity-matrix.json
```

脚本通过真实 Auth + PostgREST + Storage API 执行，不使用 mock：

- `anon` / `authenticated` / `service_role` 三种身份；
- 两个隔离租户与三张项目（含一张私有项目）；
- `profiles`、`teams`、`projects` 的跨租户可见性；
- `avatars` bucket 的公共读、按前缀写入/更新/删除、跨前缀拒绝；
- 临时对象与临时状态在结束时清理。

最近一次结果（`2026-09-12T05:12:32Z`，target `http://127.0.0.1:54321`）：

| 身份 | avatars 读取 | 写入自身前缀 | 写入他人前缀 | 删除自身 | 删除他人 |
|---|---:|---:|---:|---:|---:|
| anon | 允许（公共桶设计） | 拒绝 | 拒绝 | 拒绝 | 拒绝 |
| authenticated | 允许 | 允许 | 拒绝 | 允许 | 拒绝 |
| service_role | 允许 | 允许 | 允许 | 允许 | 允许 |

证据：`/tmp/indiestack-identity-matrix.json`（20/20 通过，0 失败）。运行器不提交该
JSON；发布记录需要附上本次输出或 CI artifact。

局限：本矩阵只在**本地 Supabase 或受控 staging** 上执行。生产环境有副作用的场景
（真实账号登录、合法/非法上传、邮件与通知发送）仍未被自动化覆盖，不能用本矩阵替代。

如果选择 private bucket，必须同步修改 `src/lib/storage/index.ts` 的 `getPublicUrl()`
为 signed URL，并更新上述矩阵与 smoke test；当前实现明确选择公共读以保持现有图片 URL
兼容性。任何新增 bucket 都要先在 `STORAGE_BUCKET_INVENTORY` 登记读取模型，否则
`pnpm check:supabase-security` 直接失败封闭（清单与规则见
[docs/db/storage-policy-audit.md](storage-policy-audit.md)）。

## 迁移与回滚说明

`024_storage_avatars_policies.sql` 是前向迁移：创建/更新 `avatars` bucket 并添加四条
对象策略。发布前应先确认现有 bucket 的 public 属性与应用的 `getPublicUrl()` 访问模型
一致。不要直接删除 `storage.objects` policy 或 bucket 作为常规回滚，因为这会改变现有
对象的可读性并可能造成数据不可见；代码回滚应保留兼容的 schema。若确需撤销，必须在
维护窗口内执行经审查的前向修复/逆向 SQL，并先导出 bucket 配置与策略快照。

## Seed 数据安全边界

`supabase/seed.sql` 现在是自包含、可重复执行的确定性种子：它先写入 `auth.users`
（`seed-owner-a@example.com` / `seed-owner-b@example.com` / `seed-member-a@example.com`，
统一密码 `indiestack-local`），再写入两个隔离团队、三个项目、订阅、邀请、API key、
会话、审计、通知与 usage 数据。

- 仅用于 **local / staging**；生产禁止执行该 seed。
- 密码是公开的固定值，不要在对外可访问环境使用。
- 身份矩阵脚本依赖这些固定 UUID 与密码，修改 seed 时需同步
  `scripts/verify-supabase-identity.js` 的常量。
