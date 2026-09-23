/**
 * 预热清单与 spec 实际导航目标的双向对账（v0.12.0 / C02 冷编译计时）。
 *
 * 这里最要紧的是「清单不会自己腐烂」：新加一条导航到没预热过的页面的 spec，或者反过来
 * 预热了一条已经没人导航的路由，都必须红。真实仓库那条用例同时是解析器的射程证明。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectNavigatedRoutes,
  formatWarmRouteIssues,
  inspectWarmRoutes,
  WARM_ROUTES,
  type E2eSpecSource,
} from "./e2e-warm-routes";

const REPO_ROOT = process.cwd();

const source = (file: string, ...lines: string[]): E2eSpecSource => ({
  file,
  content: lines.join("\n"),
});

const codesOf = (sources: readonly E2eSpecSource[], warm?: readonly string[]) =>
  inspectWarmRoutes(sources, warm).map((issue) => issue.code);

describe("collectNavigatedRoutes()", () => {
  it("读 `${appUrl()}<path>` 的尾巴：去重、排序、裸 appUrl() 算站点根", () => {
    const routes = collectNavigatedRoutes([
      source("a.spec.ts", 'page.goto(`${appUrl()}/dashboard`);', 'page.goto(`${appUrl()}/contact`);'),
      source("b.spec.ts", 'page.goto(`${appUrl()}/dashboard`);', "page.goto(`${appUrl()}`);"),
    ]);
    expect(routes).toEqual(["/", "/contact", "/dashboard"]);
  });

  it("查询、hash 与结尾斜杠都不产生新路由", () => {
    expect(
      collectNavigatedRoutes([
        source(
          "a.spec.ts",
          'get(`${appUrl()}/contact?x=1`);',
          'get(`${appUrl()}/contact#top`);',
          'get(`${appUrl()}/dashboard/`);',
        ),
      ]),
    ).toEqual(["/contact", "/dashboard"]);
  });

  it("API 端点与动态路径不预热，404 探针也不是页面", () => {
    expect(
      collectNavigatedRoutes([
        source(
          "a.spec.ts",
          'post(`${appUrl()}/api/e2e/mock-reset`);',
          'get(`${appUrl()}/dashboard/${id}`);',
          'goto(`${appUrl()}/this-page-does-not-exist`);',
        ),
      ]),
    ).toEqual([]);
  });

  it("waitForURL 的 glob 与 baseURL 相对路径不算导航目标", () => {
    expect(
      collectNavigatedRoutes([source("a.spec.ts", 'page.waitForURL("**/dashboard**");')]),
    ).toEqual([]);
  });
});

describe("inspectWarmRoutes()", () => {
  it("清单齐平时没有问题", () => {
    const sources = [source("a.spec.ts", 'goto(`${appUrl()}/contact`);')];
    expect(inspectWarmRoutes(sources, ["/contact"])).toEqual([]);
  });

  it("spec 导航到没预热的路由 → E2E_WARM_MISSING，并点名是哪条", () => {
    const issues = inspectWarmRoutes([source("a.spec.ts", 'goto(`${appUrl()}/pricing`);')], []);
    expect(issues.map((issue) => issue.code)).toEqual(["E2E_WARM_MISSING"]);
    expect(issues[0]?.message).toContain("/pricing");
  });

  it("预热了没人导航的路由 → E2E_WARM_STALE：两台服务器各白等一次编译", () => {
    const issues = inspectWarmRoutes([source("a.spec.ts", 'goto(`${appUrl()}/contact`);')], [
      "/contact",
      "/gone-page",
    ]);
    expect(issues.map((issue) => issue.code)).toEqual(["E2E_WARM_STALE"]);
    expect(issues[0]?.message).toContain("/gone-page");
  });

  it("一份 spec 都没读到是问题，不是干净", () => {
    expect(codesOf([])).toEqual(["E2E_WARM_NO_SOURCES"]);
    expect(formatWarmRouteIssues(inspectWarmRoutes([]))).toContain("[E2E_WARM_NO_SOURCES]");
  });

  it("读到了 spec 却一条导航都没解析到 → 解析器失效，报空清单", () => {
    expect(codesOf([source("a.spec.ts", "test('x', async () => {});")])).toEqual([
      "E2E_WARM_EMPTY_LIST",
    ]);
  });
});

describe("真实仓库", () => {
  function specSources(): E2eSpecSource[] {
    return fs
      .readdirSync(path.join(REPO_ROOT, "e2e"))
      .filter((name) => name.endsWith(".spec.ts"))
      .map((name) => ({
        file: `e2e/${name}`,
        content: fs.readFileSync(path.join(REPO_ROOT, "e2e", name), "utf8"),
      }));
  }

  it("解析器打得到东西：导航目标不止个位数，且清单与读数完全一致", () => {
    const navigated = collectNavigatedRoutes(specSources());
    expect(navigated.length).toBeGreaterThan(9);
    expect([...WARM_ROUTES].sort()).toEqual(navigated);
  });

  it("双向对账没有意见（漏预热与腐烂的清单都会在这儿红）", () => {
    expect(inspectWarmRoutes(specSources())).toEqual([]);
  });

  it("warm-up 真的用这份清单，而不是自己抄一份", () => {
    const warmUp = fs.readFileSync(path.join(REPO_ROOT, "e2e/support/warm-up.ts"), "utf8");
    expect(warmUp).toContain(`from "../../src/lib/testing/e2e-warm-routes"`);
    expect(warmUp).toContain("WARM_ROUTES");
    // 自己再写一份字面量清单，就是下一轮腐烂的开始。
    expect(warmUp).not.toMatch(/const ROUTES\s*=\s*\[/);
  });
});
