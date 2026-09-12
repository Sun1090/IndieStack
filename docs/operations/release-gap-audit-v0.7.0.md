# v0.7.0 发布文档缺口审计

审计日期：2026-09-12
审计范围：`package.json` 版本 0.7.0、`CHANGELOG.md`、`.github/RELEASE_CHECKLIST.md`、双语 README、`docs/operations/release-*-v0.7.0.md`、`scripts/check-release-docs.js` 与 CI 门禁。

## 结论

v0.7.0 完成了本地 `RELEASE_FREEZE`：版本号、CHANGELOG、发布/回滚/smoke runbook、
双语 README 与 docs-site 版本页已对齐，`pnpm check:release-docs` 在
`package.json` 版本为 0.7.0 时通过。**生产 smoke 仍未执行**，本审计不构成发布通过证据；
在获得 push / merge / deploy 授权前，`docs/operations/production-smoke-v0.7.0.md` 保持“未执行”。

## 缺口与交付物

| 缺口                   | 之前的问题                                                | 本次交付物                                                               | 当前证据                  | 状态                 |
| ---------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------- | -------------------- |
| 发布文档门禁版本漂移   | `check-release-docs.js` 硬编码 `v0.6.0`，发版必须手改脚本 | 脚本改为从 `package.json` 解析版本并拼出 runbook/rollback/smoke 路径     | `check:release-docs` 通过 | 已消除               |
| 发布 checklist 版本    | checklist 仍指向 v0.6.0 产物与 tag                        | `.github/RELEASE_CHECKLIST.md` 更新为 v0.7.0 tag 与三个 v0.7.0 文档链接  | 门禁读取 checklist 校验   | 文档已补齐           |
| README 发布入口        | 双语 README 链接旧版本 runbook/smoke                      | `README.md`、`README.zh-CN.md` 指向 v0.7.0 产物并由门禁校验              | `check:release-docs` 通过 | 文档已补齐           |
| docs-site 版本页       | 新版本没有中英发布说明页                                  | `docs-site/v0.7.0.md`、`docs-site/zh-CN/v0.7.0.md` 并注册到导航与侧边栏  | 中英页面各 1 个           | 文档已补齐           |
| v0.7.0 smoke 证据      | 直接复制 v0.6.0 smoke 会把历史生产证据误认成本版本通过    | `production-smoke-v0.7.0.md` 重写为干净“未执行”基线，并新增 Web Push 行  | 状态：未执行              | 执行记录待发布时填写 |
| Release Notes 已知限制 | 容易把 Web Push 说成具备重试/死信能力                     | runbook 差异章节、CHANGELOG 与 docs-site 版本页显式保留 best-effort 限制 | 三处一致                  | 已声明               |

## 与 v0.6.0 的差异

1. `check-release-docs` 从“硬编码版本”变为“跟随 `package.json`”，因此本版本无需再手工编辑脚本；
   新增的 checklist 校验也覆盖 tag 与三个 runbook 路径。
2. 本版本**不新增数据库迁移**，最新仍为 `025_notifications_realtime.sql`；回滚按
   `docs/operations/rollback-runbook-v0.7.0.md` 走应用层回退，未配置 VAPID 密钥即关闭 Push 通道，
   订阅行保留不做破坏性清理。
3. 新增发布前必须确认的外部条件：VAPID 密钥对与 HTTPS 站点（非 HTTPS 时推送不可用）。

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
```

其中 `check:release-docs` / `check:changelog` / `check:docs` / `check:all` 属于本地门禁，
`verify:build`、E2E、audit 必须在目标发布 commit 上重新执行，不能用本审计文件替代。

## 发布前仍需产生的真实证据

1. 从目标 commit 的干净 checkout 保存完整 `pnpm verify:build`、E2E 与 audit 输出。
2. 在具备 VAPID 密钥与 HTTPS 的环境完成一次真实浏览器推送（订阅 → 投递 → 关闭订阅）并记录结果。
3. 填写 `production-smoke-v0.7.0.md` 每一行，附 UTC 时间、HTTP 状态和脱敏证据。
4. 生成 v0.7.0 exit report；任一退出标准失败时保持版本未发布并创建修复 issue。
