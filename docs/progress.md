# Project Progress

## 当前阶段
- 阶段：通知与基础设施收口
- 日期：2026-09-06
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
- [ ] B06–B10 通知 provider、偏好、幂等、重试、E2E
- [ ] A06–A10 存储生产能力收口

## 验证
- 最近本地完整验证：通过（736 tests，type-check、lint、test 通过；build 待本阶段收口验证）
- 本次迁移：待本地 Supabase migration check
- CI：上次远端检查通过；本地改动尚未 push

## 下一入口
下一入口：实现 B06 provider 抽象与 B07 偏好统一；随后补 B08 幂等、B09 重试和 B10 E2E。
- [x] B04 订阅 repository：注册 upsert 幂等、按用户+endpoint 撤销
- [x] B04 repository contract tests and subscribe/unsubscribe Server Actions
