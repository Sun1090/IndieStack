/**
 * Mock 查询链上 `gt` 的语义。
 *
 * 起因（不是推测）：`src/lib/repositories/marketing.ts:89` 的 token 过期闸门是
 * `.update(...).eq("token_hash", …).gt("token_expires_at", now).select("id")`，而 Mock 的构建器只有
 * `gte / lt / lte`——mock 模式下这条链直接抛 `TypeError: ... .gt is not a function`。
 * 仓储层单测（`marketing.test.ts`）用的是手搓 `chainMock`，那份替身**自带 `gt`**，所以那边一直绿。
 * 这个文件钉「严格大于」：恰好等于 `now` 的那一条不能被更新——而且读写两条路径都要钉，
 * 因为 mock 里它们是两处独立实现（`matchesFilters` 服务 update/delete，
 * `applyFiltersAndPagination` 服务 select），只补一边就是留一个下次会踩的洞。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createMockSupabaseClient, resetMockCache } from "@/lib/mock";

const NOW = "2026-01-02T00:00:00.000Z";

/** Mock 客户端的返回类型是宽松的（`data` 落成 `{}`），断言前收成 id 列表。 */
function idsOf(result: unknown): string[] {
  const data = (result as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  return data.map((row) => (row as { id: string }).id).sort();
}

function subscription(id: string, expiresAt: string) {
  return {
    id,
    user_id: `u-${id}`,
    email: `${id}@example.test`,
    status: "pending",
    token_expires_at: expiresAt,
  };
}

async function seed() {
  const client = createMockSupabaseClient();
  await client.from("marketing_subscriptions").insert([
    subscription("fresh", "2026-06-01T00:00:00.000Z"),
    subscription("boundary", NOW),
    subscription("expired", "2026-01-01T00:00:00.000Z"),
  ]);
  return client;
}

describe("mock 的 gt 与 PostgREST 的 > 对齐", () => {
  beforeEach(() => resetMockCache());

  it("写路径：只更新严格大于 now 的那一条（等于与小于都不算）", async () => {
    const client = await seed();
    const result = await client
      .from("marketing_subscriptions")
      .update({ status: "subscribed" })
      .gt("token_expires_at", NOW)
      .select("id");
    expect((result as { error: unknown }).error).toBeNull();
    expect(idsOf(result)).toEqual(["fresh"]);
  });

  it("对照：gte 会把边界那条一起收进来，两者不是同一个算子", async () => {
    const client = await seed();
    const result = await client
      .from("marketing_subscriptions")
      .update({ status: "unsubscribed" })
      .gte("token_expires_at", NOW)
      .select("id");
    expect(idsOf(result)).toEqual(["boundary", "fresh"]);
  });

  it("读路径用同一套语义（两处实现不能只补一边）", async () => {
    const client = await seed();
    const read = await client.from("marketing_subscriptions").select("id").gt("token_expires_at", NOW);
    expect(idsOf(read)).toEqual(["fresh"]);
    const readGte = await client.from("marketing_subscriptions").select("id").gte("token_expires_at", NOW);
    expect(idsOf(readGte)).toEqual(["boundary", "fresh"]);
  });

  it("仓储那条链的形状：eq + gt 同时生效", async () => {
    const client = await seed();
    const hit = await client
      .from("marketing_subscriptions")
      .update({ status: "subscribed" })
      .eq("user_id", "u-fresh")
      .gt("token_expires_at", NOW)
      .select("id");
    expect(idsOf(hit)).toEqual(["fresh"]);

    const miss = await client
      .from("marketing_subscriptions")
      .update({ status: "subscribed" })
      .eq("user_id", "u-expired")
      .gt("token_expires_at", NOW)
      .select("id");
    expect(idsOf(miss)).toEqual([]);
  });
});
