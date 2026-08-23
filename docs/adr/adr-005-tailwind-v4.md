# ADR-005: Tailwind CSS v3 → v4 迁移策略

日期: 2026-08-23
状态: 已接受

## 背景
v4 改为 CSS-first 配置，官方提供 @tailwindcss/upgrade codemod。

## 决策
采用 **@config 桥接**而非全量 CSS-first 重写：
- postcss 换用 @tailwindcss/postcss（内建前缀，移除 autoprefixer）
- globals.css 头部 `@import "tailwindcss"` + `@config "../../tailwind.config.ts"`
- 既有 JS 配置（content/darkMode:"class"/tailwindcss-animate 插件）零改动保留
- darkMode 由数组改字符串（v4 类型要求）

## 理由
桥接路径风险最低，shadcn/ui 的 border-border 等自定义工具类依赖 JS 配置中的颜色映射。

## 影响
- 负面：未享受 v4 原生 @theme 的 tree-shaking 收益（后续可渐进重写）
- 注意：Turbopack 对 tailwind.config.ts 有 MODULE_TYPELESS 警告（无害）
