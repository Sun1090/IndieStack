/**
 * CodeQL 告警对账 IO 层的单测（`scripts/lib/codeql-alert-check.js`）。
 *
 * ## 为什么测试放在 src/lib 下却测 scripts/lib
 *
 * 判定层（`codeql-alert-registry.ts`）已有 28 条单测，但 IO 层**一行都没有**。
 * 上一轮那句错误的因果解释（「严重度为 null 是因为缺 api-version header」）能一路进 main，
 * 结构性原因就是「字段在哪一层」的唯一决定点当时只存在于 IO 层。
 * 搬走映射逻辑只补了一半：另一半是**读实况这件事本身**也没人钉——
 * 而它决定的是这个探测最要命的分支：「读不到」到底会不会被显示成「一切正常」。
 *
 * 本仓库惯例是「规则进 src/lib 下才有单测」，但 vitest 的 node 项目只收
 * `src` 目录里的 `.test.ts`，所以沿用 `production-smoke-contract.test.ts` 的做法：
 * 测试文件放在 src/lib 下，import 指向 `scripts/lib` 的实现。
 *
 * ## 重点在四件事
 *
 *   1. 读不到 ⇒ 返回 `{error}`，**绝不**返回 `{alerts: []}`；
 *   2. 真读到空列表 ⇒ `{alerts: []}`，与上一条必须是两种不同的东西；
 *   3. 退出码 2（未知）优先于 1（有差集）——探测挂掉不能冒充「查过了」；
 *   4. 请求里带了什么（分页、header）——这是「读数可复现」的唯一凭据。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchOpenAlerts,
  parseArgs,
  readFixture,
  REQUIRED_API_VERSION,
  runCodeqlAlertCheck,
} from "../../../scripts/lib/codeql-alert-check.js";
import { CODEQL_ALERT_REGISTRY, type LiveAlert } from "./codeql-alert-registry";

const REPO_ROOT = process.cwd();

// `scripts/lib/codeql-alert-check.js` 是无标注的 JS：TS 从默认参数把 `env` 推成
// `NodeJS.ProcessEnv`（含必填的 NODE_ENV），又把返回值推成 `{error} | {options}` 联合。
// 下面三个 helper 把这层适配集中起来，避免每个断言都写 `!` 或 `as unknown as`——
// 那样做会把「这个分支真的返回了 options/alerts」这件事从断言里抹掉。
type ParsedArgs = { error?: string; options?: Record<string, unknown> };
type FetchResult = { alerts?: LiveAlert[]; error?: string };

/** 传 env 给 `parseArgs`；缺的键就是「环境里没有」，所以不必补 NODE_ENV。 */
function envOf(values: Record<string, string>): NodeJS.ProcessEnv {
  return values as NodeJS.ProcessEnv;
}

async function fetchAlerts(repo: string, token: string, apiBase?: string): Promise<FetchResult> {
  return (await fetchOpenAlerts(repo, token, apiBase)) as FetchResult;
}

/** 取 `fetchOpenAlerts` 成功分支的列表；失败时让断言在 undefined 上报错而不是静默通过。 */
function alertsOf(result: FetchResult): LiveAlert[] {
  expect(result.error).toBeUndefined();
  return result.alerts ?? [];
}

/** 取 `readFixture` 成功分支的列表，同上。 */
function fixtureAlerts(file: string, repoRoot: string = REPO_ROOT): LiveAlert[] {
  const result = readFixture(file, repoRoot) as FetchResult;
  expect(result.error).toBeUndefined();
  return result.alerts ?? [];
}

/** 构造一条 GitHub 真实嵌套形状的告警：严重度只在 `rule` 下面。 */
function rawAlert(number: number, overrides: Record<string, unknown> = {}) {
  return {
    number,
    state: "open",
    created_at: "2026-09-27T00:00:00Z",
    dismissed_reason: null,
    rule: { id: "js/log-injection", severity: "error", security_severity_level: "medium" },
    most_recent_instance: { location: { path: "src/lib/logger.ts" } },
    ...overrides,
  };
}

/** 一个最小 fetch 响应替身；只实现被测代码真正读的那几个成员。 */
function jsonResponse(
  body: unknown,
  init: { ok?: boolean; status?: number; statusText?: string } = {},
) {
  const ok = init.ok ?? true;
  const status = init.status ?? 200;
  return { ok, status, statusText: init.statusText ?? "OK", json: async () => body };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseArgs", () => {
  it("环境变量提供默认值：GITHUB_REPOSITORY / GITHUB_TOKEN，GH_TOKEN 是备选", () => {
    const parsed = parseArgs([], envOf({ GITHUB_REPOSITORY: "o/r", GH_TOKEN: "ghp_b" })) as ParsedArgs;
    expect(parsed.options).toEqual({
      repo: "o/r",
      token: "ghp_b",
      today: "",
      fixture: "",
      json: false,
      help: false,
    });
  });

  it("GITHUB_TOKEN 优先于 GH_TOKEN", () => {
    const parsed = parseArgs([], envOf({ GITHUB_TOKEN: "a", GH_TOKEN: "b" })) as ParsedArgs;
    expect(parsed.options?.token).toBe("a");
  });

  it("未知参数与缺值都返回 error，而不是静默忽略", () => {
    expect((parseArgs(["--nope"]) as ParsedArgs).error).toContain("--nope");
    expect((parseArgs(["--repo"]) as ParsedArgs).error).toContain("--repo 需要一个值");
    expect((parseArgs(["--today", "2026-10-13"]) as ParsedArgs).error).toBeUndefined();
    expect((parseArgs(["--today", "13/10/2026"]) as ParsedArgs).error).toContain("YYYY-MM-DD");
  });
});

describe("fetchOpenAlerts：读不到 ≠ 没有告警", () => {
  it("缺仓库信息 ⇒ error，不发请求", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchAlerts("", "tok");
    expect(result.error).toContain("GITHUB_REPOSITORY");
    expect(result.alerts).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("缺 token ⇒ error（实测匿名回 401，所以没有 token 只能回答「未知」）", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchAlerts("o/r", "");
    expect(result.error).toContain("缺少 GitHub token");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("HTTP 非 2xx ⇒ error 带上状态码，绝不返回空数组", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse([], { ok: false, status: 403, statusText: "Forbidden" })),
    );
    const result = await fetchAlerts("o/r", "tok");
    expect(result.error).toBe("HTTP 403 Forbidden");
    expect(result.alerts).toBeUndefined();
  });

  it("响应不是数组 ⇒ error：API 换了形状时不猜它的含义", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ alerts: [rawAlert(11)] })));
    const result = await fetchAlerts("o/r", "tok");
    expect(result.error).toContain("响应不是数组");
  });

  it("fetch 抛错 ⇒ error 带原始消息，而不是让进程崩在这里", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ENOTFOUND api.github.com");
      }),
    );
    const result = await fetchAlerts("o/r", "tok");
    expect(result.error).toBe("ENOTFOUND api.github.com");
  });

  it("读到空列表 ⇒ `{alerts: []}`，这是「真的一条都没有」，与上面四种 error 是两种东西", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([])));
    expect(alertsOf(await fetchAlerts("o/r", "tok"))).toEqual([]);
  });

  it("请求带上了可复现读数所需的东西：state=open、分页、api-version、Bearer", async () => {
    // `init` 声明为必填：这样 `mock.calls[0]` 的元素类型是 `[string, RequestInit]`，
    // 断言里就不必到处兜 `undefined`（那会把「确实带了 init」这件事从类型里抹掉）。
    const fetchMock = vi.fn(async (_input: string, _init: RequestInit) => jsonResponse([rawAlert(11)]));
    vi.stubGlobal("fetch", fetchMock);
    // 尾斜杠：apiBase 带不带斜杠都必须落在同一个路径上
    await fetchAlerts("Sun1090/IndieStack", "ghp_test", "https://api.github.com/");
    // 兜底值只为了让类型收窄；真的没被调用时下面那条 URL 断言就会红。
    const [url, init] = fetchMock.mock.calls[0] ?? ["", {} as RequestInit];
    expect(url).toBe(
      "https://api.github.com/repos/Sun1090/IndieStack/code-scanning/alerts?state=open&per_page=100&page=1",
    );
    expect(init.method).toBe("GET");
    const headers = (init.headers ?? {}) as Record<string, string>;
    expect(headers["x-github-api-version"]).toBe(REQUIRED_API_VERSION);
    expect(headers.authorization).toBe("Bearer ghp_test");
    expect(headers.accept).toBe("application/vnd.github+json");
  });

  it("不足一页就停；满 100 条才继续翻页并合并结果", async () => {
    const hundred = Array.from({ length: 100 }, (_, i) => rawAlert(100 + i));
    const fetchMock = vi.fn(async (input: string) =>
      input.includes("page=2") ? jsonResponse([rawAlert(201)]) : jsonResponse(hundred),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchAlerts("o/r", "tok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const alerts = alertsOf(result);
    expect(alerts).toHaveLength(101);
    expect(alerts[100]).toMatchObject({ number: 201 });
  });

  it("返回的每条都已过 toLiveAlert：严重度取自 rule，而不是顶层", async () => {
    // 顶层放一个 null 同名键——这正是我上一轮实际犯的错。
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse([{ ...rawAlert(18), security_severity_level: null }])),
    );
    const alerts = alertsOf(await fetchAlerts("o/r", "tok"));
    expect(alerts[0]).toMatchObject({ number: 18, securitySeverityLevel: "medium" });
  });
});

describe("readFixture", () => {
  it("仓库里那份 fixture 能读，且 6 条的形状被正确映射", () => {
    const alerts = fixtureAlerts("fixtures/codeql-alerts.json");
    expect(alerts).toHaveLength(6);
    const eighteen = alerts.find((alert) => alert.number === 18);
    expect(eighteen).toMatchObject({ securitySeverityLevel: "high", createdAt: "2026-09-27" });
    // #19 是构造条目，专门用来离线复现「拿不到严重度」
    const nineteen = alerts.find((alert) => alert.number === 19);
    expect(nineteen?.securitySeverityLevel).toBeNull();
  });

  it("文件不存在 / 不是合法 JSON / 没有数组 ⇒ error，不返回空数组冒充「录制时就没有告警」", () => {
    expect((readFixture("fixtures/does-not-exist.json", REPO_ROOT) as FetchResult).error).toContain("读不了");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codeql-fixture-"));
    fs.writeFileSync(path.join(dir, "broken.json"), "{not json");
    expect((readFixture("broken.json", dir) as FetchResult).error).toContain("读不了");
    fs.writeFileSync(path.join(dir, "no-array.json"), JSON.stringify({ alerts: "nope" }));
    expect((readFixture("no-array.json", dir) as FetchResult).error).toContain("找不到 alerts 数组");
  });

  it("顶层直接是数组也接受（录制的两种形状都认）", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codeql-fixture-"));
    fs.writeFileSync(path.join(dir, "bare.json"), JSON.stringify([rawAlert(11)]));
    expect(fixtureAlerts("bare.json", dir)).toHaveLength(1);
  });
});

describe("runCodeqlAlertCheck：退出码", () => {
  /** 写一份临时 fixture，返回它所在的仓库根。 */
  function fixtureRepo(alerts: unknown[]): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codeql-run-"));
    fs.writeFileSync(path.join(dir, "alerts.json"), JSON.stringify({ alerts }));
    return dir;
  }

  it("读不到实况 ⇒ 2（未知不算通过），不冒充「查过了」", async () => {
    // 没有 token ⇒ fetchOpenAlerts 直接 error。此时台账里那 5 条一条都没被核对，
    // 绝不能报 0；也不能报 1——1 的含义是「查过了，有差集」。
    const code = await runCodeqlAlertCheck({ repo: "", token: "", today: "2026-10-13" }, REPO_ROOT);
    expect(code).toBe(2);
  });

  it("仓库里那份 fixture ⇒ 1：#19 未登记 + #18 阻断级未处置 + SLA 超期", async () => {
    const code = await runCodeqlAlertCheck(
      { fixture: "fixtures/codeql-alerts.json", today: "2026-10-13", json: true },
      REPO_ROOT,
    );
    expect(code).toBe(1);
  });

  it("实况与台账逐条一致 ⇒ 0（这是「绿」的唯一合法路径）", async () => {
    // **故意从台账推导实况**：本测的要钉的是「一致 ⇒ 0」这条退出码路径，
    // 不是台账里具体有哪几条。写死 5 条会让每一次合法登记都把这个测试带红。
    const dir = fixtureRepo(
      CODEQL_ALERT_REGISTRY.map((entry) =>
        rawAlert(entry.number, {
          rule: { id: entry.ruleId, severity: "error", security_severity_level: "medium" },
          created_at: "2026-11-01T00:00:00Z",
        }),
      ),
    );
    // 先确认这份实况真的读得出来，否则下面的 0 可能来自别处
    expect(fixtureAlerts("alerts.json", dir)).toHaveLength(CODEQL_ALERT_REGISTRY.length);
    const code = await runCodeqlAlertCheck({ fixture: "alerts.json", today: "2026-11-02", json: true }, dir);
    expect(code).toBe(0);
  });

  it("实况为空列表 ⇒ 1：台账全腐烂，这不是「没有告警所以通过」", async () => {
    const dir = fixtureRepo([]);
    const code = await runCodeqlAlertCheck({ fixture: "alerts.json", today: "2026-11-02", json: true }, dir);
    expect(code).toBe(1);
  });
});
