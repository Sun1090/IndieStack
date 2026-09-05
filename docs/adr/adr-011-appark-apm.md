# ADR-011: Appark APM 轻量接入

- 状态：accepted
- 日期：2026-09-05
- 关联：v0.5.0 roadmap C01；`docs/adr/adr-008-repository.md`

## 背景

Appark APM 自 v0.1.0 起仅为脚手架占位（`src/lib/appark.ts` 曾因误导被移除），
v0.5.0 C01 要求将其落为生产代码。厂商 SDK 的可用性与初始化行为未知，
且 Sentry 已承担错误监控主通道。

## 决策

1. **无厂商 SDK 依赖**：`src/lib/appark.ts` 以第一方轻量封装实现
   `initAppark / trackEvent / trackError / flushEvents`——事件进内存队列
   （上限 200，丢最旧），`flushEvents()` 批量 POST 到
   `NEXT_PUBLIC_APPARK_ENDPOINT`（Bearer 认证）。将来切换或新增 APM 供应商
   只替换传输层，业务埋点不动。
2. **默认旁路关闭**：`NEXT_PUBLIC_APPARK_API_KEY` 与 `NEXT_PUBLIC_APPARK_ENDPOINT`
   齐备才真正启用；未启用时 track* 只入内存队列、flush 直接清空，零网络开销。
   配置只给一半时在 env 诊断（`getEnvReport`）中告警。
3. **初始化位置**：`src/instrumentation.ts`（nodejs runtime）调用 `initAppark()`，
   幂等；与 Sentry server config 并列，无顺序耦合。
4. **埋点范围（首版）**：仅关键服务端流程——Stripe 结账会话创建
   （`checkout.session_created`）与 cron digest 运行指标（`cron.digest`）；
   错误主通道仍走 Sentry（`trackError` 仅作补充通道）。
5. **失败语义**：APM 属旁路——flush 非 2xx 保留批次待重试（受队列上限约束），
   网络异常吞错记日志，绝不影响业务主流程。

## 理由

- 满足"无凭据环境（本地/CI/preview）零开销 + 有凭据环境开箱即用"。
- 避免 vendor SDK 锁定与 Turbopack 打包兼容风险（参照 ali-oss 的
  `serverExternalPackages` 经验，能不引 SDK 就不引）。

## 后果

- 事件 schema（`event/properties/timestamp/app_version`）成为约定，
  收集端需按此解析。
- 队列在进程内存中，serverless 环境下未 flush 的事件随实例回收丢失——
  首版接受（关键流程均在请求尾部主动 flush）。
- 注册流程埋点未包含（auth 流程在 Supabase 侧），列为后续增强。
