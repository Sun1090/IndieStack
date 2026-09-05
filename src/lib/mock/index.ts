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

// Mock 模式检测逻辑抽离至零依赖的 config 模块（供 Edge Middleware 引用），此处转发保持兼容
export { isMockEnabled, shouldUseMock } from "./config";

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
let _mockProfiles: ReturnType<typeof generateMockProfile>[] | null = null;
let _mockTeams: ReturnType<typeof generateMockTeam>[] | null = null;
let _mockMembers: ReturnType<typeof generateMockTeamMembersWithProfiles> | null = null;
let _mockProjects: ReturnType<typeof generateMockProjects> | null = null;
let _mockNotifications: ReturnType<typeof generateMockNotifications> | null = null;
let _mockAuditLogs: ReturnType<typeof generateMockAuditLogs> | null = null;
let _mockApiUsage: ReturnType<typeof generateMockApiUsageRows> | null = null;
let _mockUserSessions: ReturnType<typeof generateMockUserSessions> | null = null;
let _mockApiKeys: ReturnType<typeof generateMockApiKeys> | null = null;
let _mockWorkerRuns: Record<string, unknown>[] | null = null;
let _mockMarketingSubscriptions: Record<string, unknown>[] | null = null;

/** 重置缓存的 mock 数据（可用于测试或刷新） */
export function resetMockCache() {
  _mockUser = null;
  _mockProfile = null;
  _mockTeam = null;
  _mockProfiles = null;
  _mockTeams = null;
  _mockMembers = null;
  _mockProjects = null;
  _mockNotifications = null;
  _mockAuditLogs = null;
  _mockApiUsage = null;
  _mockUserSessions = null;
  _mockApiKeys = null;
  _mockWorkerRuns = null;
  _mockMarketingSubscriptions = null;
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

function getMockProfiles() {
  if (!_mockProfiles) {
    _mockProfiles = [getMockProfile(), ...Array.from({ length: 9 }, () => generateMockProfile())];
  }
  return _mockProfiles;
}

function getMockTeams() {
  if (!_mockTeams) _mockTeams = [getMockTeam()];
  return _mockTeams;
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

function getMockWorkerRuns() {
  if (!_mockWorkerRuns) _mockWorkerRuns = [];
  return _mockWorkerRuns;
}

function getMockMarketingSubscriptions() {
  if (!_mockMarketingSubscriptions) _mockMarketingSubscriptions = [];
  return _mockMarketingSubscriptions;
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
  private head = false;
  private selected = false;
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

  /** 过滤条件 lt */
  lt(column: string, value: unknown) {
    this.filters[`${column}:lt`] = value;
    return this;
  }

  /** JSON 字段包含值（metadata->>key / metadata->key） */
  contains(column: string, value: unknown) {
    this.filters[`${column}:contains`] = value;
    return this;
  }

  /** 取反过滤器：后续条件挂到 :not 命名空间（如 metadata->>email_attempts.is.null） */
  not(column: string, value: unknown) {
    this.filters[`${column}:not`] = value;
    return this;
  }

  /**
   * or 过滤器：接收形如 `metadata->>email_attempts.is.null,metadata->>email_attempts.lt.3`
   * 的逗号分隔条件串；`:is.` 表示字段为空（null/undefined），`:lt.` 表示数值小于。
   * 满足任一条件即保留该行。
   */
  or(conditions: string) {
    this.filters[":or"] = conditions;
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
  select(
    columns?: string | Record<string, unknown>,
    opts?: { count?: "exact" | "planned" | "estimated"; head?: boolean },
  ) {
    // 记录列选择：嵌套关联（profiles:user_id (...)/teams!inner(...)）依赖此信息
    if (columns !== undefined) {
      this.columns = typeof columns === "string" ? columns : "*";
    }
    this.getCount = opts?.count ?? null;
    this.head = opts?.head ?? false;
    this.selected = true;
    return this;
  }

  /** 插入 insert */
  insert(values: unknown) {
    this.writeMode = "insert";
    this.writeValue = values;
    // 将插入数据持久化到对应缓存列表（teams/projects/api_keys/team_members 等），
    // 使创建后列表/详情立即可见，与真实 PostgREST 行为一致
    this.persistInsert();
    return this;
  }

  /** 更新 update（延迟到 then/single 执行，配合 eq/in 过滤器只更新匹配行） */
  update(values: Record<string, unknown>) {
    this.writeMode = "update";
    this.writeValue = values;
    return this;
  }

  /** 删除 delete */
  delete() {
    this.writeMode = "delete";
    return this;
  }

  /**
   * upsert：依据 onConflict 指定列查重，存在则更新、不存在则插入。
   * mock 层实现：先按 conflict 字段过滤列表，命中的行用 writeValue 更新；
   * 否则按 insert 路径追加。options.onConflict 仅字符串形式支持（如 "user_id"）。
   */
  upsert(values: Record<string, unknown>, options?: { onConflict?: string }) {
    const list = this.getWriteList();
    const conflictCol = options?.onConflict ?? "id";
    if (list) {
      const matched = list.filter((r) => {
        const row = r as Record<string, unknown>;
        return row[conflictCol] !== undefined && row[conflictCol] === values[conflictCol];
      });
      if (matched.length > 0) {
        this.writeMode = "update";
        this.writeValue = values;
        // 强制按 conflict 列过滤，避免前面挂的 eq/in 干扰
        this.filters = { [conflictCol]: values[conflictCol] };
        return this;
      }
    }
    // 不存在匹配行 → 走 insert 路径
    this.writeMode = "insert";
    this.writeValue = values;
    this.persistInsert();
    return this;
  }

  /**
   * is：列值等于 null/undefined（PostgREST 用于 NULL 判定，区别于 eq）。
   * 行字段为 null/undefined 或缺失视为匹配。
   */
  is(column: string, value: unknown) {
    if (value !== null && value !== undefined) {
      // mock 暂只实现 is(col, null) 这条真实路径；非 null 用 :eq 退路
      this.filters[column] = value;
    } else {
      this.filters[`${column}:isnull`] = true;
    }
    return this;
  }

  /** thenable — 支持 await builder 直接获取 { data, error } */
  then<TResult1 = { data: unknown; count?: number; error: unknown }, TResult2 = never>(
    onFulfilled:
      | ((value: {
          data: unknown;
          count?: number;
          error: unknown;
        }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    if (this.writeMode === "delete") {
      this.applyDelete();
      return Promise.resolve(
        onFulfilled
          ? onFulfilled({ data: null, error: null })
          : ({ data: null, error: null } as unknown as TResult1),
      );
    }

    if (this.writeMode === "insert") {
      const value = this.writeValue;
      if (this.getCount === "exact") {
        const count = Array.isArray(value) ? value.length : 1;
        return Promise.resolve(
          onFulfilled
            ? onFulfilled({ data: value, count, error: null })
            : ({ data: value, count, error: null } as unknown as TResult1),
        );
      }
      return Promise.resolve(
        onFulfilled
          ? onFulfilled({ data: value, error: null })
          : ({ data: value, error: null } as unknown as TResult1),
      );
    }

    if (this.writeMode === "update") {
      const rows = this.applyUpdate();
      if (this.getCount === "exact") {
        return Promise.resolve(
          onFulfilled
            ? onFulfilled({ data: rows, count: rows.length, error: null })
            : ({ data: rows, count: rows.length, error: null } as unknown as TResult1),
        );
      }
      if (this.selected) {
        return Promise.resolve(
          onFulfilled
            ? onFulfilled({ data: rows, error: null })
            : ({ data: rows, error: null } as unknown as TResult1),
        );
      }
      return Promise.resolve(
        onFulfilled
          ? onFulfilled({ data: null, error: null })
          : ({ data: null, error: null } as unknown as TResult1),
      );
    }

    const data = this.getData();
    if (this.getCount === "exact") {
      const count = Array.isArray(data) ? data.length : 1;
      // head: true 与真实 PostgREST 一致：只返回 count，不返回数据行
      const payload = this.head
        ? { data: [] as unknown[], count, error: null }
        : { data, count, error: null };
      return Promise.resolve(onFulfilled ? onFulfilled(payload) : (payload as unknown as TResult1));
    }
    return Promise.resolve(
      onFulfilled
        ? onFulfilled({ data, error: null })
        : ({ data, error: null } as unknown as TResult1),
    );
  }

  /** 获取 mock 数据 */
  private getData() {
    if (this.writeMode === "insert") {
      return Array.isArray(this.writeValue) ? this.writeValue : [this.writeValue];
    }
    if (this.writeMode === "update") {
      return this.applyUpdate();
    }
    if (this.writeMode === "delete") {
      this.applyDelete();
      return [];
    }
    switch (this.table) {
      case "profiles":
        return this.applyFiltersAndPagination(getMockProfiles());
      case "teams":
        // 以数组形式返回并应用过滤，使列表/详情查询与真实 PostgREST 行为一致
        return this.applyFiltersAndPagination(getMockTeams());
      case "team_members": {
        const members = getMockMembers();
        return this.applyFiltersAndPagination(
          this.applyRelationships(members as Record<string, unknown>[]),
        );
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
      case "email_worker_runs":
        return this.applyFiltersAndPagination(getMockWorkerRuns());
      case "marketing_subscriptions":
        return this.applyFiltersAndPagination(getMockMarketingSubscriptions());
      default:
        return [];
    }
  }

  /** 将插入数据规范化并写入缓存列表（保留数组引用，读取可见） */
  private persistInsert(): void {
    const list = this.getWriteList();
    const values = Array.isArray(this.writeValue) ? this.writeValue : [this.writeValue];
    if (!Array.isArray(values)) return;
    const now = new Date().toISOString();
    const normalized = values.map((value) => {
      const row = { ...(value as Record<string, unknown>) } as Record<string, unknown>;
      if (!row.id) row.id = crypto.randomUUID();
      if (!row.created_at) row.created_at = now;
      if (row.updated_at === undefined) row.updated_at = now;
      if (this.table === "api_keys" && row.is_active === undefined) row.is_active = true;
      return row;
    });
    // 让 then()/single() 返回规范化后的行（含生成的 id/created_at）
    this.writeValue = Array.isArray(this.writeValue) ? normalized : normalized[0];
    if (list) list.unshift(...normalized);
  }

  /**
   * 解析 select 中的嵌套关联（如 profiles:user_id (...) / teams!inner(...)），
   * 为每行附加关联数据；inner join 找不到关联时过滤该行。
   */
  private applyRelationships(rows: Record<string, unknown>[]): Record<string, unknown>[] {
    const relPattern =
      /([A-Za-z_][A-Za-z0-9_]*)(?::([A-Za-z_][A-Za-z0-9_]*))?(?:!([A-Za-z]+))?\s*\(([^)]*)\)/g;
    let match: RegExpExecArray | null;
    const rels: { alias: string; fk: string | null; inner: boolean }[] = [];
    while ((match = relPattern.exec(this.columns)) !== null) {
      rels.push({ alias: match[1], fk: match[2] ?? null, inner: match[3] === "inner" });
    }
    if (rels.length === 0) return rows;

    const profiles = getMockProfiles() as Array<Record<string, unknown>>;
    const teams = getMockTeams() as Array<Record<string, unknown>>;
    const result: Record<string, unknown>[] = [];

    for (const row of rows) {
      const enriched: Record<string, unknown> = { ...row };
      let drop = false;
      for (const rel of rels) {
        // 行已内嵌关联（如 team_members 生成时自带 profiles）则保留，不重复覆盖
        if (enriched[rel.alias] !== undefined) continue;
        const fk = rel.fk ?? (rel.alias === "teams" || rel.alias === "team" ? "team_id" : null);
        if (!fk) continue;
        const fkValue = row[fk];
        let related: Record<string, unknown> | null = null;
        if (rel.alias === "profiles" && fk === "user_id") {
          related = profiles.find((p) => p.id === fkValue) ?? null;
        } else if (rel.alias === "teams" || rel.alias === "team") {
          related = teams.find((tm) => tm.id === fkValue) ?? null;
        }
        if (rel.inner && !related) {
          drop = true;
          break;
        }
        enriched[rel.alias] = related;
      }
      if (!drop) result.push(enriched);
    }
    return result;
  }

  /** 行是否匹配当前 eq/in 过滤器（写操作专用） */
  private matchesFilters(row: Record<string, unknown>): boolean {
    // 主键/外键等高频字段保持原分支（兼容值为空串/0 的场景）
    if (this.filters["id"] !== undefined && row["id"] !== this.filters["id"]) return false;
    if (this.filters["user_id"] !== undefined && row["user_id"] !== this.filters["user_id"])
      return false;
    if (this.filters["team_id"] !== undefined && row["team_id"] !== this.filters["team_id"])
      return false;
    for (const [key, value] of Object.entries(this.filters)) {
      if (key.endsWith(":in")) {
        const column = key.slice(0, -3);
        if (!(value as unknown[]).includes(row[column])) return false;
        continue;
      }
      if (key.endsWith(":gte") || key.endsWith(":lt") || key.endsWith(":contains") || key.endsWith(":not") || key === ":or") continue;
      if (key.endsWith(":isnull")) continue;
      // 通用 eq 过滤（如 email），与真实 PostgREST 行为一致
      if (key === "id" || key === "user_id" || key === "team_id") continue;
      if (row[key] !== value) return false;
    }
    return true;
  }

  /** 可写的缓存列表（与读取共用同一份引用，保证写操作持久可见） */
  private getWriteList(): unknown[] | null {
    switch (this.table) {
      case "api_keys":
        return getMockApiKeys();
      case "profiles":
        return getMockProfiles();
      case "teams":
        return getMockTeams();
      case "team_members":
        return getMockMembers();
      case "notifications":
        return getMockNotifications();
      case "audit_logs":
        return getMockAuditLogs();
      case "projects":
        return getMockProjects();
      case "api_usage":
        return getMockApiUsage();
      case "user_sessions":
        return getMockUserSessions();
      case "email_worker_runs":
        return getMockWorkerRuns();
      case "marketing_subscriptions":
        return getMockMarketingSubscriptions();
      default:
        return null;
    }
  }

  /** 应用 update：只修改匹配过滤器的行，返回被更新的行 */
  private applyUpdate(): unknown[] {
    const list = this.getWriteList();
    if (!list) return [];
    const rows = list.filter((row) => this.matchesFilters(row as Record<string, unknown>));
    for (const row of rows) {
      Object.assign(row as Record<string, unknown>, this.writeValue);
    }
    return rows;
  }

  /** 应用 delete：从缓存列表中移除匹配过滤器的行（保留数组引用） */
  private applyDelete(): void {
    const list = this.getWriteList();
    if (!list) return;
    const kept = list.filter((row) => !this.matchesFilters(row as Record<string, unknown>));
    list.splice(0, list.length, ...kept);
  }

  private applyFiltersAndPagination(data: unknown[]): unknown[] {
    let result = [...data];

    // 如果传入了 user_id 过滤，返回匹配的数据
    if (this.filters["user_id"]) {
      result = result.filter((item: any) => item.user_id === this.filters["user_id"]);
    }
    if (this.filters["id"]) {
      result = result.filter((item: any) => item.id === this.filters["id"]);
    }
    if (this.filters["team_id"]) {
      result = result.filter((item: any) => item.team_id === this.filters["team_id"]);
    }
    // 通用 eq 过滤（如 email），与真实 PostgREST 行为一致；id/user_id/team_id 已在上面分支处理
    for (const [key, value] of Object.entries(this.filters)) {
      if (
        key.endsWith(":in") ||
        key.endsWith(":gte") ||
        key.endsWith(":lt") ||
        key.endsWith(":contains") ||
        key.endsWith(":not") ||
        key === ":or"
      ) {
        continue;
      }
      if (key === "id" || key === "user_id" || key === "team_id") continue;
      result = result.filter((item: any) => this.matchValue(item[key], value));
    }
    Object.entries(this.filters).forEach(([key, value]) => {
      if (key.endsWith(":in")) {
        const column = key.slice(0, -3);
        const values = value as unknown[];
        result = result.filter((item: any) => values.includes(item[column]));
        return;
      }
      if (key.endsWith(":gte")) {
        const column = key.slice(0, -4);
        result = result.filter(
          (item: any) => Number(this.readPath(item, column)) >= Number(this.matchValue(value, value)),
        );
        return;
      }
      if (key.endsWith(":lt")) {
        const column = key.slice(0, -3);
        result = result.filter(
          (item: any) => Number(this.readPath(item, column)) < Number(this.matchValue(value, value)),
        );
        return;
      }
      if (key.endsWith(":contains")) {
        const column = key.slice(0, -9);
        const needle = String(value);
        result = result.filter((item: any) => {
          const current = this.readPath(item, column);
          if (current === null || current === undefined) return false;
          return typeof current === "string" ? current.includes(needle) : JSON.stringify(current).includes(needle);
        });
        return;
      }
      if (key.endsWith(":not")) {
        const column = key.slice(0, -4);
        result = result.filter((item: any) => !this.matchValue(this.readPath(item, column), value));
        return;
      }
      if (key === ":or") {
        const conditions = String(value).split(",").map((c) => c.trim());
        result = result.filter((item: any) => this.matchAnyCondition(item, conditions));
        return;
      }
      if (key.endsWith(":isnull")) {
        const column = key.slice(0, -7);
        result = result.filter((item: any) => item[column] === null || item[column] === undefined);
        return;
      }
    });

    // 排序
    if (this.orderColumn) {
      result.sort((a: any, b: any) => {
        const valA = a[this.orderColumn!];
        const valB = b[this.orderColumn!];
        if (typeof valA === "string") {
          return this.orderAscending ? valA.localeCompare(valB) : valB.localeCompare(valA);
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

  /** 解析 JSON 路径：metadata->>email_attempts → metadata 对象中取 email_attempts */
  private readPath(row: Record<string, unknown>, path: string): unknown {
    const parts = path.split("->");
    let current: unknown = row;
    for (const part of parts) {
      const key = part.replace(/^>/, "");
      if (current === null || current === undefined) return undefined;
      if (typeof current !== "object") return undefined;
      current = (current as Record<string, unknown>)[key];
    }
    return current;
  }

  /** 值比较：数值字符串按数值比较（metadata.email_attempts 场景），其余严格等值 */
  private matchValue(current: unknown, expected: unknown): boolean {
    if (current === expected) return true;
    if (
      typeof current === "number" &&
      typeof expected === "string" &&
      expected.trim() !== "" &&
      !Number.isNaN(Number(expected))
    ) {
      return current === Number(expected);
    }
    if (
      typeof current === "string" &&
      current.trim() !== "" &&
      !Number.isNaN(Number(current)) &&
      typeof expected === "number"
    ) {
      return Number(current) === expected;
    }
    return false;
  }

  /** 解析 or 条件：`col.is.null`（字段为空）或 `col.lt.3`（数值小于） */
  private matchAnyCondition(item: Record<string, unknown>, conditions: string[]): boolean {
    for (const condition of conditions) {
      if (!condition) continue;
      const idx = condition.indexOf(".");
      if (idx === -1) continue;
      const column = condition.slice(0, idx);
      const rest = condition.slice(idx + 1);
      const segIdx = rest.indexOf(".");
      const op = segIdx === -1 ? rest : rest.slice(0, segIdx);
      const value = segIdx === -1 ? "" : rest.slice(segIdx + 1);
      const current = this.readPath(item, column);
      if (op === "is" && value === "null") {
        if (current === null || current === undefined) return true;
        continue;
      }
      if (op === "lt") {
        if (this.matchValue(current, value) && Number(current) < Number(value)) return true;
        if (typeof current === "number" && typeof value === "string" && current < Number(value)) return true;
        continue;
      }
      if (this.matchValue(current, value)) return true;
    }
    return false;
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
    // MFA（Mock：返回固定的测试 factor 与验证码通过）
    mfa: {
      enroll: async (_params: unknown) => ({
        data: {
          id: "mock-factor-id",
          type: "totp",
          totp: { qr_code: "", secret: "MOCKSECRET" },
        },
        error: null,
      }),
      challengeAndVerify: async (_params: unknown) => ({ error: null }),
      challenge: async (_params: unknown) => ({
        data: { id: "mock-challenge-id", expires_at: 9999999999 },
        error: null,
      }),
      verify: async (_params: unknown) => ({ error: null }),
      listFactors: async () => ({
        data: {
          all: [
            {
              id: "mock-factor-id",
              type: "totp" as const,
              status: "verified" as const,
              friendly_name: "",
              created_at: new Date().toISOString(),
            },
          ],
          totp: [
            {
              id: "mock-factor-id",
              type: "totp" as const,
              status: "verified" as const,
              friendly_name: "",
              created_at: new Date().toISOString(),
            },
          ],
        },
        error: null,
      }),
      unenroll: async (_params: unknown) => ({ data: { id: "mock-factor-id" }, error: null }),
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
