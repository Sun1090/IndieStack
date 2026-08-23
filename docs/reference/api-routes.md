# API 路由文档

> 数据通道约定：写操作走 Server Actions（`src/lib/actions/`），本目录仅保留外部回调与健康检查类端点。

## 端点一览

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/api/health` | 无 | 健康检查：返回 uptime、Supabase/Sentry/Stripe 配置状态。`Cache-Control: no-store` |
| GET | `/api/user` | 登录 | 当前用户信息 + profile |
| PATCH | `/api/user` | 登录 | 更新 profile（白名单字段，strict 校验，拒绝 `javascript:` 头像协议） |
| DELETE | `/api/user` | 登录 | 注销账号（service_role 删除 auth 用户） |
| GET | `/api/analytics?range=1-90` | 登录 | 请求指标聚合：summary / timeline / recent。UTC 自然日对齐窗口 |
| POST | `/api/stripe/checkout` | 登录 | 创建 Stripe Checkout Session，返回跳转 URL |
| POST | `/api/webhooks/stripe` | **签名验证** | Stripe 事件回调（subscription.* / invoice.*）。无 rate limit（防重试丢失） |
| GET | `/api/auth/callback` | OAuth state | Supabase OAuth 回调，交换 code 换 session |
| GET | `/api/invitations` | 登录 | 团队邀请信息查询 |

## 通用约定

### 错误格式

```json
{ "error": "<i18n error key 或通用消息>" }
```

- 永不返回堆栈、内部错误细节；详细原因仅记录在服务端日志
- 认证失败统一 `401`；权限不足 `403`；校验失败 `400`；限流 `429`

### 缓存

- 所有鉴权作用域响应均携带 `Cache-Control: no-store`（见 `src/lib/api-response.ts`）

### 限流

- 除 Stripe webhook 外，API 路由均经内存滑窗限流（多实例部署需迁移 Redis/Upstash）

### Trace

- 所有请求经 middleware 注入 `x-request-id`（响应头可读），排障时引用
