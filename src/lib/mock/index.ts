/**
 * Mock 系统入口
 * 提供 Mock 模式检测、Mock Supabase 客户端
 * 当 NEXT_PUBLIC_MOCK_ENABLED=true 或 Supabase 未配置时启用
 */

import {
  generateMockUser,
  generateMockSession,
  generateMockProfile,
  generateMockTeam,
  generateMockTeamMembersWithProfiles,
  generateMockProjects,
  generateMockNotifications,
  generateMockAuditLogs,
  generateMockApiUsageRows,
  generateMockUserSessions,
  generateMockApiKeys,
  generateMockAdminStats,
  MOCK_USER_ID,
  MOCK_TEAM_ID,
} from "./data";

// =============================================================================
// Mock 模式检测
// =============================================================================

/** 是否启用 Mock 模式 */
export const isMockEnabled =
  process.env.NEXT_PUBLIC_MOCK_ENABLED === "true" ||
  // 仅在非生产环境：Supabase 未配置时自动启用 Mock（避免生产环境误配时静默绕过认证）
  (process.env.NODE_ENV !== "production" && !process.env.NEXT_PUBLIC_SUPABASE_URL);

/** 当 Supabase 未配置时，自动启用 Mock 模式 */
export function shouldUseMock(): boolean {
  return isMockEnabled;
}

export { generateMockAdminStats };

// =============================================================================
// Mock Supabase 客户端
// =============================================================================

/**
 * 创建一个 Mock Supabase 客户端
 * 模拟 Supabase 的 auth 和 query 接口
 * 所有数据来自 @faker-js/faker 生成的随机数据
 */
export function createMockSupabaseClient() {
  const mock = new MockSupabaseClient();
  return mock;
}

/**
 * 内部状态：缓存生成的 mock 数据，在一次请求内保持一致
 */
let _mockUser: ReturnType<typeof generateMockUser> | null = null;
let _mockProfile: ReturnType<typeof generateMockProfile> | null = null;
let _mockTeam: ReturnType<typeof generateMockTeam> | null = null;
let _mockMembers: ReturnType<typeof generateMockTeamMembersWithProfiles> | null = null;
let _mockProjects: ReturnType<typeof generateMockProjects> | null = null;
let _mockNotifications: ReturnType<typeof generateMockNotifications> | null = null;
let _mockAuditLogs: ReturnType<typeof generateMockAuditLogs> | null = null;
let _mockApiUsage: ReturnType<typeof generateMockApiUsageRows> | null = null;
let _mockUserSessions: ReturnType<typeof generateMockUserSessions> | null = null;
let _mockApiKeys: ReturnType<typeof generateMockApiKeys> | null = null;

/** 重置缓存的 mock 数据（可用于测试或刷新） */
export function resetMockCache() {
  _mockUser = null;
  _mockProfile = null;
  _mockTeam = null;
  _mockMembers = null;
  _mockProjects = null;
  _mockNotifications = null;
  _mockAuditLogs = null;
  _mockApiUsage = null;
  _mockUserSessions = null;
  _mockApiKeys = null;
}

function getMockUser() {
  if (!_mockUser) _mockUser = generateMockUser();
  return _mockUser;
}

function getMockProfile() {
  if (!_mockProfile) _mockProfile = generateMockProfile();
  return _mockProfile;
}

function getMockTeam() {
  if (!_mockTeam) _mockTeam = generateMockTeam();
  return _mockTeam;
}

function getMockMembers() {
  if (!_mockMembers) _mockMembers = generateMockTeamMembersWithProfiles();
  return _mockMembers;
}

function getMockProjects() {
  if (!_mockProjects) _mockProjects = generateMockProjects();
  return _mockProjects;
}

function getMockNotifications() {
  if (!_mockNotifications) _mockNotifications = generateMockNotifications();
  return _mockNotifications;
}

function getMockAuditLogs() {
  if (!_mockAuditLogs) _mockAuditLogs = generateMockAuditLogs();
  return _mockAuditLogs;
}

function getMockApiUsage() {
  if (!_mockApiUsage) _mockApiUsage = generateMockApiUsageRows();
  return _mockApiUsage;
}

function getMockUserSessions() {
  if (!_mockUserSessions) _mockUserSessions = generateMockUserSessions();
  return _mockUserSessions;
}

function getMockApiKeys() {
  if (!_mockApiKeys) _mockApiKeys = generateMockApiKeys();
  return _mockApiKeys;
}

/**
 * Mock 查询构建器
 * 模拟 Supabase PostgREST 查询链
 */
class MockQueryBuilder {
  private table: string;
  private columns: string;
  private filters: Record<string, unknown> = {};
  private limitCount: number | null = null;
  private orderColumn: string | null = null;
  private orderAscending = true;
  private rangeStart = 0;
  private rangeEnd = 0;
  private useRange = false;
  private getCount: "exact" | "planned" | "estimated" | null = null;
  private writeMode: "insert" | "update" | "delete" | null = null;
  private writeValue: unknown = null;

  constructor(table: string, columns = "*") {
    this.table = table;
    this.columns = columns;
  }

  /** 过滤条件 eq */
  eq(column: string, value: unknown) {
    this.filters[column] = value;
    return this;
  }

  /** 过滤条件 in */
  in(column: string, values: unknown[]) {
    this.filters[`${column}:in`] = values;
    return this;
  }

  /** 过滤条件 gte */
  gte(column: string, value: unknown) {
    this.filters[`${column}:gte`] = value;
    return this;
  }

  /** 排序 order */
  order(column: string, opts?: { ascending?: boolean }) {
    this.orderColumn = column;
    this.orderAscending = opts?.ascending ?? true;
    return this;
  }

  /** 分页 range */
  range(start: number, end: number) {
    this.useRange = true;
    this.rangeStart = start;
    this.rangeEnd = end;
    return this;
  }

  /** 限制 limit */
  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  /** 单条 single */
  async single() {
    const data = this.getData();
    if (Array.isArray(data)) {
      return { data: data[0] ?? null, error: null };
    }
    return { data, error: null };
  }
  /** 单条 maybeSingle（与 single 类似，但允许 0 行时返回 null 而非报错） */
  async maybeSingle() {
    const data = this.getData();
    if (Array.isArray(data)) {
      return { data: data[0] ?? null, error: null };
    }
    return { data, error: null };
  }

  /** 查询 select — 返回 this（链式构建器），与真实 Supabase 行为一致 */
  select(columns?: string | Record<string, unknown>, opts?: { count?: "exact" | "planned" | "estimated" }) {
    this.getCount = opts?.count ?? null;
    return this;
  }

  /** 插入 insert */
  insert(values: unknown) {
    this.writeMode = "insert";
    this.writeValue = values;
    // api_keys：将新密钥追加到缓存列表，使创建后列表立即可见
    if (this.table === "api_keys" && values && typeof values === "object") {
      const row = { ...(values as Record<string, unknown>) } as Record<string, unknown>;
      if (!row.id) row.id = crypto.randomUUID();
      if (!row.created_at) row.created_at = new Date().toISOString();
      if (!row.updated_at) row.updated_at = new Date().toISOString();
      if (!row.is_active) row.is_active = true;
      getMockApiKeys().unshift(row as never);
    }
    return this;
  }

  /** 更新 update */
  update(values: Record<string, unknown>) {
    this.writeMode = "update";
    this.writeValue = values;
    // api_keys：支持吊销（is_active=false）等更新在列表中生效
    if (this.table === "api_keys") {
      for (const row of getMockApiKeys()) {
        for (const [key, value] of Object.entries(values)) {
          (row as Record<string, unknown>)[key] = value;
        }
        (row as Record<string, unknown>).updated_at = new Date().toISOString();
      }
    }
    return this;
  }

  /** 删除 delete */
  delete() {
    this.writeMode = "delete";
    return this;
  }

  /** thenable — 支持 await builder 直接获取 { data, error } */
  then<TResult1 = { data: unknown; count?: number; error: unknown }, TResult2 = never>(
    onFulfilled:
      | ((value: { data: unknown; count?: number; error: unknown }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    if (this.writeMode === "delete") {
      return Promise.resolve(
        onFulfilled ? onFulfilled({ data: null, error: null }) : ({ data: null, error: null } as unknown as TResult1),
      );
    }

    if (this.writeMode === "insert" || this.writeMode === "update") {
      const value = this.writeValue;
      if (this.getCount === "exact") {
        const count = Array.isArray(value) ? value.length : 1;
        return Promise.resolve(
          onFulfilled ? onFulfilled({ data: value, count, error: null }) : ({ data: value, count, error: null } as unknown as TResult1),
        );
      }
      return Promise.resolve(
        onFulfilled ? onFulfilled({ data: value, error: null }) : ({ data: value, error: null } as unknown as TResult1),
      );
    }

    const data = this.getData();
    if (this.getCount === "exact") {
      const count = Array.isArray(data) ? data.length : 1;
      return Promise.resolve(
        onFulfilled ? onFulfilled({ data, count, error: null }) : ({ data, count, error: null } as unknown as TResult1),
      );
    }
    return Promise.resolve(
      onFulfilled ? onFulfilled({ data, error: null }) : ({ data, error: null } as unknown as TResult1),
    );
  }

  /** 获取 mock 数据 */
  private getData() {
    if (this.writeMode === "insert" || this.writeMode === "update") {
      return Array.isArray(this.writeValue) ? this.writeValue : [this.writeValue];
    }
    switch (this.table) {
      case "profiles": {
        const list = [getMockProfile(), ...Array.from({ length: 9 }, () => generateMockProfile())];
        return this.applyFiltersAndPagination(list);
      }
      case "teams":
        // 以数组形式返回并应用过滤，使列表/详情查询与真实 PostgREST 行为一致
        return this.applyFiltersAndPagination([getMockTeam()]);
      case "team_members": {
        const members = getMockMembers();
        return this.applyFiltersAndPagination(members);
      }
      case "team_members_with_profiles":
        return getMockMembers();
      case "notifications":
        return this.applyFiltersAndPagination(getMockNotifications());
      case "audit_logs":
        return this.applyFiltersAndPagination(getMockAuditLogs());
      case "projects":
        return this.applyFiltersAndPagination(getMockProjects());
      case "api_usage":
        return this.applyFiltersAndPagination(getMockApiUsage());
      case "user_sessions":
        return this.applyFiltersAndPagination(getMockUserSessions());
      case "api_keys":
        return this.applyFiltersAndPagination(getMockApiKeys());
      case "subscriptions":
        return { id: "mock-sub-001", team_id: MOCK_TEAM_ID, plan: "pro", status: "active" };
      default:
        return [];
    }
  }

  private applyFiltersAndPagination(data: unknown[]): unknown[] {
    let result = [...data];

    // 如果传入了 user_id 过滤，返回匹配的数据
    if (this.filters["user_id"]) {
      result = result.filter((item: any) =>
        item.user_id === this.filters["user_id"]
      );
    }
    if (this.filters["id"]) {
      result = result.filter((item: any) =>
        item.id === this.filters["id"]
      );
    }
    if (this.filters["team_id"]) {
      result = result.filter((item: any) =>
        item.team_id === this.filters["team_id"]
      );
    }
    Object.entries(this.filters).forEach(([key, value]) => {
      if (key.endsWith(":in")) {
        const column = key.slice(0, -3);
        const values = value as unknown[];
        result = result.filter((item: any) => values.includes(item[column]));
        return;
      }
      if (!key.endsWith(":gte")) return;
      const column = key.slice(0, -4);
      result = result.filter((item: any) => new Date(item[column]) >= new Date(value as string));
    });

    // 排序
    if (this.orderColumn) {
      result.sort((a: any, b: any) => {
        const valA = a[this.orderColumn!];
        const valB = b[this.orderColumn!];
        if (typeof valA === "string") {
          return this.orderAscending
            ? valA.localeCompare(valB)
            : valB.localeCompare(valA);
        }
        return this.orderAscending ? valA - valB : valB - valA;
      });
    }

    // limit
    if (this.limitCount !== null) {
      result = result.slice(0, this.limitCount);
    }

    // range
    if (this.useRange) {
      result = result.slice(this.rangeStart, this.rangeEnd + 1);
    }

    return result;
  }
}

/**
 * Mock Supabase 客户端类
 * 实现 createBrowserClient / createServerClient 的核心接口
 */
export class MockSupabaseClient {
  auth = {
    getUser: async () => {
      const user = getMockUser();
      return { data: { user }, error: null };
    },
    getSession: async () => {
      const session = generateMockSession();
      return { data: { session }, error: null };
    },
    signOut: async () => {
      return { error: null };
    },
    signUp: async () => {
      return { data: { user: getMockUser(), session: generateMockSession() }, error: null };
    },
    signInWithPassword: async () => {
      return { data: { user: getMockUser(), session: generateMockSession() }, error: null };
    },
    signInWithOAuth: async () => {
      return { data: { provider: "github", url: "http://localhost:3000" }, error: null };
    },
    resetPasswordForEmail: async () => {
      return { data: {}, error: null };
    },
    updateUser: async (attrs: Record<string, unknown>) => {
      return { data: { user: { ...getMockUser(), ...attrs } }, error: null };
    },
    onAuthStateChange: () => {
      return {
        data: { subscription: { unsubscribe: () => {} } },
      };
    },
    // 管理接口：供 createAdminClient() 在 Mock 模式下使用
    admin: {
      listUsers: async () => {
        const user = getMockUser();
        const others = Array.from({ length: 9 }, () => generateMockUser());
        return { data: { users: [user, ...others] }, error: null };
      },
      deleteUser: async () => {
        return { data: { user: getMockUser() }, error: null };
      },
    },
  };

  from(table: string) {
    return new MockQueryBuilder(table);
  }

  channel() {
    return {
      on: () => ({ subscribe: () => {} }),
      subscribe: () => {},
      unsubscribe: () => {},
    };
  }

  rpc() {
    return {
      then: (resolve: Function) => resolve({ data: null, error: null }),
    };
  }
}
