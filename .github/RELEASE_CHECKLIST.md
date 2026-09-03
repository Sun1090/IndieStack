# Release 检查模板（打 v* 标签前逐项勾选）

> 由 `.github/workflows/release.yml` 在推送 `v*` 标签后自动创建 GitHub Release（notes 自动生成）。
> 本模板保证打标签前人工侧已就绪。

## 版本号

- [ ] `package.json` version 已更新
- [ ] `.env.example` 中 `NEXT_PUBLIC_APP_VERSION` 已同步
- [ ] `/api/health` 版本兜底已同步（或已改为读 package.json）

## 文档

- [ ] `CHANGELOG.md` `[Unreleased]` 已转正为 `[x.y.z]` 并写发布日期
- [ ] `docs/roadmap-*.md` 退出标准逐项确认
- [ ] docs-site 功能章节已同步（含中英双语）

## 门禁

- [ ] 本地 `pnpm verify:build` 全绿（lint / type-check / test / build）
- [ ] CI 八道关卡全绿（Lint&Type / Build / E2E / Docs / CodeQL / gitleaks…）
- [ ] 覆盖率门禁未降低（statements/functions/lines ≥ 90%、branches ≥ 78%）
- [ ] RLS 回归脚本通过；`pnpm audit` 无高危

## 打标签

```bash
git tag v0.4.0 && git push origin v0.4.0
```
