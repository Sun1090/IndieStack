# v0.8.0 回滚 Runbook

> 回滚优先恢复服务，不自动回滚数据库。数据库逆向迁移可能造成数据丢失，必须经过 DBA 与发布负责人共同决定。

## 触发条件

触发条件包括：持续 5xx、认证/支付/上传关键路径不可用、数据完整性风险、迁移导致请求失败、错误率超过发布前基线两倍且持续 5 分钟，或 health check 连续失败。

## 决策树

1. **代码回滚即可修复**：将 Vercel/部署平台切换到上一个已验证 deployment；保留当前数据库 schema，确认旧代码能兼容新增列。
2. **迁移不可兼容**：先暂停写入或关闭受影响 feature flag，再恢复应用；不得直接执行 `down` SQL。
3. **数据损坏或误写**：停止相关 worker，保留日志和数据库快照，按备份恢复演练流程处理，并记录影响范围。
4. **仅 provider 故障**：保持应用版本，关闭 provider 开关，启用已验证 fallback；不要为了外部服务故障回滚无关代码。

## 操作步骤

```bash
# 记录当前状态（先保存，不要覆盖证据）
date -u
curl -fsS "$PRODUCTION_URL/api/health" > /tmp/indiestack-health-before-rollback.json
# 在部署平台选择上一个已验证 deployment / commit SHA
# 回滚后再次执行
a=0; while [ "$a" -lt 3 ]; do curl -fsS "$PRODUCTION_URL/api/health"; a=$((a+1)); sleep 10; done
pnpm health:check -- "$PRODUCTION_URL"
```

实际平台切换必须由有权限的发布人员执行；命令中的 URL、deployment ID 和输出必须写入 incident 记录。

## 回滚后验证

- `/api/health` 返回成功且版本符合预期；
- 匿名首页与登录流程可用；
- 最近一次迁移状态明确，无半完成迁移；
- 5xx、延迟、Sentry、队列积压恢复到发布前基线；
- 新写入和后台 worker 没有重复执行；
- 至少一条关键业务 smoke test 通过；
- 通知相关 provider 若被关闭，用户可见降级行为已记录。

## 迁移处理原则

迁移必须先做备份/快照并确认孤儿数据。只有存在经过测试的逆向迁移、明确的锁定窗口和 DBA 批准时才允许逆向迁移；否则采用前向修复迁移。每次回滚都要更新事故记录、CHANGELOG 的已知问题和后续修复 issue。

## 演练记录

- 演练日期（UTC）：
- 目标版本 / 回滚版本：
- 使用的 deployment：
- 数据库是否保持向前 schema：
- 检查结果与耗时：
- 失败点 / 改进项：
- 负责人 / 审查者：

## v0.8.0 回滚补充

- **新增迁移 026 为纯新增**：`push_delivery_attempts` 是全新表，不修改既有表结构。回退应用部署后该表
  不会再被读取或写入；数据库可保持向前 schema，无需执行 `drop table`。
- **无法用纯代码回退清理的数据**：若确认长期不再需要该表，且已确认无任何消费者（旧代码、看板、外部脚本），
  可在备份后执行 `drop table public.push_delivery_attempts;`。这是**破坏性操作**，会丢失队列与死信审计历史，
  必须经 DBA 与发布负责人共同批准并记录。默认建议仅是保留该表。
- **停止 cron**：回滚期间可在 `vercel.json` 移除 `/api/cron/push-retry` 或清除 `CRON_SECRET` 关闭 worker；
  已存在的 pending 行不会被拉取，重新启用后按 `next_attempt_at` 继续。
- **关闭推送通道**：清除 `NEXT_PUBLIC_VAPID_PUBLIC_KEY` 或 `VAPID_PRIVATE_KEY` 即可关闭 Push 通道，
  站内通知与邮件不受影响；重新配置凭证后队列继续投递。
- **订阅与队列数据保留**：`public.push_subscriptions` 与 `public.push_delivery_attempts` 中的数据不随回滚删除，
  只有 push service 返回 404/410 时才会自动清理端点。
- **保留策略停止**：正常 worker 会删除超过 7 天的 `sent` 与超过 30 天的 `dead` 行；回滚并停用 cron 后
  该清理也会停止，表可能继续增长。不要把自动清理当作备份或审计保留机制，需要长期审计时应先导出。
- **前向修复优先**：若问题来自 worker 逻辑而非 schema，优先以**前向修复迁移/代码补丁**修复，而不是回滚数据库。
