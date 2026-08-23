# ADR-001: 写操作统一走 Server Actions

日期: 2026-08-23
状态: 已接受

## 背景
项目早期同时存在 `/api/teams` REST 路由与 `createTeam` Server Action 两套完整实现，
鉴权与限流各维护一份，审查发现权限规则变更时容易漏改一处。

## 决策
写操作（增删改）一律走 Server Actions；API Routes 仅保留给外部回调（Stripe webhook、OAuth callback）、健康检查和确需 HTTP 端点的场景。已删除 `/api/teams` 死路由。

## 理由
- Server Actions 天然类型安全（函数签名即契约），Zod schema 共享校验
- 免去手写 fetch 样板与 JSON 错误协议
- 鉴权守卫（guards.ts）单点复用

## 影响
- 正面：单一数据通道，代码量减少约 300 行
- 负面：需要 HTTP API 的第三方集成场景仍需补路由层薄封装
