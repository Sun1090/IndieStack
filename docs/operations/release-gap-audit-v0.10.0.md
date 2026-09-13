# v0.10.0 发布文档缺口审计 / Exit Report

审计日期：2026-09-13
审计范围：`package.json` 版本 0.10.0、`CHANGELOG.md`、`.github/RELEASE_CHECKLIST.md`、双语 README、
`docs/operations/release-*-v0.10.0.md`、`docs-site/{,zh-CN/}v0.10.0.md`、`scripts/check-release-docs.js`
与 CI 门禁。

## 结论

v0.10.0 在本地完成了 `RELEASE_FREEZE`：版本号、CHANGELOG、发布 / 回滚 / smoke runbook、双语 README、
docs-site 双语版本页与 checklist 已全部对齐，`pnpm check:release-docs` 在 `package.json` 版本为 0.10.0 时通过。
**push / tag / PR / merge / deploy 未执行**（当前权限边界为本地），因此本审计不构成发布通过证据；
`docs/operations/production-smoke-v0.10.0.md` 保持「未执行」。本版本无数据库迁移。

## 里程碑退出标准核对（M2 UI 系统收口）

| 退出条件                                 | 证据                                                                 | 状态 |
| ---------------------------------------- | -------------------------------------------------------------------- | ---- |
| G01 Tailwind v4 原生主题收口             | `pnpm check:tailwind`（7 类规则码、24 条单测）                       | 达成 |
| G02 design token 单一事实来源 + 门禁     | `src/lib/design/tokens.ts`、`pnpm check:tokens`（8 类、28 条单测）   | 达成 |
| G03 共享表单字段原语 + 门禁              | `form-field.tsx` / `native-select.tsx`、`pnpm check:fields`（3 类）  | 达成 |
| G04 加载 / 空 / 错误状态统一 + 门禁      | `PageLoading` / `EmptyState` / `ErrorState`、`pnpm check:states`（4 类） | 达成 |
| G05 暗色模式无首帧闪烁且持久化           | 内联 nonce 阻塞脚本、13 条单测、`e2e/theme.spec.ts` 6 条（含断 bundle 首屏断言） | 达成 |
| G06 移动端断点无溢出且导航可达           | 容器 1rem/2rem、`MobileDashboardNav`、18 条单测 + 11 条 E2E          | 达成 |
| G07 键盘与屏幕阅读器交互无回归           | `#main-content` 可聚焦、Esc 交还焦点、折叠按钮可访问名、`?` 快捷键收口 | 达成 |
| 全量门禁全绿                             | 见下「可复现验证」                                                   | 达成 |
| 视觉基线无像素漂移                       | Linux 容器 4 项（首页 / 功能页 / 定价页 / 登录页）                   | 达成 |
| 生产 smoke                               | 需 deploy 权限                                                       | 未执行（外部权限） |

## 缺口与交付物

| 缺口                              | 之前的问题                                                          | 本次交付物                                                                        | 当前证据                          | 状态                 |
| --------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------- | -------------------- |
| 状态色散落原生调色板              | 同一语义在不同文件用不同色阶，深色模式无统一回退                    | `src/lib/design/tokens.ts` 39 个 token + 11 个业务文件迁移                        | `pnpm check:tokens` 通过          | 已消除               |
| 图表 token 无 `@theme` 映射       | `text-chart-N` / `fill-chart-N` 类名实际不存在                      | `globals.css` 补 `--color-chart-1..5` 映射                                        | 门禁 + 构建产物复核               | 已消除               |
| v3 动画写法与死代码               | 裸 `@keyframes` + 手写工具类，`.step` 无引用                        | `@theme` token 化 + 删除死代码                                                    | `pnpm check:tailwind` 通过        | 已消除               |
| 表单 label / aria 接线易漂移      | 每个表单各写一套 `htmlFor` / `aria-describedby`                     | `FormField` context 统一注入，15+ 表单迁移                                        | `pnpm check:fields` 通过          | 已消除               |
| 原生 select 外观漂移              | 复制控件类名长串，部分漏掉 `disabled:` 外观                         | `NativeSelect` 单一来源                                                           | 门禁禁止复制类名                  | 已消除               |
| 3 个路由骨架丢 `aria-busy`        | 手写 Skeleton 绕开共享原语，加载文案硬编码中文                      | `PageLoading` 五种骨架 + next-intl 文案 + `sr-only` `role="status"`               | `pnpm check:states` 通过          | 已消除               |
| 10 处裸空态 / 4 处错误态各写一套  | 空态是无图标无角色的 `<p>`，错误边界各写一套 markup                 | `EmptyState` / `ErrorState` 收敛，错误页 `code` 渲染唯一 `h1`                     | 14 条原语单测                     | 已消除               |
| 两个零引用重复加载组件            | `page-loader.tsx` / `loading-state.tsx` 无人引用却长期存在          | 删除，门禁禁止其复活                                                              | `check:states` 的 `LEGACY_LOADER_MODULE` | 已消除         |
| FAQ 文案硬编码英文                | `faq-list` 的搜索占位符与无结果提示未走 i18n                        | 改为 props，双语各补 2 个 key（en/zh 各 980）                                     | `pnpm check:locales` 通过         | 已消除               |
| 深色模式首帧闪烁                  | 主题在 hydration 后才写入，深色用户先看到一帧浅色                   | 根布局 CSP nonce 内联阻塞脚本 + `color-scheme`                                    | 6 条主题 E2E（含断 bundle）       | 已消除               |
| 主题持久化失效                    | Provider 写 `ui-theme`、其它调用点读 `theme`                        | 键名与解析规则收口到 `src/lib/theme/theme.ts`                                     | 13 条单测 + E2E                   | 已消除               |
| 375px 横向溢出                    | 容器固定 2rem 内边距，`scrollWidth` 428 > 375                       | 手机 1rem / ≥640px 2rem                                                           | `e2e/responsive.spec.ts`          | 已消除               |
| 手机端导航不可达                  | 仪表盘侧边栏 `hidden md:block`，手机上只能手改地址栏                | `MobileDashboardNav` 抽屉 + 页头断点 md→lg + `aria-*`                             | 11 条响应式 E2E                   | 已消除               |
| 跳过导航后焦点不落位              | `#main-content` 不可聚焦                                            | 四处 `<main>` 补 `tabIndex={-1}`                                                  | `e2e/keyboard.spec.ts`            | 已消除               |
| 移动菜单 Esc / 焦点              | Esc 无响应，关闭后焦点丢失                                          | Esc 关闭并交还汉堡按钮                                                            | 键盘 E2E + 单测                   | 已消除               |
| 折叠侧边栏无可访问名称            | 按钮无 `aria-label` / `aria-expanded`，折叠后链接只剩 `title`       | 补齐 `aria-label` / `aria-expanded` / `aria-controls`，链接改 `aria-label`        | 键盘 E2E + 单测                   | 已消除               |
| `?` 快捷键误触发                  | contenteditable / `role="textbox"` 内输入 `?` 会弹帮助              | 一并拦截 contenteditable 与带修饰键组合                                           | 快捷键单测                        | 已消除               |
| 发布 checklist 版本               | checklist 仍指向 v0.9.0 产物与 tag                                  | `.github/RELEASE_CHECKLIST.md` 更新为 v0.10.0 tag 与三个 v0.10.0 文档链接          | 门禁读取 checklist 校验           | 文档已补齐           |
| README 发布入口                   | 双语 README 链接旧版本 runbook / smoke                              | `README.md`、`README.zh-CN.md` 指向 v0.10.0 产物并由门禁校验                       | `check:release-docs` 通过         | 文档已补齐           |
| docs-site 版本页                  | 新版本没有中英发布说明页                                            | `docs-site/v0.10.0.md`、`docs-site/zh-CN/v0.10.0.md` 并注册到导航                  | 中英页面各 1 个                   | 文档已补齐           |
| v0.10.0 smoke 证据                | 直接复制 v0.9.0 smoke 会把历史证据误认成本版本通过                  | `production-smoke-v0.10.0.md` 重写为干净「未执行」基线，并新增深色首屏 / 移动导航 / 状态色行 | 状态：未执行          | 执行记录待发布时填写 |

## 与 v0.9.0 的差异

1. **无新增数据库迁移**：最新迁移仍是 `031_upload_objects.sql`，迁移号与 SHA-256 清单不变。
   `pnpm check:migrations` 期望基线与 v0.9.0 完全相同。
2. 变更集中在应用层：`src/lib/design/tokens.ts`、`src/lib/ui/form-field-rules.ts`、
   `src/lib/ui/state-rules.ts`、`src/components/shared/{form-field,native-select,page-loading,empty-state,error-state}.tsx`
   与 `globals.css`。
3. 新增四道写法门禁（`check:tailwind` / `check:tokens` / `check:fields` / `check:states`），
   全部接入 `pnpm check:all` 与 CI，任何一项失败都会阻断构建。
4. 对外可见行为变化：深色模式不再闪白、375px 不再横向滚动、手机端仪表盘导航可达、
   跳过导航后焦点真正落进主内容。无破坏性 API 变更。
5. 发布前外部条件与 v0.9.0 相同（VAPID 密钥对、HTTPS 站点、`CRON_SECRET`、Supabase Management API token）。

## 可复现验证

在目标 commit 的干净 checkout 中至少运行：

```bash
pnpm check:release-docs
pnpm check:changelog
pnpm check:docs
pnpm check:all
pnpm verify:build
pnpm test:e2e
pnpm test:visual
pnpm audit --audit-level high
pnpm --filter indiestack-docs build
```

## 恢复步骤（受限中断时）

若在未能 push 前中断，仓库处于 `feat/visual-regression-baseline` 分支、本地提交领先 `origin/main`
（base `15b05ebe8e93725e16698e8b66fc9c43e3733965`）。恢复方式：

```bash
git status --short          # 应为干净工作树
git log --oneline -3        # 看到 release commit
pnpm check:all              # 复现全部离线门禁
pnpm verify:build           # 复现构建门禁
```

发布步骤从 `docs/operations/release-runbook-v0.10.0.md` 的「发布前入口条件」继续；
未获授权前不得 push、开 PR、merge 或 deploy。

## 下一里程碑

roadmap `docs/roadmap-0.6.0.md` 的 I / J 段（I04、I06–I10、J02–J10）：ADR 决策状态、release checklist、
本地 mock / provider 诊断 / 贡献者测试矩阵 / 迁移回滚 runbook、E2E shard 策略、CI 并行与缓存、
CodeQL 与 Secrets 零回归、production smoke、tag/release 自动化、退出报告。
