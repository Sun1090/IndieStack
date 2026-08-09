# 快速开始

从零到运行 IndieStack 只需几分钟。

## 前置条件

- **Node.js** 18.17+（推荐使用 nvm 管理版本）
- **npm** 9+ 或 **pnpm** 8+
- **Git**
- **Supabase CLI**（可选，用于本地数据库管理）
- **Docker Desktop**（可选，用于本地 PostgreSQL）

## 克隆与安装

```bash
git clone <repo-url> indiestack
cd indiestack
pnpm install
```

## 配置环境变量

```bash
cp .env.example .env.local
```

编辑 `.env.local`，根据你的开发模式配置：

### 方式一：Mock 模式（推荐开发初期）

无需真实 Supabase 后端，所有数据使用 `@faker-js/faker` 生成：

```bash
# Mock 模式：设为 true，无需配置 Supabase 即可开发
NEXT_PUBLIC_MOCK_ENABLED=true
```

### 方式二：Supabase 真实后端

需要创建 Supabase 项目并获取配置：

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIs...
NEXT_PUBLIC_MOCK_ENABLED=false
```

## 启动开发服务器

```bash
# 使用 Mock 模式启动（推荐开发初期）
pnpm dev:mock

# 或使用 Supabase 模式
pnpm dev:supabase

# 标准模式
pnpm dev
```

打开 [http://localhost:3000](http://localhost:3000)。

## 快速体验

IndieStack 启动后，你可以：

1. **浏览首页**：营销着陆页，展示功能特性
2. **查看定价**：三档定价方案（Free / Pro / Enterprise）
3. **登录体验**：Mock 模式下，点击"登录"无需真实凭证即可进入仪表盘
4. **探索仪表盘**：项目管理、团队协作、分析图表、通知设置
5. **切换主题**：右上角切换浅色/深色/跟随系统
6. **切换语言**：右上角切换中文/英文

## 构建生产版本

```bash
pnpm build
pnpm start
```

## 数据库设置（Supabase 模式）

如使用 Supabase 模式，需初始化数据库：

```bash
npx supabase login
npx supabase link --project-ref your-project-ref
pnpm db:push
pnpm db:types
npx supabase db seed
```

## 验证安装

启动后访问以下页面确认一切正常：

| 页面 | 路径 | 说明 |
|------|------|------|
| 首页 | `/` | 营销着陆页 |
| 功能 | `/features` | 功能特性介绍 |
| 定价 | `/pricing` | 定价方案 |
| 登录 | `/auth/login` | 支持邮箱 + GitHub + Google |
| 注册 | `/auth/register` | 新用户注册 |
| 仪表盘 | `/dashboard` | 需要登录后访问 |
| 个人资料 | `/dashboard/profile` | 用户信息 |
| 团队管理 | `/dashboard/team` | 创建和邀请团队 |
| 项目 | `/dashboard/projects` | 项目管理 |
| 分析 | `/dashboard/analytics` | 使用数据统计 |
| 设置 | `/dashboard/settings` | 账户和外观设置 |
| 账单 | `/dashboard/billing` | 订阅管理 |
| API Keys | `/dashboard/api-keys` | API 密钥管理 |
| 集成 | `/dashboard/integrations` | 第三方服务连接 |
| 管理后台 | `/dashboard/admin` | 用户管理（需要管理员角色） |

## 下一步

- 📖 阅读 [项目架构](./architecture) 了解整体设计
- 🏗️ 查看 [项目结构](./project-structure) 熟悉代码组织
- 🔐 了解 [认证流程](./auth-flow) 掌握权限体系
- 🚀 参考 [部署方案](./deployment) 上线你的应用
- 🧪 查看 [Mock 模式](./mock) 学习模拟数据开发
- ⚙️ 浏览 [配置指南](./configuration) 完成所有环境变量设置
