/**
 * Mock 数据层测试
 * 验证 Mock Supabase 客户端对 API 密钥表的读写行为
 * （列表、创建追加、吊销更新）
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createMockSupabaseClient,
  createMockRequestStore,
  resetMockCache,
  getMockUploadFailNext,
  setMockUploadFailNext,
} from "./mock";
import { MOCK_USER_ID } from "./mock/data";

type MockRow = Record<string, unknown>;

function asRows(data: unknown): MockRow[] {
  return (data as MockRow[] | null) ?? [];
}

describe("Mock API Keys", () => {
  beforeEach(() => {
    resetMockCache();
  });

  it("列出预置的 mock API 密钥", async () => {
    const client = createMockSupabaseClient();
    const { data, error } = await client
      .from("api_keys")
      .select("*")
      .eq("user_id", MOCK_USER_ID)
      .order("created_at", { ascending: false });

    expect(error).toBeNull();
    const rows = asRows(data);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      user_id: MOCK_USER_ID,
      key_prefix: expect.any(String),
      scopes: expect.any(Array),
      is_active: expect.any(Boolean),
    });
  });

  it("创建密钥后追加到列表", async () => {
    const client = createMockSupabaseClient();
    const { data: created } = await client
      .from("api_keys")
      .insert({
        user_id: MOCK_USER_ID,
        name: "测试密钥",
        key_prefix: "isk_test...",
        key_hash: "sha256:salt:hash",
        scopes: ["project:read"],
        is_active: true,
      })
      .select()
      .single();

    expect(created).not.toBeNull();

    const { data: list } = await client.from("api_keys").select("*");
    const rows = asRows(list);
    expect(rows).toHaveLength(4);
    expect(rows.some((k) => k.name === "测试密钥")).toBe(true);
  });

  it("吊销密钥更新 is_active 并保留在列表中", async () => {
    const client = createMockSupabaseClient();
    const { data: first } = await client.from("api_keys").select("*").limit(1);

    const keyId = asRows(first)[0].id as string;
    await client
      .from("api_keys")
      .update({ is_active: false })
      .eq("id", keyId)
      .eq("user_id", MOCK_USER_ID);

    const { data: after } = await client.from("api_keys").select("*").eq("id", keyId);

    expect(asRows(after)[0].is_active).toBe(false);
  });

  it("吊销只影响目标密钥，不影响其他密钥", async () => {
    const client = createMockSupabaseClient();
    const { data: before } = await client.from("api_keys").select("*").eq("user_id", MOCK_USER_ID);

    const rows = asRows(before);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const targetId = rows[0].id as string;
    // 其他密钥保持各自的原始状态（mock 预置数据中可能存在本来已吊销的密钥）
    const others = rows.slice(1).map((r) => ({ id: r.id, is_active: r.is_active }));

    await client
      .from("api_keys")
      .update({ is_active: false })
      .eq("id", targetId)
      .eq("user_id", MOCK_USER_ID);

    const { data: after } = await client.from("api_keys").select("*").eq("user_id", MOCK_USER_ID);

    const afterRows = asRows(after);
    expect(afterRows.find((r) => r.id === targetId)?.is_active).toBe(false);
    for (const other of others) {
      expect(afterRows.find((r) => r.id === other.id)?.is_active).toBe(other.is_active);
    }
  });
});

describe("Mock Teams", () => {
  beforeEach(() => {
    resetMockCache();
  });

  it("in 过滤可返回用户所属团队列表", async () => {
    const client = createMockSupabaseClient();
    const { data, error } = await client.from("teams").select("*").in("id", ["mock-team-001"]);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    const rows = asRows(data);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("mock-team-001");
  });

  it("in 过滤不匹配时返回空列表", async () => {
    const client = createMockSupabaseClient();
    const { data } = await client
      .from("teams")
      .select("*")
      .in("id", ["00000000-0000-0000-0000-000000000000"]);

    expect(asRows(data)).toHaveLength(0);
  });
});

describe("Mock Admin Auth", () => {
  beforeEach(() => {
    resetMockCache();
  });

  it("admin.listUsers 返回含当前用户的用户列表", async () => {
    const client = createMockSupabaseClient();
    const { data, error } = await client.auth.admin.listUsers();

    expect(error).toBeNull();
    expect(Array.isArray(data.users)).toBe(true);
    expect(data.users.length).toBeGreaterThan(0);
    expect(data.users[0]).toMatchObject({
      id: MOCK_USER_ID,
      email: "dev@indiestack.local",
    });
  });
});

describe("Mock 写操作与真实 PostgREST 行为对齐", () => {
  beforeEach(() => {
    resetMockCache();
  });

  it("update 带 eq 只更新匹配行并持久化", async () => {
    const client = createMockSupabaseClient();
    await client
      .from("profiles")
      .update({ full_name: "测试更新后的名字", updated_at: "2026-01-01T00:00:00.000Z" })
      .eq("id", MOCK_USER_ID);

    const { data } = await client
      .from("profiles")
      .select("full_name")
      .eq("id", MOCK_USER_ID)
      .single();

    expect(data).not.toBeNull();
    expect((data as Record<string, unknown>).full_name).toBe("测试更新后的名字");
  });

  it("update 不匹配任何行时不改动数据", async () => {
    const client = createMockSupabaseClient();
    await client
      .from("profiles")
      .update({ full_name: "不应生效" })
      .eq("id", "00000000-0000-0000-0000-000000000000");

    const { data } = await client
      .from("profiles")
      .select("full_name")
      .eq("id", MOCK_USER_ID)
      .single();

    expect((data as Record<string, unknown>).full_name).not.toBe("不应生效");
  });

  it("notifications 插入补齐真实库列默认值（is_read/email_sent=false）", async () => {
    const client = createMockSupabaseClient();
    // 模拟 createNotification 的最小插入载荷（不带 is_read/email_sent）
    const { data: inserted } = await client
      .from("notifications")
      .insert({ user_id: MOCK_USER_ID, type: "payment_succeeded", title: "付款成功" })
      .select("id")
      .single();
    expect(inserted).not.toBeNull();

    // 真实库默认值为 false，mock 必须一致，否则按 email_sent/is_read 过滤的查询会漏行
    const { data: pending } = await client
      .from("notifications")
      .select("*")
      .eq("user_id", MOCK_USER_ID)
      .eq("email_sent", false)
      .eq("is_read", false)
      .eq("title", "付款成功");
    const rows = asRows(pending);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email_sent: false, is_read: false });
  });

  it("delete 从列表中移除匹配行", async () => {
    const client = createMockSupabaseClient();
    const { data: before } = await client.from("team_members").select("*");
    const beforeRows = asRows(before);
    const targetId = beforeRows[0].id as string;
    const beforeCount = beforeRows.length;

    await client.from("team_members").delete().eq("id", targetId);

    const { data: after } = await client.from("team_members").select("*");
    const afterRows = asRows(after);
    expect(afterRows).toHaveLength(beforeCount - 1);
    expect(afterRows.some((r) => r.id === targetId)).toBe(false);
  });

  it("head: true 只返回 count 不返回数据行", async () => {
    const client = createMockSupabaseClient();
    const { data, count, error } = await client
      .from("profiles")
      .select("*", { count: "exact", head: true });

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    expect((data as unknown[]).length).toBe(0);
    expect(count).toBeGreaterThan(0);
  });

  it("update+select 返回完整更新后的行", async () => {
    const client = createMockSupabaseClient();
    const { data } = await client
      .from("profiles")
      .update({ full_name: "API 更新" })
      .eq("id", MOCK_USER_ID)
      .select()
      .single();

    expect(data).not.toBeNull();
    const row = data as Record<string, unknown>;
    expect(row.full_name).toBe("API 更新");
    expect(row.id).toBe(MOCK_USER_ID);
  });

  it("profiles 支持按 email 通用 eq 过滤（邀请成员按邮箱查用户）", async () => {
    const client = createMockSupabaseClient();

    // 已知邮箱（mock 当前用户）→ 命中
    const { data: found } = await client
      .from("profiles")
      .select("id")
      .eq("email", "dev@indiestack.local")
      .maybeSingle();
    expect(found).not.toBeNull();
    expect((found as Record<string, unknown>).id).toBe(MOCK_USER_ID);

    // 未知邮箱 → 无结果（maybeSingle 返回 null，对应"用户未注册"）
    const { data: missing } = await client
      .from("profiles")
      .select("id")
      .eq("email", "nobody@example.com")
      .maybeSingle();
    expect(missing).toBeNull();
  });
});

describe("Mock user_sessions", () => {
  beforeEach(() => {
    resetMockCache();
  });

  it("生成与真实表一致的 last_seen_at 元数据并支持按最近活跃时间排序", async () => {
    const client = createMockSupabaseClient();
    const { data, error } = await client
      .from("user_sessions")
      .select("*")
      .eq("user_id", MOCK_USER_ID)
      .order("last_seen_at", { ascending: false })
      .limit(20);

    expect(error).toBeNull();
    expect(data).toHaveLength(20);
    const rows = asRows(data);
    expect(rows.every((row) => typeof row.last_seen_at === "string")).toBe(true);
    expect(rows.every((row) => typeof row.created_at === "string")).toBe(true);
    for (let index = 1; index < rows.length; index += 1) {
      expect(Date.parse(String(rows[index - 1].last_seen_at))).toBeGreaterThanOrEqual(
        Date.parse(String(rows[index].last_seen_at)),
      );
    }
  });
});

describe("Mock request-scoped worker/subscription state", () => {
  beforeEach(() => {
    resetMockCache();
  });

  it("隔离 email worker runs 与 marketing subscriptions 的读写", async () => {
    const first = createMockSupabaseClient({ store: {} });
    const second = createMockSupabaseClient({ store: {} });

    await first.from("email_worker_runs").insert({ id: "run-first", status: "sent" });
    await first
      .from("marketing_subscriptions")
      .insert({ id: "subscription-first", user_id: MOCK_USER_ID, status: "pending" });

    expect((await first.from("email_worker_runs").select("*")).data).toHaveLength(1);
    expect((await first.from("marketing_subscriptions").select("*")).data).toHaveLength(1);
    expect((await second.from("email_worker_runs").select("*")).data).toHaveLength(0);
    expect((await second.from("marketing_subscriptions").select("*")).data).toHaveLength(0);
  });
});

describe("Mock MFA 状态机", () => {
  beforeEach(() => {
    resetMockCache();
  });

  it("enroll → list 返回未验证因子", async () => {
    const client = createMockSupabaseClient();
    const enrolled = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: "测试设备" });

    expect(enrolled.error).toBeNull();
    expect(enrolled.data).toMatchObject({
      type: "totp",
      totp: { secret: "MOCKSECRET" },
    });

    const listed = await client.auth.mfa.listFactors();
    expect(listed.error).toBeNull();
    expect(listed.data.totp).toHaveLength(1);
    expect(listed.data.totp[0]).toMatchObject({
      id: enrolled.data?.id,
      status: "unverified",
      friendly_name: "测试设备",
    });
  });

  it("challengeAndVerify 将目标因子标记为 verified", async () => {
    const client = createMockSupabaseClient();
    const enrolled = await client.auth.mfa.enroll({ factorType: "totp" });
    const factorId = enrolled.data?.id ?? "";

    await expect(client.auth.mfa.challengeAndVerify({ factorId, code: "123456" })).resolves.toEqual(
      {
        error: null,
      },
    );
    const listed = await client.auth.mfa.listFactors();
    expect(listed.data.totp[0].status).toBe("verified");
  });

  it("verified 因子可创建 challenge，错误验证码失败且成功验证后 challenge 只能消费一次", async () => {
    const client = createMockSupabaseClient();
    const enrolled = await client.auth.mfa.enroll({ factorType: "totp" });
    const factorId = enrolled.data?.id ?? "";
    await client.auth.mfa.challengeAndVerify({ factorId, code: "123456" });

    const challenge = await client.auth.mfa.challenge({ factorId });
    expect(challenge.error).toBeNull();
    expect(challenge.data?.id).toEqual(expect.any(String));

    await expect(
      client.auth.mfa.verify({ factorId, challengeId: challenge.data?.id, code: "000000" }),
    ).resolves.toEqual({ error: { message: "Invalid MFA code" } });
    await expect(
      client.auth.mfa.verify({ factorId, challengeId: challenge.data?.id, code: "123456" }),
    ).resolves.toEqual({ error: null });
    await expect(
      client.auth.mfa.verify({ factorId, challengeId: challenge.data?.id, code: "123456" }),
    ).resolves.toEqual({ error: { message: "Challenge not found" } });
  });

  it("连续错误验证码达到阈值后锁定 challenge，锁定期后可重新 challenge", async () => {
    vi.useFakeTimers();
    try {
      const client = createMockSupabaseClient();
      const enrolled = await client.auth.mfa.enroll({ factorType: "totp" });
      const factorId = enrolled.data?.id ?? "";
      await client.auth.mfa.challengeAndVerify({ factorId, code: "123456" });
      const challenge = await client.auth.mfa.challenge({ factorId });
      for (let attempt = 1; attempt < 5; attempt += 1) {
        await expect(
          client.auth.mfa.verify({ factorId, challengeId: challenge.data?.id, code: "000000" }),
        ).resolves.toEqual({ error: { message: "Invalid MFA code" } });
      }
      await expect(
        client.auth.mfa.verify({ factorId, challengeId: challenge.data?.id, code: "000000" }),
      ).resolves.toEqual({ error: { message: "Too many MFA attempts" } });
      await expect(
        client.auth.mfa.verify({ factorId, challengeId: challenge.data?.id, code: "123456" }),
      ).resolves.toEqual({ error: { message: "Too many MFA attempts" } });

      vi.advanceTimersByTime(15 * 60 * 1000 + 1);
      const nextChallenge = await client.auth.mfa.challenge({ factorId });
      await expect(
        client.auth.mfa.verify({ factorId, challengeId: nextChallenge.data?.id, code: "123456" }),
      ).resolves.toEqual({ error: null });
    } finally {
      vi.useRealTimers();
    }
  });

  it("未验证因子不能创建登录 challenge，过期 challenge 会被拒绝", async () => {
    vi.useFakeTimers();
    try {
      const client = createMockSupabaseClient();
      const enrolled = await client.auth.mfa.enroll({ factorType: "totp" });
      const factorId = enrolled.data?.id ?? "";
      await expect(client.auth.mfa.challenge({ factorId })).resolves.toEqual({
        data: null,
        error: { message: "Factor is not verified" },
      });

      await client.auth.mfa.challengeAndVerify({ factorId, code: "123456" });
      const challenge = await client.auth.mfa.challenge({ factorId });
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);
      await expect(
        client.auth.mfa.verify({ factorId, challengeId: challenge.data?.id, code: "123456" }),
      ).resolves.toEqual({ error: { message: "Challenge expired" } });
    } finally {
      vi.useRealTimers();
    }
  });

  it("unenroll 移除目标因子，未知因子返回错误", async () => {
    const client = createMockSupabaseClient();
    const enrolled = await client.auth.mfa.enroll({ factorType: "totp" });
    const factorId = enrolled.data?.id ?? "";

    await expect(client.auth.mfa.unenroll({ factorId })).resolves.toEqual({
      data: { id: factorId },
      error: null,
    });
    expect((await client.auth.mfa.listFactors()).data.totp).toHaveLength(0);
    await expect(client.auth.mfa.unenroll({ factorId })).resolves.toEqual({
      data: null,
      error: { message: "Factor not found" },
    });
  });

  it("request-scoped store 隔离不同 client 的 MFA 状态", async () => {
    const first = createMockSupabaseClient({ store: {} });
    const second = createMockSupabaseClient({ store: {} });

    await first.auth.mfa.enroll({ factorType: "totp", friendlyName: "first" });

    expect((await first.auth.mfa.listFactors()).data.totp).toHaveLength(1);
    expect((await second.auth.mfa.listFactors()).data.totp).toHaveLength(0);
  });

  it("resetMockCache 清除跨 client 的 MFA 状态", async () => {
    const first = createMockSupabaseClient();
    await first.auth.mfa.enroll({ factorType: "totp" });
    expect((await createMockSupabaseClient().auth.mfa.listFactors()).data.totp).toHaveLength(1);

    resetMockCache();
    expect((await createMockSupabaseClient().auth.mfa.listFactors()).data.totp).toHaveLength(0);
  });

  it("同一个 store 的两个 client 共享 MFA 状态（假数据库契约）", async () => {
    // Server Action 与随后的 RSC 读取分属不同 chunk 的两次构造，靠的是共享 store，
    // 不是模块级变量。删掉这条就等于允许把 mock 改回「每个 client 一份私有数据」，
    // 那会重新制造 v0.5.0 F02 的「写进去了、读不到」。
    const store = createMockRequestStore();
    const writer = createMockSupabaseClient({ store });
    const reader = createMockSupabaseClient({ store });

    const enrolled = await writer.auth.mfa.enroll({ factorType: "totp", friendlyName: "共享设备" });
    const factorId = enrolled.data?.id ?? "";
    await writer.auth.mfa.challengeAndVerify({ factorId, code: "123456" });

    const listed = (await reader.auth.mfa.listFactors()).data.totp;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: factorId, status: "verified" });
  });
  it("signInWithPassword 带回 user.factors，登录表单据此决定是否跳挑战页", async () => {
    const store = createMockRequestStore();
    const client = createMockSupabaseClient({ store });

    // 参数在 mock 里不参与判定（真实客户端要 credentials），这里测的是响应形状。
    const anonymous = await client.auth.signInWithPassword();
    expect(anonymous.data.user?.factors).toEqual([]);

    const enrolled = await client.auth.mfa.enroll({ factorType: "totp" });
    await client.auth.mfa.challengeAndVerify({
      factorId: enrolled.data?.id ?? "",
      code: "123456",
    });

    const signed = await client.auth.signInWithPassword();
    expect(signed.data.user?.factors).toEqual([
      expect.objectContaining({ id: enrolled.data?.id, type: "totp", status: "verified" }),
    ]);

    // 返回的是副本：调用方（表单里的 filter/map）改不动假数据库里的因子表。
    signed.data.user?.factors.pop();
    expect((await client.auth.mfa.listFactors()).data.totp).toHaveLength(1);
  });

  it("challenge 的失败计数与锁定是 store 私有的", async () => {
    const first = createMockSupabaseClient({ store: createMockRequestStore() });
    const second = createMockSupabaseClient({ store: createMockRequestStore() });
    const open = async (client: ReturnType<typeof createMockSupabaseClient>) => {
      const enrolled = await client.auth.mfa.enroll({ factorType: "totp" });
      const factorId = enrolled.data?.id ?? "";
      await client.auth.mfa.challengeAndVerify({ factorId, code: "123456" });
      const challenge = await client.auth.mfa.challenge({ factorId });
      return { factorId, challengeId: challenge.data?.id ?? "" };
    };
    const a = await open(first);
    const b = await open(second);

    // 两个 store 各自 enroll 出来的 id 形状相同（同一毫秒、长度都是 1），
    // 所以这里真正在测的是「按 id 找人」不会跨 store 命中。
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await first.auth.mfa.verify({ factorId: a.factorId, challengeId: a.challengeId, code: "000000" });
    }
    await expect(
      first.auth.mfa.verify({ factorId: a.factorId, challengeId: a.challengeId, code: "123456" }),
    ).resolves.toEqual({ error: { message: "Too many MFA attempts" } });

    await expect(
      second.auth.mfa.verify({ factorId: b.factorId, challengeId: b.challengeId, code: "123456" }),
    ).resolves.toEqual({ error: null });
  });

  it("同一 store 内两个 challenge 各自计数，锁一个不影响另一个", async () => {
    const client = createMockSupabaseClient({ store: createMockRequestStore() });
    const enrolled = await client.auth.mfa.enroll({ factorType: "totp" });
    const factorId = enrolled.data?.id ?? "";
    await client.auth.mfa.challengeAndVerify({ factorId, code: "123456" });
    const first = await client.auth.mfa.challenge({ factorId });
    const second = await client.auth.mfa.challenge({ factorId });
    const firstId = first.data?.id ?? "";
    const secondId = second.data?.id ?? "";

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await client.auth.mfa.verify({ factorId, challengeId: firstId, code: "000000" });
    }
    await expect(
      client.auth.mfa.verify({ factorId, challengeId: firstId, code: "123456" }),
    ).resolves.toEqual({ error: { message: "Too many MFA attempts" } });
    await expect(
      client.auth.mfa.verify({ factorId, challengeId: secondId, code: "123456" }),
    ).resolves.toEqual({ error: null });
  });

  it("listFactors 返回副本，调用方改不动 store 里的因子状态", async () => {
    const client = createMockSupabaseClient({ store: createMockRequestStore() });
    await client.auth.mfa.enroll({ factorType: "totp" });
    const listed = (await client.auth.mfa.listFactors()).data.totp;

    listed[0].status = "verified";
    expect((await client.auth.mfa.listFactors()).data.totp[0].status).toBe("unverified");
  });
});

describe("Mock storage（F07 上传失败/重试）", () => {
  beforeEach(() => {
    resetMockCache();
  });

  it("upload 成功返回 path，getPublicUrl 生成可公开访问地址", async () => {
    const client = createMockSupabaseClient();
    const bucket = client.storage.from("avatars");

    const { data, error } = await bucket.upload("avatars/u1/1.png", Buffer.from("x"), {
      contentType: "image/png",
      upsert: true,
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ path: "avatars/u1/1.png" });

    const { data: urlData } = bucket.getPublicUrl("avatars/u1/1.png");
    expect(urlData.publicUrl).toBe(
      "https://mock.supabase.co/storage/v1/object/public/avatars/avatars/u1/1.png",
    );
  });

  it("failNext 注入：前 N 次 upload 返回错误，随后恢复成功", async () => {
    const client = createMockSupabaseClient();
    setMockUploadFailNext(2);

    for (let i = 0; i < 2; i += 1) {
      const { error } = await client.storage.from("avatars").upload("k", Buffer.from("x"));
      expect(error).not.toBeNull();
    }
    expect(getMockUploadFailNext()).toBe(0);

    const { error } = await client.storage.from("avatars").upload("k", Buffer.from("x"));
    expect(error).toBeNull();
  });

  it("failNext 只在所属 store 内生效（request-scoped 隔离）", async () => {
    const isolatedStore: Record<string, unknown> = {};
    const shared = createMockSupabaseClient();
    createMockSupabaseClient({ store: isolatedStore });

    setMockUploadFailNext(1, isolatedStore);

    const { error } = await shared.storage.from("avatars").upload("k", Buffer.from("x"));
    expect(error).toBeNull();
    expect(getMockUploadFailNext(isolatedStore)).toBe(1);
  });
});

describe("Mock push delivery queue", () => {
  beforeEach(() => {
    resetMockCache();
  });

  it("支持按到期时间 lte 过滤并按时间升序取批次", async () => {
    const client = createMockSupabaseClient();
    await client.from("push_delivery_attempts").insert([
      {
        notification_id: "n1",
        user_id: "u1",
        endpoint: "https://push/older",
        status: "pending",
        next_attempt_at: "2026-09-13T00:00:00.000Z",
      },
      {
        notification_id: "n1",
        user_id: "u1",
        endpoint: "https://push/boundary",
        status: "pending",
        next_attempt_at: "2026-09-13T01:00:00.000Z",
      },
      {
        notification_id: "n1",
        user_id: "u1",
        endpoint: "https://push/future",
        status: "pending",
        next_attempt_at: "2026-09-13T02:00:00.000Z",
      },
    ]);

    const { data, error } = await client
      .from("push_delivery_attempts")
      .select("*")
      .eq("status", "pending")
      .lte("next_attempt_at", "2026-09-13T01:00:00.000Z")
      .order("next_attempt_at", { ascending: true })
      .limit(2);

    expect(error).toBeNull();
    expect(asRows(data).map((row) => row.endpoint)).toEqual([
      "https://push/older",
      "https://push/boundary",
    ]);
  });

  it("支持先按时间选终态再按 id 删除，且 pending 不受影响", async () => {
    const client = createMockSupabaseClient();
    await client.from("push_delivery_attempts").insert([
      {
        notification_id: "n1",
        user_id: "u1",
        endpoint: "https://push/aged-sent",
        status: "sent",
        sent_at: "2026-09-01T00:00:00.000Z",
      },
      {
        notification_id: "n1",
        user_id: "u1",
        endpoint: "https://push/fresh-sent",
        status: "sent",
        sent_at: "2026-09-12T00:00:00.000Z",
      },
      {
        notification_id: "n1",
        user_id: "u1",
        endpoint: "https://push/old-pending",
        status: "pending",
        next_attempt_at: "2026-09-14T00:00:00.000Z",
      },
    ]);

    const { data: aged } = await client
      .from("push_delivery_attempts")
      .select("id")
      .eq("status", "sent")
      .lt("sent_at", "2026-09-08T00:00:00.000Z")
      .order("sent_at", { ascending: true })
      .limit(1000);
    const ids = asRows(aged).map((row) => row.id as string);
    expect(ids).toHaveLength(1);

    await client.from("push_delivery_attempts").delete().in("id", ids);

    const { data: remaining } = await client.from("push_delivery_attempts").select("*");
    expect(asRows(remaining).map((row) => row.endpoint).sort()).toEqual([
      "https://push/fresh-sent",
      "https://push/old-pending",
    ]);
  });

  it("纯数字字符串仍按数值比较，不被 Date.parse 误判", async () => {
    const client = createMockSupabaseClient();
    await client.from("push_delivery_attempts").insert([
      { notification_id: "n1", endpoint: "https://push/2", attempt_count: "2" },
      { notification_id: "n1", endpoint: "https://push/3", attempt_count: "3" },
      { notification_id: "n1", endpoint: "https://push/20", attempt_count: "20" },
      { notification_id: "n1", endpoint: "https://push/21", attempt_count: "21" },
    ]);

    const { data } = await client
      .from("push_delivery_attempts")
      .select("*")
      .gte("attempt_count", "3")
      .lte("attempt_count", "20")
      .order("attempt_count", { ascending: true });

    expect(asRows(data).map((row) => row.endpoint).sort()).toEqual([
      "https://push/20",
      "https://push/3",
    ]);
  });
});

describe("Mock webhook 幂等占位（H06）", () => {
  beforeEach(() => {
    resetMockCache();
  });

  /** 调用 mock 的 claim_webhook_event，返回占位结论 */
  async function claim(eventId: string, provider = "stripe") {
    const client = createMockSupabaseClient();
    const result = (await client.rpc("claim_webhook_event", {
      p_provider: provider,
      p_event_id: eventId,
      p_event_type: "customer.subscription.created",
    })) as { data: { outcome: string; attempts: number }[]; error: unknown };
    return result.data[0];
  }

  it("首次投递 claimed，重复投递 duplicate 且不新增行", async () => {
    await expect(claim("evt_mock_1")).resolves.toEqual({ outcome: "claimed", attempts: 1 });
    await expect(claim("evt_mock_1")).resolves.toEqual({ outcome: "duplicate", attempts: 1 });

    const client = createMockSupabaseClient();
    const { data } = await client.from("webhook_events").select("*").eq("event_id", "evt_mock_1");
    expect(asRows(data)).toHaveLength(1);
    expect(asRows(data)[0]).toMatchObject({ status: "received", attempts: 1 });
  });

  it("不同 provider 的同名 event_id 互不影响", async () => {
    await expect(claim("evt_shared", "stripe")).resolves.toEqual({ outcome: "claimed", attempts: 1 });
    await expect(claim("evt_shared", "lemonsqueezy")).resolves.toEqual({
      outcome: "claimed",
      attempts: 1,
    });
  });

  it("status=failed 允许重新占位并累加 attempts", async () => {
    const client = createMockSupabaseClient();
    await claim("evt_retry");
    await client
      .from("webhook_events")
      .update({ status: "failed", error_message: "boom" })
      .eq("event_id", "evt_retry");

    await expect(claim("evt_retry")).resolves.toEqual({ outcome: "claimed", attempts: 2 });
  });

  it("received 超过 15 分钟租约可重新占位", async () => {
    const client = createMockSupabaseClient();
    await claim("evt_lease");
    await client
      .from("webhook_events")
      .update({ last_attempt_at: new Date(Date.now() - 16 * 60 * 1000).toISOString() })
      .eq("event_id", "evt_lease");

    await expect(claim("evt_lease")).resolves.toEqual({ outcome: "claimed", attempts: 2 });
  });

  it("已处理完成的事件永远是 duplicate", async () => {
    const client = createMockSupabaseClient();
    await claim("evt_done");
    await client
      .from("webhook_events")
      .update({ status: "processed", last_attempt_at: new Date(Date.now() - 60 * 60 * 1000).toISOString() })
      .eq("event_id", "evt_done");

    await expect(claim("evt_done")).resolves.toEqual({ outcome: "duplicate", attempts: 1 });
  });

  it("未知 RPC 仍返回空数据（不影响既有调用）", async () => {
    const client = createMockSupabaseClient();
    await expect(client.rpc("unknown_rpc")).resolves.toEqual({ data: null, error: null });
  });
});

describe("Mock 账户个人数据擦除（H08）", () => {
  beforeEach(() => {
    resetMockCache();
  });

  async function erase(userId?: string) {
    const client = createMockSupabaseClient();
    return (await client.rpc("erase_user_data", { p_user_id: userId })) as {
      data: Record<string, number> | null;
      error: { message: string } | null;
    };
  }

  it("缺少 user id 时报错，而不是静默 no-op", async () => {
    const { data, error } = await erase();
    expect(data).toBeNull();
    expect(error?.message).toContain("requires a user id");
  });

  it("删除该用户的 API 使用记录", async () => {
    const client = createMockSupabaseClient();
    const before = asRows(
      (await client.from("api_usage").select("*").eq("user_id", MOCK_USER_ID)).data,
    );
    expect(before.length).toBeGreaterThan(0);

    const { data } = await erase(MOCK_USER_ID);
    expect(data!.apiUsage).toBe(before.length);

    const after = await client.from("api_usage").select("*").eq("user_id", MOCK_USER_ID);
    expect(asRows(after.data)).toHaveLength(0);
  });

  it("匿名化审计日志并按邮箱匹配联系消息（大小写与空白都不该漏删）", async () => {
    const client = createMockSupabaseClient();
    const profiles = asRows(
      (await client.from("profiles").select("*").eq("id", MOCK_USER_ID)).data,
    );
    const email = String(profiles[0]?.email);
    expect(email.length).toBeGreaterThan(0);

    await client.from("audit_logs").insert({
      user_id: MOCK_USER_ID,
      action: "team.invite",
      entity_type: "user",
      entity_id: MOCK_USER_ID,
      metadata: { email, ip_address: "203.0.113.9", role: "admin" },
    });
    await client.from("contact_messages").insert({
      name: "Mock User",
      email: `  ${email.toUpperCase()}  `,
      subject: "erase-me-subject",
      message: "private content",
      status: "new",
    });

    const { data } = await erase(MOCK_USER_ID);
    expect(data!.contactMessages).toBe(1);
    expect(
      asRows((await client.from("contact_messages").select("*")).data).filter(
        (row) => row.subject === "erase-me-subject",
      ),
    ).toHaveLength(0);

    const invited = asRows(
      (await client.from("audit_logs").select("*").eq("action", "team.invite")).data,
    );
    const mine = invited.find(
      (row) => (row.metadata as Record<string, unknown>)?.role === "admin",
    );
    expect(mine).toBeDefined();
    expect(mine!.user_id).toBeNull();
    expect(mine!.entity_id).toBeNull();
    expect(mine!.metadata).toEqual({ role: "admin" });
  });

  it("第二次擦除不再影响任何行（幂等）", async () => {
    await erase(MOCK_USER_ID);
    const { data } = await erase(MOCK_USER_ID);
    expect(data).toEqual({ apiUsage: 0, contactMessages: 0, auditLogsAnonymized: 0 });
  });
});

describe("Mock 受管对象枚举（A10）", () => {
  beforeEach(() => {
    resetMockCache();
  });

  async function seedObject(objectKey: string, status: "active" | "deleted" = "active") {
    const client = createMockSupabaseClient();
    await client.from("upload_objects").upsert(
      {
        bucket: "avatars",
        object_key: objectKey,
        owner_id: MOCK_USER_ID,
        byte_size: 1024,
        content_type: "image/png",
        checksum: "a".repeat(64),
        status,
      },
      { onConflict: "bucket,object_key" },
    );
  }

  it("缺少 user id 时报错", async () => {
    const client = createMockSupabaseClient();
    const result = (await client.rpc("list_user_objects_for_erasure", {})) as {
      error: { message: string } | null;
    };
    expect(result.error?.message).toContain("requires a user id");
  });

  it("active 对象按引用状态分类，deleted 行不参与", async () => {
    const client = createMockSupabaseClient();
    await seedObject("avatars/mock-user-001/avatar.png");
    await seedObject("avatars/mock-user-001/old.png");
    await seedObject("avatars/mock-user-001/gone.png", "deleted");
    await client
      .from("profiles")
      .update({ avatar_url: `https://h/object/public/avatars/avatars/mock-user-001/avatar.png` })
      .eq("id", MOCK_USER_ID);

    const listed = (await client.rpc("list_user_objects_for_erasure", {
      p_user_id: MOCK_USER_ID,
    })) as { data: { object_key: string; referenced: boolean }[] };
    // 迁移按 created_at 排序，mock 保持插入顺序；调用方只遍历全集，这里按 key 归一
    expect([...listed.data].sort((a, b) => a.object_key.localeCompare(b.object_key))).toEqual([
      { bucket: "avatars", object_key: "avatars/mock-user-001/avatar.png", referenced: true },
      { bucket: "avatars", object_key: "avatars/mock-user-001/old.png", referenced: false },
    ]);

    const orphans = (await client.rpc("find_orphan_upload_objects")) as {
      data: { object_key: string; owner_id: string | null }[];
    };
    expect(orphans.data).toHaveLength(1);
    // 「从未记录」与「已清理」是两回事：deleted 行不能出现在待补删清单里
    expect(orphans.data[0]).toMatchObject({
      object_key: "avatars/mock-user-001/old.png",
      owner_id: MOCK_USER_ID,
      byte_size: 1024,
    });
  });

  it("后缀相等而不是子串包含：xavatars/... 不算引用", async () => {
    const client = createMockSupabaseClient();
    await seedObject("avatars/mock-user-001/f.png");
    await client
      .from("profiles")
      .update({ avatar_url: "https://h/objects/xavatars/mock-user-001/f.png" })
      .eq("id", MOCK_USER_ID);

    const listed = (await client.rpc("list_user_objects_for_erasure", {
      p_user_id: MOCK_USER_ID,
    })) as { data: { referenced: boolean }[] };
    expect(listed.data[0]?.referenced).toBe(false);
  });
});

describe("Mock 上传对象元数据（H02）", () => {
  beforeEach(() => {
    resetMockCache();
  });

  const RECORD = {
    bucket: "avatars",
    object_key: "avatars/u1/a.png",
    owner_id: "u1",
    byte_size: 12,
    content_type: "image/png",
    checksum: "a".repeat(64),
  };

  it("默认是空表，不预置任何行", async () => {
    const client = createMockSupabaseClient();
    const { data } = await client.from("upload_objects").select("*");
    expect(asRows(data)).toHaveLength(0);
  });

  it("upsert 按 (bucket, object_key) 复合键去重，第二次写入只更新同一行", async () => {
    const client = createMockSupabaseClient();
    await client.from("upload_objects").upsert(RECORD, { onConflict: "bucket,object_key" });
    await client
      .from("upload_objects")
      .upsert({ ...RECORD, status: "deleted" }, { onConflict: "bucket,object_key" });

    const { data } = await client.from("upload_objects").select("*");
    const rows = asRows(data);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "deleted", object_key: "avatars/u1/a.png" });
  });

  it("不同 bucket 的同名 key 是两行（复合键不是单列去重）", async () => {
    const client = createMockSupabaseClient();
    await client.from("upload_objects").upsert(RECORD, { onConflict: "bucket,object_key" });
    await client
      .from("upload_objects")
      .upsert({ ...RECORD, bucket: "covers" }, { onConflict: "bucket,object_key" });

    const { data } = await client.from("upload_objects").select("*");
    expect(asRows(data)).toHaveLength(2);
  });

  it("插入时补齐真实库的 status 默认值 active", async () => {
    const client = createMockSupabaseClient();
    await client.from("upload_objects").insert(RECORD);
    const { data } = await client.from("upload_objects").select("*");
    expect(asRows(data)[0]).toMatchObject({ status: "active" });
  });

  it("单列 onConflict 行为不变（user_id 去重）", async () => {
    const client = createMockSupabaseClient();
    await client
      .from("push_subscriptions")
      .upsert(
        { user_id: "u1", endpoint: "https://push", p256dh: "p", auth: "a" },
        { onConflict: "user_id,endpoint" },
      );
    await client
      .from("push_subscriptions")
      .upsert(
        { user_id: "u1", endpoint: "https://push", p256dh: "p2", auth: "a2" },
        { onConflict: "user_id,endpoint" },
      );

    const { data } = await client.from("push_subscriptions").select("*").eq("user_id", "u1");
    expect(asRows(data)).toHaveLength(1);
    expect(asRows(data)[0]).toMatchObject({ p256dh: "p2" });
  });
});
