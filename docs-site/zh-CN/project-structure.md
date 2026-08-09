# 项目结构

```
indiestack/
├── src/
│   ├── app/                      # Next.js App Router
│   │   ├── (marketing)/          # 营销页面（公开）
│   │   ├── auth/                 # 认证页面（公开）
│   │   ├── dashboard/            # 仪表盘（受保护）
│   │   ├── api/                  # API 路由
│   │   ├── page.tsx              # 首页
│   │   ├── layout.tsx            # 根布局
│   │   ├── globals.css           # 全局样式
│   │   ├── not-found.tsx         # 404
│   │   └── error.tsx             # 错误边界
│   ├── components/
│   │   ├── ui/                   # 23 个 shadcn/ui 组件
│   │   ├── auth/                 # 登录/注册表单
│   │   ├── layout/               # 头部/底部/主题切换
│   │   ├── dashboard/            # 仪表盘组件
│   │   ├── forms/                # 表单组件
│   │   ├── providers/            # Theme/Supabase Provider
│   │   └── shared/               # 通用组件
│   ├── hooks/                    # 自定义 Hooks
│   ├── i18n/                     # next-intl 配置（routing/request/navigation）
│   ├── lib/
│   │   ├── actions/              # Server Actions
│   │   ├── storage/              # 阿里云 OSS
│   │   ├── stripe/               # Stripe 支付
│   │   ├── supabase/             # 4 个 Supabase 客户端
│   │   ├── validations/          # Zod 校验
│   │   ├── appark.ts             # Appark APM
│   │   ├── constants.ts          # 常量
│   │   └── utils.ts              # 工具函数
│   └── middleware.ts
├── messages/                     # i18n 文案（{locale}/{namespace}.json）
├── docs-site/                    # VitePress 文档站
└── .env.example
