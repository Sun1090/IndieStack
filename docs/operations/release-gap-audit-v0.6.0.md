# v0.6.0 发布文档缺口审计

审计日期：2026-09-09  
审计范围：`docs/roadmap-0.6.0.md` 的 I/J 发布相关任务、`.github/RELEASE_CHECKLIST.md`、CHANGELOG、双语 README、CI 脚本与运维文档。

## 结论

本次补齐了发布操作所需的**可执行文档和自动化文档门禁**，但没有把尚未实际执行的生产冒烟或回滚演练伪标记为完成。空白的执行记录仍然表示“未验证”。

## 缺口与交付物

| 缺口                  | 之前的问题                               | 本次交付物                                                                                                                        | 当前证据                                           | 状态                 |
| --------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | -------------------- |
| I05 CHANGELOG 校验    | 没有检查发布说明和命令是否仍然存在       | `scripts/check-release-docs.js`、`pnpm check:release-docs`；后续补充结构门禁 `scripts/check-changelog.js`、`pnpm check:changelog` | 两项门禁本地通过                                   | 已有自动化门禁       |
| I06 release checklist | 只有版本/构建勾选项，缺少证据和回滚字段  | `.github/RELEASE_CHECKLIST.md` 增加证据、冒烟、回滚栏位                                                                           | 文件存在且被门禁读取                               | 文档已补齐           |
| I09 测试矩阵          | README 的测试数量过时，发布前检查分散    | 双语 README 更新测试统计和发布命令                                                                                                | `check:release-docs` 通过                          | 文档已补齐           |
| I10 迁移回滚          | 没有明确禁止危险的数据库 down migration  | `docs/operations/rollback-runbook-v0.6.0.md`                                                                                      | 包含前向修复、快照和批准规则                       | runbook 已补齐       |
| J06 production smoke  | 没有结构化的生产验证清单                 | `docs/operations/production-smoke-v0.6.0.md`                                                                                      | 覆盖 health、auth、tenant、upload、webhook、安全头 | 执行记录待发布时填写 |
| J08 rollback exercise | 没有回滚触发条件、决策树或验证步骤       | `docs/operations/rollback-runbook-v0.6.0.md`                                                                                      | 含停止条件和回滚后验证                             | 演练证据待实际执行   |
| J09 exit report       | 没有报告模板区分“已写文档”和“已验证发布” | `docs/operations/release-runbook-v0.6.0.md` 发布记录模板 + 本审计                                                                 | 明确空白记录不构成通过                             | 发布后生成           |

## 后续加固（2026-09-12）

I05 最初只由 `check-release-docs` 的字符串存在性检查覆盖，无法发现版本标题格式、重复版本、空章节等结构漂移。现已补充独立结构门禁 `pnpm check:changelog`（规则实现 `src/lib/changelog/parse-changelog.ts`，38 条单测），并接入 `pnpm check:all` 与 CI Lint & Type Check job；`check-release-docs` 继续负责发布文档产物存在性，两者职责不重叠。

## 后续加固（2026-09-12，H09 迁移漂移）

`pnpm check:migrations` 此前只校验迁移文件名，无法发现已应用迁移被改写、编号断号或清单漂移。现已升级为内容门禁（规则实现 `src/lib/migrations/migration-drift.ts`，43 条单测）：命名/编号连续与唯一、空文件、UTF-8 BOM、CRLF、结尾换行，以及每个迁移的 SHA-256 与 `supabase/migration-manifest.json` 基线比对；`pnpm update:migrations-manifest` 仅允许追加，拒绝改写已基线化迁移。新增的 `pnpm check:migration-history` 只读比对本地 Supabase 迁移历史，因依赖 `supabase start` 不纳入离线 `check:all`/CI 聚合。linked/production 历史校验保留为发布 Runbook 中的显式凭据 + 审批步骤。

## 后续加固（2026-09-12，H10 依赖与 secrets 扫描门禁）

原有 `check:security` 是单体脚本：服务端变量清单遗漏 `RESEND_API_KEY`、`VAPID_PRIVATE_KEY`，客户端
指令检测会命中注释，环境文件清单漏掉 `.env`，且没有单测或扫描配置漂移保护。现已拆分为纯策略模块
`src/lib/security/security-config.ts` 与 `scripts/lib/security-config-check.js`，覆盖被跟踪环境/私钥文件、
环境文件权限、共享开发环境服务端密钥、客户端环境变量访问、workflow 最小权限、gitleaks/CodeQL/
Dependabot/security-config 配置漂移，以及 high/critical 依赖审计结果；异常输入 fail-closed。新增 54 条
专项测试，命令名保持 `pnpm check:security`，并继续由 `pnpm check:all` 与 CI 执行。

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
