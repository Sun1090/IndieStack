# 安全策略 / Security Policy

## 支持的版本 / Supported Versions

| 版本 / Version | 支持情况 / Support          |
| ------- | ------------------ |
| 0.1.x   | ✅ 积极维护 / Active support |

## 报告漏洞 / Reporting a Vulnerability

如果在 IndieStack 中发现安全漏洞，**请不要公开提交 issue**。

请通过以下方式私下报告：

1. 发送邮件至 [security@indiestack.dev](mailto:security@indiestack.dev)
2. 在 GitHub 上创建安全公告：仓库主页 → Security → Advisories → New advisory

我们会在 48 小时内确认收到报告，并在修复后公开致谢。

## 安全最佳实践 / Security Best Practices

使用此项目时请注意：

- **环境变量**: 永远不要将 `.env.local` 或敏感凭据提交到 Git
- **Supabase RLS**: 所有表使用 Row Level Security，避免客户端直接访问未授权数据
- **API 路由**: 敏感操作使用 `safelyRequireAuth()` / `safelyRequirePermission()` 进行鉴权
- **依赖**: 定期运行 `npm audit` 检查依赖安全漏洞
- **会话管理**: 使用 @supabase/ssr 的 HttpOnly Cookie 进行会话管理

## 依赖漏洞扫描 / Dependency Scanning

项目依赖通过 GitHub Dependabot 自动扫描。发现漏洞后会自动创建 PR 进行修复。
