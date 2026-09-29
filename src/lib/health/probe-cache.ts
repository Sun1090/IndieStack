/**
 * 短 TTL + single-flight 的探测结果缓存。
 *
 * **它存在的原因是一条被写下来的已知缺口**（`RATE_LIMIT_LEDGER` 的 `GET /api/health`）：
 * 那条端点必须能被负载均衡器、Docker `HEALTHCHECK`、`check:production-smoke` 无凭据地打，
 * 按 IP 的滑窗会把监控自己读成 429——所以「加窗口」在这条上不是免费的。
 * 但它每次请求都会用 anon 身份真打一次 `profiles limit(1)`，于是**无凭据的重复调用
 * 会把成本按次数转嫁给 Supabase**，而没有任何东西拦住这件事。
 * 缺口条目里写明的关法是「把 DB 探测结果按秒缓存」——那是这里的一半。
 *
 * **single-flight 比 TTL 更关键**：TTL 只挡住「先后到达」的重复调用，而放大面通常来自
 * **并发的**一簇（N 个探针同时到）。没有 single-flight 时 20 个并发请求仍然是 20 次往返，
 * 缓存等于没加。两条都要，所以这个模块同时管它们。
 *
 * 刻意的两个选择，各有代价，写在这里免得下一个人「顺手优化」：
 * 1. **失败也缓存**，TTL 相同。Supabase 挂掉时正是最需要挡住的时刻——
 *    每次请求都重试会把一次故障放大成一串故障。只缓存成功值的话，
 *    「不缓存失败」看起来更实时，实际是**故障时最不安全**的那个选择。
 * 2. **时钟可注入**。TTL 的正确性全在时间上，用真实 `Date.now()` 测就必然要 sleep，
 *    而 sleep 出来的测试在 CI 上会随机红。
 */
export interface ProbeCacheOptions {
  /** 结果有效期（毫秒）。要短到「恢复很快能被看到」，长到「一簇探针只打一次」。 */
  ttlMs: number;
  /** 注入时钟，便于确定性地测 TTL（生产传 `() => Date.now()`）。 */
  now?: () => number;
}

export interface ProbeCache<T> {
  /** 取一份缓存结果；没有或在飞行中就共用/发起一次探测。 */
  read(probe: () => Promise<T>): Promise<T>;
  /** 只读缓存，不发起探测。用于测试与「我不想在这里等一次网络」的场合。 */
  peek(): { ok: true; value: T } | { ok: false; error: unknown } | null;
  /** 清掉缓存（探测参数会变时、或测试里用）。 */
  clear(): void;
}

/** 缓存里存的是**已结算**的结果：成功值或失败，两者的 TTL 一样。 */
type Settled<T> = { ok: true; value: T; at: number } | { ok: false; error: unknown; at: number };

export function createProbeCache<T>(options: ProbeCacheOptions): ProbeCache<T> {
  const now = options.now ?? (() => Date.now());
  const ttlMs = options.ttlMs;
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new Error(`createProbeCache: ttlMs must be a positive number, got ${String(ttlMs)}`);
  }

  let entry: Settled<T> | null = null;
  let inFlight: Promise<T> | null = null;

  const fresh = (): Settled<T> | null =>
    entry !== null && now() - entry.at < ttlMs ? entry : null;

  return {
    async read(probe) {
      const cached = fresh();
      if (cached !== null) {
        if (cached.ok) return cached.value;
        throw cached.error;
      }
      // single-flight：飞行中就复用同一个 Promise；探测失败时也要清掉它，
      // 否则缓存会永久卡在「永远失败」上——那是把一次抖动变成一次停机。
      if (inFlight !== null) return inFlight;

      inFlight = (async () => {
        const value = await probe();
        entry = { ok: true, value, at: now() };
        return value;
      })();
      try {
        return await inFlight;
      } catch (error) {
        // **失败也要缓存**，TTL 与成功值相同。这一格第一版漏了，而「失败不缓存」看起来
        // 更实时，实际是**故障时最不安全**的那个选择：Supabase 挂掉时每次请求都重试，
        // 一次故障被放大成一串。health 这条端点的读数本来就允许几秒的滞后，
        // 而「一簇探针只打一次」是它被写进缺口条目的原因。
        entry = { ok: false, error, at: now() };
        throw error;
      } finally {
        inFlight = null;
      }
    },
    peek() {
      const cached = fresh();
      if (cached === null) return null;
      return cached.ok ? { ok: true, value: cached.value } : { ok: false, error: cached.error };
    },
    clear() {
      entry = null;
      inFlight = null;
    },
  };
}
