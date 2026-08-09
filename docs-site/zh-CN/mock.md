
# Mock 模式开发指南

## 概述

IndieStack 内置了一套完整的 Mock 系统，基于 `@faker-js/faker` 生成模拟数据。开启 Mock 模式后，无需真实 Supabase 后端即可进行完整的本地开发和调试。

### 为什么需要 Mock 模式

- **脱机开发**：没有网络或 Supabase 服务不可用时仍可开发
- **快速启动**：跳过数据库配置，秒级启动开发服务器
- **前端优先**：专注于 UI 开发和调试，后端就绪后再连接
- **API 模拟**：配合 Apifox 等工具，可以完整模拟 API 接口
- **测试友好**：确定性数据生成，便于编写和复现测试

## 开启 Mock 模式

### 方式一：环境变量（推荐）

在 `.env.local` 中设置：

```bash
# 开发 Mock 模式
NEXT_PUBLIC_MOCK_ENABLED=true
```

### 方式二：自动启用

当 `NEXT_PUBLIC_SUPABASE_URL` 或 `NEXT_PUBLIC_SUPABASE_ANON_KEY` 未设置时，系统会自动启用 Mock 模式。

### 方式三：命令行脚本

```bash
# 使用 Mock 模式启动
pnpm dev:mock

# 使用 Supabase 启动
pnpm dev:supabase
```

## Mock 数据生成

Mock 数据基于 `@faker-js/faker`，位于 `src/lib/mock/data.ts`：

| 数据类型 | 生成函数 | 说明 |
|---------|---------|------|
| 用户 | `generateMockUser()` | 包含 ID、邮箱、头像 |
| 会话 | `generateMockSession()` | 模拟 Supabase 会话 |
| 个人资料 | `generateMockProfile()` | 含姓名、简介、头像 |
| 团队 | `generateMockTeam()` | 团队名称、描述 |
| 团队成员 | `generateMockTeamMembersWithProfiles()` | 含角色、状态 |
| 项目 | `generateMockProjects()` | 项目名、状态、进度 |
| 通知 | `generateMockNotifications()` | 通知标题、内容、类型 |
| 审计日志 | `generateMockAuditLogs()` | 操作记录、IP、时间 |
| API 用量 | `generateMockApiUsage()` | 请求次数、错误率 |
| 订阅 | `generateMockSubscription()` | 方案、状态、续费日期 |

### 数据缓存策略

Mock 数据在**一次请求内**保持缓存一致，每次请求生成新的随机数据。可以通过 `resetMockCache()` 手动刷新。

## Mock Supabase 客户端

Mock 系统实现了一个 `MockSupabaseClient` 类，模拟了 Supabase 的核心接口：

### 支持的 API

```typescript
// 认证 API
const { data: { user } } = await supabase.auth.getUser()
const { data: { session } } = await supabase.auth.getSession()
const { data } = await supabase.auth.signUp({ email, password })
const { data } = await supabase.auth.signInWithPassword({ email, password })
const { data } = await supabase.auth.signInWithOAuth({ provider: "github" })
await supabase.auth.signOut()
await supabase.auth.resetPasswordForEmail({ email })
await supabase.auth.updateUser({ ... })

// 数据库查询（链式调用）
const { data } = await supabase
  .from("profiles")
  .select("*")
  .eq("id", userId)
  .single()

const { data } = await supabase
  .from("team_members")
  .select("*")
  .order("created_at", { ascending: false })
  .limit(10)

// 插入 / 更新 / 删除
await supabase.from("profiles").insert({ ... })
await supabase.from("profiles").update({ ... }).eq("id", userId)
await supabase.from("profiles").delete().eq("id", userId)
```

### 支持的查询表

| 表名 | 返回数据 |
|------|---------|
| `profiles` | 10 条随机个人资料 |
| `teams` | 1 个团队 |
| `team_members` | 多个团队成员 |
| `notifications` | 通知列表 |
| `audit_logs` | 审计日志列表 |
| `subscriptions` | 订阅信息 |

## Apifox 集成

Apifox 可以帮助你更好地管理 API 和 Mock 数据：

### 为什么使用 Apifox

- **API 文档自动生成**：从代码注释或 OpenAPI 规范导入
- **Mock 数据管理**：自定义 Mock 规则
- **接口调试**：可视化请求/响应
- **团队协作**：共享 API 文档

### 配置步骤

1. **导出 OpenAPI 规范**

   安装并运行 API 路由导出工具：

   ```bash
   pnpm install -g apifox-cli
   ```

2. **在 Apifox 中创建项目**

   - 新建项目，选择「导入」
   - 选择「OpenAPI / Swagger」格式
   - 上传或粘贴 API 规范

3. **配置环境**

   - 开发环境：`http://localhost:3000`
   - 生产环境：`https://your-app.vercel.app`

4. **开启 Apifox Mock**

   - 在 Apifox 中开启「云端 Mock」
   - 设置 Mock 规则：字段类型、长度、格式
   - 使用 Apifox 提供的 Mock URL 进行调试

5. **自定义 Mock 规则示例**

   ```json
   {
     "code": 0,
     "message": "success",
     "data": {
       "id": "@integer(1, 10000)",
       "name": "@cname",
       "email": "@email",
       "avatar": "@image(200x200)",
       "createdAt": "@datetime"
     }
   }
   ```

### 与项目 Mock 配合使用

- 项目内置 Mock 适合**前端开发阶段**，零配置即可运行
- Apifox Mock 适合**接口联调阶段**，精细化控制每个接口的响应
- 两者可以配合使用：先用内置 Mock 快速开发 UI，再用 Apifox Mock 验证接口逻辑

## 限制与注意事项

### 功能限制

Mock 模式**不支持**以下真实后端功能：

| 功能 | 说明 | 替代方案 |
|------|------|---------|
| 真实认证 | 不会发送真实邮件/短信 | 模拟登录成功 |
| Realtime 订阅 | 不会建立 WebSocket 连接 | 静态数据 |
| 文件存储 | 不会上传到阿里云 OSS | 本地占位图 |
| Stripe 支付 | 不会处理真实支付 | 模拟成功响应 |
| 权限验证 | 所有用户默认 admin 角色 | 本地校验 |
| 数据库持久化 | 数据不会持久化存储 | 内存缓存 |

### 代码位置

```
src/lib/mock/
  index.ts   # Mock 入口、客户端、查询构建器
  data.ts    # 数据生成器（使用 @faker-js/faker）
```

### 开发建议

1. **新功能开发**：先用 Mock 模式快速迭代 UI
2. **接口联调**：切换到真实 Supabase 验证 API 逻辑
3. **自动化测试**：Mock 模式可用于 CI 中的前端测试
4. **团队协作**：推荐使用 Apifox 共享接口文档
