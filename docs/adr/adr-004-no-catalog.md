# ADR-004: 暂不引入 pnpm catalog

日期: 2026-08-23
状态: 已接受

## 背景
pnpm catalog 可将依赖版本集中在 pnpm-workspace.yaml 统一管理，避免多包版本漂移。

## 决策
暂不引入。当前 workspace 仅两个项目：主应用与 docs-site，二者**无任何共享依赖**
（docs-site 只用 vitepress），catalog 无收益。

## 触发条件（满足任一即重评）
1. workspace 新增共享运行时依赖的项目（如 admin 后台、独立 server）
2. 主应用与 docs-site 开始共用同一依赖（如 react types）

## 影响
- 无即时成本；版本管理继续由各 package.json + lockfile 承担
- `pnpm dep:health` 脚本已提供过期依赖可见性
