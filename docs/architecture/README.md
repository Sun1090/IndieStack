# IndieStack 架构文档

> 项目架构、流程图、组件设计的完整文档体系

## 文档索引

| 序号 | 文档 | 内容 |
|------|------|------|
| 01 | [总体架构概览](./01-overview.md) | 系统架构图、分层设计、核心原则、技术栈速览、路由分组、关键数据流 |
| 02 | [技术栈详解](./02-tech-stack.md) | Next.js、React、Tailwind、Supabase、Stripe、next-intl、Sentry 等技术细节 |
| 03 | [目录结构](./03-project-structure.md) | 完整目录树、路径别名、文件职责、命名规范 |
| 04 | [路由体系](./04-routing.md) | 路由组、路由保护、路由清单、特殊文件、重定向规则、安全 Headers |
| 05 | [认证与 RBAC](./05-auth-rbac.md) | 认证流程、OAuth 回调、会话管理、角色层级、权限矩阵、守卫函数 |
| 06 | [数据库设计](./06-database.md) | ER 图、表结构、RLS 策略、触发器、TypeScript 类型、订阅计划 |
| 07 | [API 路由](./07-api-routes.md) | API 清单、请求流程、响应格式、速率限制、安全模式 |
| 08 | [Server Actions](./08-server-actions.md) | Actions 清单、数据流、输入验证、缓存刷新、测试覆盖 |
| 09 | [前端组件](./09-frontend-components.md) | 组件分层、UI 组件、共享组件、布局组件、Provider、Hooks、主题系统 |
| 10 | [国际化](./10-i18n.md) | next-intl 配置、命名空间、消息加载、语言切换 |
| 11 | [第三方集成](./11-integrations.md) | Supabase、Stripe、Sentry、阿里云 OSS（规划中）、Appark APM（规划中）集成详情 |
| 12 | [部署架构](./12-deployment.md) | Docker 部署、Vercel 部署、CI/CD、文档站、健康检查 |
| 13 | [Mock 系统](./13-mock-system.md) | Mock 模式、数据生成、缓存机制、使用场景 |
| 14 | [数据流程](./14-data-flow.md) | 注册、登录、OAuth、团队邀请、订阅支付、文件上传等核心流程图 |

## 快速导航

**新加入项目？**
→ 从 [01 总体架构概览](./01-overview.md) 开始，了解全局

**想了解数据库？**
→ 直接查看 [06 数据库设计](./06-database.md)

**要开发新 API？**
→ 参考 [07 API 路由](./07-api-routes.md) 和 [05 认证与 RBAC](./05-auth-rbac.md)

**要开发新页面？**
→ 查看 [04 路由体系](./04-routing.md) 和 [09 前端组件](./09-frontend-components.md)

**本地开发无后端？**
→ 查看 [13 Mock 系统](./13-mock-system.md)

**部署应用？**
→ 查看 [12 部署架构](./12-deployment.md)

## 图表说明

所有文档中的架构图和流程图均使用 [Mermaid](https://mermaid.js.org/) 语法编写，支持在 GitHub、VS Code（Mermaid 插件）和大多数 Markdown 渲染器中直接查看。

## 文档维护

- 文档与代码同目录维护，位于 `docs/architecture/`
- 代码结构变更时同步更新对应文档
- 所有文档使用中文编写
- 最后更新: 2026-08-02
