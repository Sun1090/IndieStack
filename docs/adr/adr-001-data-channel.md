# ADR-001: 写操作统一走 Server Actions

日期: 2026-08-23（2026-09-12 补充上传进度例外）
状态: 已接受

## 背景
项目早期同时存在 `/api/teams` REST 路由与 `createTeam` Server Action 两套完整实现，
鉴权与限流各维护一份，审查发现权限规则变更时容易漏改一处。

## 决策
写操作（增删改）一律走 Server Actions；API Routes 仅保留给外部回调（Stripe webhook、OAuth callback）、健康检查和确需 HTTP 端点的场景。已删除 `/api/teams` 死路由。

2026-09-12 上传组件需要真实字节级进度与取消底层请求，Server Actions 无法完整提供这两个能力。因此浏览器上传增加“同源 Route Handler + 共享领域 service”的窄例外：`/api/uploads/*` 只负责请求边界和响应映射，鉴权、校验、存储与回滚规则仍与 Server Action 共用 `src/lib/uploads/service.ts`，不允许形成第二套业务规则。

## 理由
- Server Actions 天然类型安全（函数签名即契约），Zod schema 共享校验
- 免去手写 fetch 样板与 JSON 错误协议
- 鉴权守卫（guards.ts）单点复用

## 影响
- 正面：单一数据通道，代码量减少约 300 行
- 负面：需要 HTTP API 的第三方集成场景仍需补路由层薄封装；上传进度等浏览器传输能力需在薄路由与共享 service 之间守住边界
