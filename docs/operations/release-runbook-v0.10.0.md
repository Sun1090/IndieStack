# v0.10.0 发布 Runbook

> 目的：把发布从“打 tag”变成可审计、可暂停、可回滚的操作。本文是操作手册，不代表发布已完成。

## 发布前入口条件

发布负责人必须在发布记录中填写 commit SHA、目标环境、操作者和时间。不得从有未提交变更的工作树发布。

```bash
git status --short
git fetch origin --prune
git rev-parse HEAD
pnpm verify:build
pnpm test:e2e
pnpm audit --audit-level high
pnpm check:release-docs
pnpm check:migrations            # 离线：迁移命名/顺序/SHA-256 校验和
pnpm check:migration-history     # 本地 Supabase 迁移历史（需先 `pnpm exec supabase start`）
```

所有命令必须有保存的输出；任一失败即停止，不得以修改清单状态替代修复。

## 发布步骤

1. **冻结范围**：确认 CHANGELOG 的版本、迁移列表、环境变量变更和已知限制；由第二位审查者复核 migrations、workflows、认证和 storage 变更。
2. **构建制品**：从目标 commit 的干净 checkout 构建；记录 Node/pnpm 版本、构建日志和制品摘要。
3. **数据库先行**：先确认迁移历史一致——本地运行 `pnpm check:migration-history` 必须通过（pending 或数据库独有的版本都会失败），对 linked/生产环境用带显式凭据与审批的只读 `supabase migration list` 复核后再执行迁移，并保存迁移日志。已基线化的迁移不可改写，只能追加前向迁移；破坏性变更必须拆分到后续版本。
4. **部署应用**：部署同一 commit SHA，不在平台 UI 临时修改代码或环境变量。
5. **健康检查**：运行 `pnpm health:check -- <url>`（或使用 `.github/workflows/health-check.yml`），验证 `/api/health`、版本、关键依赖状态和安全响应头。
6. **生产冒烟**：执行 `pnpm smoke:production -- "$PRODUCTION_URL" --expected-version "$EXPECTED_APP_VERSION" --output production-smoke.json`（或触发 `.github/workflows/production-smoke.yml`）验证 health、公共页面、静态资源、匿名 dashboard 跳转、安全头和无效 webhook；需要登录、上传、邮件或合法 webhook 的场景在隔离测试账号/provider 中另行执行。不得使用真实用户数据。
7. **观察窗口**：至少观察 15 分钟错误率、5xx、延迟、队列积压、Sentry 新事件和数据库迁移错误。仅在指标稳定后发布公告并创建 tag。

## 停止条件

出现以下任一项立即停止发布并进入回滚判断：health 失败、5xx 持续上升、认证失败、迁移错误、关键队列积压、数据写入异常、依赖 provider 大面积失败或无法证明部署 commit 与验证 commit 相同。

## 发布记录模板

- 版本 / tag：
- commit SHA：
- 数据库迁移：
- 构建与 E2E 证据路径：
- 冒烟开始/结束时间（含时区）：
- 观察指标及基线：
- 操作者 / 审查者：
- 结果：成功 / 暂停 / 回滚
- 未解决风险与后续 issue：

回滚操作见：[rollback-runbook-v0.10.0.md](./rollback-runbook-v0.10.0.md)。

## v0.10.0 发布差异

相对 v0.9.0，本版本的入口条件与步骤不变，但需要额外确认：

1. **无新增数据库迁移**：最新迁移仍是 `031_upload_objects.sql`，迁移号与 SHA-256 清单不变。
   本版本是纯应用层（UI 系统）收口，因此 `pnpm check:migrations` 与 `pnpm check:migration-history`
   的期望基线**与 v0.9.0 完全相同**；若出现新迁移，说明发布范围被污染，应先确认再继续。
2. **数据库先行不再是耦合前提**：本版本不改变应用与 schema 的耦合方式，迁移与部署顺序回到常规
   （先迁移再部署仍然更安全，但没有 v0.9.0 那种“必须先迁移”的硬顺序）。回滚只需回滚应用 deployment。
3. **前端样式产物体积与外观需要抽样确认**：`globals.css` 的两段动画收口到 `@theme` token
   （`--animate-progress-indeterminate` / `--animate-navprogress`），`--color-chart-1..5` 补上 `@theme`
   映射，状态色从 Tailwind 原生调色板（`bg-green-500` / `text-amber-600` / `bg-red-500`…）统一到
   `bg-success` / `text-warning` / `bg-destructive` / `bg-info`。上线后抽样确认：进度条仍在动、
   图表五色仍可区分、浅色与深色下状态提示对比度均正常。
4. **深色模式与首屏主题脚本**：根布局新增带 CSP nonce 的内联阻塞脚本，在 CSS 解析前写入 `<html>` 的
   `light` / `dark` class 与 `color-scheme`。**上线后必须确认 CSP 仍生效且控制台无 nonce 相关报错**；
   该脚本是首屏无闪烁的前提，若 CSP 阻断它会退化为「先浅后深」的闪一下。
5. **响应式断点语义变化**：容器内边距改为手机 1rem / ≥640px 2rem，页头断点由 md 提升到 lg，
   仪表盘新增移动抽屉 `MobileDashboardNav`。上线后至少用 375px 与 768px 各走一遍导航可达性。
6. **共享原语替换了同义组件**：`page-loader.tsx` 与 `loading-state.tsx` 已被删除（此前零引用），
   加载态统一为 `PageLoading` / `LoadingIndicator`。若部署分支上仍有代码引用旧模块，构建会直接失败，
   因此不需要额外的灰度开关。
7. **保活与 cron 不变**：`CRON_SECRET`、VAPID 密钥对、HTTPS 生产域名、Supabase 免费版保活/恢复
   仍是既有前置条件，本版本未新增 cron 路由。
8. **观察窗口新增项**：除 v0.9.0 的 health/5xx/Sentry 外，额外关注首屏主题闪烁上报、移动端导航相关
   前端错误，以及 `pnpm check:tokens` / `check:fields` / `check:states` 在 CI 上是否保持绿。

## v0.10.0 发布记录（事后复核，2026-09-22）

本版本是**没有 tag 的发布**：2026-09-13 把 `package.json` / `.env.example` 升到 0.10.0、
CHANGELOG 写出 `[0.10.0]` 章节并部署 `main`，但没有创建 `v0.10.0` 标签或 GitHub Release
（仓库唯一的 tag 仍是 `v0.6.0`）。因此本节的字段是按「部署即发布」的事实事后回填的，
而不是发布前逐条勾选的产物；下一个走完整 tag → release 流程的版本是 v0.11.0。

- 版本 / tag：v0.10.0 / **无 tag**（缺口已记录，不追溯补打：`main` 自 2026-09-13 之后又前进了
  数十个提交，事后补打的 `v0.10.0` 会指向一个已经不代表生产内容的 commit）
- commit SHA：`6465e89`（2026-09-21T17:33Z 复核时的 `main` HEAD；生产报告 `version=0.10.0`）
- 数据库迁移：v0.10.0 范围内为 001–031；`032`（个人数据擦除与保留期）与 `033`
  （上传对象孤儿可发现性）是 0.10.0 之后合入的，属于 v0.11.0，已按 DB-first 顺序应用到云端库
- 构建与 E2E 证据路径：`CI` run `35633071050`（`Lint & Type Check` / `Unit Tests` / `Build` /
  `Build Docs Site` / `E2E shard 1` / `E2E shard 2` / `E2E (Playwright)` 全成功，`main` push）
- 冒烟开始/结束时间（含时区）：2026-09-21T17:33:38Z → 17:34:21Z（UTC）；
  本地 `node scripts/production-smoke.js ... --expected-version 0.10.0` 6/6，
  证据 `/tmp/indiestack-production-smoke-20260922.json`；
  workflow `Production Smoke` run `35632786147` success，artifact 保留 30 天
- 观察指标及基线：`/api/health` 连续 10 次采样全部 HTTP 200（0.85–2.92s，含一次冷启动 2.92s），
  `status=ok`、`ready=true`；`x-request-id` 与安全头齐全；未观察到 5xx
- 操作者 / 审查者：Qoder 自主开发代理（单人执行，**缺少第二位审查者**，是本记录的已知缺陷；
  `release.yml` 的标签校验与 CHANGELOG 门禁承担机器侧复核）
- 结果：成功（应用层内容与生产一致，无副作用冒烟 6/6）
- 未解决风险与后续 issue：
  1. 需要登录 / provider 的冒烟矩阵项仍未执行（见 [production-smoke-v0.10.0.md](./production-smoke-v0.10.0.md)）；
  2. 云端与本地库都**未安装 pg_cron**，`docs/db/retention.md` 登记的每周清理从未执行；
  3. 本版本没有 tag，回滚只能按 deployment 而非版本标签定位；
  4. Vercel Hobby 计划限制每条 cron 路径每天一次，`push-retry` 的重试延迟已放宽到最多 24 小时。
