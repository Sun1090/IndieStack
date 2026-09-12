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

| 环境        | 来源                                                | 说明                 |
| ----------- | --------------------------------------------------- | -------------------- |
| Production  | Vercel Dashboard → Settings → Environment Variables | 生产环境配置         |
| Preview     | 同 Production                                       | Preview 部署自动继承 |
| Development | `.env.local`                                        | 本地开发配置         |

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

### 部署方式

本项目使用 Vercel 直连 GitHub 仓库的方式自动部署（不经过 GitHub Actions）：

1. 在 [Vercel](https://vercel.com) 导入 Git 仓库
2. Framework Preset 会自动识别为 Next.js
3. 在 Settings → Environment Variables 中添加 Supabase 等环境变量
4. 之后每次 `git push` 到 `main` 分支，Vercel 自动构建并部署

CI 工作流仅做质量检查（lint / type-check / test / build），不参与部署流程。

## 数据库部署

### Supabase 生产环境

1. 在 [Supabase Dashboard](https://supabase.com) 创建项目
2. 执行数据库迁移：

```bash
npx supabase login
npx supabase link --project-ref your-project-ref
pnpm db:migrate
```

3. 开启 Row Level Security：

```bash
npx supabase db push
```

4. 配置 Auth 设置（URL、重定向域名等）

### 免费版保活

Supabase 免费版项目连续 7 天无 API 活动会被自动暂停。IndieStack 用两条每日探测保持项目活跃，
探测目标都是 `/api/health`（内部会对 `profiles` 执行一次 `limit(1)` 查询）：

| 层级                 | 文件                                 | 时间（UTC）  | 说明                                 |
| -------------------- | ------------------------------------ | ------------ | ------------------------------------ |
| Vercel Cron（主）    | `vercel.json`                        | `0 2 * * *`  | 仅对生产部署生效，不会自动失效       |
| GitHub Actions（备） | `.github/workflows/health-check.yml` | `17 3 * * *` | 仓库 60 天无提交后 GitHub 会自动停用 |

GitHub Actions 侧需要配置仓库变量 `HEALTHCHECK_URL`（Settings → Secrets and variables →
Actions → Variables），例如 `https://你的域名/api/health`；手动触发时可用 `health_url` 输入覆盖。
两条保活探测都会对瞬时网络错误、5xx 和未就绪响应最多重试 3 次，间隔 5 秒；404/401
等确定错误以及持续故障仍会失败并告警，不会被静默吞掉。

关闭方式：删除 `vercel.json` 的 `crons` 块或 workflow 的 `schedule` 触发器。
升级到付费 Supabase 套餐后不再需要保活。

#### 暂停自动恢复（兜底）

保活探测正常情况下不会让项目进入暂停状态；为防极端情况（例如连续多日部署失败、
探测失败），仓库另有一个把项目自动拉起来的兜底 workflow：

| 层级                 | 文件                                          | 时间（UTC）  | 说明                                                        |
| -------------------- | --------------------------------------------- | ------------ | ----------------------------------------------------------- |
| Vercel Cron（主）    | `vercel.json` → `/api/ops/supabase-restore`   | `0 4 * * *`  | 不受仓库静默影响；需要 `CRON_SECRET` 与下方 Management 变量 |
| GitHub Actions（备） | `.github/workflows/supabase-auto-restore.yml` | `37 4 * * *` | 仅在项目状态为 `INACTIVE` 时调用 Management API 恢复        |

需要在 GitHub（供 workflow 使用）与 Vercel 项目环境（供 cron 路由使用）配置：

- Variable `SUPABASE_PROJECT_REF`：Supabase 项目 ref；Vercel 侧可留空，路由会从
  `NEXT_PUBLIC_SUPABASE_URL`（`https://<ref>.supabase.co`）推断
- Secret `SUPABASE_ACCESS_TOKEN`：Management API 令牌（`sbp_` 开头，需要 `projects:write` 权限）
- `CRON_SECRET`：Vercel Cron 会自动以 `Authorization: Bearer <CRON_SECRET>` 调用

两层都只有在 Management API 明确返回 `status=INACTIVE` 时才会执行恢复；`RESTORING`、
`COMING_UP` 等中间态只等待，未知/不可恢复状态会显式失败交给人工处理。
`scripts/supabase-auto-restore.js` 在项目本身健康而站点不可用时（应用侧故障）只报错退出，
不会误触发写操作；手动触发默认 `dry_run=true`。`/api/ops/supabase-restore` 在生产缺少配置
时返回 `503`，避免兜底层静默失效。轮换令牌后记得同步更新两处 secret。

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
