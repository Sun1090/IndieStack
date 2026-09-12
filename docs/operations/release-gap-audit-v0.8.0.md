# v0.8.0 发布文档缺口审计

审计日期：2026-09-13
审计范围：`package.json` 版本 0.8.0、`CHANGELOG.md`、`.github/RELEASE_CHECKLIST.md`、双语 README、`docs/operations/release-*-v0.8.0.md`、`docs-site/{,zh-CN/}v0.8.0.md`、`scripts/check-release-docs.js` 与 CI 门禁。

## 结论

v0.8.0 完成了本地 `RELEASE_FREEZE`：版本号、CHANGELOG、发布/回滚/smoke runbook、双语 README 与
docs-site 版本页已对齐，`pnpm check:release-docs` 在 `package.json` 版本为 0.8.0 时通过。
**生产 smoke 仍未执行**，本审计不构成发布通过证据；在获得 push / merge / deploy 授权前，
`docs/operations/production-smoke-v0.8.0.md` 保持“未执行”。

## 缺口与交付物

| 缺口                    | 之前的问题                                                         | 本次交付物                                                                    | 当前证据                       | 状态                 |
| ----------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ------------------------------ | -------------------- |
| v0.7.0 遗留能力缺口     | Push 为即时 best-effort，无重试队列或死信表                        | 迁移 026 + repository + worker + cron 路由，语义对齐邮件 `email_attempts`      | 单测 111 文件 / 1099 + 本地 DB | 已实现               |
| 迁移漂移                | 新增迁移必须纳入 SHA-256 清单                                      | `migration-manifest.json` 更新为 26 条，`pnpm update:migrations-manifest` 生成 | `check:migrations` 通过        | 已消除               |
| 类型生成噪声            | `db:types` 无 `--schema` 会引入无关 auth 类型                      | `db:types` 改为 `--schema public`，`database.types.ts` 只含 public             | 重新生成后 diff 可审阅         | 已消除               |
| 队列可观测性            | 新队列无积压/死信/失效端点指标                                     | `push.backlog`（阈值 500）、`push.delivery.dead`、`push.endpoint.revoked`、`push.queue.pruned`、`push.queue.prune_failed`、`cron.push-retry.*` | `sentry-alerts.md` 已记录契约  | 已补齐               |
| 队列无界增长            | `sent`/`dead` 终态没有保留期，长期运行会持续膨胀                   | worker 每轮清理 `sent` 7 天 / `dead` 30 天，单状态 1000 行，`pending` 永不清理 | 单测 + 真实本地 Supabase 验证 | 已补齐               |
| 发布 checklist 版本     | checklist 仍指向 v0.7.0 产物与 tag                                 | `.github/RELEASE_CHECKLIST.md` 更新为 v0.8.0 tag 与三个 v0.8.0 文档链接        | 门禁读取 checklist 校验        | 文档已补齐           |
| README 发布入口         | 双语 README 链接旧版本 runbook/smoke                               | `README.md`、`README.zh-CN.md` 指向 v0.8.0 产物并由门禁校验                    | `check:release-docs` 通过      | 文档已补齐           |
| docs-site 版本页        | 新版本没有中英发布说明页                                           | `docs-site/v0.8.0.md`、`docs-site/zh-CN/v0.8.0.md` 并注册到导航与侧边栏        | 中英页面各 1 个                | 文档已补齐           |
| v0.8.0 smoke 证据       | 直接复制 v0.7.0 smoke 会把历史证据误认成本版本通过                 | `production-smoke-v0.8.0.md` 重写为干净“未执行”基线，并新增 Push 重试/死信行  | 状态：未执行                   | 执行记录待发布时填写 |
| Push 重试链路 E2E       | 新重试/死信链目前只有单测 + 本地 DB 证据                           | 记录为 `[Unreleased]` 下一里程碑任务                                          | `check:changelog` 通过         | 已知缺口，已声明     |

## 与 v0.7.0 的差异

1. 本版本**新增数据库迁移** `026_push_delivery_attempts.sql`（纯新增表，无破坏性变更），最新迁移号由
   025 前进到 026；回滚按 `docs/operations/rollback-runbook-v0.8.0.md` 走应用层回退，表保留不删除。
2. 新增 Vercel Cron 任务 `/api/cron/push-retry`（每 15 分钟，单轮 50 条），依赖已存在的 `CRON_SECRET`。
3. Push 投递语义从 **best-effort** 变为 **at-least-once**：新增退避重试（60s → 120s，上限 1 小时）、
   重试上限 3（含首次）与死信状态；404/410 立即撤销端点。
4. 新增终态保留策略：`sent` 保留 7 天、`dead` 保留 30 天、单状态每轮最多清理 1000 行；响应增加
   `pruned`，并上报 `push.queue.pruned` / `push.queue.prune_failed`。
5. 发布前外部条件不变：VAPID 密钥对、HTTPS 站点、`CRON_SECRET`。

## 可复现验证

在目标 commit 的干净 checkout 中至少运行：

```bash
pnpm check:release-docs
pnpm check:changelog
pnpm check:docs
pnpm check:all
pnpm verify:build
pnpm test:e2e
pnpm audit --audit-level high
pnpm --filter indiestack-docs build
```

其中 `check:release-docs` / `check:changelog` / `check:docs` / `check:all` 属于本地门禁，
`verify:build`、E2E、audit 必须在目标发布 commit 上重新执行，不能用本审计文件替代。

## 发布前仍需产生的真实证据

1. 从目标 commit 的干净 checkout 保存完整 `pnpm verify:build`、E2E、coverage 与 audit 输出。
2. 在具备 VAPID 密钥与 HTTPS 的环境完成一次真实浏览器推送链路（订阅 → 投递 → 瞬时失败退避重试 →
   关闭订阅/失效端点 → 死信），并记录结果。
3. 以真实 `CRON_SECRET` 触发一次 `/api/cron/push-retry`，确认返回脱敏计数、`pruned` 清理计数且队列下降。
4. 填写 `production-smoke-v0.8.0.md` 每一行，附 UTC 时间、HTTP 状态和脱敏证据。
5. 生成 v0.8.0 exit report；任一退出标准失败时保持版本未发布并创建修复 issue。
