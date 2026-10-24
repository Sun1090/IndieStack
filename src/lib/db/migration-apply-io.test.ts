/**
 * 云端迁移应用的 IO 层单测——这一层管的是「什么情况下会真的往生产库发两条 SQL」。
 * 与 `cloud-sql-probe-io.test.ts` / `migration-status-io.test.ts` 同一结构成因：
 * 判定层的守卫有单测不代表 dry-run 绝不发请求、失败路径会停。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_API_BASE, parseArgs, runMigrationApply } from "../../../scripts/lib/migration-apply-cli.js";
import { migrationSha256 } from "./migration-apply";

type ParsedArgs = { error?: string; options?: Record<string, unknown> };
type FetchRoute = { method: string; match: string; body: unknown; status?: number };

function optionsOf(parsed: ParsedArgs): Record<string, unknown> {
  expect(parsed.error).toBeUndefined();
  return parsed.options as Record<string, unknown>;
}

const baseOptions = {
  version: "036",
  projectRef: "abc123defg",
  token: "sbp_token_placeholder",
  apiBase: DEFAULT_API_BASE,
  supabaseUrl: "",
  apply: false,
  timeoutMs: 1000,
  help: false,
};

const SQL = "create table t (id int primary key);\ncommit;\n";
const MANIFEST = JSON.stringify({
  migrations: [
    { version: "036", fileName: "036_demo.sql", sha256: migrationSha256(SQL) },
    { version: "035", fileName: "035_worker_run_backlog_skipped.sql" },
  ],
});

function tempRepoRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "migration-apply-"));
  fs.mkdirSync(path.join(root, "supabase/migrations"), { recursive: true });
  fs.writeFileSync(path.join(root, "supabase/migration-manifest.json"), MANIFEST);
  fs.writeFileSync(path.join(root, "supabase/migrations/036_demo.sql"), SQL);
  return root;
}

type Call = { method: string; url: string };

/** 按 (method, url) 分发的 fetch 桩，记录调用供「到底发没发 POST」断言。 */
function stubFetch(routes: FetchRoute[], calls: Call[] = []): Call[] {
  const fn = vi.fn(async (url: unknown, init?: { method?: string }) => {
    const method = init?.method ?? "GET";
    const urlText = String(url);
    calls.push({ method, url: urlText });
    const route = routes.find((entry) => entry.method === method && urlText.includes(entry.match));
    if (!route) throw new Error(`stubFetch: 未登记的请求 ${method} ${urlText}`);
    return new Response(typeof route.body === "string" ? route.body : JSON.stringify(route.body), {
      status: route.status ?? 200,
    });
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

/** 捕获 console 输出（log 与 error 分开收集）。 */
function captureConsole(): { log: string[]; error: string[]; restore: () => void } {
  const log: string[] = [];
  const error: string[] = [];
  vi.spyOn(console, "log").mockImplementation((message) => {
    log.push(String(message));
  });
  vi.spyOn(console, "error").mockImplementation((message) => {
    error.push(String(message));
  });
  return {
    log,
    error,
    restore: () => {
      vi.mocked(console.log).mockRestore();
      vi.mocked(console.error).mockRestore();
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("parseArgs", () => {
  it("--version 与 --apply 正常解析；--apply 缺省为 false（默认 dry-run）", () => {
    const options = optionsOf(parseArgs(["--version", "036", "--apply"]) as ParsedArgs);
    expect(options.version).toBe("036");
    expect(options.apply).toBe(true);
    expect((parseArgs([]) as ParsedArgs).options?.apply).toBe(false);
  });

  it("未知 flag 报错", () => {
    expect((parseArgs(["--sql", "drop table x"]) as ParsedArgs).error).toContain("未知参数");
  });
});

describe("runMigrationApply", () => {
  const liveEmpty = [{ version: "035" }];

  it("dry-run：打印计划，绝不发 POST", async () => {
    const calls = stubFetch([{ method: "GET", match: "/database/migrations", body: liveEmpty }]);
    const { log, restore } = captureConsole();
    const code = await runMigrationApply(optionsOf({ options: baseOptions }), tempRepoRoot());
    restore();
    expect(code).toBe(0);
    expect(calls.filter((call) => call.method === "POST")).toEqual([]);
    expect(log.some((line) => line.includes("036_demo.sql"))).toBe(true);
    expect(log.some((line) => line.includes("dry-run"))).toBe(true);
  });

  it("缺 --version ⇒ 用法错误退出 2", async () => {
    stubFetch([]);
    const { error, restore } = captureConsole();
    const code = await runMigrationApply(
      optionsOf({ options: { ...baseOptions, version: "" } }),
      tempRepoRoot(),
    );
    restore();
    expect(code).toBe(2);
    expect(error.some((line) => line.includes("--version"))).toBe(true);
  });

  it("文件被改过 ⇒ SHA 校验拒绝，不发任何 POST", async () => {
    const calls = stubFetch([{ method: "GET", match: "/database/migrations", body: liveEmpty }]);
    const root = tempRepoRoot();
    fs.writeFileSync(path.join(root, "supabase/migrations/036_demo.sql"), `${SQL}-- tampered\n`);
    const { error, restore } = captureConsole();
    const code = await runMigrationApply(optionsOf({ options: baseOptions }), root);
    restore();
    expect(code).toBe(2);
    expect(calls.filter((call) => call.method === "POST")).toEqual([]);
    expect(error.some((line) => line.includes("APPLY_SHA_MISMATCH"))).toBe(true);
  });

  it("云端已 applied ⇒ 拒绝重放", async () => {
    const calls = stubFetch([{ method: "GET", match: "/database/migrations", body: [{ version: "036" }] }]);
    const { error, restore } = captureConsole();
    const code = await runMigrationApply(optionsOf({ options: baseOptions }), tempRepoRoot());
    restore();
    expect(code).toBe(2);
    expect(calls.filter((call) => call.method === "POST")).toEqual([]);
    expect(error.some((line) => line.includes("APPLY_ALREADY_APPLIED"))).toBe(true);
  });

  it("--apply：执行迁移体 → 落历史 → GET 复核通过", async () => {
    const calls: Call[] = [];
    let getCalls = 0;
    const fn = vi.fn(async (url: unknown, init?: { method?: string }) => {
      const method = init?.method ?? "GET";
      calls.push({ method, url: String(url) });
      if (method === "POST") return new Response("[]", { status: 200 });
      getCalls += 1;
      const body = getCalls === 1 ? liveEmpty : [{ version: "035" }, { version: "036" }];
      return new Response(JSON.stringify(body), { status: 200 });
    });
    vi.stubGlobal("fetch", fn);
    const { log, restore } = captureConsole();
    const code = await runMigrationApply(
      optionsOf({ options: { ...baseOptions, apply: true } }),
      tempRepoRoot(),
    );
    restore();
    expect(code).toBe(0);
    expect(calls.filter((call) => call.method === "POST").length).toBe(2);
    expect(log.some((line) => line.includes("复核通过"))).toBe(true);
  });

  it("历史行写入失败 ⇒ 停在退出码 2，并打印补救 INSERT", async () => {
    const calls: Call[] = [];
    const fn = vi.fn(async (url: unknown, init?: { method?: string }) => {
      const method = init?.method ?? "GET";
      calls.push({ method, url: String(url) });
      if (method === "GET") return new Response(JSON.stringify(liveEmpty), { status: 200 });
      const posts = calls.filter((call) => call.method === "POST").length;
      return posts === 1
        ? new Response("[]", { status: 200 })
        : new Response("duplicate key", { status: 409 });
    });
    vi.stubGlobal("fetch", fn);
    const { log, restore } = captureConsole();
    const code = await runMigrationApply(
      optionsOf({ options: { ...baseOptions, apply: true } }),
      tempRepoRoot(),
    );
    restore();
    expect(code).toBe(2);
    expect(log.some((line) => line.includes("insert into supabase_migrations.schema_migrations"))).toBe(true);
  });
});
