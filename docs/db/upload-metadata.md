# 上传对象元数据（H02）

> v0.8.x H02 建立。迁移：[`031_upload_objects.sql`](../../supabase/migrations/031_upload_objects.sql)，
> 仓储：[`src/lib/repositories/upload-objects.ts`](../../src/lib/repositories/upload-objects.ts) +
> [`src/lib/uploads/service.ts`](../../src/lib/uploads/service.ts)，
> 哈希：[`src/lib/uploads/checksum.ts`](../../src/lib/uploads/checksum.ts)。

## 为什么需要

在 H02 之前，`avatars` bucket 里的每个对象只以「公共 URL 字符串」的形式存在于业务表
（`profiles.avatar_url` / `projects.logo_url`）。对象本身除了 bucket 列表之外没有任何登记，
留下三个治理盲区：

| 盲区 | 具体后果 |
| --- | --- |
| 没有对象属性记录 | 无法回答「这个公开对象是谁传的、多大、什么类型、内容是否被换过」 |
| 孤儿对象不可枚举 | 回写业务表失败、进程在 `put` 之后被杀、替换头像，都会留下**永久可公开读取**且无人引用的对象 |
| 保留期 / 配额 / 审计无数据源 | 只能遍历 bucket 列表，成本高且无法按上传者聚合 |

因此引入 `public.upload_objects`：**每次成功 `put` 落一行**，`status = 'active'` 的行集合就是
「数据库认为应该存在的对象」，可与 bucket 实际列表比对找出孤儿。

## 数据模型

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `uuid` | 主键，`gen_random_uuid()` |
| `bucket` | `text not null` | 对象所属 bucket（当前只有 `avatars`，见 H05 storage 门禁） |
| `object_key` | `text not null` | provider 侧完整对象键，形如 `avatars/<userId>/<时间戳>-<随机串>.<ext>` |
| `owner_id` | `uuid`（031 建表时 `not null`，033 改为可空） | 上传者；`references auth.users(id) on delete set null`（033）——元数据必须活过账户删除，否则失败的对象删除永远无法被发现 |
| `byte_size` | `bigint not null` | `check (byte_size > 0)` |
| `content_type` | `text not null` | 校验后的 MIME（不是浏览器声明值，见服务层文件头校验） |
| `checksum` | `text not null` | `sha256(对象字节)` 十六进制，`check (checksum ~ '^[0-9a-f]{64}$')` |
| `status` | `text not null default 'active'` | `check (status in ('active','deleted'))`；`deleted` = 已从 provider 删除或已被替换 |
| `created_at` / `updated_at` | `timestamptz not null default now()` | `updated_at` 由 `handle_updated_at` 触发器维护 |

约束与索引：

- `unique (bucket, object_key)` —— 同一对象只保留一行，重复写入走 upsert 刷新而不是追加；
- `idx_upload_objects_owner_status (owner_id, status)` —— 按用户清理；
- `idx_upload_objects_bucket_status (bucket, status)` —— 孤儿巡检时按 bucket 拉 `active` 集合；
- `idx_upload_objects_deleted_at (updated_at) where status = 'deleted'`（032）—— 30 天保留期清理。

`(bucket, object_key)` 是复合唯一键，仓储层 upsert 使用
`{ onConflict: "bucket,object_key" }`；mock（`src/lib/mock/index.ts`）同步支持逗号分隔的复合
`onConflict`，单列行为不变。

## 访问边界（server-only）

本表是**故意**的 deny-all：

- `alter table ... enable row level security`，但**不建任何策略**；
- `revoke insert, update, delete, truncate ... from anon, authenticated`；
- 只有 `service_role`（`BYPASSRLS`）能读写，入口是
  `src/lib/repositories/upload-objects.ts` 的 `createAdminClient()`。

与 `email_worker_runs` / `mfa_recovery_codes` / `push_delivery_attempts` / `webhook_events` 同类，
已在 `src/lib/security/rls-coverage.ts` 的 `SERVER_ONLY_TABLES` 登记，并由
`src/lib/security/admin-client-boundary.ts` 记录为 `data-access` 调用点（表 `upload_objects`，
理由：授权已在上传服务内完成，表本身保持 deny-all）。

### 运行时身份矩阵（本地 Supabase，2026-09-13）

先由 `postgres` 造一行探针数据，再逐个角色在事务里切换（`set local role` +
`set local request.jwt.claims`），每条语句单独执行：

```sql
begin; set local role anon;          select count(*) from public.upload_objects; rollback;
begin; set local role authenticated; select count(*) from public.upload_objects; rollback;
begin; set local role service_role;  select count(*) from public.upload_objects; rollback;
```

实测结果：

| 角色 | `select` | `insert` / `update` / `delete` |
| --- | --- | --- |
| `anon` | **0 行** | `ERROR: permission denied for table upload_objects` |
| `authenticated` | **0 行** | `ERROR: permission denied for table upload_objects` |
| `service_role` | **1 行** | 允许（表属主 + `BYPASSRLS`） |

目录侧同一时间点的核对：

```sql
-- relrowsecurity = t，policies = 0，columns = 10
select c.relrowsecurity,
       (select count(*) from pg_policies p
         where p.schemaname = 'public' and p.tablename = 'upload_objects') as policies
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'upload_objects';

-- anon / authenticated 只剩 REFERENCES, SELECT, TRIGGER；insert/update/delete 已收回
select grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'upload_objects' order by 1, 2;
```

约束同样做了运行时验证：写入非法 `checksum` 触发
`upload_objects_checksum_check`，重复 `(bucket, object_key)` 触发
`upload_objects_bucket_key_unique`，`update` 后 `updated_at > created_at`（触发器生效），
删除 `auth.users` 行后元数据行**保留**、`owner_id` 变为 `null`，且仍会出现在
`find_orphan_upload_objects()` 的结果里（033 改动，在回滚事务内验证）。

## 写入协议

服务层（`src/lib/uploads/service.ts`）对头像与项目封面共用同一段前置阶段：

```
put(objectKey)                      → provider 私钥写入
  ├─ 请求已取消（signal.aborted）    → 删除刚写入的对象，返回 uploadCancelled
  └─ recordUploadObject(...)        → 写 upload_objects（active）
       ├─ 写失败                     → 删除刚写入的对象，返回 uploadFailed（不留无元数据的对象）
       └─ 成功                       → 回写业务表（profiles.avatar_url / projects.logo_url）
            ├─ 业务写失败            → 删除对象 + 标记 metadata deleted，返回 uploadFailed
            └─ 成功                  → 替换场景：删除旧对象，**确认删除成功才**把旧行标记 deleted
```

失败路径的取舍：

- **元数据写失败即回滚对象**。宁可让一次上传失败，也不要在 bucket 里留下没有登记的行——
  否则孤儿巡检永远发现不了它（没有 `active` 行可对比）。
- **旧对象删除失败不标记 deleted**。对象可能仍在 bucket 里；标成 `deleted` 会让巡检把它
  当成已清理而漏报（`cleanupStorageObject` 返回 `false` 时跳过标记）。
- **标记 deleted 失败只记日志**（`markDeletedQuietly`）。对象已经删掉，这时再抛错会让调用方
  触发一次多余的回滚。

## 孤儿巡检

引用关系只存在于 `profiles.avatar_url` / `projects.logo_url` 这两个完整 URL 字符串里，
所以「谁还指着这个对象」由 `033` 的 `upload_object_is_referenced(text)` 回答：
判定是 `right(url, length(key) + 1) = '/' || key` 的**后缀相等**，不是 `LIKE`/子串包含——
对象键里的 `_` 在 `LIKE` 里是单字符通配符（会把 `a_b.png` 匹配到 `axb.png`），
而子串包含会把 `xavatars/u/f.png` 误当成 `avatars/u/f.png` 的引用。两条规则在本地库
回滚事务演练（`docs/operations/drills/account-erasure.sql`）与 `src/lib/mock.test.ts`
（镜像同一判定的 mock 实现）中各有一条用例。

**这条判定的精确度上限要说清楚**：函数只拿到对象键、拿不到 bucket，所以它比较的是
「URL 是否以 `/<key>` 结尾」。演练实测 `upload_object_is_referenced('drill.png')` 对着
`.../avatars/<uid>/drill.png` 会返回 `true`——那是另一个对象（键为 `<uid>/drill.png`），
只是末段同名。偏差方向是**保守**的：同名不同目录的真孤儿会被当成仍被引用而保留，
最多留下磁盘占用，不会误删还在被人看的对象。要收紧就得把签名改成按行比较
`(bucket, object_key)`，那是另一次迁移。

```sql
-- 全库 active 但已无任何业务行引用（含账户删除后失去归属的行）→ 待补删清单
select * from public.find_orphan_upload_objects();

-- 删号前：这个人上传过什么、还能不能删（referenced=true 的必须保留，例如团队项目封面）
select * from public.list_user_objects_for_erasure('<userId>');

-- 数据库认为应存在、但 bucket 里已经没有（业务表仍可能指向失效 URL）
select object_key from public.upload_objects where status = 'active';
```

两个函数都是 `security definer` + 空 `search_path`，`EXECUTE` 只对 `service_role`（它们跨行读
所有人的资料 URL）。账户删除链路（`src/lib/uploads/erasure.ts`）会在删号前清理
`referenced=false` 的对象；单个对象删除失败**不阻塞删号**，失败的行保持 `active`，
因此会稳定出现在上面的孤儿清单里等待补删。

**过去未覆盖的一半（现在由 `--provider-diff` 补上，见下）**：bucket 里存在、但数据库从来没有
登记过行的对象（例如 031 之前上传的历史文件），只读数据库这一侧是永远看不见的——
RPC 的真相来源就是 `upload_objects`，一行不存在的记录无法被它报出来。

数据库这一侧的巡检已经封装成命令（只读，不删任何对象）：

```bash
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=... pnpm audit:storage-orphans -- --json --output /tmp/orphans.json
# 或显式传参：pnpm audit:storage-orphans -- --url ... --service-role-key ... --fail-on-findings
```

命令是**按需**跑的；每天那一轮由 `/api/cron/retention` 顺带做：它调用同一个
`find_orphan_upload_objects()`，只产出两个计数（`storage.orphan.objects` /
`storage.orphan.unowned`）而不导出清单——告警负责发现「出现了孤儿」，具体对象仍按上面的命令取。
巡检失败既不拖垮保留期清理那一轮，也不会被报成「零孤儿」：响应里 `orphans` 为 `null`，
且那一轮的 `cron.retention.completed` 干脆不带 `orphans` 维度（缺失才是真的缺失）。

报告把 **owner_id 为空** 的行单列出来——那意味着上传者账户已经删除而对象还公开可读，
是隐私问题而不只是容量问题，所以它排在总字节数之前。退出码：0 无孤儿、1 执行失败
（缺凭据 / RPC 报错 / 响应形状不认识 / **列目录没走完**）、2 有孤儿且带了 `--fail-on-findings`。
解析严格而不是断言：`byte_size` 缺列或类型漂移会让巡检失败，而不是把「读不懂」报成「没有孤儿」。

### provider 侧集合差（`--provider-diff`，C05）

```bash
pnpm audit:storage-orphans -- --provider-diff --bucket avatars --max-pages 200
```

它多做两件事：用 `POST /storage/v1/object/list/<bucket>` 递归列完一个 bucket（含分页），
以及分页读 `upload_objects` 的全部键，然后做**双向**差集：

- **无元数据行**：bucket 里有对象、`upload_objects` 完全不认得。031 之前的存量就是这一类，
  这也是这条命令存在的理由——RPC 永远报不出「一行都不存在的记录」。
- **active 行对象已不在**：元数据说对象应该在、bucket 里却没有。这通常意味着有人绕开应用删过
  对象或清过 bucket，而业务表里的 URL 还指着它。`deleted` 行不算发现（那是我们已承认没了的）。

三个刻意的设计：

1. **它是 opt-in 的**，因为要多走一整趟列目录；不带这个 flag 时命令的行为与开销和以前完全一致，
   报告的零孤儿一行也会自己写明「这只说明数据库侧为空」。
2. **「没看完」不是「没有」**：页数 / 深度 / 条数任一触顶，元数据表 `Content-Range` 缺失或前后矛盾，
   一律 `exit 1` 并给出停在哪，绝不打印那份「0 个发现」的报告。实测过反例：列一个不存在的 bucket
   服务端返回的是 200 + 空数组，所以命令会先用 `GET /storage/v1/bucket` 校验 bucket 存在，
   名字拼错时直接失败——否则一次笔误就产出一次假清白。
3. **仍然只读**：集合差里「bucket 有、元数据无」的对象不能自动删。历史文件可能正被引用而只是
   没登记过元数据，所以删除要么补登记、要么人工确认，且建议只碰创建时间超过观察窗口的对象。

身份是 `bucket/object_key`，而 `object_key` 本身带着 bucket 内的前缀目录（`avatars/<userId>/…`），
所以报告里会出现 `avatars/avatars/...` 这样的双前缀——那是数据形状如此，不是拼接 bug。
反向比对接入了列目录，但**没有**接入定时任务：`/api/cron/retention` 那一轮仍然只跑数据库侧的
两个计数，provider 侧这一趟按人工节奏来。

## 已知边界

- **当前只有一个 bucket**。应用把头像与项目封面都写在 `avatars` bucket 里，靠键前缀区分
  （`avatars/<userId>/...` vs `covers/<projectId>/...`），所以 `upload_objects.bucket` 对两者都是
  `avatars`。按用途统计要按 `object_key` 前缀分组，不能按 `bucket`。
- **`owner_id` 是上传者，不一定是业务实体所有者**。项目封面允许团队 owner/admin 上传，
  因此想按团队清理需要 join `projects`。
- **巡检是「数据库 → bucket」单向可信**。如果有人绕过应用直接往 bucket 写对象，元数据里不会有行；
  这正是反向差集要解决的问题，但需要在巡检侧实现。
- **没有审计/保留期绑定**。审计日志与保留期联动（`docs/db/retention.md`）尚未覆盖本表。

## 回滚

元数据表是**旁路记录**：删掉它不会丢用户可见数据（`profiles.avatar_url` / `projects.logo_url`
仍在业务表里）。回滚顺序必须是先代码后 DDL：

1. `git revert <H02 commit>` —— 恢复服务层与仓储，上传不再写元数据；
2. 再执行 `drop table if exists public.upload_objects;`（连同触发器一起删除）；
3. `notify pgrst, 'reload schema';` 让 PostgREST 立刻丢弃缓存；
4. 从 `supabase/migration-manifest.json` 与迁移目录移除本迁移，或保留历史但接受
   `pnpm check:migration-history` 对「本地已应用、仓库无迁移」的报错（生产环境建议保留迁移文件，
   只在前滚迁移里 `drop table`）。

不要只 drop 表而保留代码：服务层会在每次上传时写不存在的表，直接把上传功能打挂。

## 验证命令

```bash
pnpm vitest run src/lib/uploads src/lib/repositories/upload-objects.test.ts src/lib/mock.test.ts
pnpm check:rls                     # public.upload_objects 必须被分类（server-only）
pnpm check:supabase-security       # 迁移数 / public 表数 / service-role 调用点
pnpm exec supabase migration up --local   # 应用 031
pnpm update:migrations-manifest    # 追加新迁移的 SHA-256 基线
```
