# v0.11.0 回滚 Runbook

> 回滚优先恢复服务，**不自动回滚数据库**。数据库逆向迁移可能造成数据丢失，必须经过 DBA 与发布负责人共同决定。
> 通用流程见 [migration-rollback-runbook.md](./migration-rollback-runbook.md)；本文件只写 v0.11.0 的差异。

## 触发条件

触发条件包括：持续 5xx、认证/上传/删号关键路径不可用、数据完整性风险、迁移导致请求失败、错误率超过发布前基线两倍且持续 5 分钟，或 health check 连续失败。

v0.11.0 有一条**不可逆用户操作**（账户删除：擦除个人数据 + 删号），它的故障形态与普通缺陷不同：

- **擦除过度**（删掉了不该删的行/对象）→ 回滚不能挽回，只能按备份/PITR 恢复；
- **擦除不足但仍然删号**（外键级联先跑，`contact_messages` / `api_usage` / `audit_logs` 失去归属）→ 回滚同样不能挽回，
  因为 `user_id` 已经随着账户消失，事后无法反查该擦哪些行。

这两种是本版本唯一「回滚无意义、必须事先阻止」的场景，因此它们出现在发布 runbook 的停止条件里，
而不是只出现在这里。

## 决策树

1. **代码回滚即可修复**：将 Vercel/部署平台切换到上一个已验证 deployment；保留当前数据库 schema，
   确认旧代码能兼容 032/033 的最终态（见下「数据库向前兼容」）。
2. **账户删除链路有缺陷（本版本特有的首选止血手段）**：**回滚应用 deployment，数据库不动**。
   上一版本的设置页没有「危险区域」入口，`/api/user` 的 `DELETE` 也不经 `deleteAccountWithData()`，
   风险面随入口一起消失——这是唯一不需要新增代码就能立刻关闭不可逆操作的方法。
3. **迁移不兼容**：先暂停写入或关闭受影响 feature flag，再恢复应用；不得直接执行 `down` SQL。
4. **数据损坏或误删**：立即停止相关 worker 与账户删除入口（按第 2 条回滚），保留日志与数据库快照，
   按备份恢复演练流程处理，并记录影响范围；**只有用户/负责人明确授权后**才执行 PITR。
5. **仅 provider 故障**：保持应用版本，关闭 provider 开关，启用已验证 fallback；不要为了外部服务故障回滚无关代码。
6. **仅保留期清理未按预期生效**：不回滚。pg_cron 在两个环境都未安装，所有 SQL 侧每周清理都被守卫跳过，
   「没删数据」是已知状态而不是新缺陷；要处理的是启用 cron 或改为平台定时任务，而不是回退 schema。

## 操作步骤

```bash
# 记录当前状态（先保存，不要覆盖证据）
date -u
curl -fsS "$PRODUCTION_URL/api/health" > /tmp/indiestack-health-before-rollback.json
supabase migration list --linked > /tmp/indiestack-migrations-before-rollback.txt   # 只读
# 在部署平台选择上一个已验证 deployment / commit SHA
# 回滚后再次执行
a=0; while [ "$a" -lt 3 ]; do curl -fsS "$PRODUCTION_URL/api/health"; a=$((a+1)); sleep 10; done
pnpm health:check -- "$PRODUCTION_URL"
```

实际平台切换必须由有权限的发布人员执行；命令中的 URL、deployment ID 和输出必须写入 incident 记录。

## 回滚后验证

- `/api/health` 返回成功且版本符合预期（回滚到 `0.10.0` 时 `/api/health` 应报告 `0.10.0`）；
- 匿名首页与登录流程可用；
- 最近一次迁移状态明确，无半完成迁移：`supabase migration list --linked` 仍显示 001–033 全部 applied，
  `pnpm check:migrations` 与仓库 manifest 一致；
- 5xx、延迟、Sentry、队列积压恢复到发布前基线；
- 新写入和后台 worker 没有重复执行；
- 至少一条关键业务 smoke test 通过；
- **设置页不再出现「危险区域」，`DELETE /api/user` 不再可达不可逆链路**（确认止血生效）；
- 若已发生过账户删除，记录受影响账户与时间窗，供 PITR 决策使用——回滚本身不会恢复这些数据。

## 数据库向前兼容

032/033 都是**追加式**变更，回滚应用、保持数据库向前 schema 是安全的：

- `032_data_retention_erasure.sql` 只新增函数（`erase_user_data`、3 个保留期函数）、2 个部分索引和 pg_cron 守卫。
  旧代码不调用这些函数，多出来的函数不会被触发；它们只授予 `service_role`，即使被误调也需要 service-role 密钥。
- `033_upload_object_orphan_audit.sql` 把 `upload_objects.owner_id` 从 `not null` 改为可空、外键改为
  `on delete set null`。放宽约束对旧写入路径（一定带 `owner_id`）无影响；收紧回去反而会破坏
  「元数据行必须活过账户删除」这条设计前提，**因此绝对不要逆向执行这条**。
- 两条迁移都进过 `supabase/migration-manifest.json` 基线。删除或改写已基线化的迁移文件会让
  `pnpm check:migrations` 失败，也不是回滚手段。

## 迁移处理原则

迁移必须先做备份/快照并确认孤儿数据。只有存在经过测试的逆向迁移、明确的锁定窗口和 DBA 批准时才允许逆向迁移；
否则一律采用**前向修复迁移**（新增 `034_*.sql` 修状态，而不是编辑 032/033）。每次回滚都要更新事故记录、
CHANGELOG 的已知问题和后续修复 issue。

具体到本版本：如果 `erase_user_data()` 的某条 `delete` 条件写错，正确做法是新增一个前向迁移修正函数体
（`create or replace function`），同时把新 SHA 追加进 manifest 并更新回滚 runbook 的「最新迁移」标记；
`pnpm check:migration-runbook` 会拒绝标记与 manifest 不一致的状态。

## 演练记录

- 演练日期（UTC）：
- 目标版本 / 回滚版本：
- 使用的 deployment：
- 数据库是否保持向前 schema：
- 检查结果与耗时：
- 失败点 / 改进项：
- 负责人 / 审查者：

## v0.11.0 回滚补充

- **发布顺序已经替回滚兜底**：迁移先于应用部署（DB-first），所以任何时刻线上代码要么还不调用新函数，
  要么调用的函数已存在；不存在「代码先上、函数缺失」导致的删号半途失败。
- **回滚不会关掉 `auth.admin.deleteUser` 本身**：`/api/user` 的 `DELETE` 在旧版本依然直接删号。
  回滚消除的是「带擦除的新链路」，账户删除这个操作两个版本都能做——因此回滚后必须同时确认前端入口与
  rate limit 的状态，别把「按钮还在但语义变了」当成回滚成功。
- **对象清理失败不回滚**：`removeUnreferencedUserObjects()` 在 provider 报错时只统计 `failed` 并继续，
  孤儿对象可以用 `find_orphan_upload_objects()` 事后补偿。不要因为「bucket 里有残留对象」回滚整个版本。
- **审计补记失败是设计内的**：删号成功后写审计行失败只记日志、不抛错。看到
  `[deleteAccountWithData] 账户删除审计补记失败` 说明账户已删除，属于观测缺口而不是回滚触发条件。
- 若回滚后 `pnpm check:supabase-security` 抱怨调用点预算（86）与实际不符，那是清点基线问题，
  在修复分支上更新登记表，不要为了过门禁去放宽 service-role 边界。
