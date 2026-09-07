# Project Progress

## 当前阶段
- 阶段：通知与基础设施收口
- 日期：2026-09-07
- 策略：本地连续开发、阶段完成后统一推送

## 已完成
- C01–C10、F01–F10
- A01–A05
- B01–B02
- 提交：b8a4fd8（CI、CodeQL、Secrets Scan 均成功）

## 本批次
- [x] B03 Web Push 订阅迁移：`supabase/migrations/020_push_subscriptions.sql`
- [x] B04 订阅注册/撤销 action
- [x] B05 通知权限与设置 UI（VAPID 未配置时安全降级；已补测试）
- [x] B06 Web Push provider 抽象
- [x] B07 邮件/Web Push 偏好统一
- [x] B08 通知幂等键与数据库唯一索引（021_notification_idempotency.sql）
- [x] B09 统一重试/死信查询与回执（既有 email_attempts 上限机制，新增死信查询 API 层）
- [x] B10 通知链路 E2E：成功回执、失败 attempts/error、重试上限过滤、死信查询与 cron 鉴权
- [ ] A06–A10 存储生产能力收口

## 验证
- 最近本地完整验证：通过（746 tests；本次 B10 局部 E2E 通过；完整 verify:build 在提交阶段执行）
- 本地验证：type-check、lint、test（741）、coverage（分支 90.29%）、build 通过；CI 曾因 coverage 统计包含未覆盖的 server action 导致分支 88.88% 失败，已修正 coverage exclude
- CI：99f218e 的 CI、CodeQL、Secrets Scan、Build、E2E 均通过（CI run 34068093215；E2E 有 1 个 flaky annotation 但最终通过）

## 下一入口
下一入口：继续 A07，审计 Supabase fallback contract、能力一致性、错误上下文与敏感信息边界；随后继续 A08–A10。
- [x] B04 订阅 repository：注册 upsert 幂等、按用户+endpoint 撤销
- [x] B04 repository contract tests and subscribe/unsubscribe Server Actions

- 283e613：增加通知 idempotency_key 字段、唯一索引、repository 透传与测试；verify:build 通过。

- 24a9012：新增 listDeadLetterNotifications 及数据库错误/limit 契约测试；verify:build 通过。

- 2026-09-07：完成 B10 通知链路 E2E，新增 mock 通知读取端点用于断言失败回执与 dead-letter；局部 E2E 通过。
- 2026-09-07：完成 A06 storage 配置安全摘要，统一 provider 选择与 env 诊断，覆盖未配置/部分配置/完整配置测试；verify:build 通过。
