/**
 * 云端迁移状态探测的 IO 层单测——重点是 `--fix-version-shape` 订正流程。
 *
 * 为什么这一层必须有测试：它是这个脚本唯一真正往生产库写东西的分支。
 * 判定层（`planVersionShapeFix`）的映射逻辑有单测，但「什么情况下会真的发 POST」、
 * 「dry-run 是否绝对不写」「对不上的行是否一律不动」都住在这里。
 * 与 `cloud-sql-probe-io.test.ts` 同一结构成因：IO 层零测试 = 假绿的结构性温床。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_API_BASE, fixStatement, parseArgs, runVersionShapeFix } from "../../../scripts/lib/migration-status-check.js";
import { normalizeMigrationVersion } from "./migration-status";

type ParsedArgs = { error?: string; options?: Record<string, unknown> };

function optionsOf(parsed: ParsedArgs): Record<string, unknown> {
  expect(parsed.error).toBeUndefined();
  return parsed.options as Record<string, unknown>;
}

const baseOptions = {
  projectRef: "abc123defg",
  token: "sbp_token_placeholder",
  apiBase: DEFAULT_API_BASE,
  supabaseUrl: "",
  json: false,
  fixVersionShape: true,
  apply: false,
  timeoutMs: 1000,
  help: false,
  expectApplied: [],
};

const MANIFEST = JSON.stringify({
  migrations: [{ version: "034", fileName: "034_email_skip_reason.sql" }],
});

/** 建一个只含 034 一条迁移的临时「仓库」，让订正流程读确定性的 manifest。 */
function tempRepoRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "migration-status-"));
  fs.mkdirSync(path.join(root, "supabase"), { recursive: true });
  fs.writeFileSync(path.join(root, "supabase/migration-manifest.json"), MANIFEST);
  return root;
}

/** 按 (method, url) 分发的 fetch 桩；调用记录可事后断言「到底发没发 POST」。 */
function stubFetch(routes: Array<{ method: string; match: string; body: unknown }>) {
  const calls: Array<{ method: string; url: string }> = [];
  const fn = vi.fn(async (url: unknown, init?: { method?: string }) => {
    const method = init?.method ?? "GET";
    const urlText = String(url);
    calls.push({ method, url: urlText });
    const route = routes.find((entry) => entry.method === method && urlText.includes(entry.match));
    if (!route) throw new Error(`stubFetch: 未登记的请求 ${method} ${urlText}`);
    return new Response(JSON.stringify(route.body), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("parseArgs（订正 flag）", () => {
  it("--fix-version-shape 与 --apply 解析为布尔", () => {
    const parsed = parseArgs(["--fix-version-shape", "--apply"]);
    const options = optionsOf(parsed);
    expect(options.fixVersionShape).toBe(true);
    expect(options.apply).toBe(true);
  });

  it("缺省时两个 flag 都是 false（默认只读）", () => {
    const options = optionsOf(parseArgs([]));
    expect(options.fixVersionShape).toBe(false);
    expect(options.apply).toBe(false);
  });
});

describe("fixStatement", () => {
  it("生成带 schema 前缀的 UPDATE，并把单引号转义", () => {
    expect(fixStatement({ fromRaw: "2026102409000000", toVersion: "034", matchedBy: "x" })).toBe(
      "update supabase_migrations.schema_migrations set version = '034' where version = '2026102409000000';",
    );
    expect(fixStatement({ fromRaw: "o'brien", toVersion: "0'34", matchedBy: "x" })).toBe(
      "update supabase_migrations.schema_migrations set version = '0''34' where version = 'o''brien';",
    );
  });
});

describe("runVersionShapeFix", () => {
  const liveTimestampRow = [
    { version: "2026102409000000", name: "034_email_skip_reason" },
  ];

  it("dry-run：打印计划与 UPDATE 语句，绝不发 POST", async () => {
    const calls = stubFetch([{ method: "GET", match: "/database/migrations", body: liveTimestampRow }]);
    const log: string[] = [];
    vi.spyOn(console, "log").mockImplementation((message) => log.push(String(message)));
    const code = await runVersionShapeFix(optionsOf({ options: baseOptions }), tempRepoRoot());
    vi.mocked(console.log).mockRestore();
    expect(code).toBe(0);
    expect(calls.filter((call) => call.method === "POST")).toEqual([]);
    expect(log.some((line) => line.includes("2026102409000000 → 034"))).toBe(true);
    expect(log.some((line) => line.includes("dry-run"))).toBe(true);
  });

  it("--apply：执行 UPDATE 后复跑探测并转绿", async () => {
    const calls = stubFetch([
      { method: "GET", match: "/database/migrations", body: liveTimestampRow },
      { method: "POST", match: "/database/query", body: [] },
    ]);
    // 复跑探测时的 GET 返回订正后的形状 → ✅。
    let getCalls = 0;
    const fn = vi.fn(async (url: unknown, init?: { method?: string }) => {
      const method = init?.method ?? "GET";
      calls.push({ method, url: String(url) });
      if (method === "POST") return new Response("[]", { status: 200 });
      getCalls += 1;
      const body = getCalls === 1 ? liveTimestampRow : [{ version: "034" }];
      return new Response(JSON.stringify(body), { status: 200 });
    });
    vi.stubGlobal("fetch", fn);
    const log: string[] = [];
    vi.spyOn(console, "log").mockImplementation((message) => log.push(String(message)));
    const code = await runVersionShapeFix(
      optionsOf({ options: { ...baseOptions, apply: true } }),
      tempRepoRoot(),
    );
    vi.mocked(console.log).mockRestore();
    expect(code).toBe(0);
    expect(calls.filter((call) => call.method === "POST").length).toBe(1);
    expect(log.some((line) => line.includes("✅ 已订正 2026102409000000 → 034"))).toBe(true);
  });

  it("对不上仓库任何一条迁移 ⇒ 全部不动、退出码 2", async () => {
    const calls = stubFetch([
      { method: "GET", match: "/database/migrations", body: [{ version: "2026102409000000", name: "036_not_in_repo" }] },
    ]);
    const log: string[] = [];
    vi.spyOn(console, "log").mockImplementation((message) => log.push(String(message)));
    const code = await runVersionShapeFix(optionsOf({ options: baseOptions }), tempRepoRoot());
    vi.mocked(console.log).mockRestore();
    expect(code).toBe(2);
    expect(calls.filter((call) => call.method === "POST")).toEqual([]);
    expect(log.some((line) => line.includes("对不上仓库任何一条迁移"))).toBe(true);
  });

  it("没有需要订正的行 ⇒ 直接给探测结论（跟随探测的退出码）", async () => {
    stubFetch([{ method: "GET", match: "/database/migrations", body: [{ version: "034" }] }]);
    const log: string[] = [];
    vi.spyOn(console, "log").mockImplementation((message) => log.push(String(message)));
    const code = await runVersionShapeFix(optionsOf({ options: baseOptions }), tempRepoRoot());
    vi.mocked(console.log).mockRestore();
    expect(code).toBe(0);
    expect(log.some((line) => line.includes("没有需要订正的版本号形状"))).toBe(true);
  });
});
