# 部署方案

IndieStack 支持多种部署方式。推荐使用 Vercel 一键部署，也可使用 Docker 容器化部署或传统的服务器部署。

## Vercel 部署（推荐）

### 前置条件

- [Vercel](https://vercel.com) 账号（GitHub 登录即可）
- Git 仓库已推送到 GitHub

### 一键部署

Vercel 会自动检测 Next.js 项目并配置构建设置：

```bash
# 安装 Vercel CLI
npm i -g vercel

# 登录 Vercel
vercel login

# 部署到生产环境
vercel --prod
```

### 手动部署（Vercel Dashboard）

1. 在 [Vercel Dashboard](https://vercel.com/new) 点击 "New Project"
2. 导入你的 GitHub 仓库
3. 框架自动识别为 **Next.js**（无需手动选择）
4. 添加环境变量（从 `.env.example` 复制所有必需变量）
5. 点击 "Deploy"

### 环境变量配置

部署时需要在 Vercel 中添加以下环境变量：

| 环境 | 来源 | 说明 |
|------|------|------|
| Production | Vercel Dashboard → Settings → Environment Variables | 生产环境配置 |
| Preview | 同 Production | Preview 部署自动继承 |
| Development | `.env.local` | 本地开发配置 |

### 域名绑定

```bash
# 通过 CLI
vercel domains add yourdomain.com

# 或在 Dashboard → Project → Settings → Domains 中添加
```

### 预览部署

推送 PR 或分支时，Vercel 自动创建 Preview 部署并生成预览 URL，便于团队审查。

## Docker 部署

### 构建镜像

项目根目录已有 `Dockerfile`，使用多阶段构建优化镜像大小：

```bash
# 构建 Docker 镜像
docker build -t indiestack .

# 运行容器
docker run -d -p 3000:3000 --env-file .env.production indiestack
```

### Docker Compose

项目根目录提供 `docker-compose.yml`，包含应用 + PostgreSQL：

```bash
# 启动所有服务
docker compose up -d

# 查看日志
docker compose logs -f

# 停止服务
docker compose down
```

### 生产环境 Docker Compose

建议创建 `docker-compose.prod.yml` 用于生产部署：

```yaml
version: "3.8"
services:
  app:
    build: .
    ports:
      - "3000:3000"
    env_file: .env.production
    restart: always
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

## 传统服务器部署

### PM2 + Nginx

```bash
# 构建项目
pnpm build

# 使用 PM2 启动
pnpm install -g pm2
pm2 start npm --name "indiestack" -- start
pm2 save
pm2 startup
```

Nginx 反向代理配置：

```nginx
server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl;
    server_name yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## GitHub Actions CI/CD

项目 `.github/workflows/` 目录包含预配置的 CI/CD 工作流：

### `ci.yml` — PR 自动检查

每次 Push 和 PR 时自动运行：
- TypeScript 类型检查（`pnpm type-check`）
- ESLint 检查（`pnpm lint`）
- 单元测试（`pnpm test`）
- 构建验证（`pnpm build`）

### `deploy.yml` — 自动部署

推送到 `main` 分支时自动部署到 Vercel：
- 自动构建并部署
- Slack/邮件通知（可选）
- 回滚支持

### 配置 Secrets

在 GitHub 仓库 Settings → Secrets and variables → Actions 中添加：

```bash
VERCEL_TOKEN=your-vercel-token
VERCEL_ORG_ID=your-org-id
VERCEL_PROJECT_ID=your-project-id
VERCEL_DOCS_PROJECT_ID=your-docs-project-id
```

## 数据库部署

### Supabase 生产环境

1. 在 [Supabase Dashboard](https://supabase.com) 创建项目
2. 执行数据库迁移：

```bash
npx supabase login
npx supabase link --project-ref your-project-ref
pnpm db:push
```

3. 开启 Row Level Security：

```bash
npx supabase db push
```

4. 配置 Auth 设置（URL、重定向域名等）

### 数据库备份

```bash
# 使用 Supabase CLI 备份
npx supabase db dump -f backup.sql

# 恢复
npx supabase db import -f backup.sql
```

## 文档站部署

文档站（VitePress）是一个独立的静态站点，可单独部署：

### Vercel 部署

```bash
cd docs-site

# 安装依赖
pnpm install

# 构建静态文件
pnpm build

# Vercel 部署
vercel --prod
```

### Docker 部署

```bash
cd docs-site

# 构建 Docker 镜像（基于 Nginx）
docker build -t indiestack-docs .

# 运行
docker run -d -p 8080:80 indiestack-docs
```

### Nginx 部署

`docs-site/nginx.conf` 已配置好 Gzip 压缩、缓存策略和 SPA fallback：

```bash
# 构建静态文件
cd docs-site && pnpm build

# 将 dist 目录部署到 Nginx
cp -r .vitepress/dist/* /var/www/docs/
```

## 部署检查清单

### 上线前检查

- [ ] 环境变量完整性检查
- [ ] 数据库迁移已执行
- [ ] Supabase RLS 已启用
- [ ] Stripe Webhook 已配置
- [ ] Sentry DSN 已配置
- [ ] 自定义域名已绑定
- [ ] SSL 证书已配置
- [ ] CI/CD 工作流正常
- [ ] 性能测试通过
- [ ] 错误监控正常运行
- [ ] OG 图片和 SEO 标签正常
- [ ] sitemap.xml 和 robots.txt 正常
- [ ] 文档站已部署并更新
