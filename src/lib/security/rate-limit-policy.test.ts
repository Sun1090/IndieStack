/**
 * 限流两态台账单测（v0.12.0 C12）。
 *
 * 三层，与 C11 同构：① 合成 handler 事实，证明六种偏差每种都真的会红、而且红在该红的那一条上；
 * ② 正反控制——同一份合成输入里「有窗口」与「写明理由」两类各占一半时必须零问题，
 * 说明判定不是「凡是没窗口的都红」；③ 对真实仓库复算，确认台账与调用图现量的结果双向一致，
 * 并把两个分母（有窗口的 / 写明理由的）钉成地板值而不是等号——新增端点只要台账跟着登记就该通过。
 */
import { describe, expect, it } from "vitest";
import {
  buildRouteAuthSources,
  runRouteAuthCheck,
} from "../../../scripts/lib/route-auth-check.js";
import { collectRouteHandlers, type RouteHandlerFact } from "./route-auth";
import {
  auditRateLimits,
  formatRateLimitIssues,
  RATE_LIMIT_GAP_MARKER,
  RATE_LIMIT_LEDGER,
  summarizeRateLimits,
} from "./rate-limit-policy";

function handler(
  id: string,
  opts: { limiters?: string[]; file?: string } = {},
): RouteHandlerFact {
  const [method, route] = id.split(" ");
  return {
    id,
    method,
    route,
    file: opts.file ?? `src/app/api/${route.replace(/^\/api\//, "")}/route.ts`,
    reachable: [],
    limiters: opts.limiters ?? [],
    truncated: 0,
  };
}

const codes = (issues: ReturnType<typeof auditRateLimits>) => issues.map((item) => item.code);
const subjects = (issues: ReturnType<typeof auditRateLimits>) => issues.map((item) => item.subject);

describe("auditRateLimits：两态判定", () => {
  it("正反控制：有窗口的不需要台账，写明理由的不需要窗口，两类各半时零问题", () => {
    const handlers = [
      handler("GET /api/limited", { limiters: ["src/app/api/limited/route.ts#rateLimit"] }),
      handler("POST /api/exempt"),
    ];
    const issues = auditRateLimits(handlers, { "POST /api/exempt": { reason: "读一次假 store 而已" } });
    expect(issues).toEqual([]);
    // 这条用例防的是「判定退化成只要没窗口就红」：上面那条有窗口的如果也被判红，这里就会红。
    expect(subjects(issues)).not.toContain("GET /api/limited");
  });

  it("没有窗口也没有台账 → UNLEDGED，且只红在那一条上", () => {
    const handlers = [
      handler("GET /api/limited", { limiters: ["x#rateLimit"] }),
      handler("POST /api/naked"),
    ];
    const issues = auditRateLimits(handlers, {});
    expect(codes(issues)).toEqual(["RATE_LIMIT_UNLEDGED"]);
    expect(subjects(issues)).toEqual(["POST /api/naked"]);
  });

  it("有窗口却还留着豁免 → RATE_LIMIT_STALE，并把窗口来源一起报出来", () => {
    const handlers = [
      handler("GET /api/limited", { limiters: ["src/app/api/limited/route.ts#rateLimit"] }),
      handler("POST /api/other"),
    ];
    const issues = auditRateLimits(handlers, {
      "GET /api/limited": { reason: "很久以前写的豁免" },
      "POST /api/other": { reason: "理由" },
    });
    expect(codes(issues)).toEqual(["RATE_LIMIT_STALE"]);
    expect(issues[0].message).toContain("src/app/api/limited/route.ts#rateLimit");
  });

  it("台账里的键已经没有对应 handler → RATE_LIMIT_ORPHAN（端点改名或删除）", () => {
    const handlers = [
      handler("GET /api/live", { limiters: ["x#rateLimit"] }),
      handler("POST /api/gone"),
    ];
    const issues = auditRateLimits(handlers, {
      "POST /api/gone": { reason: "理由" },
      "GET /api/removed": { reason: "理由" },
    });
    expect(codes(issues)).toEqual(["RATE_LIMIT_ORPHAN"]);
    expect(subjects(issues)).toEqual(["GET /api/removed"]);
  });

  it("理由为空（或只有空白）→ RATE_LIMIT_REASON_MISSING：没有理由的豁免不算登记", () => {
    const handlers = [
      handler("GET /api/live", { limiters: ["x#rateLimit"] }),
      handler("POST /api/a"),
      handler("DELETE /api/b"),
    ];
    const issues = auditRateLimits(handlers, {
      "POST /api/a": { reason: "" },
      "DELETE /api/b": { reason: "   " },
    });
    expect(codes(issues)).toEqual(["RATE_LIMIT_REASON_MISSING", "RATE_LIMIT_REASON_MISSING"]);
  });

  it("一个 handler 都没解析出来 → 失败封闭，不报「一切正常」", () => {
    const issues = auditRateLimits([], RATE_LIMIT_LEDGER);
    expect(codes(issues)).toEqual(["RATE_LIMIT_NO_HANDLERS"]);
  });

  it("调用图一条限流器都匹配不到 → RATE_LIMIT_NOTHING_MEASURED（判据失效优先于结论）", () => {
    // 限流库换路径 / 换用法时的形状：全部 handler 都没绑定，台账哪怕齐全也不能报绿，
    // 因为那一刻「有窗口」这个状态本身已经无法被观测。
    const handlers = [handler("GET /api/a"), handler("POST /api/b")];
    const issues = auditRateLimits(handlers, {
      "GET /api/a": { reason: "理由" },
      "POST /api/b": { reason: "理由" },
    });
    expect(codes(issues)).toEqual(["RATE_LIMIT_NOTHING_MEASURED"]);
  });

  it("标成「已知缺口」却没写怎么关 → RATE_LIMIT_REASON_MISSING", () => {
    const handlers = [handler("GET /api/live", { limiters: ["x#rateLimit"] }), handler("POST /api/gap")];
    const closed = auditRateLimits(handlers, {
      "POST /api/gap": { reason: `${RATE_LIMIT_GAP_MARKER}，怎么关：#999 正在补按 IP 的滑窗` },
    });
    expect(closed).toEqual([]);
    const unclosed = auditRateLimits(handlers, {
      "POST /api/gap": { reason: `${RATE_LIMIT_GAP_MARKER}，这里确实有暴露，先记一下` },
    });
    expect(codes(unclosed)).toEqual(["RATE_LIMIT_REASON_MISSING"]);
    expect(subjects(unclosed)).toEqual(["POST /api/gap"]);
  });

  it("输出格式稳定：每行 [CODE] subject: message", () => {
    // 带一条有窗口的：全是裸端点时会先失败封闭在 NOTHING_MEASURED 上，走不到格式化。
    const handlers = [handler("POST /api/kept", { limiters: ["x#rateLimit"] }), handler("GET /api/naked")];
    const text = formatRateLimitIssues(auditRateLimits(handlers, {}));
    expect(text).toMatch(/^\[RATE_LIMIT_UNLEDGED\] GET \/api\/naked: /);
  });
});

describe("真实仓库", () => {
  const handlers = collectRouteHandlers(buildRouteAuthSources());
  const limited = handlers.filter((item) => item.limiters.length > 0);
  const exempt = handlers.filter((item) => item.limiters.length === 0);

  it("台账与调用图现量的结果双向一致", () => {
    expect(handlers.length).toBeGreaterThanOrEqual(45);
    expect(auditRateLimits(handlers)).toEqual([]);
  });

  it("两个分母都不是零，且合起来等于全部分母", () => {
    // 「有窗口」和「写明理由」任何一侧塌成 0，这张表就只剩一句空话：
    // 前者为 0 意味着限频全仓库消失（上一条用例已经为此失败封闭），
    // 后者为 0 意味着台账被搬空，于是每个未覆盖端点都会红在 UNLEDGED 上。
    expect(limited.length).toBeGreaterThan(0);
    expect(exempt.length).toBeGreaterThan(0);
    expect(limited.length + exempt.length).toBe(handlers.length);
    expect(Object.keys(RATE_LIMIT_LEDGER).length).toBe(exempt.length);
  });

  it("每条豁免的理由都不是套话，且没有两条是一模一样的复制粘贴", () => {
    const reasons = Object.entries(RATE_LIMIT_LEDGER).map(([id, entry]) => {
      expect(entry.reason.trim().length, id).toBeGreaterThan(20);
      return entry.reason;
    });
    expect(new Set(reasons).size).toBe(reasons.length);
  });

  it("写明理由的端点里没有任何一条是会话面的（有登录态的写入端点应当直接补窗口）", () => {
    // 这条判据把台账里最容易犯懒的方向堵住：mock / cron / 签名回调可以论证「不需要窗口」，
    // 「用户会话 + 没有窗口」则是纯粹的漏配。真实仓库目前 0 条，出现任何一条都要先解释。
    const exemptIds = new Set(exempt.map((item) => item.id));
    const sessionExempts = Object.keys(RATE_LIMIT_LEDGER).filter(
      (id) => exemptIds.has(id) && handlers.find((item) => item.id === id)?.reachable.includes("requireAuth"),
    );
    expect(sessionExempts).toEqual([]);
  });

  it("复现这个门禁真正要拦的东西：新加一条没有窗口的端点会红", () => {
    // 不是改台账、是改解析结果——模拟有人写了个没限流也没登记的端点。
    const withNaked = [...handlers, handler("POST /api/brand-new")];
    const issues = auditRateLimits(withNaked, RATE_LIMIT_LEDGER);
    expect(codes(issues)).toEqual(["RATE_LIMIT_UNLEDGED"]);
    expect(subjects(issues)).toEqual(["POST /api/brand-new"]);
  });

  it("缺口这一类不为空，且读数里带着它的条数（不把「还没做」写成「已判定」）", () => {
    const gaps = Object.entries(RATE_LIMIT_LEDGER).filter(([id, entry]) => {
      const marked = entry.reason.startsWith(RATE_LIMIT_GAP_MARKER);
      if (marked) expect(entry.reason, id).toMatch(/#\d+|关掉它的判据|怎么关/);
      return marked;
    });
    expect(gaps.length).toBeGreaterThan(0);
    expect(summarizeRateLimits(handlers)).toContain(`其中 ${gaps.length} 条标注为已知缺口`);
  });

  it("CLI 在真实仓库上退 0，并且把两个分母打出来", () => {
    const logs: string[] = [];
    const errors: string[] = [];
    const log = console.log;
    const err = console.error;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));
    console.error = (...args: unknown[]) => errors.push(args.join(" "));
    try {
      expect(runRouteAuthCheck()).toBe(0);
    } finally {
      console.log = log;
      console.error = err;
    }
    expect(errors).toEqual([]);
    expect(logs.join("\n")).toContain("限流两态台账一致");
    expect(logs.join("\n")).toMatch(/= \d+ 个有窗口 \+ \d+ 个写明理由/);
    expect(summarizeRateLimits(handlers)).toContain("台账共");
  });
});
