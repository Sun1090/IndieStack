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
  MOCK_USER_ID,
  MOCK_TEAM_ID,
} from "./data";

// =============================================================================
// Mock 模式检测
// =============================================================================

/** 是否启用 Mock 模式 */
export const isMockEnabled =
  process.env.NEXT_PUBLIC_MOCK_ENABLED === "true" ||
  !process.env.NEXT_PUBLIC_SUPABASE_URL;

/** 当 Supabase 未配置时，自动启用 Mock 模式 */
export function shouldUseMock(): boolean {
  return isMockEnabled;
}

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

/** 重置缓存的 mock 数据（可用于测试或刷新） */
export function resetMockCache() {
  _mockUser = null;
  _mockProfile = null;
  _mockTeam = null;
  _mockMembers = null;
  _mockProjects = null;
  _mockNotifications = null;
  _mockAuditLogs = null;
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

  constructor(table: string, columns = "*") {
    this.table = table;
    this.columns = columns;
  }

  /** 过滤条件 eq */
  eq(column: string, value: unknown) {
    this.filters[column] = value;
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
    return { data: values, error: null };
  }

  /** 更新 update */
  update(values: Record<string, unknown>) {
    return { data: values, error: null };
  }

  /** 删除 delete */
  delete() {
    return { data: null, error: null };
  }

  /** thenable — 支持 await builder 直接获取 { data, error } */
  then<TResult1 = { data: unknown; count?: number; error: unknown }, TResult2 = never>(
    onFulfilled:
      | ((value: { data: unknown; count?: number; error: unknown }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
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
    switch (this.table) {
      case "profiles": {
        const list = [getMockProfile(), ...Array.from({ length: 9 }, () => generateMockProfile())];
        return this.applyFiltersAndPagination(list);
      }
      case "teams":
        return getMockTeam();
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
