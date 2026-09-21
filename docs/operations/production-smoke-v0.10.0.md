# v0.10.0 生产 Smoke Test 矩阵

> 本矩阵只记录**无副作用**检查；任何登录、上传、写库、发信、真实推送场景必须有隔离账号或 provider 才能执行，
> 在这些前置条件具备前保持“未验证”，不得用空白结果冒充通过。

- 目标版本：v0.10.0
- 目标环境：生产（`https://indie-stack-theta.vercel.app`）
- 目标 commit：`6465e89`（`main` HEAD；生产已随 `main` 自动部署，`/api/health` 自 2026-09-21T17:33Z 起报告 `version=0.10.0`）
- 执行人 / 日期（含时区）：Qoder 自主代理 / 2026-09-21T17:33:38Z 复核（UTC，Asia/Shanghai 2026-09-22 01:33）
- **发布形态说明**：v0.10.0 从未打 tag、也没有 GitHub Release——它是「部署 `main` 即发布」的产物
  （`package.json` 与 `.env.example` 在 2026-09-13 已升到 0.10.0，CHANGELOG 有 `[0.10.0]` 章节，
  但仓库唯一的 tag 是 `v0.6.0`）。本文件因此记录的是**已部署版本的事后复核**，不是发布前门禁；
  下一个从 tag 走 release 流程的版本是 v0.11.0。

## 无副作用检查

| 检查项                        | 期望                                                                           | 状态                                            |
| ----------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------- |
| `GET /api/health`             | 200，`status=ok`、`ready=true`、版本与目标一致、`no-store` 且带 `x-request-id` | ✅ 通过：HTTP 200、`status=ok`、`ready=true`、`version=0.10.0`（连续 10 次采样全部 200，0.85–2.92s） |
| 首页/静态资源                 | 首页 200 且含 `#main-content`；`/icon.svg` 200 且 MIME 为 SVG                  | ✅ 通过                                          |
| 未授权 dashboard              | 匿名请求重定向到 `/auth/login`，不返回受保护内容                               | ✅ 通过：HTTP 307 到 `/auth/login`              |
| Webhook 缺签名                | HTTP 400，`Missing signature`，`no-store`                                      | ✅ 通过：HTTP 400，缺失签名已拒绝                |
| 安全头                        | CSP、HSTS、nosniff、DENY、Referrer-Policy、Permissions-Policy、request ID 齐全 | ✅ 通过                                          |
| 深色首屏脚本与 CSP            | 控制台无 CSP nonce 报错；带 `ui-theme=dark` 的会话首帧即为深色，无「先浅后深」闪烁 | ⏳ 未执行：需部署 v0.10.0 后浏览器验证          |
| 移动端导航可达性              | 375px 与 768px 下汉堡菜单可开合，仪表盘导航链接可达，无横向滚动                 | ⏳ 未执行：需部署 v0.10.0 后浏览器验证          |
| 状态语义色与图表色            | 浅色/深色下 success/warning/info/destructive 提示可辨，图表五色可区分          | ⏳ 未执行：需部署 v0.10.0 后浏览器验证          |
| 迁移基线核对                  | 生产 `supabase migration list` 与仓库 manifest 一致，无 pending/额外版本        | ✅ 通过：`--linked` 只读核对 001–033 全部 applied，`db push --linked --dry-run` 为空 |
| RLS / 权限目录核对            | `pnpm check:supabase-security` 与 `pnpm smoke:supabase-identity` 对生产回读一致 | ⏳ 需生产只读凭证                               |
| 服务端函数只对 `service_role` 开放 | 028/032/033 收口的函数在云端库里 `anon` / `authenticated` 无 `EXECUTE`       | ✅ 通过：以只读 `has_function_privilege` 核对 7 个函数全为 `false/false/true`（未做匿名 `rpc` 实调，避免「万一没拦住」就真删数据） |
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

- 结果：**无副作用 6/6 通过（2026-09-21T17:33Z 复核）**；需要登录 / provider 的矩阵项仍为未执行
- 命令：`node scripts/production-smoke.js https://indie-stack-theta.vercel.app --expected-version 0.10.0 --output /tmp/indiestack-production-smoke-20260922.json`
- 之前的 5/6 记录（版本停留在 `0.6.0`）是生产部署落后于 `main` 的漂移，随 `main` 重新部署自动消解；
  同一时点的 `Production Smoke` workflow `smoke-main` 由 `workflow_dispatch` 复核为 success
  （run `35632786147`，artifact `production-smoke.json` 保留 30 天）
- 目标 commit：`6465e89`（`main`）
- 仍未执行的矩阵项需要隔离测试账号 / provider（登录闭环、真实上传、webhook 重放、Push cron、
  邮件投递、回滚探针），以及部署 v0.10.0 之后的浏览器侧检查（首屏主题闪烁、375/768 导航、状态色对比）
- GitHub Actions：`CI`、`CodeQL`、`Secrets Scan`、`Security and configuration checks` 均成功
- 证据 artifact：待部署 v0.10.0 后由 `Production Smoke` workflow 上传 30 天
- 证据 JSON：`/tmp/indiestack-production-smoke-recheck-2026-09-21.json`

本文件只记录**无副作用**检查；任何登录、上传、写库、发信、真实推送场景必须有隔离账号或 provider 才能执行，
在这些前置条件具备前保持“未验证”，不得用空白结果冒充通过。

已接入定时生产漂移检测：`.github/workflows/production-smoke.yml` 在 UTC 02:17（cron `17 2 * * *`）运行 `node scripts/check-production-version.js --base-url https://indie-stack-theta.vercel.app`，期望版本来自 `package.json`，并将 `production-smoke.json` 作为 30 天 artifact 留存。该检查失败说明生产部署落后于仓库版本；它不会把当前 v0.10.0 标为已发布通过。
