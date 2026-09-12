# v0.6.0 发布文档缺口审计

审计日期：2026-09-09  
审计范围：`docs/roadmap-0.6.0.md` 的 I/J 发布相关任务、`.github/RELEASE_CHECKLIST.md`、CHANGELOG、双语 README、CI 脚本与运维文档。

## 结论

本次补齐了发布操作所需的**可执行文档和自动化文档门禁**，但没有把尚未实际执行的生产冒烟或回滚演练伪标记为完成。空白的执行记录仍然表示“未验证”。

## 缺口与交付物

| 缺口 | 之前的问题 | 本次交付物 | 当前证据 | 状态 |
|---|---|---|---|---|
| I05 CHANGELOG 校验 | 没有检查发布说明和命令是否仍然存在 | `scripts/check-release-docs.js`、`pnpm check:release-docs` | 本地检查通过 | 已有自动化门禁 |
| I06 release checklist | 只有版本/构建勾选项，缺少证据和回滚字段 | `.github/RELEASE_CHECKLIST.md` 增加证据、冒烟、回滚栏位 | 文件存在且被门禁读取 | 文档已补齐 |
| I09 测试矩阵 | README 的测试数量过时，发布前检查分散 | 双语 README 更新测试统计和发布命令 | `check:release-docs` 通过 | 文档已补齐 |
| I10 迁移回滚 | 没有明确禁止危险的数据库 down migration | `docs/operations/rollback-runbook-v0.6.0.md` | 包含前向修复、快照和批准规则 | runbook 已补齐 |
| J06 production smoke | 没有结构化的生产验证清单 | `docs/operations/production-smoke-v0.6.0.md` | 覆盖 health、auth、tenant、upload、webhook、安全头 | 执行记录待发布时填写 |
| J08 rollback exercise | 没有回滚触发条件、决策树或验证步骤 | `docs/operations/rollback-runbook-v0.6.0.md` | 含停止条件和回滚后验证 | 演练证据待实际执行 |
| J09 exit report | 没有报告模板区分“已写文档”和“已验证发布” | `docs/operations/release-runbook-v0.6.0.md` 发布记录模板 + 本审计 | 明确空白记录不构成通过 | 发布后生成 |

## 可复现验证

在干净 checkout 中，至少运行：

```bash
pnpm check:release-docs
pnpm check:docs
pnpm type-check
pnpm lint
pnpm verify:build
pnpm test:e2e
pnpm audit --audit-level high
```

其中前四项是本次已执行并通过的文档/静态门禁；`verify:build`、E2E、audit 必须在目标发布 commit 上重新执行，不能用本审计文件替代。

## 发布前仍需产生的真实证据

1. 从目标 commit 的干净 checkout 保存完整 `pnpm verify:build`、E2E 和 audit 输出。
2. 填写生产 smoke 表格中的每一行，附 UTC 时间、HTTP 状态和脱敏证据。
3. 在受控环境执行一次回滚演练，记录 deployment、耗时、数据库处理和回滚后 health 结果。
4. 根据真实结果生成 v0.6.0 exit report；若任一退出标准失败，保留版本为未发布并创建修复 issue。
