/**
 * 探测缓存的单测（TTL + single-flight）
 *
 * 之所以要有这个模块：`RATE_LIMIT_LEDGER` 里 `GET /api/health` 那条**已知缺口**写明的关法之一
 * 就是「把 DB 探测结果按秒缓存」——那条端点必须能被负载均衡器、Docker HEALTHCHECK 与
 * `check:production-smoke` 无凭据地打，所以按 IP 的滑窗会把监控自己读成 429；
 * 但它每次请求都真打一次 Supabase，于是无凭据的重复调用把成本按次数转嫁出去。
 *
 * 全部用例都注入时钟、零 sleep：TTL 的正确性全在时间上，用真实 `Date.now()` 测
 * 就必然要 sleep，而 sleep 出来的测试在 CI 上会随机红。
 */
import { describe, expect, it, vi } from "vitest";
import { createProbeCache } from "./probe-cache";

/** 可手动推进的时钟。 */
function clock(start = 1_000_000) {
  let value = start;
  return {
    now: () => value,
    advance(ms: number) {
      value += ms;
    },
  };
}

/** 手动结算的探测，用来观察「飞行中」那一格。 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // 立刻挂一个空处理器：调用方可能在挂上 awaitAllSettled 之前就 reject，
  // 那时 Node 会把这一次 rejection 报成未处理——那是测试的噪声，不是缺陷。
  promise.catch(() => {});
  return { promise, resolve, reject };
}

describe("createProbeCache()", () => {
  it("TTL 内的后续读取不再打探测", async () => {
    const time = clock();
    const probe = vi.fn(async () => true);
    const cache = createProbeCache<boolean>({ ttlMs: 1000, now: time.now });

    await cache.read(probe);
    time.advance(999);
    await cache.read(probe);

    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("TTL 过了就重新探测（恢复必须能被看到）", async () => {
    const time = clock();
    const probe = vi.fn(async () => true);
    const cache = createProbeCache<boolean>({ ttlMs: 1000, now: time.now });

    await cache.read(probe);
    time.advance(1000);
    await cache.read(probe);

    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("并发的 N 个读只打一次探测（single-flight 是这半个修复的关键）", async () => {
    // 只加 TTL 不加 single-flight 时这里会是 N 次——放大面通常来自并发的一簇，
    // 而 TTL 只挡得住「先后到达」。这个用例就是不许它退回去。
    const gate = deferred<boolean>();
    const probe = vi.fn(() => gate.promise);
    const cache = createProbeCache<boolean>({ ttlMs: 1000, now: () => 0 });

    const reads = Array.from({ length: 20 }, () => cache.read(probe));
    gate.resolve(true);

    await expect(Promise.all(reads)).resolves.toEqual(Array.from({ length: 20 }, () => true));
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("飞行中的复用不是「复制结果」，而是同一个 Promise 的值", async () => {
    const time = clock();
    const probe = vi.fn(async () => (await Promise.resolve()) as unknown as number);
    const cache = createProbeCache<number>({ ttlMs: 1000, now: time.now });
    const [a, b] = await Promise.all([cache.read(probe), cache.read(probe)]);
    expect(a).toBe(b);
  });

  it("失败也缓存，否则 Supabase 挂掉时每次请求都重试（把一次故障放大成一串）", async () => {
    const time = clock();
    const probe = vi.fn(async () => {
      throw new Error("down");
    });
    const cache = createProbeCache<boolean>({ ttlMs: 1000, now: time.now });

    await expect(cache.read(probe)).rejects.toThrow("down");
    await expect(cache.read(probe)).rejects.toThrow("down");

    // 第二次仍然 reject 而不是打第二次探测：故障期是最需要挡住的时刻。
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("失败标记在 TTL 之外会被丢掉，DB 恢复后重新探测（不会永久卡在失败）", async () => {
    // 那会把一次抖动变成一次停机——所以飞行标记必须清、失败的缓存项也必须会过期。
    const time = clock();
    const probe = vi
      .fn<() => Promise<boolean>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(true);
    const cache = createProbeCache<boolean>({ ttlMs: 1000, now: time.now });

    await expect(cache.read(probe)).rejects.toThrow("boom");
    // TTL 内：复用失败，不重打
    await expect(cache.read(probe)).rejects.toThrow("boom");
    expect(probe).toHaveBeenCalledTimes(1);

    time.advance(1000);
    await expect(cache.read(probe)).resolves.toBe(true);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("并发的一簇里只有一个探测失败时，其余共享同一个失败", async () => {
    const gate = deferred<boolean>();
    const probe = vi.fn(() => gate.promise);
    const cache = createProbeCache<boolean>({ ttlMs: 1000, now: () => 0 });
    const reads = Array.from({ length: 5 }, () => cache.read(probe));
    gate.reject(new Error("down"));
    const settled = await Promise.allSettled(reads);
    expect(settled.every((r) => r.status === "rejected")).toBe(true);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("peek 只读不打，clear 之后读不到", async () => {
    const time = clock();
    const probe = vi.fn(async () => "ok" as const);
    const cache = createProbeCache<string>({ ttlMs: 1000, now: time.now });

    expect(cache.peek()).toBeNull();
    await cache.read(probe);
    expect(cache.peek()).toEqual({ ok: true, value: "ok" });
    cache.clear();
    expect(cache.peek()).toBeNull();
  });

  it("peek 在 TTL 之外返回 null（不把过期值交出去冒充新鲜的）", async () => {
    const time = clock();
    const cache = createProbeCache<boolean>({ ttlMs: 1000, now: time.now });
    await cache.read(async () => true);
    time.advance(1001);
    expect(cache.peek()).toBeNull();
  });

  it("ttlMs 非法时立刻报错（0 或负数会让「永不失效」变成默认值）", () => {
    for (const ttlMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => createProbeCache({ ttlMs })).toThrow(/ttlMs/);
    }
  });
});
