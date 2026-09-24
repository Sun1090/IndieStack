# Mock 模式开发指南

## 概述

IndieStack 内置 Mock 后端，无需搭建 Supabase 项目即可在本地跑通整个应用。Mock 实现位于
`src/lib/mock/`，对外保持与真实客户端相同的调用形态，业务代码不需要写「当前是不是 Mock」的分支。

### 什么时候该用 Mock 模式

| 适用场景 | 不适用场景 |
| -------- | ---------- |
| 无网络、无 Supabase 时的 UI 开发 | 验证 RLS、策略与租户隔离 |
| Playwright E2E 与单元测试 | 验证真实认证、邮件投递与 OAuth |
| 演示与新人上手（零配置） | 验证 Stripe、存储与 Edge Function 行为 |

Mock 模式**不构成**任何安全边界成立的证据。真实边界由数据库身份矩阵覆盖（见
`docs/testing.md`）。

## 开启 Mock 模式

是否开启由 `src/lib/mock/config.ts` 的单一判断决定。

### 方式一：显式开关（推荐）

```bash
# .env.local
NEXT_PUBLIC_MOCK_ENABLED=true
```

### 方式二：自动降级（仅限非生产环境）

未设置 `NEXT_PUBLIC_MOCK_ENABLED` 时，下列条件**同时**成立才会自动启用：

- `NODE_ENV` 不是 `"production"`，且
- `NEXT_PUBLIC_SUPABASE_URL` 缺失。

`NEXT_PUBLIC_SUPABASE_ANON_KEY` 与该判断无关。生产构建永不自动降级：生产环境缺少
Supabase URL 会直接报错，而不是静默地给出 Mock 用户。

### 方式三：命令行脚本

```bash
pnpm dev:mock       # NEXT_PUBLIC_MOCK_ENABLED=true pnpm dev
pnpm dev:supabase   # bash scripts/dev.sh start（本地 Supabase 栈）
```

### 在代码里判断 Mock 模式

```typescript
import { isMockEnabled, shouldUseMock } from "@/lib/mock/config";

if (shouldUseMock()) {
  // 路由处理、种子数据与测试辅助
}
```

`src/lib/mock/config.ts` 刻意不引入 `@faker-js/faker` 等 Mock 数据依赖，这样
`src/proxy.ts` 可以在请求路径上引用而不把 fixture 生成器打进运行时。

## 支持的数据表

`MockSupabaseClient` 用内存数据集响应 `from(table)`。下表就是客户端
`switch (this.table)` 分支实际接受的全部表名；其它表名读取返回空结果、写入为空操作。

| 表名 | 类型 | 说明 |
| ---- | ---- | ---- |
| `profiles` | 预置，可写 | Mock 用户的资料，角色为 `super_admin` |
| `teams` | 预置，可写 | 确定性团队（`MOCK_TEAM_ID`） |
| `team_members` | 预置，可写 | 通过 `applyRelationships()` 解析角色 |
| `team_members_with_profiles` | 预置，只读 | 成员列表使用的联表视图 |
| `subscriptions` | 常量，只读 | 固定返回 Mock 团队的 `pro / active` |
| `notifications` | 预置，可写 | 驱动下文的实时事件桥 |
| `audit_logs` | 预置，可写 | |
| `projects` | 预置，可写 | |
| `api_usage` | 预置，可写 | |
| `api_keys` | 预置，可写 | |
| `user_sessions` | 预置，可写 | |
| `email_worker_runs` | 预置，可写 | 由 `/api/e2e/email-worker-runs` 读取 |
| `marketing_subscriptions` | 预置，可写 | |
| `contact_messages` | 预置，可写 | 联系表单闭环 |
| `webhook_events` | 预置，可写 | Stripe 幂等闭环 |
| `push_delivery_attempts` | 预置，可写 | Push 重试闭环 |
| `push_subscriptions` | 预置，可写 | |
| `upload_objects` | 预置，可写 | 存储元数据闭环 |

### 查询构建器行为

| 能力 | 行为 |
| ---- | ---- |
| `select()` | 在本地应用过滤、`order()`、`limit()`/`range()`、`single()`/`maybeSingle()` |
| `eq()` / `neq()` / `in()` / `is()` | 支持 |
| `insert()` / `update()` / `delete()` | 就地修改缓存列表，后续读取可见 |
| `rpc()` | 实现 `claim_webhook_event`、`erase_user_data`、`list_user_objects_for_erasure` 与 `find_orphan_upload_objects`，其它函数名返回 `null` 数据 |
| 未知表名 | 读取返回 `[]`，写入不落库 |

认证接口：`getUser`、`getSession`、`signInWithPassword`、`signUp`、`signInWithOAuth`、
`signOut`、`resetPasswordForEmail`、`updateUser`，以及 MFA
（`enroll`、`challenge`、`challengeAndVerify`、`verify`、`unenroll`）都返回确定性结果，
MFA 状态迁移由共享缓存承载。

## 状态模型与隔离

Mock 客户端的数据集保存在**进程级**缓存里，而不是请求级：

- 模块级缓存同时镜像到 `globalThis.__indiestackMockCache__`。这个 `globalThis` 跳板是必要的：
  Next.js 的 dev 与生产构建都会把 Mock 模块拆成多个 chunk，没有它时 RSC/路由处理里的写入
  在后续 Server Action 读取中不可见（v0.5.0 实际踩过的 bug）。
- 调用 `resetMockCache()` 可以清空所有缓存列表、Mock 用户/会话以及 MFA 状态。
- 因为缓存是进程级的，两个浏览器同时访问同一个 dev server 会共享变更，所以 E2E 默认串行
  （Playwright `workers: 1`）。

需要请求级隔离时——并行 spec、并发场景测试、adapter 单测——创建独立 scope 并注入：

```typescript
import { createMockRequestStore, createMockSupabaseClient } from "@/lib/mock";

const store = createMockRequestStore();
const supabase = createMockSupabaseClient({ store });
```

`createMockRequestStore()` 基于私有 `Map` 提供 `get` / `set` / `getOrCreate` / `clear`，
请求之间不会互相泄漏。仓库**不使用** file-backed fixture 作为运行时数据库，原因见
`docs/testing.md` 的 F02/F03 结论。

### 重置运行中的 dev server

`POST /api/e2e/mock-reset` 无需重启即可清空进程级缓存。它在非 Mock 模式下返回 404，
并要求 `Authorization: Bearer <E2E_BEARER_TOKEN>`：

```bash
curl -X POST http://localhost:3000/api/e2e/mock-reset \
  -H "Authorization: Bearer $E2E_BEARER_TOKEN"
# → { "ok": true, "reset": true }
```

## Mock 模式接入点

| 接入点 | Mock 行为 |
| ------ | --------- |
| `src/proxy.ts` | 仍然生成 CSP nonce、`x-request-id` 并执行 `updateSession()`，然后提前返回、跳过路由级重定向 |
| 页面级守卫 | `requireRole()` / `requirePermission()` 仍然执行——Mock 只跳过 proxy 的重定向层 |
| Supabase 服务端客户端 | 返回 `MockSupabaseClient` |
| Supabase 浏览器客户端 | 返回 `MockSupabaseClient` |
| Realtime | 服务端 seed 后派发 `indiestack:mock-realtime` DOM 事件供客户端订阅消费 |
| 存储 | 使用本地占位 URL；`/api/e2e/mock-upload` 注入 `put()` 失败 |
| Push 传输 | `src/lib/mock/push-transport.ts` 只替换 `web-push` 的底层 HTTP 传输，配置检查、载荷构造、重试与错误映射仍走真实代码 |
| Admin 客户端 | 永不 Mock——service role 路径必须打真实数据库 |

## 仅 E2E 使用的端点

`src/app/api/e2e/` 下的辅助端点只在 Mock 模式存在，非 Mock 模式一律 404，除特殊说明外
都需要 `Authorization: Bearer <E2E_BEARER_TOKEN>`。

| 端点 | 方法 | 用途 |
| ---- | ---- | ---- |
| `/api/e2e/mock-reset` | POST | 清空进程级 Mock 缓存 |
| `/api/e2e/seed-notifications` | GET, POST | 写入通知行并派发实时事件 |
| `/api/e2e/push-queue` | GET, POST | 写入 Push 订阅/投递记录并检查重试队列 |
| `/api/e2e/mock-upload` | GET, POST | 读取/设置 `failNext`，让 Mock 的 `storage.from(bucket).upload()` 确定性失败 |
| `/api/e2e/email-inbox` | GET, POST, DELETE | 本地邮件收件箱（`RESEND_API_URL` 指向它） |
| `/api/e2e/email-worker-runs` | GET | 检查 cron 处理器写入的 worker run |
| `/api/e2e/webhook-events` | GET, DELETE | 检查/清空已占位的 webhook 事件 |
| `/api/e2e/contact-messages` | GET, POST, DELETE | 检查/清空联系表单提交 |

Push 保留端点基于 `E2E_PUSH_ENDPOINT_BASE`：

| 端点 | 场景 |
| ---- | ---- |
| `E2E_PUSH_ENDPOINTS.ok` | 投递成功（201） |
| `E2E_PUSH_ENDPOINTS.transient` | 网络错误，退避重试直至死信 |
| `E2E_PUSH_ENDPOINTS.timeout` | 超时，`failure_code=timeout` |
| `E2E_PUSH_ENDPOINTS.gone` | 410，撤销本地订阅 |

其它端点一律抛错，确保「忘了注入 fixture」不会被误判为投递成功。

## Playwright 接线

`playwright.config.ts` 启动 `pnpm dev -p 3100` 并注入 Mock 所需环境：

| 变量 | 取值 | 作用 |
| ---- | ---- | ---- |
| `NEXT_PUBLIC_MOCK_ENABLED` | `true` | 开启 Mock 模式 |
| `E2E_BEARER_TOKEN` | `e2e-bearer-token` | 保护上表的 `/api/e2e/*` 端点 |
| `RESEND_API_URL` | `http://localhost:3100/api/e2e/email-inbox` | 本地捕获出站邮件 |
| `CRON_SECRET` | `e2e-cron-secret` | 认证 cron 路由调用 |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | `sk_test_e2e_webhook` / `whsec_e2e_webhook` | 驱动 webhook 幂等闭环 |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | 占位值 | 让 `web-push` 配置检查通过，签名由 Mock 传输层替换 |

dev server 是共享可变状态，因此 `workers` 默认 `1`；只有隔离实验会设置
`PW_FULLY_PARALLEL=true`。

这个实验不再是一次性的：`E2E parallel baseline` workflow 会用 `PW_FULLY_PARALLEL=true` 跑**全量**
（刻意不带 `--shard`），可手动触发，也固定在每周一 `30 7 * * 1`（07:30 UTC）。它**一个 worker 开一台
dev server**（`E2E_SERVERS=3`，config 里的 `workers` 取同一个数），因为这条基线的首跑——多个 worker
挤在一台服务器上——量出 4 条失败用例，唯一的共同原因就是那份共享的默认 store。每台服务器都用各自的
`NEXT_DIST_DIR`：Next 靠 `<distDir>/dev/lock` 判断「这个工作副本已经有一个 dev server」，同一份源码上
起第二台会直接退出。spec 里的应用地址一律走 `appUrl()`（按 worker 序号选端口）。
它强制 `--retries=0`：CI 默认重跑 2 次，而重跑会换 workerIndex、也就是换一台干净的服务器，
「第二次成功」说的已经不是同一份状态了。
它是测量而不是合并门禁——变红的含义是「并行基线存在共享状态冲突，请按报告记下具体是哪一份状态」，
不是「这个 PR 不能合」。常规 CI 的 shard 各自启动独立 dev server、内部仍是单 worker，因此测不出这类
冲突，两套配置互补而非互相替代。也**不要**为了让基线变绿把 mock 的运行时默认 store 改成请求级：
默认 store 是一份刻意共享的假数据库，理由见 `docs/architecture/13-mock-system.md`。

## 限制

| 能力 | Mock 行为 | 真实替代 |
| ---- | --------- | -------- |
| 认证 | 不做邮件/OAuth/MFA 往返，直接返回 Mock 会话 | 本地 Supabase |
| 行级安全 | 不生效 | `pnpm smoke:supabase-identity` |
| Realtime | 派发 `indiestack:mock-realtime` DOM 事件，不建 WebSocket | 本地 Supabase 真实频道 |
| 文件存储 | 占位 URL，可选注入失败 | 本地 Supabase Storage 或 OSS 配置 |
| 支付 | 不发送 Stripe SDK 请求 | Stripe CLI test mode |
| Push 通知 | 进程内替换传输层 | 本地不覆盖，见 `docs/operations/` |
| 持久化 | 仅内存，重启即失 | 本地 Supabase |
| 数据质量 | 由 `@faker-js/faker` 随机生成，但 spec 依赖的 ID/时间戳为确定性 | `supabase/seed.sql` 种子 |

仓库不提供 OpenAPI 导出，也不集成外部 Mock 工具；内置 Mock 客户端与上表的
`/api/e2e/*` 端点就是受支持的路径。

## 退出 Mock 模式

```bash
# .env.local
NEXT_PUBLIC_MOCK_ENABLED=false
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

重启开发服务器即可。需要完全本地的 Supabase 栈时使用 `pnpm dev:supabase`。

## 代码位置

```
src/lib/mock/
  config.ts          # 零依赖的开启判断（proxy 可安全引用）
  data.ts            # @faker-js/faker 生成器 + 确定性 ID
  index.ts           # MockSupabaseClient、缓存、重置、实时桥、上传注入
  store.ts           # createMockRequestStore() 请求级原语
  push-transport.ts  # E2E 用的 web-push 传输层替换
src/app/api/e2e/     # 仅 Mock 模式开放的测试端点
```

架构视角的同一份契约见 `docs/architecture/13-mock-system.md`；
`pnpm check:mock-docs` 会在任一份文档与代码漂移时让构建失败。
