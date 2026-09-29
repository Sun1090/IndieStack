/**
 * `/api/og` 的限频契约
 *
 * 这条端点天然要能被陌生人打——它挂在 `<meta og:image>` 上，社交预览爬虫与搜索引擎都是
 * 以**用户的 IP** 来取的。所以「按会话限频」在这里不成立，**按 IP 成立**。
 *
 * 之所以要专门钉住：台账条目原本把关法写成「按参数做缓存」，而**参数缓存挡不住这个端点
 * 真实的放大方式**——变一下 title 就是一个新键，于是任何参数缓存都以「每个键只算一次」收口，
 * 而攻击者要的正是这个。窗口按**来的人**算，与参数无关。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { checkMock, clearMock } = vi.hoisted(() => ({
  checkMock: vi.fn(),
  clearMock: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  createRateLimit: () => ({ check: checkMock, clear: clearMock }),
}));

import { GET } from "./route";

function request(query = "?title=Hello&category=Guides") {
  return new Request(`https://indiestack.test/api/og${query}`);
}

beforeEach(() => {
  checkMock.mockReset();
  clearMock.mockReset();
  checkMock.mockResolvedValue({ allowed: true, remaining: 59, resetIn: 30_000 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/og 的限频", () => {
  it("放行时先过限流，然后照常返回图片", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(checkMock).toHaveBeenCalledTimes(1);
  });

  it("超窗时 429，且不合成任何图片", async () => {
    // 「不合成」是这一条的全部意义：每请求真跑一次图片合成才是放大面。
    checkMock.mockResolvedValue({ allowed: false, remaining: 0, resetIn: 12_000 });
    const response = await GET(request());
    expect(response.status).toBe(429);
    expect(await response.arrayBuffer()).toHaveProperty("byteLength", 0);
  });

  it("429 不能被长缓存（窗口一过就该立刻能用）", async () => {
    checkMock.mockResolvedValue({ allowed: false, remaining: 0, resetIn: 12_000 });
    const response = await GET(request());
    // 放行那一侧带的是 s-maxage=86400；429 那一侧若也带长缓存，窗口过期后客户端仍拿不到图。
    expect(response.headers.get("cache-control")).toBe("no-store, must-revalidate");
    expect(response.headers.get("retry-after")).toBe("12");
  });

  it("retry-after 向上取整且至少 1 秒（0 或负数会让客户端立刻重试）", async () => {
    for (const [resetIn, expected] of [
      [1, "1"],
      [999, "1"],
      [1_000, "1"],
      [1_001, "2"],
      [0, "1"],
    ] as const) {
      checkMock.mockResolvedValue({ allowed: false, remaining: 0, resetIn });
      const response = await GET(request());
      expect(response.headers.get("retry-after"), `resetIn=${resetIn}`).toBe(expected);
    }
  });

  it("限流按请求打，与参数无关（这正是参数缓存做不到的那一格）", async () => {
    // 同一个 IP 换 title 就是「另一个键」——参数缓存会当成新条目放行，窗口不会。
    for (const title of ["a", "b", "c"]) {
      checkMock.mockResolvedValue({ allowed: true, remaining: 1, resetIn: 1_000 });
      await GET(request(`?title=${title}`));
    }
    expect(checkMock).toHaveBeenCalledTimes(3);
    // 三次都是同一个 `clientIpFromHeaders` 结果（这里没有 IP 头，落在 "anonymous" 桶）。
    const keys = checkMock.mock.calls.map(([req]) => req.headers.get("x-forwarded-for"));
    expect(new Set(keys).size).toBe(1);
  });
});
