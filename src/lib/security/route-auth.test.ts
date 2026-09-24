/**
 * 路由鉴权清单门禁单测（C11）。
 *
 * 三层：① 用合成源码证明解析器真的沿调用图走（同文件局部函数、跨文件 import、常量、
 * 属性访问各自的形态），并且不被同名噪音误导；② 用注入的台账证明六种偏差每种都会红；
 * ③ 对真实仓库复算一遍，确认台账与解析结果双向一致、并且把深度上限放宽之后结论不变
 * ——否则「范围被调浅」和「范围本来就窄」在输出里分不开。handler 条数在这层只作地板值：
 * 它是会随仓库增长的量，钉成等号就是给每个新增端点的 PR 埋一次红灯。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildRouteAuthSources,
  rateLimitReport,
  runRouteAuthCheck,
} from "../../../scripts/lib/route-auth-check.js";
import {
  auditRouteAuth,
  collectRouteHandlers,
  formatRouteAuthIssues,
  MAX_CALL_DEPTH,
  PROTECTION_SYMBOLS,
  ROUTE_AUTH_LEDGER,
  type RouteAuthEntry,
  type RouteAuthSource,
  type RouteHandlerFact,
} from "./route-auth";

const ROUTE_FILE = "src/app/api/widgets/route.ts";

function source(file: string, text: string): RouteAuthSource {
  return { file, text };
}

/** 只留判定需要的字段，避免断言被行号 / 位置牵着走。 */
function factByMethod(method: string, file = ROUTE_FILE) {
  return (handlers: RouteHandlerFact[]) =>
    handlers.find((handler) => handler.method === method && handler.file === file);
}

describe("collectRouteHandlers：调用图解析", () => {
  it("从目录推出 /api 路径，并只收导出的 HTTP 方法", () => {
    const handlers = collectRouteHandlers([
      source(
        ROUTE_FILE,
        `import { requireAuth } from "@/lib/auth/guards";
export async function GET() { await requireAuth(); return Response.json({}); }
export async function POST() { return Response.json({}); }
async function helper() { return 1; }
export function notAMethod() { return 2; }
`,
      ),
    ]);
    expect(handlers.map((handler) => handler.id)).toEqual(["GET /api/widgets", "POST /api/widgets"]);
  });

  it("一条 handler 都没有时返回空集合，交给上层失败封闭", () => {
    expect(collectRouteHandlers([source("src/app/page.tsx", "export default function Page() { return null; }")])).toEqual([]);
  });

  it("跨文件 import 的守卫算可达（上传端点就是这个形态）", () => {
    const handlers = collectRouteHandlers([
      source(
        ROUTE_FILE,
        `import { guardUploadRequest } from "@/lib/uploads/request";
export async function POST() { await guardUploadRequest(); return Response.json({}); }
`,
      ),
      source(
        "src/lib/uploads/request.ts",
        `export async function guardUploadRequest() { return true; }`,
      ),
    ]);
    expect(factByMethod("POST")(handlers)?.reachable).toContain("guardUploadRequest");
  });

  it("同文件的局部 helper 里才有守卫时也算可达（e2e 收件箱的 authOk 就是这个形态）", () => {
    const handlers = collectRouteHandlers([
      source(
        ROUTE_FILE,
        `function authOk(request: { headers: Headers }): boolean {
  return request.headers.get("authorization") === "Bearer x";
}
export async function GET(request: { headers: Headers }) {
  if (!authOk(request)) return new Response(null, { status: 401 });
  return Response.json({});
}
`,
      ),
    ]);
    expect(factByMethod("GET")(handlers)?.reachable).toEqual(["authOk"]);
  });

  it("常量守卫要求它真的是本文件的 import 或顶层声明", () => {
    const withImport = collectRouteHandlers([
      source(
        ROUTE_FILE,
        `import { isMockEnabled } from "@/lib/mock/config";
export async function GET() { if (!isMockEnabled) return new Response(null, { status: 404 }); return Response.json({}); }
`,
      ),
      source("src/lib/mock/config.ts", "export const isMockEnabled = false;"),
    ]);
    expect(factByMethod("GET")(withImport)?.reachable).toEqual(["isMockEnabled"]);

    // 同名局部变量不是那个守卫：没有 import 也没有顶层声明时不该算
    const shadowed = collectRouteHandlers([
      source(
        ROUTE_FILE,
        `export async function GET() { const isMockEnabled = false; if (!isMockEnabled) return Response.json({}); return Response.json({}); }
`,
      ),
    ]);
    expect(factByMethod("GET")(shadowed)?.reachable).not.toContain("isMockEnabled");
  });

  it("`process.env.CRON_SECRET` 这种属性访问形态也认", () => {
    const handlers = collectRouteHandlers([
      source(
        ROUTE_FILE,
        `export async function POST(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (request.headers.get("authorization") !== \`Bearer \${expected}\`) return new Response(null, { status: 401 });
  return Response.json({});
}
`,
      ),
    ]);
    expect(factByMethod("POST")(handlers)?.reachable).toEqual(["CRON_SECRET"]);
  });

  it("原型链上的名字不算守卫：`x.toString()` 与 `Object.prototype.hasOwnProperty` 都曾让每个文件看起来有守卫", () => {
    const handlers = collectRouteHandlers([
      source(
        ROUTE_FILE,
        `export async function GET() {
  const seen = new Set<string>();
  void String({}).toString();
  void Object.prototype.hasOwnProperty.call(seen, "a");
  return Response.json({});
}
`,
      ),
    ]);
    expect(factByMethod("GET")(handlers)?.reachable).toEqual([]);
  });

  it("无关的同名方法（推送订阅的 unsubscribe）不会被当成营销 token 守卫", () => {
    const handlers = collectRouteHandlers([
      source(
        ROUTE_FILE,
        `import { store } from "@/lib/notifications/store";
export async function DELETE() { store.unsubscribe("topic"); return Response.json({}); }
`,
      ),
      source("src/lib/notifications/store.ts", "export const store = { unsubscribe(topic: string) { return topic; } };"),
    ]);
    expect(factByMethod("DELETE")(handlers)?.reachable).toEqual([]);
  });

  it("环状 import 不会把解析器吊死，并且展开到上限时如实计数", () => {
    const handlers = collectRouteHandlers([
      source(
        ROUTE_FILE,
        `import { ping } from "@/lib/ping";
export async function GET() { ping(0); return Response.json({}); }
`,
      ),
      source(
        "src/lib/ping.ts",
        `import { ping } from "@/lib/ping";
import { requireAuth } from "@/lib/auth/guards";
export function ping(depth: number) { if (depth > 20) return requireAuth(); return ping(depth + 1); }
`,
      ),
      source("src/lib/auth/guards.ts", "export async function requireAuth() { return null; }"),
    ], 2);
    const fact = factByMethod("GET")(handlers);
    expect(fact?.truncated).toBeGreaterThan(0);
    // 名字是在被展开的那个子树里收集的，所以哪怕没继续往里走，`requireAuth` 已经被看见
    expect(fact?.reachable).toEqual(["requireAuth"]);
  });
});

describe("auditRouteAuth：台账核对", () => {
  const handler = (overrides: Partial<RouteHandlerFact> = {}): RouteHandlerFact => ({
    id: "GET /api/widgets",
    method: "GET",
    route: "/api/widgets",
    file: ROUTE_FILE,
    reachable: ["requireAuth"],
    limiters: [],
    truncated: 0,
    ...overrides,
  });
  const ledger = (id: string, entry: RouteAuthEntry) => ({ [id]: entry });
  const codes = (issues: { code: string }[]) => issues.map((issue) => issue.code);

  function auditWith(entry: RouteAuthEntry | undefined, fact = handler()) {
    return auditRouteAuth([fact], entry ? ledger(fact.id, entry) : {});
  }

  it("解析不出任何 handler 时报 NO_HANDLERS，而不是「一切正常」", () => {
    const issues = auditRouteAuth([]);
    expect(codes(issues)).toEqual(["ROUTE_AUTH_NO_HANDLERS"]);
  });

  it("有 handler 没台账 → UNLEDGED，并说明该登记什么", () => {
    const issues = auditWith(undefined);
    expect(codes(issues)).toEqual(["ROUTE_AUTH_UNLEDGED"]);
    expect(formatRouteAuthIssues(issues)).toContain("ROUTE_AUTH_LEDGER");
  });

  it("台账里剩着一条代码已没有的路由 → STALE", () => {
    const issues = auditRouteAuth(
      [],
      ledger("DELETE /api/gone", { family: "session", via: ["requireAuth"], reason: "" }),
    );
    // 空 handler 集合先被失败封闭拦住，所以这里给一条别的路由，让 stale 单独显形
    const mixed = auditRouteAuth(
      [handler()],
      {
        "GET /api/widgets": { family: "session", via: ["requireAuth"], reason: "会话内" },
        "DELETE /api/gone": { family: "session", via: ["requireAuth"], reason: "已删的路由" },
      },
    );
    expect(codes(issues)).toEqual(["ROUTE_AUTH_NO_HANDLERS"]);
    expect(codes(mixed)).toEqual(["ROUTE_AUTH_STALE"]);
  });

  it("声明的守卫不再可达 → GUARD_MISSING（把 requireAuth 删掉就是这个）", () => {
    const issues = auditWith(
      { family: "session", via: ["requirePermission"], reason: "需要权限" },
      handler({ reachable: ["requireAuth"] }),
    );
    expect(codes(issues)).toEqual(["ROUTE_AUTH_GUARD_MISSING"]);
    expect(formatRouteAuthIssues(issues)).toContain("requirePermission");
  });

  it("非 public 家族却不写任何 via → GUARD_MISSING：没有可核对的守卫就等于没登记", () => {
    const issues = auditWith({ family: "session", via: [], reason: "懒得写" });
    expect(codes(issues)).toEqual(["ROUTE_AUTH_GUARD_MISSING"]);
  });

  it("via 里的符号不在词表内时，报的是「词表之外」而不是空家族", () => {
    const issues = auditWith(
      { family: "session", via: ["totallyUnknownGuard"], reason: "写了个不存在的守卫名" },
      handler({ reachable: ["totallyUnknownGuard"] }),
    );
    expect(codes(issues)).toEqual(["ROUTE_AUTH_FAMILY_MISMATCH"]);
    expect(formatRouteAuthIssues(issues)).toContain("词表之外");
  });

  it("没有函数体的导出声明（重载签名）不会被当成 handler", () => {
    const handlers = collectRouteHandlers([
      source(
        ROUTE_FILE,
        `export async function GET(): Promise<Response>;
export async function GET(request: Request) { return Response.json({}); }
`,
      ),
    ]);
    expect(handlers.map((item) => item.id)).toEqual(["GET /api/widgets"]);
  });

  it("public 端点必须有 reason", () => {
    const issues = auditWith({ family: "public", via: [], reason: "   " });
    expect(codes(issues)).toEqual(["ROUTE_AUTH_REASON_MISSING"]);
  });

  it("家族与 via 不符 → FAMILY_MISMATCH（把 origin 守卫写成 session）", () => {
    const issues = auditWith(
      { family: "session", via: ["sameOrigin"], reason: "同源" },
      handler({ reachable: ["sameOrigin"] }),
    );
    expect(codes(issues)).toEqual(["ROUTE_AUTH_FAMILY_MISMATCH"]);
  });

  it("via 里混入别的家族不算错，只要有一条兑现声明的家族（收件箱 = mock + bearer）", () => {
    const issues = auditWith(
      { family: "shared-secret", via: ["authOk", "isMockEnabled"], reason: "收件箱有邮件原文" },
      handler({ reachable: ["authOk", "isMockEnabled"] }),
    );
    expect(issues).toEqual([]);
  });

  it("一致的台账不产生任何 issue", () => {
    expect(auditWith({ family: "session", via: ["requireAuth"], reason: "读自己的数据" })).toEqual([]);
  });
});

describe("限流器绑定（roadmap C12 的现量口径：只报数，不判定）", () => {
  // 判据要求 import 真能解析到模块，所以夹具里也得摆上那个库——不然测的是「路径没解析动」而不是判据
  const RATE_LIMIT_STUB = source(
    "src/lib/rate-limit.ts",
    `export function createRateLimit() { return { check: async () => ({ allowed: true, resetIn: 0 }) }; }
export const rateLimit = createRateLimit();
export function isIpLike(value: string) { return value.length > 0; }`,
  );
  const limitersOf = (list: RouteAuthSource[], method = "POST", file = ROUTE_FILE) =>
    collectRouteHandlers([...list, RATE_LIMIT_STUB]).find(
      (item) => item.method === method && item.file === file,
    )?.limiters ?? [];

  it("库导出的单例被当对象取成员：算", () => {
    expect(
      limitersOf([
        source(
          ROUTE_FILE,
          `import { rateLimit } from "@/lib/rate-limit";
export async function POST(request: Request) {
  const limits = await rateLimit.check(request);
  if (!limits.allowed) return Response.json({}, { status: 429 });
  return Response.json({});
}`,
        ),
      ]),
    ).toEqual([`${ROUTE_FILE}#rateLimit`]);
  });

  it("工厂实例的绑定名由作者起，判据不靠名字表", () => {
    const limiters = limitersOf([
      source(
        ROUTE_FILE,
        `import { createRateLimit } from "@/lib/rate-limit";
const whateverNameYouLike = createRateLimit({ maxRequests: 10, windowMs: 60_000 });
export async function POST(request: Request) {
  await whateverNameYouLike.check(request);
  return Response.json({});
}`,
      ),
    ]);
    expect(limiters).toEqual([`${ROUTE_FILE}#whateverNameYouLike`]);
    // 工厂本身不是限流器，它是造限流器的那只手；报出来只会让报告里每行都多一个噪音
    expect(limiters).not.toContain(`${ROUTE_FILE}#createRateLimit`);
  });

  it("限流器在跨文件的 helper 里也算（上传端点就是这个形态）", () => {
    expect(
      limitersOf([
        source(
          ROUTE_FILE,
          `import { guardUploadRequest } from "@/lib/uploads/request";
export async function POST() { await guardUploadRequest(); return Response.json({}); }`,
        ),
        source(
          "src/lib/uploads/request.ts",
          `import { rateLimit } from "@/lib/rate-limit";
export async function guardUploadRequest() {
  const limits = await rateLimit.check(null);
  return limits;
}`,
        ),
      ]),
    ).toEqual(["src/lib/uploads/request.ts#rateLimit"]);
  });

  it("只是从库里 import 一个函数来调用，不算限流器", () => {
    expect(
      limitersOf([
        source(
          ROUTE_FILE,
          `import { isIpLike } from "@/lib/rate-limit";
export async function POST() { if (!isIpLike("1.2.3.4")) return Response.json({}); return Response.json({}); }`,
        ),
      ]),
    ).toEqual([]);
  });

  it("同名但自己声明的对象不算：判据要的是来源", () => {
    expect(
      limitersOf([
        source(
          ROUTE_FILE,
          `const rateLimit = { check: async () => ({ allowed: true }) };
export async function POST() { await rateLimit.check(); return Response.json({}); }`,
        ),
      ]),
    ).toEqual([]);
  });

  it("同文件的另一个 handler 才用限流器时，本 handler 不被算成有覆盖", () => {
    const list = [
      source(
        ROUTE_FILE,
        `import { rateLimit } from "@/lib/rate-limit";
export async function GET() { return Response.json({}); }
export async function POST(request: Request) { await rateLimit.check(request); return Response.json({}); }`,
      ),
    ];
    expect(limitersOf(list, "GET")).toEqual([]);
    expect(limitersOf(list, "POST")).toEqual([`${ROUTE_FILE}#rateLimit`]);
  });

  // 报告的「一条都没匹配到」那一支是一次真的控制：没有它，判据整体失效也会打印一张全空的表并退出 0
  it("报告在真实仓库上退出 0，在为空的仓库里退出 1（而不是安静地给一张全空的表）", () => {
    expect(rateLimitReport()).toBe(0);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rate-report-"));
    try {
      const dir = path.join(root, "src/app/api/probe");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "route.ts"),
        `export async function POST() { return Response.json({}); }\n`,
        "utf8",
      );
      expect(rateLimitReport(root)).toBe(1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("真实仓库", () => {
  // IO 层是 .js（无类型），这里显式标注，后面的闭包参数才不会退化成隐式 any
  const sources: RouteAuthSource[] = buildRouteAuthSources();
  const handlers = collectRouteHandlers(sources);

  it("真实仓库的 handler 全部解析出来，并且与台账双向一致", () => {
    // 地板值，不是等号：新增一条端点只要台账跟着登记就该通过（台账漏了会红在 UNLEDGED），
    // 而等号等于要求每个加路由的 PR 回来改这个数——忘了改挡不住任何错误，只在合并后的 main 上
    // 红出一场不存在的回归。地板防的是另一件事：解析范围被调窄时条数会往下掉，而「掉了一半」
    // 和「路由本来就这么几条」在输出里长得一样。精确读数由 `pnpm check:route-auth` 现量。
    expect(handlers.length).toBeGreaterThanOrEqual(45);
    expect(auditRouteAuth(handlers)).toEqual([]);
  });

  it("解析条数与一个独立分母一致（换写法的路由不会静默漏掉）", () => {
    const routeSources = sources.filter((item) => item.file.startsWith("src/app/api/"));
    const declared = routeSources.reduce(
      (total, item) => total + (item.text.match(/^export (?:async )?function (?:GET|POST|PUT|PATCH|DELETE)\b/gm) ?? []).length,
      0,
    );
    expect(declared).toBe(handlers.length);
    // 另一种导出形态目前不存在；哪天有人这么写，这条会红并提醒扩解析器
    const otherShape = routeSources.filter((item) =>
      /export const (?:GET|POST|PUT|PATCH|DELETE)\b|export \{[^}]*\bas (?:GET|POST|PUT|PATCH|DELETE)\b/.test(item.text),
    );
    expect(otherShape.map((item) => item.file)).toEqual([]);
  });

  it("放宽调用图深度之后结论不变（证明上限没有把守卫藏在下面）", () => {
    const deeper = collectRouteHandlers(sources, MAX_CALL_DEPTH + 15);
    expect(deeper.map((item) => `${item.id}=[${item.reachable.join(",")}]`)).toEqual(
      handlers.map((item) => `${item.id}=[${item.reachable.join(",")}]`),
    );
    expect(auditRouteAuth(deeper)).toEqual([]);
  });

  it("每一条 public 的理由都不是套话", () => {
    const publicEntries = handlers
      .filter((item) => ROUTE_AUTH_LEDGER[item.id]?.family === "public")
      .map((item) => ROUTE_AUTH_LEDGER[item.id]);
    expect(publicEntries.length).toBeGreaterThan(0);
    for (const entry of publicEntries) {
      expect(entry.reason.length).toBeGreaterThan(20);
      expect(entry.via).toEqual([]);
    }
  });

  it("复现那个真实缺陷：把收件箱 GET 的 bearer 摘掉，门禁必须只红在这一条上", () => {
    const inbox = sources.find((item) => item.file === "src/app/api/e2e/email-inbox/route.ts");
    expect(inbox).toBeDefined();
    const marker = "export async function GET";
    const at = inbox?.text.indexOf(marker) ?? -1;
    expect(at).toBeGreaterThan(-1);
    const head = inbox?.text.slice(0, at) ?? "";
    const tail = (inbox?.text.slice(at) ?? "").replace("if (!authOk(request))", "if (false)");
    expect(tail).not.toBe(inbox?.text.slice(at));

    const mutated = sources.map((item) =>
      item.file === inbox?.file ? source(item.file, `${head}${tail}`) : item,
    );
    const issues = auditRouteAuth(collectRouteHandlers(mutated));
    expect(issues.map((item) => `${item.code} ${item.subject}`).sort()).toEqual([
      "ROUTE_AUTH_GUARD_MISSING GET /api/e2e/email-inbox",
    ]);
  });

  it("CLI 在真实仓库上退出 0", () => {
    expect(runRouteAuthCheck()).toBe(0);
  });

  it("词表里每个符号都真的存在于源码：一条不存在的守卫只会给读者一个错觉", () => {
    // 排掉门禁自己的文件，否则「表里写了」就等于「源码里有」，这条断言恒真
    const corpus = sources
      .filter((item) => !item.file.endsWith("security/route-auth.ts"))
      .map((item) => item.text)
      .join("\n");
    const dead = Object.keys(PROTECTION_SYMBOLS).filter(
      (symbol) => !new RegExp(`\\b${symbol}\\b`).test(corpus),
    );
    expect(dead).toEqual([]);
  });

  it("限流器读数与一个独立的 grep 分母一致，并且解释得清多出来的那几条", () => {
    const withLimiters = handlers.filter((item) => item.limiters.length > 0);
    // 分母用不着解析器：直接 import 了限流库的路由文件，它的每个 handler 都必须被读到
    const direct = new Set(
      sources
        .filter((item) => item.file.startsWith("src/app/api/") && /from "@\/lib\/rate-limit"/.test(item.text))
        .map((item) => item.file),
    );
    const reported = new Set(withLimiters.map((item) => item.file));
    for (const file of direct) expect(reported.has(file), `${file} 自己 import 了限流库却没被读到`).toBe(true);
    // 报出来的每一条来路都必须真能在那个文件里对上：那个文件确实 import 了限流库。
    // 「多出来 2 条」只有在这种意义上才可核对，而不是因为 helper 文件存在于源码里就算解释过
    const textByFile = new Map(sources.map((item) => [item.file, item.text]));
    for (const item of withLimiters) {
      for (const binding of item.limiters) {
        const [file] = binding.split("#");
        expect(textByFile.get(file) ?? "", `${file} 并没有 import 限流库`).toMatch(/from "@\/lib\/rate-limit"/);
      }
    }
    // 上传两条是「限流器在 helper 里」的那个形态：路由自己不 import，靠 guardUploadRequest 走到
    const uploads = handlers.filter((item) => item.route.startsWith("/api/uploads/"));
    expect(uploads.map((item) => item.id).sort()).toEqual([
      "POST /api/uploads/avatar",
      "POST /api/uploads/project-cover",
    ]);
    for (const item of uploads) {
      expect(item.limiters).toEqual(["src/lib/uploads/request.ts#rateLimit"]);
    }
    // 地板值，不是等号：这条读数会随「又给哪条端点加了窗口」往上走，钉成等号就是给每个
    // 后来的 PR 埋一次红灯。精确的数由 `pnpm check:route-auth --rate-limit-report` 现量；
    // 地板要防的是另一件事——判据自己坏掉时读数会掉到 0，而 0 看起来和「没人加窗口」一样干净。
    expect(withLimiters.length).toBeGreaterThanOrEqual(14);
    // 会话与公开两族必须有窗口（用户直接打的那两族）。读数里冒出别的族不算错，但那是一次
    // 该被人看见的扩容，所以只放行到这里点得到的范围
    const families = new Set(withLimiters.map((item) => ROUTE_AUTH_LEDGER[item.id].family));
    for (const family of ["session", "public"] as const) {
      expect(families.has(family), `${family} 族一条限流器都没读到`).toBe(true);
    }
    // 反向的边界：今天有窗口的只有这三族（token 那两条来自营销端点）。多出一族是一次
    // 该被评审的扩容——C12 要定的正是「哪些端点必须有窗口」，所以这里宁可红一声。
    for (const family of [...families]) {
      expect(["public", "session", "token"], `${family} 族读到了限流器，但这条测试不认识它`).toContain(
        family,
      );
    }
    expect(handlers.filter((item) => ROUTE_AUTH_LEDGER[item.id].family === "session").every((item) => item.limiters.length > 0)).toBe(true);
  });
});
