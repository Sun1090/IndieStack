# v0.10.0 生产 Smoke Test 矩阵

> 本矩阵只记录**无副作用**检查；任何登录、上传、写库、发信、真实推送场景必须有隔离账号或 provider 才能执行，
> 在这些前置条件具备前保持“未验证”，不得用空白结果冒充通过。

- 目标版本：v0.10.0
- 目标环境：生产（待填写 URL）
- 目标 commit：待填写
- 执行人 / 日期（含时区）：待填写

## 无副作用检查

| 检查项                        | 期望                                                                           | 状态                                            |
| ----------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------- |
| `GET /api/health`             | 200，`status=ok`、`ready=true`、版本与目标一致、`no-store` 且带 `x-request-id` | ⏳ 未执行                                       |
| 首页/静态资源                 | 首页 200 且含 `#main-content`；`/icon.svg` 200 且 MIME 为 SVG                  | ⏳ 未执行                                       |
| 未授权 dashboard              | 匿名请求重定向到 `/auth/login`，不返回受保护内容                               | ⏳ 未执行                                       |
| Webhook 缺签名                | HTTP 400，`Missing signature`，`no-store`                                      | ⏳ 未执行                                       |
| 安全头                        | CSP、HSTS、nosniff、DENY、Referrer-Policy、Permissions-Policy、request ID 齐全 | ⏳ 未执行                                       |
| 深色首屏脚本与 CSP            | 控制台无 CSP nonce 报错；带 `ui-theme=dark` 的会话首帧即为深色，无「先浅后深」闪烁 | ⏳ 未执行                                       |
| 移动端导航可达性              | 375px 与 768px 下汉堡菜单可开合，仪表盘导航链接可达，无横向滚动                 | ⏳ 未执行                                       |
| 状态语义色与图表色            | 浅色/深色下 success/warning/info/destructive 提示可辨，图表五色可区分          | ⏳ 未执行                                       |
| 迁移基线核对                  | 生产 `supabase migration list` 显示 001–031 全部 applied，无 pending/额外版本  | ⏳ 需生产只读凭证                               |
| RLS / 权限目录核对            | `pnpm check:supabase-security` 与 `pnpm smoke:supabase-identity` 对生产回读一致 | ⏳ 需生产只读凭证                               |
| 客户端 `rpc` 越权已关闭       | 匿名/登录用户调用 `cleanup_old_notifications` / `log_audit_action` 返回权限错误 | ⏳ 未执行                                       |
| 匿名 `audit_logs` 写入已关闭  | 直接 `POST /rest/v1/audit_logs` 不再返回 201                                   | ⏳ 未执行                                       |
| Webhook 幂等（重复事件）      | 同一 `event.id` 投递两次后副作用行数仍为 1，第二次返回 200 `duplicate`         | ⏳ 需 Stripe test-mode 签名生成器与隔离测试租户 |
| Web Push 未配置               | 无 VAPID 密钥时设置页显示“未配置”，点击不写入 `push_subscriptions`             | ⏳ 未执行                                       |
| Push cron 401 防护            | 无/错误 `CRON_SECRET` 调用 `/api/cron/push-retry` 返回 401                     | ⏳ 未执行                                       |
| 登录与登出                    | 测试账号可完成闭环                                                             | ⏳ 需专用测试账号                               |
| dashboard 业务查询            | 关键查询无 5xx，**租户数据隔离**成立                                           | ⏳ 需专用测试账号/租户                          |
| 上传元数据落库                | 一次真实头像/封面上传后 `upload_objects` 出现对应 `status='active'` 行          | ⏳ 需专用测试项目与存储对象                     |
| 邮件/通知                     | provider 可用且不重复发送                                                      | ⏳ 需隔离收件箱或 staging provider              |
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
