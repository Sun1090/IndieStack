# v0.6.0 生产 Smoke Test

只使用专用测试账号和脱敏数据。每项记录 HTTP 状态、响应版本、UTC 时间和结果；不要把 cookie、token、邮件正文或 secret 放入 artifact。

| 场景 | 通过条件 | 结果/证据 |
|---|---|---|
| `GET /api/health` | 200，版本为目标 commit，required 依赖 healthy | |
| 首页/静态资源 | 200，无 console error | |
| 登录与登出 | 测试账号可完成闭环，未授权页面拒绝访问 | |
| dashboard | 关键查询无 5xx，租户数据隔离 | |
| 上传 | 合法文件成功；超限/非法 MIME 被拒绝 | |
| 邮件/通知 | mock 或 provider fallback 可用，不重复发送 | |
| Webhook | 缺签名/错误签名拒绝，合法事件幂等 | |
| 安全头 | `no-store`、CSP、Referrer-Policy 等符合基线 | |
| 回滚探针 | 上一版本可恢复，数据库无破坏性依赖 | |

## 执行

```bash
pnpm health:check -- "$PRODUCTION_URL"
# 其余场景使用无副作用的专用 smoke 脚本或 Playwright 项目
```

生产 smoke 的结果必须附在 release 记录中；本文件的空白结果不构成通过证据。
