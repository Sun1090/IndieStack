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
- **可选**: Sentry DSN, Stripe keys, Alibaba Cloud OSS（四项 `OSS_*` 齐备时启用，否则安全回退 Supabase Storage）, Appark（`APPARK_API_KEY` 与 `APPARK_ENDPOINT` 齐备时启用，默认旁路关闭）

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

两个 Vercel 项目来自同一仓库，因此有一处必须区分，否则每次 push 都会白占一份
build storage（10 GB 额度会因此提前见底）：

| 设置                                   | App (`indie-stack`) | Docs (`indie-stack-docs-site`) |
| -------------------------------------- | ------------------- | ----------------------------- |
| Root Directory                         | （仓库根）           | `docs-site`                   |
| Enable Affected Projects Deployments   | 关闭                 | **开启**                      |

Docs 项目开启 Affected Projects Deployments 后，只有 `docs-site/` 目录内的文件发生变化时才会
触发部署；仅改 App 代码时不再连带重建文档站。若要强制重建文档站，用 CLI 手动部署。

> 教训（2026-10-04）：两个项目未做区分时，单日 18 次部署把 10 GB 额度推到 8.71 GB。
> 排查入口是 Dashboard → Usage → Deployment Storage，注意额度上限显示在卡片上，
> 而 Total size 图表的纵轴刻度（如 150 GB）只是坐标轴，不是额度。

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

| 工作流   | 触发      | 操作                                                                    |
| -------- | --------- | ----------------------------------------------------------------------- |
| `ci.yml` | PR / push | lint → type-check → test                                                |
| （无）   | —         | 当前仓库没有托管部署 workflow；Vercel 部署由项目平台/CLI 按发布清单执行 |

### 监控

| 服务   | 用途         | 集成方式                                                                       |
| ------ | ------------ | ------------------------------------------------------------------------------ |
| Sentry | 错误监控     | `@sentry/nextjs`（client/edge/server 配置）                                    |
| Appark | APM 性能监控 | `src/lib/appark.ts` 轻量接线，默认旁路关闭；checkout/cron 等路径按采样配置上报 |

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
