# 部署架构

## 部署方式

项目支持两种部署方式：**Docker 容器化部署** 和 **Vercel 平台部署**。

```mermaid
graph TD
    subgraph DeployOptions["部署方式"]
        Docker["Docker 部署<br/>Dockerfile + docker-compose"]
        Vercel["Vercel 部署<br/>自动构建 + 部署"]
    end

    subgraph DockerFlow["Docker 流程"]
        Build["docker build<br/>多阶段构建"]
        Image["Docker 镜像"]
        Run["docker run<br/>或 docker-compose up"]
        Container["运行容器<br/>standalone 模式"]
    end

    subgraph VercelFlow["Vercel 流程"]
        Push["git push"]
        AutoBuild["Vercel 自动构建"]
        Deploy["部署到 Edge 网络"]
        CDN["全球 CDN"]
    end

    Docker --> Build --> Image --> Run --> Container
    Vercel --> Push --> AutoBuild --> Deploy --> CDN
```

## Docker 部署

### 多阶段构建

```mermaid
graph LR
    subgraph Stage1["Stage 1: deps"]
        DepsBase["node:20-alpine"]
        Install["corepack enable<br/>pnpm install --frozen-lockfile"]
    end

    subgraph Stage2["Stage 2: builder"]
        BuilderBase["node:20-alpine"]
        CopyDeps["复制 node_modules"]
        BuildApp["pnpm build<br/>(standalone 输出)"]
    end

    subgraph Stage3["Stage 3: runner"]
        RunnerBase["node:20-alpine"]
        CopyStandalone["复制 .next/standalone"]
        CopyStatic["复制 .next/static"]
        CopyPublic["复制 public/"]
        Run["node server.js<br/>端口 3000"]
    end

    Stage1 --> Stage2 --> Stage3
```

### Dockerfile 关键配置

```dockerfile
FROM node:20-alpine AS deps
RUN corepack enable && pnpm install --frozen-lockfile

FROM node:20-alpine AS builder
COPY --from=deps /app/node_modules ./node_modules
RUN pnpm build  # output: "standalone"

FROM node:20-alpine AS runner
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

### docker-compose.yml

```mermaid
graph TD
    subgraph Compose["docker-compose 服务"]
        Postgres["postgres:16-alpine<br/>端口: 5432<br/>数据卷: postgres_data"]
        PgAdmin["pgadmin4<br/>端口: 5050"]
        App["应用容器<br/>端口: 3000<br/>(可选)"]
    end

    Postgres -->|健康检查| PgAdmin
    App -->|连接| Postgres
```

| 服务 | 镜像 | 端口 | 说明 |
|------|------|------|------|
| postgres | postgres:16-alpine | 5432 | 本地 PostgreSQL |
| pgadmin | dpage/pgadmin4 | 5050 | 数据库管理 UI |

### Docker 部署命令

```bash
# 构建镜像
docker build -t indiestack .

# 运行容器
docker run -p 3000:3000 --env-file .env.production indiestack

# 或使用 docker-compose
docker-compose up -d
```

## Vercel 部署

### 环境变量

在 Vercel 项目设置中配置所有环境变量（参考 `.env.example`）。

### 域名与重定向

```typescript
// next.config.ts
redirects: [
  { source: "/docs/:path*", destination: "${DOCS_URL}/:path*", permanent: false },
]
```

文档站独立部署在 `indiestack-docs.vercel.app`。

## CI/CD 流程

```mermaid
flowchart LR
    Dev["开发者"] -->|git push| Repo["Git 仓库"]
    Repo --> Hook["Husky pre-commit"]
    Hook --> LintStaged["lint-staged<br/>ESLint + Prettier"]
    LintStaged --> Commitlint["commitlint<br/>提交消息规范"]
    Commitlint --> Push["git push 到远程"]
    Push --> CI["GitHub Actions"]
    CI --> TypeCheck["TypeScript 类型检查"]
    CI --> Lint["ESLint"]
    CI --> Test["Vitest 测试"]
    CI --> Build["Next.js 构建"]
    CI --> Deploy["部署"]
```

### 提交规范

使用 commitlint 强制 Conventional Commits 规范：

```
<type>(<scope>): <subject>

feat: 新功能
fix: 修复
docs: 文档
style: 格式
refactor: 重构
test: 测试
chore: 构建/工具
```

### 质量检查

| 检查项 | 命令 | 时机 |
|--------|------|------|
| 类型检查 | `pnpm type-check` | CI |
| Lint | `pnpm lint` | pre-commit + CI |
| 格式化 | `pnpm format` | pre-commit |
| 单元测试 | `pnpm test` | CI |
| 构建 | `pnpm build` | CI |

## 文档站部署

```mermaid
graph TD
    subgraph DocsSite["VitePress 文档站"]
        VPConfig[".vitepress/config.mts<br/>多语言配置"]
        ZHDocs["zh-CN/ — 中文文档"]
        ENDocs["en/ — 英文文档"]
        DocsDocker["Dockerfile<br/>文档站容器"]
        Nginx["nginx.conf<br/>Nginx 配置"]
    end

    VPConfig --> ZHDocs
    VPConfig --> ENDocs
    DocsDocker --> Nginx
```

文档站独立部署，支持中英双语，使用 VitePress 构建。

## 健康检查

```bash
# Docker HEALTHCHECK
curl http://localhost:3000/api/health

# 响应
{
  "status": "ok",
  "uptime": 3600,
  "checks": {
    "supabase": { "configured": true },
    "sentry": { "configured": true },
    "stripe": { "configured": true }
  }
}
```

## 环境配置文件

| 文件 | 用途 |
|------|------|
| `.env.example` | 环境变量模板 |
| `.env.local` | 本地开发（不提交） |
| `.env.development` | 开发环境 |
| `.env.production` | 生产环境 |
