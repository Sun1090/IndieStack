# 数据保留策略

> v0.4.0 D05 建立，v0.8.x 补齐 Push 队列与邮件 worker 运行记录（迁移 `027`），
> H08 补齐 API 使用记录、已删除上传元数据、已处理联系内容的保留期，
> 以及账户删除时的个人数据擦除（迁移 `032`）。
> 定时清理分两条链路：**执行**由平台 cron worker 负责（`/api/cron/retention`，每天 05:00 UTC，
> 用 service_role 逐个调用迁移 `003` / `014` / `027` / `032` 里已定义的清理函数，不依赖 pg_cron）；
> 迁移里那组 pg_cron 周调度（`04:00`–`05:00` 错峰）仍是同一批 SQL 的另一个调度器，
> 启用后与平台 worker 并存也只是重复执行同一条件、结果幂等。
> Push 队列由 `/api/cron/push-retry` 自己每轮清理（见下表）。
> 擦除不是定时任务：`erase_user_data()` 在删号前由应用侧同步调用。

| 数据                                     | 保留期                                                  | 机制                                                        | 调度                    |
| ---------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------- | ----------------------- |
| notifications（已读）                    | 90 天                                                   | `cleanup_old_notifications()`（003 建）                     | 每天 05:00（`/api/cron/retention`） |
| notifications（未读）                    | 永久（用户手动标已读后进入 90 天窗口）                  | 同上                                                        | 同上                    |
| webhook_events（全部状态）               | 90 天                                                   | `cleanup_old_webhook_events()`（014 建）                    | 每天 05:00（`/api/cron/retention`） |
| email_worker_runs（digest 运行记录）     | 90 天                                                   | `cleanup_old_email_worker_runs()`（027 建）                 | 每天 05:00（`/api/cron/retention`）            |
| push_delivery_attempts（`sent`）         | 7 天                                                    | `prunePushDeliveryAttempts()`（应用侧，worker 每轮调用）    | 每天一次（cron 路由） |
| push_delivery_attempts（`dead`）         | 30 天                                                   | 同上                                                        | 同上                    |
| push_delivery_attempts（`pending`）      | 永久（失败重试的上限由 `attempt_count` + 死信状态约束） | 永不被清理（清理只按 `sent`/`dead` 状态与时间窗删除）       | —                       |
| audit_logs                               | 永久（合规需要，删改走变更流程；账户删除时匿名化）      | 无自动清理；`erase_user_data()`（032）在删号前剔除身份连接            | —                       |
| contact_messages（`resolved`）             | 365 天                                                  | `cleanup_resolved_contact_messages()`（032 建）                        | 每天 05:00（`/api/cron/retention`）            |
| contact_messages（`new` / `in_progress`）  | 永久（未处理的求助不能被定时删掉）                      | 无自动清理（清理语句按状态过滤，永不含这两个状态）                     | —                       |
| api_usage                                  | 90 天                                                   | `cleanup_old_api_usage()`（032 建）                                    | 每天 05:00（`/api/cron/retention`）            |
| upload_objects（`deleted`）                | 30 天                                                   | `prune_deleted_upload_objects()`（032 建）                              | 每天 05:00（`/api/cron/retention`）            |
| upload_objects（`active`）                 | 永久（对象是否应存在的唯一依据，删了就找不到孤儿）      | 无自动清理                                                             | —                       |

## 账户删除时的个人数据擦除（H08）

外键级联不等于个人数据擦除。`032_data_retention_erasure.sql` 的 `erase_user_data(uuid)`
处理级联覆盖不到的三类：

| 数据面                          | 级联行为                        | 擦除动作                                                            |
| ------------------------------- | ------------------------------- | ------------------------------------------------------------------- |
| `api_usage`                     | `user_id` `on delete set null`  | 整行删除（`ip_address` 是个人数据，失去指向的残留没有合规价值）      |
| `contact_messages`              | 没有外键（只有裸 `email` 文本） | 按该账户邮箱匹配删除（大小写与首尾空白无关）                         |
| `audit_logs`                    | `user_id` `on delete set null`  | **匿名化**：`user_id` 置空、`entity_id` 指向该用户时置空、`metadata` 剔除 `email` / `ip_address` / `user_agent` 等 PII 键 |

顺序是刻意的：**先擦除、再删号**。删号之后再想按账户反查邮箱已经不可能，
`contact_messages` 将永远无法被清除。因此 `src/lib/account/deletion.ts` 在擦除失败时
直接中止，不给「号删了、数据没擦」这条路；删除成功后的审计补记失败只记日志，
因为账户删除本身已不可回滚，不能把成功报成失败。

被删除/匿名化的行数由 RPC 返回（`apiUsage` / `contactMessages` / `auditLogsAnonymized`），
`parseAccountErasureCounts()` 对形状不符的返回值抛错——详见
`src/lib/privacy/data-policy.ts`，该模块是保留天数、cron 任务名、PII 键与确认短语的
单一事实来源，`src/lib/privacy/data-policy.test.ts` 把它与本文件和迁移 SQL 双向钉死。

## 设计约束

- **单一状态每轮最多清理 1000 行**（应用侧 Push 队列）：历史积压远超单轮上限时需要多轮 cron 收敛，
  每轮上报 `push.queue.pruned{status,retention_days}`，清理失败只上报
  `push.queue.prune_failed` 且**不影响投递**。
- **`pending` 永不清理**：待重试行代表尚未投递的用户通知，删除即静默丢消息。
- **`new` / `in_progress` 联系内容与 `active` 上传元数据永不清理**：前者是还没处理的用户求助，
  后者是「数据库认为应该存在的对象」集合，删掉就再也无法枚举孤儿对象（031 的设计前提）。
- **SQL 侧清理是批量删除**：`security definer` + 空 `search_path`，只按时间窗与状态列删除，
  不读取业务字段；pg_cron 任务名固定，重放迁移是幂等更新而不是新增任务。
- **时间窗清理配局部索引**：`upload_objects(updated_at) where status='deleted'`、
  `contact_messages(created_at) where status='resolved'`（032），避免为一次性删除扫全表。
- **清理函数只对服务端开放**：迁移 `028` 收回了 `cleanup_old_notifications()` /
  `cleanup_old_webhook_events()` / `cleanup_old_email_worker_runs()` 与 `log_audit_action()`
  对 `PUBLIC` / `anon` / `authenticated` 的 `EXECUTE`（PostgreSQL 默认授予 PUBLIC），
  只保留 `service_role` 与函数属主。pg_cron 任务以属主身份执行，不受影响；匿名用户此前可直接
  `rpc('cleanup_old_notifications')` 强制删除数据。细节与运行时证据见
  [security-audit.md](./security-audit.md)。`032` 的四个新函数在建函数时就带同样的撤权，
  不再依赖「事后补一刀」。
- 清理周期与业务表索引匹配：`email_worker_runs(created_at desc)`、`webhook_events(created_at)`、
  `notifications(created_at)`、`push_delivery_attempts(status, sent_at / last_attempt_at)`、
  `api_usage(created_at)`（既有）、032 的两个局部索引。

## 保留期由平台 worker 执行，不再依赖 pg_cron

历史上这些清理只有 SQL 侧调度，且都写成 `if exists (select 1 from pg_extension where extname = 'pg_cron')`
的守卫形式——未安装扩展的环境会**静默跳过**：迁移照样成功、`check:migrations` 照样通过、
`/api/health` 也不会报错，但保留期一行都不会删。

2026-09-21 复核：本地开发库与云端项目 `ntqggnztzvoavjbiillb` 的 `pg_extension`
都只有 `plpgsql / uuid-ossp / pgcrypto / pg_stat_statements / supabase_vault`，
**没有 `pg_cron`**，因此 `cron.job` 关系根本不存在，本文登记的每周清理在实际数据库里
从未执行过。`032` 之前只有 `docs` 里那句「生产需确认扩展已启用」，没有任何证据说明它做没做。

现在的执行者是 `/api/cron/retention`（每天 05:00 UTC，登记在 `src/lib/observability/cron-contract.ts`
并由 `pnpm check:cron-contract` 校验接线）：它用 service_role 逐个调用同一批迁移函数。于是

- 保留期不再要求任何人去 Dashboard 装扩展；删除逻辑仍然只有迁移 SQL 一个事实源；
- 迁移里的 pg_cron 周调度保持原样（迁移不可改写）。日后若启用扩展，两条链路跑的都是
  `now() - <retention>` 这同一组条件，重复执行幂等；
- 单个函数失败只影响那张表：上报 `cron.retention.cleanup_failed{cleanup_function}` 后继续下一个，
  只有全部失败才让整轮返回 500——否则平台调度记录会显示成功，而过期数据一直在堆积；
- 账户删除的 `erase_user_data()` 仍由删号流程同步调用，与这两条链路都无关。

## 运维检查

保留期的执行者是 `/api/cron/retention`：要确认它真的在跑，看平台 Cron Jobs 的调用记录，
以及 `cron.retention.completed` 是否每天有一条样本（部分失败看 `cron.retention.cleanup_failed`）。
下面的 SQL 用于核对权限收口，以及（可选的）pg_cron 注册。

```sql
-- pg_cron 现在只是第二个可选调度器：返回 0 行不代表保留期失效，只代表迁移里那组周调度没注册
select extname from pg_extension where extname = 'pg_cron';

-- 若确实启用了 pg_cron，应看到这六个任务；未启用时 0 行是正常的
select jobname, schedule, active from cron.job order by jobname;

-- 确认清理函数没有对匿名/登录用户开放（应全部为 f，service_role 为 t）
select p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('cleanup_old_notifications', 'cleanup_old_webhook_events',
                    'cleanup_old_email_worker_runs', 'log_audit_action',
                    'cleanup_old_api_usage', 'prune_deleted_upload_objects',
                    'cleanup_resolved_contact_messages', 'erase_user_data');

-- 手动触发一次（演练，只影响早于保留期的行）
select public.cleanup_old_notifications();
select public.cleanup_old_webhook_events();
select public.cleanup_old_email_worker_runs();
select public.cleanup_old_api_usage();
select public.prune_deleted_upload_objects();
select public.cleanup_resolved_contact_messages();

-- 清理前后行数与最老时间戳
select count(*) as total, min(created_at) as oldest from public.email_worker_runs;

-- 擦除链路演练（032）：造一个用户与其三类个人数据，验证「先擦后删」真的擦得干净
-- 期望：api_usage 0 行、该邮箱的 contact_messages 0 行、
--       audit_logs 该用户行数仍在但 user_id / entity_id / metadata 里的 PII 键都消失
begin;
insert into auth.users (id, email, instance_id, aud, role, email_confirmed_at)
values ('00000000-0000-0000-0000-0000000000aa', 'erase.me@example.com',
        '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now());
insert into public.api_usage (user_id, path, method, status_code, ip_address)
values ('00000000-0000-0000-0000-0000000000aa', '/api/x', 'GET', 200, '203.0.113.9');
insert into public.contact_messages (name, email, subject, message, status)
values ('Erase Me', 'Erase.Me@Example.com', 'hi', 'secret content', 'new');
insert into public.audit_logs (user_id, action, entity_type, entity_id, metadata)
values ('00000000-0000-0000-0000-0000000000aa', 'team.invite', 'team', 't-1',
        '{"email":"erase.me@example.com","ip_address":"203.0.113.9","role":"admin"}');

select public.erase_user_data('00000000-0000-0000-0000-0000000000aa');
-- 幂等：第二次调用三类计数都应为 0
select public.erase_user_data('00000000-0000-0000-0000-0000000000aa');
-- 缺参数必须拒绝，而不是静默no-op
-- select public.erase_user_data(null);  -- ERROR: erase_user_data requires a user id
rollback;
```

```bash
# Push 队列保留策略的端到端断言（Mock 模式，无需真实 Supabase）
pnpm test:e2e -- e2e/push-retry.spec.ts

# 队列清理与回执的单测
pnpm vitest run src/lib/repositories/push-delivery-attempts.test.ts \
  src/app/api/cron/push-retry/route.test.ts
```

## 演练记录

### 2026-09-22 · 账户删除全链路（本地 Supabase，`001`–`033` 已应用，事务内回滚）

脚本已入库：`docs/operations/drills/account-erasure.sql`（含运行命令与断言清单）。

```bash
docker exec -i supabase_db_indiestack psql -U postgres -d postgres \
  -v ON_ERROR_STOP=1 -f - < docs/operations/drills/account-erasure.sql
```

- `erase_user_data()` 返回 `{"apiUsage": 2, "contactMessages": 2, "auditLogsAnonymized": 3}`；
  本人 `api_usage` 归零、他人那条保留；`contact_messages` 三种邮箱写法（大小写混排 + 前后空格）
  按 `lower(btrim(email))` 命中两条，他人邮箱保留。
- `audit_logs` 四条行数不变（合规留存），本人三行 `user_id` 置空、指向本人的 `entity_id` 置空、
  指向他人的 `project-42` 保留；`metadata` 剔掉 `email`/`ip`/`user_agent`/`avatar_url` 但保留
  `keepMe`/`name`/非 PII 键；非 object 的历史脏 `metadata` 整体清成 `{}` 而不是报错中断擦除。
- **顺序证据**：`profiles` 行在擦除之后、删号之前仍为 1 行；删号后才随级联消失——
  这正是「先擦除、再删号」，反过来做会留下无法反查归属的个人数据。
- **对象证据**：删号后本人两条 `upload_objects` 行仍在且 `owner_id is null`，其中仍被
  `profiles.avatar_url` 指着的那条出现在 `find_orphan_upload_objects()`（等补删），
  `status='deleted'` 的那条不再出现；他人团队项目封面因 `projects.logo_url` 仍引用而不进清单。
- 引用判定反例同时验证：`xavatars/<uid>/drill.png`（前缀巧合）判为未引用，
  `<uid>/drill.png` 判为被引用；同名末段（`drill.png`）判为**被引用**——保守方向，见
  `docs/db/upload-metadata.md` 的精确度说明。
- **权限矩阵按真实调用验证**（不只是查 `has_function_privilege`）：`anon` 与 `authenticated`
  对 032/033 的 7 个函数（`erase_user_data`、3 条保留期清理、2 个对象清单函数、引用判定）
  全部 `permission denied`（14/14），`service_role` 可正常调用。

**仍未取得的生产证据**：真实 `auth.admin.deleteUser`（演练里用 `delete from auth.users` 等价替代，
级联语义相同但没走 GoTrue 的会话清理）、真实 bucket 对象删除、隔离账号在**生产**上的删号闭环。
这三项需要 Vercel/Supabase 侧权限与一个可牺牲账号，见 `docs/operations/production-smoke-v0.11.0.md`。

## 变更痕迹

- `003_projects_notifications_indexes.sql`：`cleanup_old_notifications()`
- `014_retention_cleanup.sql`：`cleanup_old_webhook_events()` + 两条 pg_cron 调度
- `026_push_delivery_attempts.sql`：队列表与状态/时间索引（保留期由应用侧 worker 执行）
- `027_email_worker_runs_retention.sql`：`cleanup_old_email_worker_runs()` + pg_cron 调度
- `028_revoke_security_definer_execute.sql`：收回清理/审计写函数的客户端 `EXECUTE`
- `031_upload_objects.sql`：上传元数据表（`status` 区分 active / deleted，为孤儿巡检留依据）
- `033_upload_object_orphan_audit.sql`：`upload_objects.owner_id` 改为 `on delete set null`
  （元数据活过账户删除）+ `upload_object_is_referenced()` / `list_user_objects_for_erasure()` /
  `find_orphan_upload_objects()` 引用判定与孤儿清单
- `032_data_retention_erasure.sql`：`erase_user_data()` 个人数据擦除 +
  `cleanup_old_api_usage()` / `prune_deleted_upload_objects()` /
  `cleanup_resolved_contact_messages()` 三条保留期 + 两个局部索引 + 三条 pg_cron 调度
  + 建函数即撤客户端 `EXECUTE`
