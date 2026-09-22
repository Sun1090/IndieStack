# Release 检查模板（打 v* 标签前逐项勾选）

> 由 `.github/workflows/release.yml` 在推送 `v*` 标签后校验标签与 `package.json` 一致，并从 CHANGELOG
> 对应章节生成 GitHub Release Notes。
> 本模板保证打标签前人工侧已就绪。

## 版本号

- [ ] `package.json` version 已更新
- [ ] `.env.example` 中 `NEXT_PUBLIC_APP_VERSION` 已同步
- [ ] `/api/health` 版本兜底已同步（当前默认读取 `package.json`，并验证 required/optional 依赖状态）

## 文档

- [ ] `CHANGELOG.md` `[Unreleased]` 已转正为 `[x.y.z]` 并写发布日期
- [ ] `docs/roadmap-*.md` 退出标准逐项确认
- [ ] docs-site 功能章节已同步（含中英双语）

## 门禁

- [ ] 本地 `pnpm verify:build` 全绿（lint / type-check / test / build）
- [ ] CI 工作流全绿：`CI`（`Lint & Type Check` / `Unit Tests` / `Build` / `Build Docs Site` / `E2E (Playwright)`）、`CodeQL`、`Secrets Scan`、`Security and configuration checks`
- [ ] 覆盖率门禁未降低（当前阈值来自 `vitest.config.ts`：statements 91、branches 90、functions 93、lines 92）
- [ ] 数据保留与擦除演练在本地 Supabase（`001`–`033` 已应用）通过：
      `docs/operations/drills/retention-cleanup.sql` 末行 `failures = 0`（14 条断言），
      `docs/operations/drills/account-erasure.sql` 全部断言通过；两者结果记入 `docs/db/retention.md` 的演练记录
- [ ] `pnpm smoke:production -- "$PRODUCTION_URL" --expected-version "$EXPECTED_APP_VERSION" --expected-commit "$(git rev-parse HEAD)" --output production-smoke.json` 通过，或 `Production Smoke` workflow 的 `smoke` 作业（只能由 `workflow_dispatch` 触发）成功并保留 30 天 artifact `production-smoke-evidence`；记下 artifact 的 run 与文件名，定时漂移检查的证据是**另一个** artifact `production-version-drift-evidence`
- [ ] 冒烟断言过 commit：生产 `/api/health` 的 `commit` 与被验证的 commit 一致（短 SHA 按前缀匹配）。生产不上报 `commit` 时这条判**失败**，不要改用「版本一致就行」绕过——同一版本号内的多个构建在外部不可区分，回滚也就不知道该回到哪一个
- [ ] `Production Smoke` workflow 的定时漂移检测 `smoke-main` 为通过（期望版本来自 `package.json`；失败表示生产部署落后，禁止发布）
- [ ] RLS 回归脚本通过；`pnpm audit` 无高危

## 打标签

```bash
git tag v0.11.0 && git push origin v0.11.0
```

## 证据与回滚

- [ ] `pnpm check:release-docs` 通过，且发布记录附命令输出
- [ ] [v0.11.0 发布 Runbook](../docs/operations/release-runbook-v0.11.0.md) 的 commit、迁移、观察窗口字段已填写
- [ ] [生产 Smoke Test](../docs/operations/production-smoke-v0.11.0.md) 每项均有时间、状态和证据
- [ ] [回滚 Runbook](../docs/operations/rollback-runbook-v0.11.0.md) 已由操作者和审查者复核；数据库回滚决策已明确
- [ ] 回滚演练结果单独记录；空白模板或勾选项不视为演练证据
- [ ] 本版本含迁移：`032_data_retention_erasure.sql`、`033_upload_object_orphan_audit.sql` 已在应用部署**之前**应用到目标环境，且 `supabase migration list` 与 `supabase/migration-manifest.json` 一致
- [ ] 账户删除端到端演练已在**隔离账号**上完成（擦除先于删号、审计留痕不含身份、被引用的封面保留）
