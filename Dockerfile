# =============================================================================
# IndieStack — Docker 多阶段构建
# =============================================================================
# 构建方式：
#   docker build -t indiestack .
#   docker run -p 3000:3000 --env-file .env.production indiestack
#
# 或使用 docker-compose：
#   docker-compose up -d
# =============================================================================

# ---- Stage 1: 依赖安装 ----
FROM node:22-alpine AS deps
LABEL stage=deps

RUN apk add --no-cache libc6-compat && \
    corepack enable && \
    corepack prepare pnpm@latest --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile --prod

# ---- Stage 2: 构建 ----
FROM node:22-alpine AS builder
LABEL stage=builder

RUN apk add --no-cache libc6-compat && \
    corepack enable && \
    corepack prepare pnpm@latest --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

COPY . .

# 构建时环境变量
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_MOCK_ENABLED
ARG NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_NAME
ARG NEXT_PUBLIC_DOCS_URL

ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_MOCK_ENABLED=$NEXT_PUBLIC_MOCK_ENABLED \
    NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN \
    NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_APP_NAME=$NEXT_PUBLIC_APP_NAME \
    NEXT_PUBLIC_DOCS_URL=$NEXT_PUBLIC_DOCS_URL \
    NEXT_TELEMETRY_DISABLED=1

RUN pnpm build

# ---- Stage 3: 运行 ----
FROM node:22-alpine AS runner
LABEL stage=runner

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

WORKDIR /app

# 仅复制运行需要的依赖（忽略 devDependencies）
COPY --from=deps /app/node_modules ./node_modules

# 从构建阶段复制产物
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# 配置文件复制
COPY --from=builder /app/next.config.ts ./
COPY --from=builder /app/package.json /app/pnpm-lock.yaml ./

# 设置运行用户
USER nextjs

EXPOSE 3000

ENV PORT=3000 \
    HOSTNAME="0.0.0.0" \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

CMD ["node", "server.js"]
