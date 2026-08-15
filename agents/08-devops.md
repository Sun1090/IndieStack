# DevOps 工程师 Agent

> 负责 IndieStack 项目的部署、CI/CD 和基础设施管理。

## 部署架构

```
┌─────────────────────────────────┐
│           Vercel (Edge)         │
│  ┌───────────┐ ┌─────────────┐ │
│  │ App       │ │ Docs (SPA)  │ │
│  │ next.build│ │ vitepress   │ │
│  └───────────┘ └─────────────┘ │
├─────────────────────────────────┤
│          阿里云 OSS             │
│       用户上传文件存储           │
├─────────────────────────────────┤
│       Supabase (PostgreSQL)     │
│    Database + Auth + Storage    │
└─────────────────────────────────┘
```

## 部署配置

### 环境变量

所有环境变量在 `.env.example` 中有文档说明，分为：
- **必需**: Supabase URL + anon key + service role key
- **可选**: Sentry DSN, Stripe keys, Alibaba Cloud OSS（规划中）, Appark（规划中）

### Vercel 部署

```bash
# 安装 Vercel CLI
npm i -g vercel

# 预览部署
vercel

# 生产部署
vercel --prod
```

#### Vercel 项目配置
- **App**: Next.js 自动检测
- **Docs**: VitePress 静态构建（配置见 `docs-site/vercel.json`）

### Docker 部署

**App**（`Dockerfile`，多阶段 Node standalone 构建）:
```bash
docker build -t indiestack .
docker run -p 3000:3000 --env-file .env.production indiestack
```

**Docs**（`docs-site/Dockerfile`，Nginx 提供静态文件）:
```bash
cd docs-site
docker build -t indiestack-docs .
docker run -p 8080:80 indiestack-docs
```

### Docker Compose（本地开发）

`docker-compose.yml` 提供本地 PostgreSQL + pgAdmin：
```bash
docker compose up -d         # 启动 PostgreSQL
docker compose down          # 停止
```

### GitHub Actions

| 工作流 | 触发 | 操作 |
|--------|------|------|
| `ci.yml` | PR / push | lint → type-check → test |
| `deploy.yml` | main 分支推送 | 构建并部署到 Vercel（App + Docs）|

### 监控

| 服务 | 用途 | 集成方式 |
|------|------|----------|
| Sentry | 错误监控 | `@sentry/nextjs`（client/edge/server 配置）|
| Appark | APM 性能监控（规划中） | 未接线，模块已移除 |

## 本地开发环境

```bash
# 一键初始化
bash scripts/setup.sh

# 启动开发服务器（含环境检查）
bash scripts/dev.sh start

# 启动 PostgreSQL
bash scripts/dev.sh db:up

# 运行质量检查
bash scripts/dev.sh check
```
