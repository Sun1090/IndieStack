# v0.9.0 生产 Smoke Test

只使用专用测试账号和脱敏数据。每项记录 HTTP 状态、响应版本、UTC 时间和结果；不要把 cookie、token、邮件正文或 secret 放入 artifact。

> 状态：**未执行**。本文件是 v0.9.0 的待执行清单，不是通过证据。v0.6.0 的实际执行记录见
> [production-smoke-v0.6.0.md](./production-smoke-v0.6.0.md)；v0.7.0 与 v0.8.0 同样保持“未执行”。
> 在获得部署授权前，本版本不产生生产证据。

自动化命令：

```bash
pnpm smoke:production -- "$PRODUCTION_URL" \
  --expected-version "$EXPECTED_APP_VERSION" \
  --output production-smoke.json
```

脚本只执行无副作用检查：GET 公共页面/健康端点，以及一个故意缺少签名的 webhook POST。不会登录、上传、写数据库或发送通知。GitHub Actions 中也提供手动触发的 `Production Smoke` 工作流并上传 JSON 证据。

健康检查复用与保活相同的有限重试策略：网络错误、可重试 5xx、以及
`200` 但 body 尚未 ready 时最多尝试 3 次（间隔 5 秒）；版本或安全头持续不匹配仍会失败。

## 自动化覆盖

| 场景                          | 通过条件                                                                       | 结果/证据                                       |
| ----------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------- |
| `GET /api/health`             | 200，`status=ok`、`ready=true`、版本与目标一致、`no-store` 且带 `x-request-id` | ⏳ 未执行                                       |
| 首页/静态资源                 | 首页 200 且含 `#main-content`；`/icon.svg` 200 且 MIME 为 SVG                  | ⏳ 未执行                                       |
| 未授权 dashboard              | 匿名请求重定向到 `/auth/login`，不返回受保护内容                               | ⏳ 未执行                                       |
| Webhook 缺签名                | HTTP 400，`Missing signature`，`no-store`                                      | ⏳ 未执行                                       |
| 安全头                        | CSP、HSTS、nosniff、DENY、Referrer-Policy、Permissions-Policy、request ID 齐全 | ⏳ 未执行                                       |
| 迁移基线核对                  | 生产 `supabase migration list` 显示 001–031 全部 applied，无 pending/额外版本  | ⏳ 需生产只读凭证                               |
| RLS / 权限目录核对            | `pnpm check:supabase-security` 与 `pnpm smoke:supabase-identity` 对生产回读一致 | ⏳ 需生产只读凭证                               |
| 上传元数据落库                | 一次真实头像/封面上传后 `upload_objects` 出现对应 `status='active'` 行          | ⏳ 需专用测试项目与存储对象                     |
| 上传回滚不留孤儿              | 人为让元数据写失败时对象被删除，bucket 与表双向差集为空                        | ⏳ 需专用测试项目与存储对象                     |
| 客户端 `rpc` 越权已关闭       | 匿名/登录用户调用 `cleanup_old_notifications` / `log_audit_action` 返回权限错误 | ⏳ 未执行                                       |
| 匿名 `audit_logs` 写入已关闭  | 直接 `POST /rest/v1/audit_logs` 不再返回 201                                   | ⏳ 未执行                                       |
| Webhook 幂等（重复事件）      | 同一 `event.id` 投递两次后副作用行数仍为 1，第二次返回 200 `duplicate`         | ⏳ 需 Stripe test-mode 签名生成器与隔离测试租户 |
| Webhook 失败重试可恢复        | 副作用失败回 500，Stripe 重试后 `attempts` 递增且最终成功一次                  | ⏳ 需 Stripe test-mode 签名生成器与隔离测试租户 |
| Web Push 未配置               | 无 VAPID 密钥时设置页显示“未配置”，点击不写入 `push_subscriptions`             | ⏳ 未执行                                       |
| Web Push 已配置与投递         | 开启通知后订阅落库，投递写入 `push_delivery_attempts.status=sent`              | ⏳ 需真实 push service                          |
| Push cron 重试                | `GET /api/cron/push-retry`（带 `CRON_SECRET`）返回脱敏计数且队列下降           | ⏳ 需 `CRON_SECRET`                             |
| Push 401 防护                 | 无/错误 `CRON_SECRET` 调用 `/api/cron/push-retry` 返回 401                     | ⏳ 未执行                                       |
| 登录与登出                    | 测试账号可完成闭环                                                             | ⏳ 需专用测试账号                               |
| dashboard 业务查询            | 关键查询无 5xx，**租户数据隔离**成立                                           | ⏳ 需专用测试账号/租户                          |
| 邮件/通知                     | provider 可用且不重复发送                                                      | ⏳ 需隔离收件箱或 staging provider              |
| 审计日志分页                  | 管理页分页正常，无 `count(*)` 全表扫描与明显延迟回升                           | ⏳ 需专用测试账号                               |
| 队列积压告警                  | 积压 > 500 时 Sentry 出现 `push_backlog_threshold_exceeded`                    | ⏳ 未执行                                       |
| **回滚探针**                  | 上一版本可恢复，数据库无破坏性依赖（见回滚 runbook）                           | ⏳ 见回滚 runbook，尚未演练                     |

## 执行结果

- 结果：**未执行**
- 命令：待填写
- 目标 commit：待填写
- GitHub Actions：待填写
- 证据 artifact：待填写
- 证据 JSON：待填写

本文件只记录**无副作用**检查；任何登录、上传、写库、发信、真实推送场景必须有隔离账号或 provider 才能执行，
在这些前置条件具备前保持“未验证”，不得用空白结果冒充通过。
