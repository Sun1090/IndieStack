# 数据库管理员 Agent

> 负责 IndieStack 项目的数据库设计、迁移管理和数据安全。

## 数据库架构

### 表结构

| 表名 | 描述 | RLS |
|------|------|-----|
| `profiles` | 用户档案，auth.users 触发器自动创建 | ✓ |
| `teams` | 团队，用户注册时自动创建个人团队 | ✓ |
| `team_members` | 团队成员关系 | ✓ |
| `subscriptions` | Stripe 订阅 | ✓ |
| `user_sessions` | 用户会话 | ✓ |
| `api_usage` | API 使用统计 | ✓ |
| `audit_logs` | 审计日志 | ✓ |
| `api_keys` | API 密钥管理 | ✓ |
| `team_invitations` | 团队邀请 | ✓ |

### 迁移管理

迁移文件位于 `supabase/migrations/`，使用时间戳前缀命名。

**当前迁移**:
| 文件 | 行数 | 内容 |
|------|------|------|
| `001_initial_schema.sql` | 234 | 基础表结构、RLS、触发器 |
| `002_rbac_audit.sql` | 189 | RBAC 权限系统、审计日志 |
| `003_projects_notifications_indexes.sql` | 173 | 项目、通知、索引 |

### 迁移开发流程

```bash
# 1. 创建新的迁移文件
touch supabase/migrations/004_your_feature.sql

# 2. 本地测试迁移
npx supabase db reset

# 3. 应用迁移
pnpm db:migrate

# 4. 生成 TypeScript 类型
pnpm db:types

# 5. 填充种子数据
pnpm db:seed
```

### 查询模式

```typescript
// .single() 查询时做类型转换以处理 RLS 类型问题
const { data: item } = await supabase
  .from("table")
  .select("*")
  .eq("id", id)
  .single() as unknown as { data: T | null; error: null };
```

### 种子数据

种子文件 `supabase/seed.sql` 包含本地开发用的示例数据。
注意：生产环境需要通过 Supabase Auth 注册用户，而非手动插入 `auth.users`。

### 数据类型

数据库类型定义在 `src/lib/supabase/database.types.ts`，通过 `pnpm db:types` 从数据库生成。

### 安全原则

1. 所有表启用 RLS
2. 用户注册时通过数据库触发器自动创建 profile + personal team
3. Service Role（`supabase/admin.ts`）仅在受信任的 Server 端使用（如 Stripe webhook）
4. 敏感操作写入 `audit_logs` 表
