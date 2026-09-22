# v0.11.0 发布 Runbook

> 目的：把发布从「打 tag」变成可审计、可暂停、可回滚的操作。本文是操作手册，不代表发布已完成。
> 通用流程与 v0.10.0 一致（见 [release-runbook-v0.10.0.md](./release-runbook-v0.10.0.md)），
> 本文件只写 v0.11.0 的差异与必须逐项确认的前提。

## 发布前入口条件

```bash
git status --short
git fetch origin --prune
git rev-parse HEAD
pnpm verify:build
pnpm test:e2e
pnpm audit --audit-level high
pnpm check:release-docs
pnpm check:migrations            # 离线：命名/顺序/SHA-256 清单
pnpm check:migration-history     # 本地 Supabase 迁移历史
pnpm check:supabase-security     # RLS / SECURITY DEFINER 撤权 / service-role 边界清点
```

任一命令失败即停止。**不得用修改清单状态（`update:migrations-manifest` 重写、勾选项改绿）替代修复。**

## v0.11.0 相对 v0.10.0 的差异

v0.11.0 的范围是「可观测性里程碑收口 + 数据生命周期闭环」：E01–E10、H07–H10、A10、
CI/发布门禁（J02–J07）、依赖稳定化，以及账户数据擦除与受管对象孤儿链路。

1. **本版本含两条数据库迁移：`032_data_retention_erasure.sql` 与
   `033_upload_object_orphan_audit.sql`**，与 v0.10.0「无新增迁移」的前提相反，
   因此**迁移必须先于应用部署**（DB-first）。2026-09-22 已按该顺序把两条迁移应用到云端项目
   `ntqggnztzvoavjbiillb`（只读复核：`supabase migration list --linked` 显示 001–033 全部 applied，
   `db push --linked --dry-run` 为空；`upload_objects.owner_id` 为 `YES` 可空、
   外键 `confdeltype = n`；7 个新函数 `anon`/`authenticated` = false、`service_role` = true）。
   若在未应用迁移的环境上先部署代码，账户删除会在枚举对象时失败并**保留账户**
   （`src/lib/account/deletion.ts` 的失败语义是先擦除再删号，任一步失败即中止），
   不会造成数据损坏，但用户会看到删除失败。
2. **新增一条不可逆用户操作入口**：设置页「危险区域」→ `deleteAccountAction` →
   对象清理 → `erase_user_data()` → `auth.admin.deleteUser()`。发布后需要一次
   **隔离测试账号**的端到端演练（见冒烟矩阵），确认：确认短语被服务端校验、
   `api_usage` 与本人邮箱的 `contact_messages` 消失、`audit_logs` 行仍在但
   `user_id` / `entity_id` / PII 键被清空、其独占头像对象从 bucket 消失、
   被团队引用的封面保留、会话失效且跳转到首页。禁止用真实用户数据演练。
3. **保留期依赖 pg_cron，而两个环境都没装**：`003`/`014`/`027`/`032` 的每周清理都被
   `if exists (select 1 from pg_extension where extname = 'pg_cron')` 守卫静默跳过，
   迁移成功、门禁全绿、`/api/health` 正常，但**一行都不会删**。启用需要 Supabase
   Dashboard 权限（外部运维动作）；未启用前不要把保留期写成已生效。
4. **service-role 边界扩大**：`pnpm check:supabase-security` 现在登记 31 个模块 / 86 个调用点、
   4 个 RPC。新增的 `src/lib/account/deletion.ts` 与 `src/lib/repositories/account-erasure.ts`
   是权限最高的一批（跨用户读 URL、擦个人数据、`auth.admin.deleteUser`），
   审查时优先看这两个文件与 `src/lib/actions/account.ts` 的授权证据。
5. **Vercel Hobby 的 cron 预算不变**：每条路径每天最多一次，`digest` 09:00 UTC、
   `push-retry` 22:00 UTC；`pnpm check:cron-contract` 会拒绝任何「每天多次」的表达式。
   本版本没有新增 cron 路由。
6. **观察窗口新增项**：除 health / 5xx / Sentry / 队列积压外，额外关注
   `account.deleted` 审计行的 metadata 计数是否符合预期（`objectsFailed > 0` 说明对象删除在失败、
   需要跑孤儿清单）、`provider.fallback` 与 `storage.upload.completed` 是否出现新维度、
   以及 `check:migration-history` 在 CI 之外是否仍与云端一致。

## 发布步骤

1. **冻结范围**：确认 CHANGELOG 的 `[0.11.0]` 章节、迁移清单（032 / 033）、环境变量变更
   （无新增必填变量）与已知限制；由第二位审查者复核 migrations、workflows、认证与 storage 变更。
2. **构建制品**：从目标 commit 的干净 checkout 构建，记录 Node/pnpm 版本与构建日志。
3. **数据库先行**：见上文差异 1；保存 `supabase migration list --linked` 与权限核对输出。
4. **部署应用**：部署同一 commit SHA，不在平台 UI 临时改代码或环境变量。
5. **健康检查**：`pnpm health:check -- <url>`（或 `.github/workflows/health-check.yml`），
   要求 `200 + status=ok` 且 `ready` 不为 `false`，版本等于 `0.11.0`。
6. **生产冒烟**：`pnpm smoke:production -- "$PRODUCTION_URL" --expected-version 0.11.0 --output production-smoke.json`，
   或触发 `.github/workflows/production-smoke.yml`；登录/上传/邮件/合法 webhook 场景在隔离账号中另行执行。
7. **观察窗口**：至少 15 分钟错误率、5xx、延迟、队列积压、Sentry 新事件与迁移错误；
   指标稳定后才创建 tag。

## 打标签与发布说明

```bash
git tag v0.11.0 && git push origin v0.11.0
```

`release.yml` 会用冻结依赖跑 `pnpm check:all`、以 `$GITHUB_REF_NAME` 校验标签与 `package.json`
一致，并从 CHANGELOG 的 `[0.11.0]` 章节生成 `--notes-file` 发布（不使用 `--generate-notes`）。

## 停止条件

出现以下任一项立即停止发布并进入回滚判断：health 失败、5xx 持续上升、认证失败、迁移错误、
关键队列积压、数据写入异常、依赖 provider 大面积失败、无法证明部署 commit 与验证 commit 相同，
或**账户删除在擦除未完成时仍然删号**（这条是本版本的安全底线）。

## 冻结状态与未完成步骤（2026-09-22）

冻结已完成的部分：版本号（`package.json` / `.env.example` → `0.11.0`）、CHANGELOG
`[0.11.0] — 2026-09-22` 章节与新的 `[Unreleased]` 已知限制、三份发布产物、docs-site 中英发布说明、
README 与 `RELEASE_CHECKLIST` 接线；本地 `pnpm check:release-docs` / `check:changelog` / `check:gates`、
1929 条单测全绿。

**尚未执行、也不应假装执行的部分**：

- **tag `v0.11.0` 未创建**。原因已经变了：2026-09-22 08:05Z 直读生产 `/api/health` 已返回
  `version=0.11.0`（此前的 Vercel 构建配额限流已解除），`smoke-main` 定时漂移检查也在 07:41Z 转绿，
  无副作用 smoke 本地与 CI 各取一次证据都是 6/6（见 `docs/operations/production-smoke-v0.11.0.md`）。
  仍然挡住打标签的是两条前置：①**账户删除端到端演练未执行**（下文），它是本版本唯一的不可逆面；
  ②**当前生产跑的是哪个 commit 仍然无法证明**——`/api/health` 的 `commit` 字段是之后才加的，
  这一版已部署的构建不上报它，而本文件的停止条件正是「无法证明部署 commit 与验证 commit 相同」。
  在这之前打 tag 等于把一个无法归属的构建说成发布制品。下一次部署带上该字段后，
  用 `pnpm smoke:production --expected-commit "$(git rev-parse HEAD)"` 就能把这条补齐。
- **账户删除端到端演练未执行**（差异 2）。这是本版本唯一的不可逆面，缺它就没有发布证据；
  需要一个可牺牲的测试账号，不接受用真实用户数据代跑。
- **回滚探针未演练**：需要 Vercel dashboard 的 deployment 切换权限。
- **pg_cron 未启用**：需要 Supabase Dashboard 权限。上述三项都记在 `[Unreleased] → Known Limitations`，
  不会因为发布而消失。

## 发布记录模板

- 版本 / tag：
- commit SHA：
- 数据库迁移：
- 构建与 E2E 证据路径：
- 冒烟开始/结束时间（含时区）：
- 观察指标及基线：
- 操作者 / 审查者：
- 账户删除端到端演练（隔离账号）结果：
- pg_cron 启用状态：
- 结果：成功 / 暂停 / 回滚
- 未解决风险与后续 issue：

回滚操作见：[rollback-runbook-v0.11.0.md](./rollback-runbook-v0.11.0.md)；
冒烟矩阵见：[production-smoke-v0.11.0.md](./production-smoke-v0.11.0.md)。
