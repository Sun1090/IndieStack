/**
 * 路由鉴权清单门禁单测（C11）。
 *
 * 三层：① 用合成源码证明解析器真的沿调用图走（同文件局部函数、跨文件 import、常量、
 * 属性访问各自的形态），并且不被同名噪音误导；② 用注入的台账证明六种偏差每种都会红；
 * ③ 对真实仓库复算一遍，确认 45 个 handler 全部对上、并且把深度上限放宽之后结论不变
 * ——否则「范围被调浅」和「范围本来就窄」在输出里分不开。
 */
import { describe, expect, it } from "vitest";
import { buildRouteAuthSources, runRouteAuthCheck } from "../../../scripts/lib/route-auth-check.js";
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

describe("真实仓库", () => {
  // IO 层是 .js（无类型），这里显式标注，后面的闭包参数才不会退化成隐式 any
  const sources: RouteAuthSource[] = buildRouteAuthSources();
  const handlers = collectRouteHandlers(sources);

  it("45 个 handler 全部解析出来，并且与台账双向一致", () => {
    expect(handlers.length).toBe(45);
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
});
