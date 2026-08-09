# 页面概览

IndieStack 应用划分 6 大路由分组，共计 30+ 页面和 4 个 API 路由。

## 路由分组架构

```
src/app/
├── (marketing)/     # 营销页面 - 11 页 - 公开访问
├── auth/            # 认证页面 - 5 页 - 公开（已登录则重定向）
├── dashboard/       # 仪表盘 - 14 页 - 需登录
├── dashboard/admin/ # 管理后台 - 3 页 - admin/super_admin 专属
└── api/             # API 路由 - 5 条
```

## 营销页面（公开 - 11 页）

| 页面 | 路径 | 说明 |
|------|------|------|
| 首页 | `/` | Hero 区域、统计数据、功能特性、技术栈展示、CTA |
| 功能特性 | `/features` | 三级展示：核心功能、技术特性、平台优势 |
| 定价 | `/pricing` | Free/Pro/Enterprise 三级方案对比 |
| 博客 | `/blog` | 博客文章列表 |
| 博客详情 | `/blog/[slug]` | 博客文章详情页 |
| 更新日志 | `/changelog` | 版本发布历史时间线 |
| 常见问题 | `/faq` | FAQ 手风琴折叠列表 |
| 关于 | `/about` | 团队介绍和项目愿景 |
| 联系我们 | `/contact` | 联系表单（服务端验证） |
| 隐私政策 | `/privacy` | 法律文档 |
| 服务条款 | `/terms` | 法律文档 |

所有营销页面使用 Server Components，通过 `getTranslations` 实现国际化。

## 认证页面（公开 - 5 页）

| 页面 | 路径 | 组件 |
|------|------|------|
| 登录 | `/auth/login` | `LoginForm`（邮箱密码 + GitHub + Google OAuth） |
| 注册 | `/auth/register` | `RegisterForm`（邮箱 + OAuth 注册） |
| 忘记密码 | `/auth/forgot-password` | `ForgotPasswordForm` |
| 重置密码 | `/auth/reset-password` | `ResetPasswordForm` |
| OAuth 回调 | `/auth/callback` | 回调处理（完成 OAuth 流程） |

认证页面使用 `Card` 布局，统一展示在页面中央。已登录用户访问认证页面会自动重定向到仪表盘。

## 仪表盘（受保护 - 14 页）

| 页面 | 路径 | 内容 |
|------|------|------|
| 总览 | `/dashboard` | 欢迎语、4 个统计卡片、当前方案、订阅信息、最近活动 |
| 分析 | `/dashboard/analytics` | 收入趋势图、用户增长、API 调用量、响应时间 |
| 个人资料 | `/dashboard/profile` | 个人资料展示 + 编辑表单、修改密码表单 |
| 设置 | `/dashboard/settings` | 通知偏好设置（邮箱推送、浏览器推送、营销邮件） |
| 团队 | `/dashboard/team` | 团队成员列表、角色标签、移除成员 |
| 邀请成员 | `/dashboard/team/invite` | 邀请表单（邮箱输入 + 角色选择） |
| 创建团队 | `/dashboard/team/create` | 创建新团队表单 |
| 项目 | `/dashboard/projects` | 项目卡片网格（名称、状态、域名、分支、最后部署时间） |
| 项目详情 | `/dashboard/projects/[id]` | 单项目详情 |
| 通知 | `/dashboard/notifications` | 通知列表（类型标签、已读/未读、时间戳） |
| 集成 | `/dashboard/integrations` | 第三方服务集成（GitHub、Slack、Vercel、Stripe 等） |
| 计费 | `/dashboard/billing` | 当前方案、用量统计、升级按钮 |
| API 密钥 | `/dashboard/api-keys` | 密钥列表（名称/密钥/创建时间/最后使用）、创建/删除/复制 |
| 个人资料编辑 | `/dashboard/profile/edit` | 编辑个人资料表单 |

所有仪表盘页面使用 `export const dynamic = "force-dynamic"` 确保数据实时性。

## 管理后台（受保护 - super_admin / admin 专属 - 3 页）

| 页面 | 路径 | 内容 |
|------|------|------|
| 管理控制台 | `/dashboard/admin` | 统计卡片（用户/团队/项目总数）、角色分布饼图、系统状态指示器 |
| 用户管理 | `/dashboard/admin/users` | 用户列表搜索、角色切换 |
| 审计日志 | `/dashboard/admin/audit-logs` | 操作历史追溯、按操作类型/用户/时间过滤 |

> 管理后台默认对普通用户隐藏，侧边栏中仅 `super_admin` 和 `admin` 角色可见。

## API 路由（公开/受保护 - 5 条）

| 路由 | 方法 | 说明 | 认证 |
|------|------|------|------|
| `/api/health` | GET | 健康检查（数据库连接、Supabase 状态、内存使用） | 公开 |
| `/api/auth/callback` | GET | 认证回调处理 | 公开 |
| `/api/user` | GET/PUT | 获取/更新用户信息 | 需认证 |
| `/api/teams` | POST/GET | 创建/获取团队 | 需认证 |
| `/api/invitations` | POST | 发送邀请邮件 | 需 admin 权限 |

## 文档站（公开 - 13 页）

独立 VitePress 项目（`docs-site/`），可单独部署到 Vercel 或 Docker：

快速开始、项目架构、Mock 模式、认证流程、项目结构、技术栈、Supabase、组件库、配置指南、脚本工具、部署方案、页面概览 + 首页

> 文档站支持中英双语、深色/浅色主题切换、本地搜索。
