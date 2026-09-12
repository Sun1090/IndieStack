# ADR-012: Passkey（WebAuthn）试点

- 状态：accepted
- 日期：2026-09-05
- 关联：v0.5.0 roadmap D01；迁移 019；`src/lib/auth/passkey.ts`；`src/lib/auth/passkey-session.ts`

## 背景

v0.4.0 仅对 WebAuthn/Passkey 做了可行性结论（不写生产代码）。v0.5.0 D01 要求
推进为试点落地。约束：Supabase Auth（GoTrue）尚无 passkey 原生登录通道，
但会话仍必须由 GoTrue 签发，不能把 WebAuthn assertion 当成应用会话。

## 决策

1. **加密校验不自研**：引入 `@simplewebauthn/server`（校验）与
   `@simplewebauthn/browser`（前端 navigator.credentials 封装）。WebAuthn 的
   CBOR/attestation/签名校验复杂且安全敏感，自研风险不可接受（Reuse First：
   仓库内无既有依赖覆盖此能力，故新增）。
2. **双 Feature flag 门控**：`NEXT_PUBLIC_FEATURE_PASSKEY=true` 控制注册
   与设置入口；`NEXT_PUBLIC_FEATURE_PASSKEY_LOGIN=true` 额外控制登录选项
   与认证验证。任一所需开关关闭时对应 API 返回 404。默认关闭，部署后显式启用。
3. **RP/origin 推导**：RP ID 与验证 origin 从 `NEXT_PUBLIC_APP_URL` 推导
   （RP ID = hostname），不新增环境变量。
4. **challenge 传递**：短时（5 分钟）httpOnly + SameSite=Lax cookie，
   无状态、serverless 友好，避免引入 challenge 存储表。
5. **数据模型**（迁移 019）：`webauthn_credentials`——`credential_id`（base64url，唯一）、
   `public_key`（base64url）、`counter`（克隆检测）、`device_name`、`transports`；
   RLS 允许用户读写自己的行，服务端验证流程走 admin 客户端。
6. **Supabase session bridge**：assertion 验签成功并持久化计数器后，服务端才使用
   `service_role` 为该用户生成一次性 magiclink token，并在同一请求内通过
   `verifyOtp` 消费。`@supabase/ssr` 只向浏览器写入 HttpOnly 会话 cookie；
   token、action link、邮箱和 userId 均不返回客户端或写入日志。
7. **MFA 兼容**：若用户已有已验证因子，桥接会话保持 aal1，并仅返回 factorId；
   前端跳转 `/auth/mfa` 完成 aal2。没有 MFA 因子的用户才直接进入 dashboard。

## 理由

- passkey 注册、验签、服务端会话桥接形成完整登录闭环，且不伪造应用会话。
- cookie 传 challenge 相比内存存储跨实例可靠，相比 DB 存储免迁移与清理。

## 后果

- 需要新依赖 `@simplewebauthn/*`（理由见上）。
- 非 HTTPS 环境浏览器不提供 WebAuthn（localhost 除外），预览/生产必须 https。
- 用户删除凭据走 Server Action（RLS delete-own）；凭据丢失时账号仍可用密码/OAuth 登录。
- 会话桥接依赖 Supabase Admin API；`SUPABASE_SERVICE_ROLE_KEY` 只能存在服务端。
- 启用生产登录需同时部署桥接代码并设置 `NEXT_PUBLIC_FEATURE_PASSKEY`、
  `NEXT_PUBLIC_FEATURE_PASSKEY_LOGIN`；配置值应在 Vercel 中保存为 Secret/Sensitive。
