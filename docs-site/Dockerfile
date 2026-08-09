# ===== IndieStack 文档站 — VitePress 多阶段构建 =====

# 构建阶段：安装依赖并构建静态站点
FROM node:20-alpine AS builder
WORKDIR /app

RUN apk add --no-cache libc6-compat && \
    corepack enable && \
    corepack prepare pnpm@latest --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# 运行阶段：使用 Nginx 提供静态文件
FROM nginx:alpine AS runner
COPY --from=builder /app/.vitepress/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
