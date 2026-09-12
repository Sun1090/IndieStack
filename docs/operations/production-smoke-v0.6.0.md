# v0.6.0 生产 Smoke Test

只使用专用测试账号和脱敏数据。每项记录 HTTP 状态、响应版本、UTC 时间和结果；不要把 cookie、token、邮件正文或 secret 放入 artifact。

自动化命令：

```bash
pnpm smoke:production -- "$PRODUCTION_URL" \
  --expected-version "$EXPECTED_APP_VERSION" \
  --output production-smoke.json
```

脚本只执行无副作用检查：GET 公共页面/健康端点，以及一个故意缺少签名的 webhook POST。不会登录、上传、写数据库或发送通知。GitHub Actions 中也提供手动触发的 `Production Smoke` 工作流并上传 JSON 证据。

## 自动化覆盖（2026-09-12）

| 场景 | 通过条件 | 结果/证据 |
|---|---|---|
| `GET /api/health` | 200，`status=ok`、`ready=true`、版本与目标一致、`no-store` 且带 `x-request-id` | ✅ 2026-09-12T04:34:50Z，version `0.6.0`，部署 `indie-stack-e9uqet9rf-sun1090s-projects.vercel.app`（production） |
| 首页/静态资源 | 首页 200 且含 `#main-content`；`/icon.svg` 200 且 MIME 为 SVG | ✅ 首页 HTTP 200；`/icon.svg` HTTP 200 |
| 未授权 dashboard | 匿名请求重定向到 `/auth/login`，不返回受保护内容 | ✅ HTTP 307，Location `/auth/login?redirect=%2Fdashboard` |
| Webhook 缺签名 | HTTP 400，`Missing signature`，`no-store` | ✅ HTTP 400，无副作用 |
| 安全头 | CSP、HSTS、nosniff、DENY、Referrer-Policy、Permissions-Policy、request ID 齐全 | ✅ 全部通过 |
| 登录与登出 | 测试账号可完成闭环 | ⏳ 需要专用测试账号；当前脚本不做认证写入 |
| dashboard 业务查询 | 关键查询无 5xx，租户数据隔离 | ⏳ 需要在专用测试账号/租户下执行 |
| 上传 | 合法文件成功；超限/非法 MIME 被拒绝 | ⏳ 需要专用测试项目与存储对象；当前脚本不做上传副作用 |
| 邮件/通知 | provider 可用且不重复发送 | ⏳ 需要隔离收件箱或 staging provider |
| Webhook 合法事件 | 合法签名事件幂等落库 | ⏳ 需要 Stripe test-mode 签名生成器与隔离测试租户 |
| 回滚探针 | 上一版本可恢复，数据库无破坏性依赖 | ⏳ 见回滚 runbook，尚未宣称完成演练 |

## 执行结果

- 结果：**6/6 自动化检查通过**
- 命令：`pnpm smoke:production -- https://indie-stack-theta.vercel.app --expected-version 0.6.0`
- 目标 commit：`f34f574`
- Vercel deployment：`indie-stack-e9uqet9rf-sun1090s-projects.vercel.app`
- 证据 JSON：`/tmp/indiestack-production-smoke.json`（运行器不提交临时 evidence；CI artifact 保留 30 天）

生产 smoke 的结果必须附在 release 记录中；未执行的有副作用场景继续保持未验证，不能用空白结果冒充通过。
