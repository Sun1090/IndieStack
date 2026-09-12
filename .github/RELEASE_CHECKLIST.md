# Release 检查模板（打 v* 标签前逐项勾选）

> 由 `.github/workflows/release.yml` 在推送 `v*` 标签后自动创建 GitHub Release（notes 自动生成）。
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
- [ ] CI 工作流全绿（Lint&Type / Build / Docs / E2E / CodeQL / Secrets Scan）
- [ ] 覆盖率门禁未降低（statements/functions/lines ≥ 90%、branches ≥ 90%）
- [ ] `pnpm smoke:production -- "$PRODUCTION_URL" --expected-version "$EXPECTED_APP_VERSION" --output production-smoke.json` 通过，或 `Production Smoke` workflow 成功并保留 30 天 artifact
- [ ] RLS 回归脚本通过；`pnpm audit` 无高危

## 打标签

```bash
git tag v0.6.0 && git push origin v0.6.0
```

## 证据与回滚

- [ ] `pnpm check:release-docs` 通过，且发布记录附命令输出
- [ ] [v0.6.0 发布 Runbook](../docs/operations/release-runbook-v0.6.0.md) 的 commit、迁移、观察窗口字段已填写
- [ ] [生产 Smoke Test](../docs/operations/production-smoke-v0.6.0.md) 每项均有时间、状态和证据
- [ ] [回滚 Runbook](../docs/operations/rollback-runbook-v0.6.0.md) 已由操作者和审查者复核；数据库回滚决策已明确
- [ ] 回滚演练结果单独记录；空白模板或勾选项不视为演练证据
