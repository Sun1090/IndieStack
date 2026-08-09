 # 脚本工具
 
 IndieStack 提供了丰富的 npm scripts 来简化开发、测试、部署流程。
 
 ## 开发命令
 
 | 命令 | 说明 |
 |------|------|
 | `pnpm dev` | 启动 Next.js 开发服务器（热更新） |
 | `pnpm dev:mock` | 以 Mock 模式启动（`NEXT_PUBLIC_MOCK_ENABLED=true`） |
 | `pnpm dev:supabase` | 启动 Supabase 本地服务 + 开发服务器 |
 | `pnpm preview` | 预览生产构建（端口 4173） |
 
 ## 构建与部署
 
 | 命令 | 说明 |
 |------|------|
 | `pnpm build` | 生产构建（Next.js + Sentry 自动集成） |
 | `pnpm start` | 启动生产服务器 |
 | `pnpm sentry:sourcemaps` | 上传 Source Maps 到 Sentry |
 
 ## 代码质量
 
 | 命令 | 说明 |
 |------|------|
 | `pnpm lint` | ESLint 代码检查（含 Next.js 规则） |
 | `pnpm type-check` | TypeScript 类型检查（`tsc --noEmit`） |
 | `pnpm format` | Prettier 格式化（TS、TSX、CSS、JSON） |
 | `pnpm check` | 同时运行类型检查和代码检查 |
 
 ## 测试
 
 | 命令 | 说明 |
 |------|------|
 | `pnpm test` | 运行所有测试（Vitest） |
 | `pnpm test:watch` | 监听模式运行测试 |
 | `pnpm test:coverage` | 运行测试并生成覆盖率报告 |
 
 ## 数据库
 
 | 命令 | 说明 |
 |------|------|
 | `pnpm db:migrate` | 推送数据库迁移到 Supabase |
 | `pnpm db:push` | 推送 schema 变更 |
 | `pnpm db:seed` | 执行种子数据脚本 |
 | `pnpm db:types` | 从 Supabase 生成 TypeScript 类型定义 |
 | `pnpm db:status` | 查看 Supabase 本地服务状态 |
 
 ## 辅助脚本
 
 ### `/scripts/setup.sh`
 
 一键项目设置脚本，执行以下操作：
 
 1. 检查 Node.js 版本（要求 18.17+）
 2. 安装项目依赖（`pnpm install`）
 3. 复制环境变量模板（如果 `.env.local` 不存在）
 4. 初始化 Git Hooks（husky）
 5. 提示启动开发模式
 
 ### `/scripts/dev.sh`
 
 开发辅助脚本，提供：
 
 - 启动 Supabase 本地服务（Docker）
 - 应用数据库迁移
 - 启动 Next.js 开发服务器
 
 ## Git Hooks（husky）
 
 项目使用 husky 管理 Git Hooks：
 
 - **pre-commit**: 运行 lint-staged（自动格式化 + ESLint 修复暂存文件）
 - **commit-msg**: 校验提交信息是否符合 Conventional Commits 规范
 
 ```bash
 # 提交信息格式
 feat: 新功能
 fix: 修复 Bug
 docs: 文档更新
 refactor: 重构
 chore: 杂项
 test: 测试
 ```
 
 ## Docker 部署
 
 ```bash
 # 使用 Docker Compose 本地运行完整项目
 docker compose up -d
 
 # 构建并运行
 docker build -t indiestack .
 docker run -p 3000:3000 indiestack
 ```
 
 | 命令 | 说明 |
 |------|------|
 | `docker compose up` | 启动 PostgreSQL + pgAdmin |
 | `docker build` | 构建生产镜像（多阶段构建） |
 | `docker run` | 运行生产容器 |
