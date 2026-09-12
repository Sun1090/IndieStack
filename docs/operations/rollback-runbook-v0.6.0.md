# v0.6.0 回滚 Runbook

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
