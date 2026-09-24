/**
 * 营销订阅仓储层跑在**真 Mock 客户端**上（不是手搓替身）。
 *
 * 这一条链本来就有两套替身各说各话：仓储层单测（`marketing.test.ts`）用的是
 * `test-helpers.ts` 的 `chainMock`，它的清单里写着 `gt`、`neq`；而真正的 Mock 客户端
 * （`pnpm dev:mock` 与全部 E2E 走的那个）根本没有 `gt`——于是 `confirmSubscription`
 * 在 mock 模式下同步抛 `TypeError`，被路由的 catch 变成 HTTP 500，而单测全绿。
 * `mock-query-surface.test.ts` 从静态一侧钉住「链上用到的方法替身必须有」，
 * 这个文件从动态一侧钉住同一件事：**整条仓储流程 + 真替身，不 mock 任何查询**。
 *
 * 只有这里能验到「过期那条必须返回 false」：如果 `gt` 只是个吃掉参数不起作用的空壳，
 * 静态对账与「不抛错」都照样绿，而这条会红。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabaseClient, resetMockCache } from "@/lib/mock";

vi.mock("@/lib/supabase/admin", async () => {
  const { createMockSupabaseClient } = await import("@/lib/mock");
  return { createAdminClient: () => createMockSupabaseClient() };
});

const {
  upsertPendingSubscription,
  getSubscriptionByUserId,
  confirmSubscription,
  unsubscribeByToken,
} = await import("./marketing");

const USER = "u-marketing-mock";
const EMAIL = "mock@example.test";

/** 直接改替身里那一行的过期时间——这是 E2E 里「等 7 天」的等价替身。 */
async function ageTokenTo(iso: string) {
  await createMockSupabaseClient()
    .from("marketing_subscriptions")
    .update({ token_expires_at: iso })
    .eq("user_id", USER);
}

describe("营销订阅闭环跑在真 Mock 客户端上", () => {
  beforeEach(() => resetMockCache());

  it("订阅 → 点确认链接：真的落到 subscribed（这一步在补 gt 之前是 TypeError）", async () => {
    await upsertPendingSubscription(USER, EMAIL);
    const sub = await getSubscriptionByUserId(USER);
    expect(sub?.status).toBe("pending");
    expect(typeof sub?.token).toBe("string");

    await expect(confirmSubscription(sub!.token)).resolves.toBe(true);
    const after = await getSubscriptionByUserId(USER);
    expect(after?.status).toBe("subscribed");
  });

  it("token 过期 → false，而不是抛错（`gt` 必须真的在过滤，不能只是个空壳）", async () => {
    await upsertPendingSubscription(USER, EMAIL);
    const sub = await getSubscriptionByUserId(USER);
    await ageTokenTo("2020-01-01T00:00:00.000Z");

    await expect(confirmSubscription(sub!.token)).resolves.toBe(false);
    const after = await getSubscriptionByUserId(USER);
    expect(after?.status).toBe("pending");
  });

  it("退订走同一条 update 链，token 有效时真的落到 unsubscribed", async () => {
    await upsertPendingSubscription(USER, EMAIL);
    const sub = await getSubscriptionByUserId(USER);
    await confirmSubscription(sub!.token);

    // 退订的**过期**语义不在这里钉：#123 正在把它改成「退订不设时间窗」（确认仍然受），
    // 那是产品决定而不是本条主题。本文件要钉的是「`gt` 在真替身上真的过滤」，
    // 那条由上一条的确认用例钉住——它在 #123 前后都成立。
    await expect(unsubscribeByToken(sub!.token)).resolves.toBe(true);
    expect((await getSubscriptionByUserId(USER))?.status).toBe("unsubscribed");
  });

  it("没见过的 token → false（闸门不该把「查不到」说成服务故障）", async () => {
    await expect(confirmSubscription("a".repeat(48))).resolves.toBe(false);
  });
});
