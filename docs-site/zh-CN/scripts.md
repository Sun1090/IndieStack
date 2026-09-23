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
| `pnpm check:security` | 校验 secrets/环境策略与安全扫描配置 |
| `pnpm check:changelog` | 校验 CHANGELOG.md 结构（版本、章节、条目） |
| `pnpm check:adr` | 校验 ADR 编号、状态、索引、必要章节与取代关系 |
| `pnpm check:gates` | 校验每个 `check:*` 门禁都已接入 check-all.sh 与 CI，或登记豁免理由 |
| `pnpm check:workflows` | 校验 CI 工作流卫生：action 固定版本、作业超时、`needs` 目标、PR 并发取消、脚本名真实存在，以及 ci.yml 并行/缓存契约 |
| `pnpm check:codeql` | 校验 CodeQL 扫描强度与告警处置策略：action major、语言、查询套件、SARIF category、权限、超时、分支/定时覆盖、路径过滤与 runbook 事实一致性 |
| `pnpm check:secrets-scan` | 校验 gitleaks 扫描强度与泄漏处置策略：action major、全历史 fetch-depth、触发覆盖、token 接线、写权限、allowlist 条目与 runbook 事实一致性 |
| `pnpm check:trace-coverage` | 校验所有 Route Handler 与 Server Action 都经带 trace 的 `logApiError` / `logActionError` 记录错误，且 `src/lib/trace-id.ts` 与 `src/proxy.ts` 的 `x-request-id` 契约未漂移 |
| `pnpm check:bilingual-docs` | 逐页比对 `docs-site` 与其 `zh-CN` 版本的调度事实（cron 表达式、`HH:MM UTC` 时刻），只改一种语言就失败 |
| `pnpm check:cron-contract` | 校验每个 cron worker 的 Vercel 调度、路由方法、鉴权拒绝可观测性、文档中的指标契约、「按条件跳过投递时有没有上报跳过计数」，以及 `docs-site` 与 `docs` 里引用的 cron 表达式和 `/api/cron/*` 路径是否真的存在于仓库 |
| `pnpm check:release-tag` | 校验 `vX.Y.Z` 标签与 `package.json` 一致、CHANGELOG 存在带日期的对应章节，并要求 `release.yml` 跑完全部门禁后才发布审核过的 Notes |
| `pnpm check:mock-docs` | 校验 Mock 文档的表名清单与 E2E 端点同实现保持一致 |
| `pnpm check:test-matrix` | 校验贡献者测试矩阵登记了全部改动领域与真实存在的脚本 |
| `pnpm check:provider-docs` | 校验两份 provider 诊断指南都记录了全部 provider 与环境变量 |
| `pnpm provider:doctor` | 输出不含凭据的 provider 配置报告，并在半套配置时失败 |
| `pnpm check:tailwind` | 校验 Tailwind v4 原生主题用法（无 JS 配置、`@theme` token、已更名工具类） |
| `pnpm check:tokens` | 校验设计 token 注册表与 `globals.css` 一致，并禁止用原生调色板表达状态语义 |
| `pnpm check:fields` | 校验共享 `FormField` / `NativeSelect` 用法，禁止原生 select、复制控件类名和直接引入 label |
| `pnpm check:states` | 校验共享 `PageLoading` / `EmptyState` / `ErrorState` 用法，禁止手写路由骨架、旧 loader 和裸 spinner |
 
 ## 测试
 
 | 命令 | 说明 |
 |------|------|
| `pnpm test` | 运行所有测试（Vitest） |
| `pnpm test:watch` | 监听模式运行测试 |
| `pnpm test:coverage` | 运行测试并生成覆盖率报告 |
| `pnpm test:e2e` | 运行 Playwright E2E 冒烟测试 |
| `pnpm test:visual` | 对比 Linux Chromium 视觉回归基线 |
 
 ## 数据库
 
 | 命令 | 说明 |
 |------|------|
| `pnpm db:migrate` | 推送数据库迁移到 Supabase |
| `pnpm db:seed` | 执行种子数据脚本 |
| `pnpm db:types` | 从 Supabase 生成 TypeScript 类型定义 |
| `pnpm db:status` | 查看 Supabase 本地服务状态 |
| `pnpm check:migrations` | 校验迁移不可变校验和与命名/顺序规则 |
| `pnpm check:query-columns` | 校验查询链里的字面量列名，以及 `insert`/`update`/`upsert` 载荷的键，都存在于生成的行类型 / Insert·Update 类型中 |
| `pnpm update:migrations-manifest` | 重新生成迁移校验和清单（仅允许追加） |
| `pnpm check:migration-history` | 比对本地 Supabase 迁移历史（需 `supabase start`） |
| `pnpm check:migration-runbook` | 校验迁移回滚 runbook 与迁移清单保持一致 |
 
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
| `pnpm check:locales` | 校验中英键对称，并确认值真的翻译了 |
| `pnpm check:agents` | 校验 AGENTS.md 索引一致性 |
| `pnpm check:rls` | RLS 迁移静态检查（USING/WITH CHECK） |
| `pnpm check:bundle` | 客户端体积门禁（构建+基线对比） |
| `pnpm dep:health` | 依赖健康报告（major/minor 分级） |
