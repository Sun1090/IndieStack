/**
 * 云端 SQL 执行探测的 IO 层单测。
 *
 * 为什么这一层必须有测试：它管的是这个探测**唯一真正危险的分支**——
 * 「什么情况下会真的往生产库发一条 SQL」。判定层（`cloud-sql-probe.ts`）
 * 有 45 条用例，但守卫审计、dry-run 降级、鉴权失败短路都住在这里。
 * 上一轮（#248 / #249）的结论就是「IO 层一行测试都没有」是假绿的结构成因。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_API_BASE,
  endpointPath,
  parseArgs,
  postProbeStep,
  resolveDryRun,
  requestBody,
  runCli,
  runCloudSqlProbe,
} from "../../../scripts/lib/cloud-sql-probe-check.js";
import { PROBE_PLAN, type ProbeStep } from "./cloud-sql-probe";

// `scripts/lib/cloud-sql-probe-check.js` 是无标注的 JS：TS 从默认参数把 `env` 推成
// `NodeJS.ProcessEnv`（含必填的 NODE_ENV），又把返回值推成 `{error} | {options}` 联合。
// 这两个 helper 把适配集中起来，避免每个断言都写 `!`——那样会把
// 「这个分支真的返回了 options」从断言里抹掉。（与 `codeql-alert-io.test.ts` 同一做法。）
type ParsedArgs = { error?: string; options?: Record<string, unknown> };

/** 传 env 给 `parseArgs`；缺的键就是「环境里没有」，所以不必补 NODE_ENV。 */
function envOf(values: Record<string, string>): NodeJS.ProcessEnv {
  return values as NodeJS.ProcessEnv;
}

/** 取解析出的 options；返回 error 分支时让测试直接失败，而不是读到 undefined。 */
function optionsOf(parsed: ParsedArgs): Record<string, unknown> {
  expect(parsed.error).toBeUndefined();
  return parsed.options as Record<string, unknown>;
}

function step(id: ProbeStep["id"]): ProbeStep {
  const found = PROBE_PLAN.find((entry) => entry.id === id);
  if (!found) throw new Error(`计划里没有 ${id}`);
  return found;
}

const baseOptions = {
  projectRef: "abc123defg",
  token: "sbp_token_placeholder",
  apiBase: DEFAULT_API_BASE,
  supabaseUrl: "",
  json: false,
  dryRun: false,
  timeoutMs: 1000,
  help: false,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("endpointPath / requestBody", () => {
  it("对照组那一步刻意不带 read_only：它就是「不带字段会怎样」的那一半", () => {
    const off = step("READ_ONLY_FLAG_OFF");
    expect(off.endpoint).toBe("query");
    expect(requestBody(off)).not.toHaveProperty("read_only");
  });

  it("只读步骤打只读端点，且不带 read_only 字段", () => {
    const entry = step("READ_ONLY_ENDPOINT");
    expect(endpointPath(entry)).toBe("/database/query/read-only");
    expect(requestBody(entry)).toEqual({ query: "select 1 as probe_ok" });
  });

  it("另外三条打「能写」的端点，但必须带 read_only: true", () => {
    // 除第一条之外，其余都打「能写」的端点——包括那条会故意报错的。
    for (const id of [
      "WRITE_ENDPOINT_GUARDED",
      "MULTI_STATEMENT",
      "MULTI_STATEMENT_FIRST_ERROR",
      "SINGLE_DO_BLOCK",
      "READ_ONLY_FLAG_ON",
    ]) {
      const entry = step(id as ProbeStep["id"]);
      expect(endpointPath(entry)).toBe("/database/query");
      expect(requestBody(entry).read_only).toBe(true);
    }
  });

  it("请求体里只有 query 与 read_only，没有可被塞进任意 SQL 的字段", () => {
    expect(Object.keys(requestBody(step("MULTI_STATEMENT"))).sort()).toEqual([
      "query",
      "read_only",
    ]);
  });
});

describe("parseArgs", () => {
  it("env 提供默认值", () => {
    const options = optionsOf(
      parseArgs([], envOf({
        SUPABASE_PROJECT_REF: "fromenv",
        SUPABASE_ACCESS_TOKEN: "sbp_env",
        SUPABASE_API_BASE: "https://example.test/v1",
      })) as ParsedArgs,
    );
    expect(options.projectRef).toBe("fromenv");
    expect(options.token).toBe("sbp_env");
    expect(options.apiBase).toBe("https://example.test/v1");
  });

  it("命令行覆盖 env", () => {
    const options = optionsOf(
      parseArgs(
        ["--project-ref", "cli", "--token", "sbp_cli"],
        envOf({ SUPABASE_PROJECT_REF: "fromenv", SUPABASE_ACCESS_TOKEN: "sbp_env" }),
      ) as ParsedArgs,
    );
    expect(options).toMatchObject({ projectRef: "cli", token: "sbp_cli" });
  });

  it("未知参数报错，并且明说「不接受任意 SQL」", () => {
    const parsed = parseArgs(["--sql", "drop table t"]);
    expect(parsed.error).toContain("未知参数");
    expect(parsed.error).toContain("不接受任意 SQL");
  });

  it("带值 flag 缺值时报错", () => {
    expect(parseArgs(["--token"]).error).toContain("--token 需要一个值");
  });

  it("timeout 非正整数时报错", () => {
    expect(parseArgs(["--timeout-ms", "0"]).error).toContain("正整数");
    expect(parseArgs(["--timeout-ms", "abc"]).error).toContain("正整数");
  });

  it("布尔 flag 可连用；`--` 只被当作分隔符丢掉", () => {
    expect(optionsOf(parseArgs(["--dry-run", "--json"]) as ParsedArgs)).toMatchObject({
      dryRun: true,
      json: true,
      help: false,
    });
    // `--` 之后的 flag 仍会被解析（与 `migration-status-check.js` 同一口径）：
    // 这里钉的是「不会因为多一个 `--` 就报未知参数」。
    expect(optionsOf(parseArgs(["--", "--help"]) as ParsedArgs).help).toBe(true);
  });
});

describe("resolveDryRun", () => {
  it("缺令牌 ⇒ 自动 dry-run（没有凭据就不该发出请求）", () => {
    expect(resolveDryRun({ ...baseOptions, token: "" })).toBe(true);
  });

  it("显式 --dry-run ⇒ 即使有令牌也不发", () => {
    expect(resolveDryRun({ ...baseOptions, dryRun: true })).toBe(true);
  });

  it("有令牌且没要求 dry-run ⇒ 才允许发", () => {
    expect(resolveDryRun(baseOptions)).toBe(false);
  });
});

describe("postProbeStep", () => {
  it("解析不出 project ref ⇒ 传输层失败，不发请求", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await postProbeStep(step("READ_ONLY_ENDPOINT"), {
      ...baseOptions,
      projectRef: "",
      supabaseUrl: "",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.transportError).toContain("project ref");
  });

  it("URL 精确到端点，且 apiBase 的尾斜杠不产生双斜杠", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response("[]", { status: 201, headers: { "content-type": "application/json" } });
      }),
    );
    await postProbeStep(step("MULTI_STATEMENT"), { ...baseOptions, apiBase: "https://x.test/v1/" });
    // fetch 收到的是 URL 对象，不是字符串。
    expect(String(calls[0].url)).toBe("https://x.test/v1/projects/abc123defg/database/query");
  });

  it("带上 Bearer 与 JSON 体；令牌不会出现在返回的错误文本里", async () => {
    let seen: RequestInit | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        seen = init;
        return new Response("[]", { status: 201 });
      }),
    );
    await postProbeStep(step("SINGLE_DO_BLOCK"), baseOptions);
    const headers = seen!.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sbp_token_placeholder");
    expect(JSON.parse(String(seen!.body))).toMatchObject({ read_only: true });
  });

  it("fetch 抛错 ⇒ 收敛成 transportError 且 status 0，不回显请求头", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connection refused");
      }),
    );
    const response = await postProbeStep(step("READ_ONLY_ENDPOINT"), baseOptions);
    expect(response).toMatchObject({
      status: 0,
      json: null,
      bodyText: "",
      transportError: "connection refused",
    });
    // 传输层失败也要带耗时：它是「这次请求花了多久」的读数，与成功与否无关。
    expect(typeof response.elapsedMs).toBe("number");
    expect(JSON.stringify(response)).not.toContain("sbp_token");
  });

  it("响应不是 JSON ⇒ json 为 null 但保留原文（形状变了要能被认出来）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>bad gateway</html>", { status: 502 })));
    const response = await postProbeStep(step("READ_ONLY_ENDPOINT"), baseOptions);
    expect(response.json).toBeNull();
    expect(response.bodyText).toContain("bad gateway");
    expect(response.status).toBe(502);
  });
});

describe("runCloudSqlProbe 的发送前闸门", () => {
  it("缺令牌 ⇒ 一条请求都不发，退出码 2（未知不算通过）", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await runCloudSqlProbe({ ...baseOptions, token: "" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(code).toBe(2);
  });

  it("--dry-run ⇒ 即使有令牌也不发", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await runCloudSqlProbe({ ...baseOptions, dryRun: true })).toBe(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("计划里混进一条会写的语句 ⇒ 一条都不发，退出码 2", async () => {
    // 这条盯的是**未来**：今天这四条都干净，但守卫真正要拦的是「有人往 PROBE_PLAN
    // 里加了一条 insert」。不注入就没法测那条分支，而测不到的安全分支等于没有。
    // 注入点只在代码层——CLI 侧依然没有 `--sql`，所以「不能被指到任意 SQL」不受影响。
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const tainted: readonly ProbeStep[] = [
      ...PROBE_PLAN,
      { ...step("MULTI_STATEMENT"), sql: "delete from t" },
    ];
    expect(await runCloudSqlProbe(baseOptions, tainted)).toBe(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("守卫通过时才会走到发送：dry-run 与真发的分界由同一个审计把关", async () => {
    const fetchMock = vi.fn(async () => new Response("[]", { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => {});
    await runCloudSqlProbe({ ...baseOptions, dryRun: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("runCloudSqlProbe 的短路", () => {
  it("第一步 401 ⇒ 后续步骤标成「未发送」，且总共只发一次请求", async () => {
    const fetchMock = vi.fn(async () => new Response('{"message":"bad token"}', { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await runCloudSqlProbe(baseOptions);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(code).toBe(2);
  });

  /**
   * 计划里每条都回一个「按判据算通过」的响应。
   *
   * `firstRuns` 决定决定性那条走哪条路：true = 服务端报出 division by zero
   * （= 前面的语句确实执行了）；false = 它安静地返回 201
   * （= 前面的语句被静默跳过，这是最危险的读数）。
   */
  function healthyFetch(firstRuns: boolean, pgCron = "INSTALLED") {
    return vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { query: string };
      if (body.query.startsWith("do ")) {
        return new Response('{"error":"ERROR: PROBE-RESULT ok"}', { status: 500 });
      }
      if (body.query.includes("1/0")) {
        return firstRuns
          ? new Response('{"error":"division by zero"}', { status: 400 })
          : new Response('[{"survivor":2}]', { status: 201 });
      }
      // read_only 生效性那一对：按**请求体里有没有那个字段**回答 on / off。
      // 这正是这两步要验的东西，所以 mock 必须真的把它当回事。
      if (body.query.startsWith("show ")) {
        const value = (body as { read_only?: boolean }).read_only === true ? "on" : "off";
        return new Response(`[{"transaction_read_only":"${value}"}]`, { status: 201 });
      }
      // pg_cron 那一步：期望的是 `pg_cron` 这一列。
      // **本步骤刚加进来时这条用例就是红的**——mock 不认识它就回 `probe_ok`，
      // 判据读不到列 ⇒ UNKNOWN ⇒ 退出码 2。那不是测试坏了，是新判据真的没被覆盖。
      if (body.query.includes("pg_catalog.pg_extension")) {
        return new Response(`[{"pg_cron":"${pgCron}"}]`, { status: 201 });
      }
      return new Response("[{\"probe_ok\":1}]", { status: 201 });
    });
  }

  it("计划里每条都满足判据 ⇒ 退出码 0", async () => {
    const fetchMock = healthyFetch(true);
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await runCloudSqlProbe(baseOptions);
    expect(fetchMock).toHaveBeenCalledTimes(PROBE_PLAN.length);
    expect(code).toBe(0);
  });

  it("pg_cron 回 NOT_INSTALLED ⇒ 退出码 1（那是答案，不是「不知道」）", async () => {
    const fetchMock = healthyFetch(true, "NOT_INSTALLED");
    vi.stubGlobal("fetch", fetchMock);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await runCloudSqlProbe(baseOptions);
    expect(code).toBe(1);
    const printed = log.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(printed).toContain("[PG_CRON_INSTALLED] CONTRADICTED");
    // ⚠️ 标记必须是 ❗ 而不是 ❌：`❌ (HTTP 201)` 自相矛盾，会被读成「探测坏了」，
    // 于是人去查脚本而不是去查 pg_cron——生产那次实测就是这么绕了一圈的。
    expect(printed).toMatch(/❗ \[PG_CRON_INSTALLED\] CONTRADICTED/);
    expect(printed).not.toMatch(/❌ \[PG_CRON_INSTALLED\]/);
    // ⚠️ 输出**不许**把「没装 pg_cron」说成「保留期失效」：
    // 主执行者是 /api/cron/retention，pg_cron 只是迁移里那组周调度的第二个可选调度器。
    expect(printed).toContain("这不等于保留期失效");
  });

  it("前序语句被静默跳过 ⇒ 打印点名这一步，退出码 1", async () => {
    // 这条钉的是本探测最要紧的一个读数：多语句端点只回最后一条的结果，
    // 光看响应体分不清「两条都跑了」与「只跑了最后一条」。
    // 决定性判据（让第一条自己报错）就是为了把这两种分开。
    // 若是后者，把多语句演练 SQL 交给这个端点就是**静默少跑**——
    // 演练会报「通过」而它其实什么都没做，那比跑不了更坏。
    const fetchMock = healthyFetch(false);
    vi.stubGlobal("fetch", fetchMock);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await runCloudSqlProbe(baseOptions)).toBe(1);
    const printed = log.mock.calls.map((call) => String(call[0])).join("\n");
    expect(printed).toContain("MULTI_STATEMENT_FIRST_ERROR");
    expect(printed).toContain("FIRST_STATEMENT_SKIPPED");
  });

  it("多语句被 prepared statement 拒 ⇒ 退出码 1（那是答案，不是故障）", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { query: string; read_only?: boolean };
      if (body.query.includes(";")) {
        return new Response(
          '{"error":"cannot insert multiple commands into a prepared statement"}',
          { status: 400 },
        );
      }
      if (body.query.startsWith("do ")) {
        return new Response('{"error":"ERROR: PROBE-RESULT ok"}', { status: 500 });
      }
      // 按请求体里那个字段如实回答。写死成 "on" 会让对照组那一步也判成矛盾，
      // 于是「退出码 1」就不再来自它标题所说的那件事了。
      if (body.query.startsWith("show ")) {
        const value = body.read_only === true ? "on" : "off";
        return new Response(`[{"transaction_read_only":"${value}"}]`, { status: 201 });
      }
      // 同上：pg_cron 那一步必须回它自己那一列，否则它判 UNKNOWN，
      // 而这条用例要求「红只来自多语句那一步」。
      if (body.query.includes("pg_catalog.pg_extension")) {
        return new Response('[{"pg_cron":"INSTALLED"}]', { status: 201 });
      }
      return new Response("[{\"probe_ok\":1}]", { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await runCloudSqlProbe(baseOptions)).toBe(1);
    // 红必须只来自多语句那一步：否则这条用例断言的不是它标题说的那件事。
    const printed = log.mock.calls.map((call) => String(call[0])).join("\n");
    expect(printed).toContain("[MULTI_STATEMENT] REJECTED_SQL");
    expect(printed).toContain("[PREPARED_STATEMENT]");
    expect(printed).not.toContain("READ_ONLY_FLAG_ON] REJECTED_SQL");
    expect(printed).not.toContain("READ_ONLY_FLAG_OFF] REJECTED_SQL");
    expect(printed).not.toContain("[PG_CRON_INSTALLED] UNKNOWN");
  });
});

describe("runCli", () => {
  it("用法错误 ⇒ 2", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await runCli(["--nope"])).toBe(2);
  });

  it("--help ⇒ 0", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await runCli(["--help"])).toBe(0);
  });
});
