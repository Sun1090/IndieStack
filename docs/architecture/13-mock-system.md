# Mock 开发模式

## 概述

项目内置 Mock 系统，允许在没有真实 Supabase 后端的情况下进行本地开发和 UI 调试。所有 Mock 数据由 `@faker-js/faker` 随机生成。

```mermaid
graph TD
    subgraph MockSystem["Mock 系统"]
        Detection["模式检测<br/>shouldUseMock()"]
        MockClient["Mock Supabase 客户端<br/>createMockSupabaseClient()"]
        MockData["Mock 数据生成<br/>@faker-js/faker"]
    end

    subgraph RealSystem["真实系统"]
        RealClient["Supabase 客户端"]
        RealDB["PostgreSQL"]
    end

    subgraph Switch["切换逻辑"]
        EnvVar["NEXT_PUBLIC_MOCK_ENABLED=true"]
        NoSupabase["Supabase 未配置"]
    end

    Switch --> Detection
    Detection -->|Mock 模式| MockClient
    Detection -->|真实模式| RealClient
    MockClient --> MockData
    RealClient --> RealDB
```

## 启用方式

Mock 模式在以下任一条件下自动启用：

| 条件 | 说明 |
|------|------|
| `NEXT_PUBLIC_MOCK_ENABLED=true` | 显式启用 |
| 未设置 `NEXT_PUBLIC_SUPABASE_URL` | Supabase 未配置时自动降级 |

```bash
# 启动 Mock 模式开发
pnpm dev:mock

# 等价于
NEXT_PUBLIC_MOCK_ENABLED=true pnpm dev
```

## Mock 数据

```mermaid
graph LR
    subgraph MockDataGen["Mock 数据生成器"]
        User["generateMockUser()<br/>模拟用户"]
        Session["generateMockSession()<br/>模拟会话"]
        Profile["generateMockProfile()<br/>模拟资料"]
        Team["generateMockTeam()<br/>模拟团队"]
        Members["generateMockTeamMembersWithProfiles()<br/>模拟团队成员"]
        Projects["generateMockProjects()<br/>模拟项目"]
        Notifications["generateMockNotifications()<br/>模拟通知"]
        AuditLogs["generateMockAuditLogs()<br/>模拟审计日志"]
    end

    subgraph Constants["常量"]
        MockUserID["MOCK_USER_ID"]
        MockTeamID["MOCK_TEAM_ID"]
    end
```

## 缓存机制

```mermaid
flowchart TD
    Request["请求进入"] --> CheckCache{"Mock 数据已缓存?"}
    CheckCache -->|否| Generate["生成 Mock 数据<br/>并缓存"]
    CheckCache -->|是| UseCache["使用缓存数据"]
    Generate --> Return["返回 Mock 数据"]
    UseCache --> Return
    Return --> Reset["resetMockCache()<br/>可手动重置"]
```

Mock 数据在一次请求内缓存，确保数据一致性。可通过 `resetMockCache()` 手动重置。

## Mock 客户端行为

Mock Supabase 客户端模拟以下接口：

| 接口 | 模拟行为 |
|------|----------|
| `auth.getUser()` | 返回 Mock 用户 |
| `from(table).select()` | 返回 Mock 数据 |
| `from(table).insert()` | 模拟插入成功 |
| `from(table).update()` | 模拟更新成功 |
| `from(table).delete()` | 模拟删除成功 |

## 中间件 Mock 行为

```mermaid
flowchart TD
    MW["Middleware"] --> CheckMock{"shouldUseMock()?"}
    CheckMock -->|是| MockSession["generateMockSession()"]
    MockSession --> SkipAuth["跳过所有权限检查"]
    SkipAuth --> Return["返回响应 + 模拟用户"]
    CheckMock -->|否| RealSession["updateSession()<br/>真实 Supabase 会话"]
```

在 Mock 模式下，中间件跳过所有 Supabase 会话检查，直接返回模拟用户，所有路由保护失效。

## 影响范围

```mermaid
graph TD
    subgraph Affected["受 Mock 影响的模块"]
        Middleware["Middleware<br/>跳过会话检查"]
        SupabaseServer["Supabase Server Client<br/>返回 Mock 客户端"]
        SupabaseBrowser["Supabase Browser Client<br/>返回 Mock 客户端"]
        SupabaseMW["Supabase Middleware<br/>返回 Mock 会话"]
    end

    subgraph NotAffected["不受影响"]
        SupabaseAdmin["Admin Client<br/>始终使用真实 Supabase<br/>(Mock 模式下不使用)"]
    end
```

## 使用场景

| 场景 | 说明 |
|------|------|
| 前端 UI 开发 | 无需后端即可开发调试 |
| 新人入门 | 克隆项目即可运行，零配置 |
| 演示/原型 | 快速展示 UI 效果 |
| 组件开发 | 隔离前端与后端依赖 |

## 退出 Mock 模式

1. 配置 Supabase 环境变量（`.env.local`）
2. 设置 `NEXT_PUBLIC_MOCK_ENABLED=false`（或移除该变量）
3. 重启开发服务器

```bash
# .env.local
NEXT_PUBLIC_MOCK_ENABLED=false
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```
