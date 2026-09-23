/**
 * 并行基线的预热清单，以及防止它腐烂的对账（v0.12.0 / C02 的「冷编译计时」）。
 *
 * `next dev` 是**按路由**冷编译的：第一个打到某台服务器的用例要替所有人付这个钱。并行模式里
 * 这就是 C02 记过的那批红的形状（`uploads` 登录后 `waitForURL` 15s、`smoke` 的 `page.goto` 60s +
 * `ERR_ABORTED`），所以 `e2e/support/warm-up.ts` 在跑测试前先逐个 GET 一遍。
 *
 * 清单会腐烂：新增一条 spec 导航去一个新页面，没有人回头补预热。所以这里同时提供
 * 「从 spec 源码静态读出实际导航目标」的解析器，单测拿它和清单**双向**对账（漏的、多的都算问题）。
 *
 * 两个口径是量出来的，不是猜的：
 *   - mock 模式下未登录 GET `/dashboard/**` 返回 **200**（不是 307 回登录页），所以预热真的编译到
 *     那个页面本身，而不是登录页；
 *   - 一条没预热过的路由，首次命中在这里量到 `next.js: 1215ms`（`/pricing`），
 *     而清单里 16 条一起预热的总代价是十秒级——买的是「第一个用例不再掷骰子」。
 */

export interface E2eSpecSource {
  /** 仓库相对路径，用于报错时点名。 */
  file: string;
  content: string;
}

export type E2eWarmRouteCode =
  | "E2E_WARM_NO_SOURCES"
  | "E2E_WARM_EMPTY_LIST"
  | "E2E_WARM_MISSING"
  | "E2E_WARM_STALE";

export interface E2eWarmRouteIssue {
  code: E2eWarmRouteCode;
  message: string;
}

/**
 * 故意不存在的探针路径：spec 用它断言 404 页，它不是一个页面，预热它没有意义。
 * （`appUrl()` 的导航目标里只有这一条是这种性质，量出来的。）
 */
export const NON_PAGE_ROUTES: ReadonlySet<string> = new Set(["/this-page-does-not-exist"]);

/**
 * 并行基线在跑测试之前替每台服务器编译的路由。
 * 这份清单与 `collectNavigatedRoutes()` 的读数一一对应，由单测双向钉住。
 */
export const WARM_ROUTES: readonly string[] = [
  "/",
  "/auth/login",
  "/auth/register",
  "/auth/forgot-password",
  "/auth/reset-password",
  "/auth/mfa",
  "/dashboard",
  "/dashboard/settings",
  "/dashboard/notifications",
  "/dashboard/profile/edit",
  "/dashboard/admin",
  "/dashboard/admin/users",
  "/dashboard/admin/messages",
  "/dashboard/admin/audit-logs",
  "/dashboard/admin/webhooks",
  "/contact",
];

/** spec 里的导航目标一律写成 `${appUrl()}<path>`（并行模式一台 worker 一台服务器，见 base-url.ts）。 */
const NAVIGATION_PATTERN = /appUrl\(\)\}([^'"`]*)/g;

/** 把一次导航的尾巴收成路由名：去掉查询与 hash，空串算站点根。 */
function routeOf(tail: string): string | null {
  if (tail.includes("${")) return null; // 路径本身是动态的，预热不了「不知道是哪个」的路由
  const path = tail.split(/[?#]/, 1)[0];
  if (path === "") return "/";
  if (!path.startsWith("/")) return null;
  const withoutApi = path.startsWith("/api/") ? null : path;
  if (withoutApi === null) return null;
  const trimmed = withoutApi.length > 1 ? withoutApi.replace(/\/+$/, "") : withoutApi;
  return NON_PAGE_ROUTES.has(trimmed) ? null : trimmed;
}

/**
 * 从 spec 源码里读出所有真正被导航到的页面路由（去重、按字典序）。
 * 只看 `appUrl()` 的尾巴，所以 `waitForURL` 的 glob 与 `/api/*` 端点不会混进来。
 */
export function collectNavigatedRoutes(
  sources: readonly E2eSpecSource[],
): string[] {
  const found = new Set<string>();
  for (const source of sources) {
    const pattern = new RegExp(NAVIGATION_PATTERN.source, "g");
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source.content)) !== null) {
      const route = routeOf(match[1] ?? "");
      if (route !== null) found.add(route);
    }
  }
  return [...found].sort();
}

/** 双向对账：漏预热与「清单里有、spec 已经不再导航过去」都报出来。 */
export function inspectWarmRoutes(
  sources: readonly E2eSpecSource[],
  warmRoutes: readonly string[] = WARM_ROUTES,
): E2eWarmRouteIssue[] {
  const issues: E2eWarmRouteIssue[] = [];
  if (sources.length === 0) {
    return [
      {
        code: "E2E_WARM_NO_SOURCES",
        message: "一条 spec 源码都没读到，预热清单无从对账（扫描范围失效，不是「没问题」）。",
      },
    ];
  }

  const navigated = collectNavigatedRoutes(sources);
  if (navigated.length === 0) {
    return [
      {
        code: "E2E_WARM_EMPTY_LIST",
        message:
          `${sources.length} 份 spec 源码里一条导航目标都没解析到——解析器或写法变了，` +
          "而不是「这些用例不跳转」。",
      },
    ];
  }

  const warm = new Set(warmRoutes);
  const seen = new Set(navigated);
  const missing = navigated.filter((route) => !warm.has(route));
  const stale = warmRoutes.filter((route) => !seen.has(route));
  if (missing.length > 0) {
    issues.push({
      code: "E2E_WARM_MISSING",
      message: `这些路由被 spec 导航到，却不在预热清单里（第一个打到它的用例会付冷编译）：${missing.join(", ")}`,
    });
  }
  if (stale.length > 0) {
    issues.push({
      code: "E2E_WARM_STALE",
      message: `预热清单里有、spec 已不再导航到的路由：${stale.join(", ")}（每台服务器白等一次编译）`,
    });
  }
  return issues;
}

/** 打印用。 */
export function formatWarmRouteIssues(issues: readonly E2eWarmRouteIssue[]): string {
  return issues.map((issue) => `❌ [${issue.code}] ${issue.message}`).join("\n");
}
