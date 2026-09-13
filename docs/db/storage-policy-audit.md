# Storage bucket 策略审计（H05）

`pnpm check:supabase-security` 里的 storage 规则过去是**围绕一个字面量写死的**：它只在
`src/lib/storage/index.ts` 里找 `storage.from("avatars")`，再用四个 policy 名字的 regex 判定
是否合规。这种写法有两个失效面：

- 代码里第二个 bucket（任意模块里的 `client.storage.from("<bucket>")`）不会有任何迁移记录、
  没有任何 policy、也没有任何人 review，门禁照样通过；
- policy 改名或重写后，只要迁移语料库里**还残留**旧名字，regex 仍能命中，等于用"曾经存在过"
  代替"现在有效"。

`src/lib/security/storage-policies.ts` 把判定改成**跟着代码走**：bucket 集合从源码树发现，
policy 集合从迁移的**最终态**推导（`create policy` / `drop policy` 按版本顺序归约），两者交叉验证。

## 判定规则（失败封闭）

| 规则码 | 触发条件 | 为什么是错误 |
|---|---|---|
| `STORAGE_BUCKET_UNDECLARED` | 代码或 policy 引用了未登记在 `STORAGE_BUCKET_INVENTORY` 的 bucket | 读取模型（公共/私有）没有经过 review，默认拒绝 |
| `STORAGE_BUCKET_UNVERSIONED` | 登记的 bucket 没有 `insert into storage.buckets` 迁移 | Supabase driver 永远写这个 bucket id，缺行就是运行时才炸 |
| `STORAGE_BUCKET_UNPOLICED` | bucket 没有任何生效的 `storage.objects` policy | PostgREST 会拒绝全部客户端读写（或更糟：策略被误删却无人发现） |
| `STORAGE_WRITE_POLICY_UNSCOPED` | 客户端 INSERT/UPDATE/DELETE/ALL policy 未同时钉住 `bucket_id` 与 `storage.foldername(name)` + `auth.uid()` | 一个租户可以覆盖另一个租户的对象 |
| `STORAGE_READ_POLICY_UNSCOPED` | 客户端 SELECT policy 的 `USING` 里没有 `bucket_id` 过滤 | 一条策略把**所有** bucket 暴露给该角色 |
| `STORAGE_PRIVATE_BUCKET_PUBLIC_READ` | 声明为私有（`read: "private"`）的 bucket 上存在客户端读策略 | 与登记的读取模型矛盾，属于意外放开 |
| `STORAGE_PUBLIC_BUCKET_UNREADABLE` | 声明为公共读（`read: "public"`）的 bucket 没有客户端 SELECT 策略 | `getPublicUrl()` 生成的公共 URL 实际不可读 |

`warnings`（不阻断）只有一类：登记的 bucket 已经没有任何代码引用 —— 这是**过期的 review 决策**，
提示删除或确认，而不是安全漏洞。

## Bucket 登记表

| bucket | 读取模型 | 客户端写 | 理由 |
|---|---|---|---|
| `avatars` | `public` | 必须按 `auth.uid()` 前缀限定 | 头像与项目封面共用；公共读保证图片 URL 稳定，写入按 userId 目录隔离 |

新增 bucket 的正确做法（缺一不可）：

1. 新迁移里 `insert into storage.buckets` 建行，写清 `public` 属性；
2. 迁移里补 `storage.objects` policy：公共读需要 `to public using (bucket_id = '<bucket>')`；
   客户端写入必须是 `bucket_id = '<bucket>' and (storage.foldername(name))[1] = (select auth.uid()::text)`；
3. 在 `STORAGE_BUCKET_INVENTORY` 登记 `read` / `tenantScopedWrites` / `reason`；
4. 若 `read: "private"`，`src/lib/storage/index.ts` 必须从 `getPublicUrl()` 切到 `signedUrl()`；
5. 更新 `docs/operations/production-smoke-<version>.md` 的 storage 行与身份矩阵。

## 运行时交叉验证（本地 Supabase，2026-09-13）

静态门禁只证明"迁移与源码自洽"。下面是同一结论在真实数据库目录上的核对：

```bash
docker exec -i supabase_db_indiestack psql -U postgres -d postgres -At \
  -c "select id, name, public from storage.buckets order by id;"
# avatars|avatars|t        ← 有且仅有 1 个 bucket，public 属性与登记表一致

docker exec -i supabase_db_indiestack psql -U postgres -d postgres -At \
  -c "select policyname, cmd, roles::text from pg_policies
      where schemaname='storage' and tablename='objects' order by cmd, policyname;"
# Users can delete own avatars|DELETE|{authenticated}
# Users can upload own avatars|INSERT|{authenticated}
# Public can read avatars|SELECT|{public}
# Users can update own avatars|UPDATE|{authenticated}
```

生效谓词（`pg_policies.qual` / `with_check`）与迁移一致：三个写策略都是
`(bucket_id = 'avatars') AND ((storage.foldername(name))[1] = (SELECT (auth.uid())::text))`，
读策略是 `(bucket_id = 'avatars')`。

身份矩阵（同一数据库，`set local role` + `request.jwt.claims` 模拟 PostgREST 会话）：

| # | 用例 | 期望 | 实测 |
|---|---|---|---|
| 1 | `anon` INSERT 任意 `avatars/...` | 拒绝 | `ERROR: new row violates row-level security policy` |
| 2 | `authenticated` INSERT 到**他人** userId 目录 | 拒绝 | 同上 |
| 3 | `authenticated` INSERT 到**自己** userId 目录 | 允许 | `INSERT 0 1` |
| 4 | `authenticated` INSERT 到未登记 bucket | 拒绝 | 同上 |
| 5 | `authenticated` UPDATE 他人对象 | 影响 0 行 | `UPDATE 0` |
| 6 | `anon` SELECT `avatars` | 允许（公共读设计） | `count = 0` |

注：`storage.objects` 的 DELETE 在 Supabase 上被 `storage.protect_delete()` 触发器整体拦截
（"Direct deletion from storage tables is not allowed"），删除只能走 Storage API，因此第 5 行用
UPDATE 代替 DELETE 验证写策略的行级收敛。

## 失败封闭自检

```bash
# 注入一个未登记的 bucket 引用，门禁必须变红（实测 exit=1）：
#   src/lib/security/__storage-probe.ts: admin.storage.from("project-attachments")
# [STORAGE_BUCKET_UNDECLARED]      bucket 未登记
# [STORAGE_BUCKET_UNVERSIONED]     没有迁移建行
# [STORAGE_BUCKET_UNPOLICED]       没有生效 policy
# 删除探针后恢复 ✅ 通过
```

`src/lib/security/storage-policies.test.ts`（20 条）覆盖上述全部规则码，外加"后续迁移
`drop policy` 会移除覆盖"与"仓库当前状态零 issue"两条回归。

## 边界与回滚

- 静态门禁是**文本/迁移级**判定：它不解析 `bucket_id` 的表达式语义（例如
  `bucket_id = any(array[...])` 不会被识别成覆盖），也无法覆盖 Storage API 侧的服务端
  校验；真正的运行时约束仍由上面的身份矩阵与 smoke test 负责。
- 本项**没有新增迁移**，只是把既有门禁从"写死 avatars"改成"跟随代码与迁移最终态"。
- 回滚：`git revert <H05 commits>` 即可恢复到写死 avatars 的旧规则；数据库侧无需任何操作
  （不存在 schema 变更）。回滚后**会重新引入**"新增 bucket 无人审查"的盲区，需要时优先做
  前向修复而不是回滚。
