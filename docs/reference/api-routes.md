# API 路由文档

> 数据通道约定：写操作走 Server Actions（`src/lib/actions/`），本目录仅保留外部回调与健康检查类端点。

## 端点一览

| 方法   | 路径                        | 鉴权            | 说明                                                                                                                                                                                                                                                          |
| ------ | --------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/health`               | 无              | 健康检查：返回 uptime、版本、mock 模式、required/optional 依赖分级、配置与 Supabase 可达性（limit(1)，3s 超时）。required 依赖缺失返回 `503 error`，已配置但不可达返回 `503 degraded`；本地 Mock 模式跳过 Supabase 并返回 `200 ok`。`Cache-Control: no-store` |
| GET    | `/api/user`                 | 登录            | 当前用户信息 + profile                                                                                                                                                                                                                                        |
| PATCH  | `/api/user`                 | 登录            | 更新 profile（白名单字段，strict 校验，拒绝 `javascript:` 头像协议）                                                                                                                                                                                          |
| DELETE | `/api/user`                 | 登录            | 注销账号（service_role 删除 auth 用户）                                                                                                                                                                                                                       |
| GET    | `/api/analytics?range=1-90` | 登录            | 请求指标聚合：summary / timeline / recent。UTC 自然日对齐窗口                                                                                                                                                                                                 |
| POST   | `/api/stripe/checkout`      | 登录            | 创建 Stripe Checkout Session，返回跳转 URL                                                                                                                                                                                                                    |
| POST   | `/api/webhooks/stripe`      | **签名验证**    | Stripe 事件回调（subscription.* / invoice.*）。无 rate limit（防重试丢失）                                                                                                                                                                                    |
| GET    | `/api/auth/callback`        | OAuth state     | Supabase OAuth 回调，交换 code 换 session（by-design 公开：code 一次性 + `getSafeRedirect` 防开放重定向）                                                                                                                                                     |
| POST   | `/api/auth/passkey/register-options` | 登录 + flag | 已登录用户创建 WebAuthn registration options；要求 `NEXT_PUBLIC_FEATURE_PASSKEY=true`，10 次/分钟 IP 限流，challenge 存短时 httpOnly cookie |
| POST   | `/api/auth/passkey/register-verify` | 登录 + flag | 校验 attestation、持久化凭据并清除 challenge；flag 关闭返回 404，校验失败返回通用 400，存储不可用返回 503 |
| POST   | `/api/auth/passkey/auth-options` | flag | 创建 discoverable-credential authentication options；要求 passkey 与 passkey-login 双 flag，10 次/分钟 IP 限流 |
| POST   | `/api/auth/passkey/auth-verify` | flag | 校验 assertion、更新 counter、消费一次性 magiclink 并建立 Supabase SSR session；仅返回 verified/MFA 结果，不泄漏 token、action link、邮箱或 userId |
| GET    | `/api/invitations`          | 团队读权限      | 团队邀请信息查询                                                                                                                                                                                                                                              |
| POST   | `/api/invitations`          | 团队邀请权限    | 发送邀请（邮箱查 ID，白名单校验；**直接加入模式**：即时写入 team_members，无 pending 态，`team_invitations` 表暂为孤儿——pending 邀请制见 G 域）                                                                                                               |
| DELETE | `/api/invitations`          | 团队移除权限    | 撤销邀请/移除成员（owner 不可移除）                                                                                                                                                                                                                           |
| GET    | `/api/og`                   | 无（by-design） | 动态 OG 分享图（纯静态渲染，参数截断，无数据访问）                                                                                                                                                                                                            |

## 通用约定

### 错误格式

```json
{ "error": "<i18n error key 或通用消息>" }
```

- 统一经 `jsonNoStore` 输出（`src/lib/api-response.ts`）；`auth/callback` 只做 redirect 无 JSON 体
- 永不返回堆栈、内部错误细节；详细原因仅记录在服务端日志
- 认证失败统一 `401`；权限不足 `403`；校验失败 `400`；限流 `429`（`retryAfter` 秒数字段）

### 缓存

- 所有鉴权作用域响应均携带 `Cache-Control: no-store`（见 `src/lib/api-response.ts`）

### 限流（B03 审计结论 v0.4.0）

- 限流覆盖：`invitations`（GET/POST/DELETE）、`user`（GET/PATCH/DELETE）、`analytics`、`stripe/checkout`、`contact` action、四个 passkey 路由（10 次/分钟/IP）
- by-design 不限流：`webhooks/stripe`（事件重试语义，签名验签保障）、`auth/callback`（code 一次性）、`health`/`og`（纯静态无数据写）
- 内存滑窗实现，多实例部署需迁移 Redis/Upstash

### Trace

- 所有请求经 middleware 注入 `x-request-id`（响应头可读），排障时引用
