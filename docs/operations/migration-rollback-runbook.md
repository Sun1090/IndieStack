# 迁移回滚 Runbook

> 面向数据库迁移的统一回滚流程。应用侧回滚见 [rollback-runbook-v0.10.0.md](./rollback-runbook-v0.10.0.md)，
> 本文件只管 schema 与数据。
>
> **不自动回滚数据库。** 逆向迁移可能造成不可逆的数据丢失，必须由 DBA 与发布负责人共同决定；
> 多数情况下正确的做法是**前向修复**（新增一条迁移）而不是删除已经应用的历史。

<!-- migration-runbook:latest=034_email_skip_reason.sql -->

## 触发条件

出现以下任一情况时启动本流程：

- 迁移导致请求持续失败（`/api/health` 的数据库依赖为 `error`，或关键路径 5xx）；
- 迁移造成数据完整性风险（唯一约束冲突、外键断裂、孤儿行、错误的默认值）；
- RLS / 权限策略变更导致越权或大面积无权访问；
- 迁移后的写入量与发布前基线相比异常（重复行、重复 webhook、队列堆积）；
- `pnpm check:migration-history` 报告本地库已应用但仓库不存在的版本，或反之。

## 决策树

1. **新代码可回滚、schema 向后兼容** → 只切回上一个已验证 deployment，数据库保持向前 schema。
2. **schema 不向后兼容（旧代码读不到新结构）** → 不要切回旧代码；在**当前** schema 上做前向修复迁移，
   或用 feature flag 关闭受影响路径，先恢复服务。
3. **迁移本身写错且尚未产生业务数据** → 允许在受控窗口内做逆向操作，但必须先快照、必须在 DBA 在场时执行。
4. **已经产生业务数据** → 只允许前向修复迁移（补齐列、回填、重建索引），禁止 `DROP`。
5. **怀疑数据被误写** → 停止相关 worker 与后台任务，保留日志与快照，按备份恢复演练流程处理，并记录影响范围。

## 前向修复优先

「删除迁移」在本仓库是被禁止的动作：`supabase/migrations/` 是只追加的，历史一旦进入
`supabase/migration-manifest.json` 就不可改写。`pnpm update:migrations-manifest` 会拒绝重写已登记的
迁移校验和，`pnpm check:migrations` 会校验每个文件的 SHA-256 与顺序。因此：

- 想撤销一条迁移的效果，正确做法是**新增一条反向迁移**（例如 `035_...`）而不是删掉 `034`；
- 想修正一条写错的迁移，同样是新增一条修复迁移；
- 迁移文件里应当自带幂等保护（`IF EXISTS` / `IF NOT EXISTS`）与可观测注释，方便前向修复。

## 迁移类型与回滚配方

| 迁移类型                | 典型语句                                                | 逆向风险                                     | 推荐做法                                                                 |
| ----------------------- | ------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------ |
| 新增表                  | `CREATE TABLE`                                          | 低（丢表即丢数据）                           | 前向修复可用，逆向前必须先导出数据；确认无外键引用                       |
| 新增可空列              | `ALTER TABLE ... ADD COLUMN ... NULL`                   | 低                                           | 旧代码忽略新列即可，通常只需回滚应用；保留列                               |
| 新增非空列 / 默认值     | `ADD COLUMN ... NOT NULL DEFAULT`                       | 中（回滚会丢回填结果）                       | 先加可空列 → 回填 → 再加约束；回滚只回滚应用                              |
| 新增索引                | `CREATE INDEX`                                          | 极低                                         | 可直接 `DROP INDEX`，但通常留着无副作用                                   |
| 新增枚举值              | `ALTER TYPE ... ADD VALUE`                              | 高（Postgres 无法删除枚举值）                 | **只能前向修复**；不要试图逆向                                           |
| RLS / 策略变更          | `CREATE POLICY` / `ALTER POLICY` / `REVOKE`             | 中（权限真空 = 不可访问或越权）               | 新增旧策略的恢复迁移；回滚后立刻跑 `pnpm check:rls` 与身份矩阵            |
| 触发器 / 函数           | `CREATE OR REPLACE FUNCTION` / `CREATE TRIGGER`         | 中（写入放大、递归）                         | 用 `CREATE OR REPLACE` 前向覆盖；禁止直接删函数                          |
| 数据回填                | `UPDATE` / `INSERT ... SELECT`                          | 高（不可重复执行）                           | 只前向修复；回填脚本必须幂等且可重跑                                     |

## 操作步骤

```bash
# 0. 固定证据：记录时间、当前版本与迁移状态（先保存，不要覆盖）
date -u
pnpm check:migrations                       # 校验每个迁移的 SHA-256 与顺序（离线可跑）
pnpm update:migrations-manifest             # 仅当新增迁移后重新基线；拒绝改写已登记项

# 1. 需要本地 / staging 复现时，确认数据库实际应用到了哪一版
pnpm exec supabase start
pnpm check:migration-history                # 本地库已应用但仓库不存在的版本会在这里暴露

# 2. 选择动作
#    A. 兼容回滚 → 部署平台切到上一个已验证 deployment（不改数据库）
#    B. 不兼容    → 写一条新的前向修复迁移，走正常 PR 流程
#    C. 数据事故  → 冻结写入、快照、按备份恢复流程处理，并记录影响范围

# 3. 回滚后复验（见下一节）
pnpm smoke:supabase-identity -- --url "$STAGING_URL" --anon-key "$ANON_KEY" --service-role-key "$SERVICE_ROLE_KEY"
```

任何涉及生产数据库的写操作都必须由有权限的发布人员执行；命令、URL、deployment ID 与输出必须写入
incident 记录，不允许只留聊天记录。

## 回滚后验证

- `pnpm check:migrations` 通过：迁移文件未改写、顺序正确、校验和一致；
- `pnpm check:migration-history` 明确当前应用到哪一版，没有半完成迁移；
- `/api/health` 的数据库依赖回到 `ok`，5xx 与延迟恢复到发布前基线；
- RLS 回归通过（`pnpm check:rls` + 身份矩阵 `pnpm smoke:supabase-identity`），租户隔离未被破坏；
- 关键表行数与发布前快照一致，没有重复行或孤儿行；
- 后台 worker（推送重试、邮件、webhook 幂等）没有重复执行；
- 至少一条关键业务 smoke test 通过，并把结果写进 incident 记录。

## 权限与审批

- 生产数据库的逆向操作需要 DBA + 发布负责人双人批准，并事前书面确认锁定窗口；
- 任何 `DROP TABLE` / `DROP COLUMN` / `TRUNCATE` 都必须先有可验证的备份与回滚脚本；
- 发布负责人负责回滚决策与对外沟通，DBA 负责数据安全与恢复执行；
- 权限不足时不得以「临时提权」绕过流程，改为前向修复并走正常 PR。

## 演练记录

- 演练日期（UTC）：
- 目标版本 / 涉及迁移：
- 使用环境（本地 / staging）：
- 决策路径（兼容回滚 / 前向修复 / 备份恢复）：
- 执行的命令与输出摘要：
- 从触发到恢复的耗时：
- 失败点 / 改进项：
- 操作者 / 审查者：

## 附：备份与自动恢复

生产库的自动恢复由 `supabase-restore` provider 驱动，它需要 `SUPABASE_ACCESS_TOKEN` 与可推导或显式指定的
`SUPABASE_PROJECT_REF`；完整变量语义见 [provider 诊断指南](../../docs-site/provider-diagnostics.md)。
逆向迁移前的最小前提是**确认快照可用**，而不是「假设有备份」：

- 快照时间点必须早于待撤销迁移；
- 恢复演练至少验证过「快照 → 恢复 → 应用连通」这条链路；
- 恢复本身也会覆盖当前数据，属于破坏性操作，同样需要双人批准。

若 provider 诊断显示 `supabase-restore` 处于 `disabled` 或 `misconfigured`，视为**不具备回滚条件**，
只能走前向修复路径。
