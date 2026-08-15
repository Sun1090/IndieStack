/**
 * Mock 数据层
 * 使用 @faker-js/faker 生成真实的开发环境模拟数据
 * 当 Supabase 未配置或 NEXT_PUBLIC_MOCK_ENABLED=true 时使用
 */
import { faker } from "@faker-js/faker/locale/zh_CN";

/** 固定的 mock 用户 ID（便于调试） */
export const MOCK_USER_ID = "mock-user-001";
export const MOCK_TEAM_ID = "mock-team-001";
export const MOCK_TEAM_MEMBER_ID = "mock-member-001";

/**
 * 生成模拟用户信息
 */
export function generateMockUser() {
  return {
    id: MOCK_USER_ID,
    email: "dev@indiestack.local",
    user_metadata: {
      full_name: "开发者",
      avatar_url: null,
    },
    aud: "authenticated",
    role: "authenticated",
    app_metadata: {
      provider: "email",
    },
    created_at: new Date().toISOString(),
  };
}

/**
 * 生成模拟用户会话
 */
export function generateMockSession() {
  return {
    access_token: "mock-access-token",
    refresh_token: "mock-refresh-token",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: "bearer",
    user: generateMockUser(),
  };
}

/**
 * 生成模拟个人资料
 */
export function generateMockProfile(overrides?: Record<string, unknown>) {
  return {
    id: MOCK_USER_ID,
    email: "dev@indiestack.local",
    full_name: faker.person.fullName(),
    avatar_url: faker.image.avatar(),
    role: "admin",
    bio: faker.lorem.sentence(),
    timezone: "Asia/Shanghai",
    language: "zh",
    notification_settings: {
      email: true,
      push: true,
      marketing: false,
    },
    created_at: faker.date.past().toISOString(),
    updated_at: faker.date.recent().toISOString(),
    ...overrides,
  };
}

/**
 * 生成模拟团队
 */
export function generateMockTeam(overrides?: Record<string, unknown>) {
  return {
    id: MOCK_TEAM_ID,
    name: faker.company.name(),
    slug: faker.helpers.slugify(faker.company.name()).toLowerCase(),
    owner_id: MOCK_USER_ID,
    member_count: faker.number.int({ min: 1, max: 10 }),
    plan: faker.helpers.arrayElement(["free", "pro", "enterprise"]),
    created_at: faker.date.past().toISOString(),
    updated_at: faker.date.recent().toISOString(),
    ...overrides,
  };
}

/**
 * 生成模拟团队成员列表
 */
export function generateMockTeamMembers(count = 5) {
  return Array.from({ length: count }, (_, i) => ({
    id: `mock-member-${String(i + 1).padStart(3, "0")}`,
    team_id: MOCK_TEAM_ID,
    user_id: i === 0 ? MOCK_USER_ID : `mock-user-${String(i + 1).padStart(3, "0")}`,
    role:
      i === 0
        ? "owner"
        : i === 1
          ? "admin"
          : faker.helpers.arrayElement(["member", "viewer"]),
    invited_by: MOCK_USER_ID,
    created_at: faker.date.recent().toISOString(),
    profiles: {
      full_name: faker.person.fullName(),
      email: faker.internet.email(),
      avatar_url: faker.image.avatar(),
    },
  }));
}

/**
 * 生成模拟团队成员（含关联的 profiles）
 */
export function generateMockTeamMembersWithProfiles(count = 5) {
  return Array.from({ length: count }, (_, i) => ({
    id: `mock-member-${String(i + 1).padStart(3, "0")}`,
    team_id: MOCK_TEAM_ID,
    user_id: i === 0 ? MOCK_USER_ID : `mock-user-${String(i + 1).padStart(3, "0")}`,
    role:
      i === 0
        ? "owner"
        : i === 1
          ? "admin"
          : faker.helpers.arrayElement(["member", "viewer"]),
    invited_by: MOCK_USER_ID,
    created_at: faker.date.recent().toISOString(),
    profiles: {
      id: i === 0 ? MOCK_USER_ID : `mock-user-${String(i + 1).padStart(3, "0")}`,
      full_name: faker.person.fullName(),
      email: faker.internet.email(),
      avatar_url: faker.image.avatar(),
      role:
        i === 0
          ? "admin"
          : i === 1
            ? "admin"
            : "member",
    },
  }));
}

/**
 * 生成模拟项目列表
 */
export function generateMockProjects(count = 6) {
  const statuses = ["active", "draft", "maintenance"] as const;
  const branches = ["main", "staging", "develop", "feature/new-ui"] as const;
  return Array.from({ length: count }, (_, i) => ({
    id: `proj_${i + 1}`,
    team_id: MOCK_TEAM_ID,
    name: faker.helpers.arrayElement([
      "api-service",
      "web-app",
      "docs-site",
      "admin-panel",
      "mobile-api",
      "worker-01",
      "auth-service",
      "cdn-edge",
    ]),
    slug: `project-${i + 1}`,
    description: faker.company.catchPhrase(),
    status: statuses[faker.number.int({ min: 0, max: 2 })],
    visibility: "private",
    config: {
      branch: branches[faker.number.int({ min: 0, max: 3 })],
      domain: faker.internet.domainName(),
      framework: faker.helpers.arrayElement(["Next.js", "Remix", "Astro", "Express"]),
      region: faker.helpers.arrayElement(["us-east-1", "ap-southeast-1", "eu-central-1"]),
    },
    created_by: MOCK_USER_ID,
    lastDeployed: faker.date.recent().toISOString(),
    branch: branches[faker.number.int({ min: 0, max: 3 })],
    domain: faker.internet.domainName(),
    created_at: faker.date.recent({ days: 60 }).toISOString(),
    updated_at: faker.date.recent({ days: 7 }).toISOString(),
  }));
}

/**
 * 生成模拟通知列表
 */
export function generateMockNotifications(count = 8) {
  const types = ["info", "success", "warning", "error"] as const;
  return Array.from({ length: count }, (_, i) => ({
    id: `notif_${i + 1}`,
    user_id: MOCK_USER_ID,
    title: faker.helpers.arrayElement([
      "部署成功",
      "新成员加入",
      "API 调用超限",
      "账单即将到期",
      "系统维护通知",
      "新功能上线",
      "安全提醒",
      "积分更新",
    ]),
    body: faker.lorem.sentence(),
    type: types[faker.number.int({ min: 0, max: 3 })],
    link: null,
    metadata: null,
    is_read: faker.datatype.boolean(0.3),
    email_sent: faker.datatype.boolean(0.5),
    created_at: faker.date.recent({ days: 7 }).toISOString(),
  }));
}

/**
 * 生成模拟 API 使用量统计
 */
export function generateMockApiUsage(days = 30) {
  return Array.from({ length: days }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() - (days - 1 - i));
    return {
      date: date.toISOString().split("T")[0],
      requests: faker.number.int({ min: 100, max: 5000 }),
      errors: faker.number.int({ min: 0, max: 50 }),
      latency: faker.number.int({ min: 20, max: 500 }),
    };
  });
}

/**
 * 生成模拟 API 使用明细行（与 api_usage 表结构一致）
 */
export function generateMockApiUsageRows(count = 120) {
  const methods = ["GET", "POST", "PUT", "DELETE", "PATCH"] as const;
  const paths = ["/api/user", "/api/teams", "/api/projects", "/api/analytics", "/api/health"];
  return Array.from({ length: count }, (_, i) => {
    const created = faker.date.recent({ days: 30 });
    return {
      id: i + 1,
      user_id: faker.datatype.boolean(0.7) ? MOCK_USER_ID : null,
      path: faker.helpers.arrayElement(paths),
      method: faker.helpers.arrayElement(methods),
      status_code: faker.helpers.weightedArrayElement([
        { value: 200, weight: 82 },
        { value: 201, weight: 8 },
        { value: 400, weight: 4 },
        { value: 401, weight: 3 },
        { value: 429, weight: 2 },
        { value: 500, weight: 1 },
      ]),
      ip_address: faker.internet.ip(),
      created_at: created.toISOString(),
    };
  });
}

/**
 * 生成模拟用户会话（与 user_sessions 表结构一致）
 */
export function generateMockUserSessions(count = 30) {
  return Array.from({ length: count }, () => ({
    id: faker.string.uuid(),
    user_id: MOCK_USER_ID,
    ip_address: faker.internet.ip(),
    user_agent: faker.internet.userAgent(),
    created_at: faker.date.recent({ days: 30 }).toISOString(),
  }));
}


/**
 * 生成模拟 API 密钥（与 api_keys 表结构一致）
 */
export function generateMockApiKeys(count = 3) {
  const names = ["开发环境密钥", "生产环境密钥", "CI 部署密钥"];
  const scopes = [
    ["project:read", "user:read"],
    ["project:read", "project:write", "user:read", "billing:read"],
    ["project:read"],
  ];
  return Array.from({ length: count }, (_, i) => ({
    id: faker.string.uuid(),
    user_id: MOCK_USER_ID,
    name: names[i % names.length],
    key_prefix: `isk_${faker.string.alphanumeric(10)}...`,
    key_hash: `sha256:${faker.string.hexadecimal({ length: 32 })}:${faker.string.hexadecimal({ length: 64 })}`,
    scopes: scopes[i % scopes.length],
    is_active: i !== 1,
    last_used_at: i === 0 ? faker.date.recent({ days: 7 }).toISOString() : null,
    expires_at: i === 2 ? faker.date.soon({ days: 90 }).toISOString() : null,
    created_at: faker.date.recent({ days: 90 }).toISOString(),
    updated_at: faker.date.recent({ days: 30 }).toISOString(),
  }));
}

/**
 * 生成模拟订阅信息
 */
export function generateMockSubscription() {
  return {
    id: "mock-sub-001",
    team_id: MOCK_TEAM_ID,
    provider: "stripe",
    provider_id: "sub_mock_001",
    status: "active",
    plan: "pro",
    period_start: faker.date.recent({ days: 30 }).toISOString(),
    period_end: faker.date.soon({ days: 30 }).toISOString(),
    cancel_at_period_end: false,
    created_at: faker.date.past().toISOString(),
    updated_at: faker.date.recent().toISOString(),
  };
}

/**
 * 生成模拟审计日志
 */
export function generateMockAuditLogs(count = 20) {
  const actions = [
    "user.login",
    "user.logout",
    "team.create",
    "team.invite",
    "profile.update",
    "settings.change",
    "project.deploy",
    "project.delete",
    "api_key.create",
    "api_key.revoke",
  ];
  return Array.from({ length: count }, (_, i) => ({
    id: `audit_${i + 1}`,
    user_id: faker.helpers.arrayElement([
      MOCK_USER_ID,
      "mock-user-002",
      "mock-user-003",
    ]),
    action: faker.helpers.arrayElement(actions),
    metadata: { ip: faker.internet.ip(), user_agent: faker.internet.userAgent() },
    created_at: faker.date.recent({ days: 14 }).toISOString(),
  }));
}

/**
 * 生成管理后台概览统计（Mock 模式专用）
 * 角色分布遵循系统角色约束（super_admin/admin/member/viewer）
 */
export function generateMockAdminStats() {
  const roleCount = {
    super_admin: 1,
    admin: 2,
    member: 16,
    viewer: 8,
  };
  return {
    totalUsers: Object.values(roleCount).reduce((sum, n) => sum + n, 0),
    totalTeams: 3,
    roleCount,
  };
}
