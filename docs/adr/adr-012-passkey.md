# ADR-012: Passkey（WebAuthn）试点

- 状态：accepted
- 日期：2026-09-05
- 关联：v0.5.0 roadmap D01；迁移 019；`src/lib/auth/passkey.ts`

## 背景

v0.4.0 仅对 WebAuthn/Passkey 做了可行性结论（不写生产代码）。v0.5.0 D01 要求
推进为试点落地。约束：Supabase Auth（GoTrue）尚无 passkey 原生登录通道，
会话签发仍由 GoTrue 承担。

## 决策

1. **加密校验不自研**：引入 `@simplewebauthn/server`（校验）与
   `@simplewebauthn/browser`（前端 navigator.credentials 封装）。WebAuthn 的
   CBOR/attestation/签名校验复杂且安全敏感，自研风险不可接受（Reuse First：
   仓库内无既有依赖覆盖此能力，故新增）。
2. **Feature flag 门控**：`NEXT_PUBLIC_FEATURE_PASSKEY=true` 才启用；关闭时
   相关 API 返回 404、设置页不渲染入口。默认关闭。
3. **RP/origin 推导**：RP ID 与验证 origin 从 `NEXT_PUBLIC_APP_URL` 推导
   （RP ID = hostname），不新增环境变量。
4. **challenge 传递**：短时（5 分钟）httpOnly + SameSite=Lax cookie，
   无状态、serverless 友好，避免引入 challenge 存储表。
5. **数据模型**（迁移 019）：`webauthn_credentials`——`credential_id`（base64url，唯一）、
   `public_key`（base64url）、`counter`（克隆检测）、`device_name`、`transports`；
   RLS 允许用户读写自己的行，服务端验证流程走 admin 客户端。
6. **试点范围边界**：注册（生成选项 → attestation 校验 → 落库）与认证验证
   （assertion 校验 → 计数器更新 → 返回 userId）闭环可用；**登录会话签发不在本版**——
   待 GoTrue 提供原生 passkey 登录后接入，`auth-verify` 的返回值即为衔接点。

## 理由

- passkey 注册/验证闭环先行可验证 UX 与数据模型，且不阻塞未来 GoTrue 原生支持。
- cookie 传 challenge 相比内存存储跨实例可靠，相比 DB 存储免迁移与清理。

## 后果

- 需要新依赖 `@simplewebauthn/*`（理由见上）。
- 非 HTTPS 环境浏览器不提供 WebAuthn（localhost 除外），预览/生产必须 https。
- 用户删除凭据走 Server Action（RLS delete-own）；凭据丢失时账号仍可用密码/OAuth 登录。
