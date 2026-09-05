# v0.5.0 发布核对清单

> 发布日期：2026-09-05。逐项确认后方可视为发布完成。

## 数据库迁移（`supabase db push`，按序号顺序）

- [ ] 016_marketing_subscriptions.sql —— 营销订阅（double opt-in）
- [ ] 017_email_worker_runs.sql —— 邮件 worker 运行记录
- [ ] 018_session_devices.sql —— 会话设备（last_seen_at + delete 策略）
- [ ] 019_webauthn_credentials.sql —— Passkey 凭据

## 环境变量（生产环境）

| 变量 | 必需性 | 说明 |
|------|--------|------|
| `NEXT_PUBLIC_APP_URL` | 必需（https） | digest CTA / 确认退订链接 / WebAuthn origin 均依赖 |
| `CRON_SECRET` | 必需 | digest worker 鉴权 |
| `RESEND_API_KEY` / `RESEND_FROM` | 必需 | 发送通道 |
| 外部 cron | 必需 | digest 建议**每小时**（`0 * * * *` UTC），配合时区错峰 |
| `OSS_BUCKET/REGION/ACCESS_KEY_ID/ACCESS_KEY_SECRET` | 可选 | 四项齐备启用 OSS，否则 Supabase Storage（需建 `avatars` 公共读桶） |
| `NEXT_PUBLIC_APPARK_API_KEY` + `NEXT_PUBLIC_APPARK_ENDPOINT` | 可选 | 两项齐备启用 APM |
| `NEXT_PUBLIC_FEATURE_PASSKEY` | 可选 | `true` 启用通行密钥（需 https） |

## 发布后验证

- [ ] `GET /api/health` 返回 `version: 0.5.0` 且 DB 自检通过
- [ ] 联系表单提交 → admin 收件箱可见
- [ ] 触发一次 digest（带 `x-cron-secret` POST），`email_worker_runs` 落一行
- [ ] 设置页开启营销邮件 → 收到确认邮件 → 点击确认链接生效
- [ ] `pnpm verify:build` 与 CI（CI / CodeQL / Secrets Scan / E2E）全绿
