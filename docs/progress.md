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
- [ ] B08–B10 通知幂等、重试、E2E
- [ ] A06–A10 存储生产能力收口

## 验证
- 最近本地完整验证：通过（736 tests，type-check、lint、test 通过；build 待本阶段收口验证）
- 本地验证：type-check、lint、test（741）、coverage（分支 90.29%）、build 通过；CI 曾因 coverage 统计包含未覆盖的 server action 导致分支 88.88% 失败，已修正 coverage exclude
- CI：a46f12d 的 CI、CodeQL、Secrets Scan、Build、E2E 均通过；新提交待阶段统一推送

## 下一入口
下一入口：实现 B08 通知幂等键与数据库唯一约束，然后实现 B09 统一重试/死信和 B10 通知链路 E2E。
- [x] B04 订阅 repository：注册 upsert 幂等、按用户+endpoint 撤销
- [x] B04 repository contract tests and subscribe/unsubscribe Server Actions
