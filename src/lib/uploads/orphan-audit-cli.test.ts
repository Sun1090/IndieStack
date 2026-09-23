import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  orphanRpcEndpoint,
  parseArgs,
  parseContentRange,
  runStorageOrphanAudit,
  fetchOrphanRows,
  fetchTrackedObjects,
  storageListEndpoint,
  uploadObjectsEndpoint,
} from "../../../scripts/lib/storage-orphans.js";

const NOW = Date.parse("2026-09-22T00:00:00.000Z");
const RPC_ROWS = [
  {
    bucket: "avatars",
    object_key: "user-1/portrait.png",
    owner_id: null,
    byte_size: 8192,
    created_at: new Date(NOW - 5 * 86_400_000).toISOString(),
  },
];

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

/** 注入用的假 fetch：只需要 ok / status / text，不实现整个 Response。 */
const asFetch = (fn: (...args: never[]) => unknown) => fn as unknown as typeof fetch;

function collected() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    log: (message: unknown) => out.push(String(message)),
    error: (message: unknown) => err.push(String(message)),
    out,
    err,
  } as const;
}

describe("parseArgs()", () => {
  it("默认从环境变量取连接信息", () => {
    const options = parseArgs([], {
      SUPABASE_URL: "https://db.example.test",
      SUPABASE_SERVICE_ROLE_KEY: "local-key",
    });
    expect(options).toMatchObject({
      url: "https://db.example.test",
      serviceRoleKey: "local-key",
      json: false,
      maxRows: 50,
      timeoutMs: 15_000,
      failOnFindings: false,
    });
  });

  it("命令行覆盖环境变量，并解析布尔与数值 flag", () => {
    const options = parseArgs(
      ["--url", "https://other.test", "--json", "--fail-on-findings", "--max-rows", "5", "--output", "/tmp/o.json"],
      { SUPABASE_URL: "https://db.example.test", SUPABASE_SERVICE_ROLE_KEY: "k" },
    );
    expect(options).toMatchObject({
      url: "https://other.test",
      json: true,
      failOnFindings: true,
      maxRows: 5,
      output: "/tmp/o.json",
    });
  });

  it("容忍 pnpm 转发过来的 -- 分隔符", () => {
    const options = parseArgs(["--", "--json", "--max-rows", "3"], {});
    expect(options).toMatchObject({ json: true, maxRows: 3 });
  });

  it("未知参数、缺值与非正数都直接报错", () => {    expect(() => parseArgs(["--nope"], {})).toThrow(/未知参数/);
    expect(() => parseArgs(["--url"], {})).toThrow(/--url 需要一个值/);
    expect(() => parseArgs(["--url", "--json"], {})).toThrow(/--url 需要一个值/);
    expect(() => parseArgs(["--max-rows", "0"], {})).toThrow(/正整数/);
    expect(() => parseArgs(["--timeout-ms", "abc"], {})).toThrow(/正整数/);
  });
});

describe("orphanRpcEndpoint()", () => {
  it("规范化尾斜杠并固定到 RPC 路径", () => {
    expect(orphanRpcEndpoint("https://db.example.test/")).toBe(
      "https://db.example.test/rest/v1/rpc/find_orphan_upload_objects",
    );
    expect(orphanRpcEndpoint("http://127.0.0.1:54321")).toContain("/rest/v1/rpc/");
  });

  it("拒绝非 http(s)、查询串与无法解析的地址", () => {
    expect(() => orphanRpcEndpoint("ftp://x.test")).toThrow(/只接受 http\/https/);
    expect(() => orphanRpcEndpoint("https://x.test?token=1")).toThrow(/查询串/);
    expect(() => orphanRpcEndpoint("not a url")).toThrow(/不是合法地址/);
  });
});

describe("fetchOrphanRows()", () => {
  it("以 service-role 身份 POST 调用 RPC 并解析行", async () => {
    const fetchImpl = vi.fn(asFetch(async () => jsonResponse(RPC_ROWS)));
    const rows = await fetchOrphanRows(
      { url: "https://db.example.test", serviceRoleKey: "sk", timeoutMs: 1000 },
      fetchImpl,
    );
    expect(rows[0]).toMatchObject({ objectKey: "user-1/portrait.png", ownerId: null });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://db.example.test/rest/v1/rpc/find_orphan_upload_objects");
    expect(init.method).toBe("POST");
    expect(init.body).toBe("{}");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk");
    expect((init.headers as Record<string, string>).apikey).toBe("sk");
  });

  it("非 2xx 与坏响应体都抛错", async () => {
    const unauthorized = asFetch(async () => ({
      ok: false,
      status: 401,
      text: async () => "invalid JWT",
    }));
    const notAnArray = asFetch(async () => ({
      ok: true,
      status: 200,
      text: async () => '{"message":"not an array"}',
    }));
    const options = { url: "https://x.test", serviceRoleKey: "k", timeoutMs: 100 };
    await expect(fetchOrphanRows(options, unauthorized)).rejects.toThrow(/RPC 返回 401/);
    await expect(fetchOrphanRows(options, notAnArray)).rejects.toThrow(/期望数组/);
  });
});

describe("runStorageOrphanAudit()", () => {
  it("缺少凭据时以错误退出，而不是静默报零", async () => {
    const io = collected();
    const code = await runStorageOrphanAudit([], { ...io, env: {}, fetchImpl: asFetch(async () => jsonResponse([])) });
    expect(code).toBe(1);
    expect(io.err.join("\n")).toContain("缺少 --url 或 --service-role-key");
  });

  it("--help 打印用法并退出 0", async () => {
    const io = collected();
    expect(await runStorageOrphanAudit(["--help"], { ...io, env: {} })).toBe(0);
    expect(io.out.join("\n")).toContain("只读巡检");
  });

  it("文本报告里点明账户已删除，且绝不回显凭据", async () => {
    const io = collected();
    const code = await runStorageOrphanAudit(
      ["--url", "https://db.example.test", "--service-role-key", "SECRET-VALUE"],
      { ...io, env: {}, nowMs: NOW, fetchImpl: asFetch(async () => jsonResponse(RPC_ROWS)) },
    );
    const all = [...io.out, ...io.err].join("\n");
    expect(code).toBe(0);
    expect(all).toContain("1 条上传者账户已删除");
    expect(all).toContain("5 天");
    expect(all).not.toContain("SECRET-VALUE");
  });

  it("--json 输出可机读的结果，--fail-on-findings 让孤儿成为失败", async () => {
    const io = collected();
    const code = await runStorageOrphanAudit(
      ["--url", "https://db.example.test", "--service-role-key", "k", "--json", "--fail-on-findings"],
      { ...io, env: {}, nowMs: NOW, fetchImpl: asFetch(async () => jsonResponse(RPC_ROWS)) },
    );
    expect(code).toBe(2);
    const payload = JSON.parse(io.out.join("\n"));
    expect(payload.rpc).toBe("find_orphan_upload_objects");
    expect(payload.summary).toMatchObject({ count: 1, unowned: 1 });
    expect(payload.orphans[0]).toMatchObject({ objectKey: "user-1/portrait.png", ownerId: null });
  });

  it("--output 落盘证据文件", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "indiestack-orphans-"));
    const target = path.join(directory, "nested", "orphans.txt");
    const io = collected();
    const code = await runStorageOrphanAudit(
      ["--url", "https://db.example.test", "--service-role-key", "k", "--output", target],
      { ...io, env: {}, nowMs: NOW, fetchImpl: asFetch(async () => jsonResponse([])) },
    );
    expect(code).toBe(0);
    expect(fs.readFileSync(target, "utf8")).toContain("孤儿对象：0 条");
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("RPC 失败时退出码 1 并说明原因", async () => {
    const io = collected();
    const code = await runStorageOrphanAudit(
      ["--url", "https://db.example.test", "--service-role-key", "k"],
      {
        ...io,
        env: {},
        nowMs: NOW,
        fetchImpl: asFetch(async () => {
          throw new Error("fetch failed");
        }),
      },
    );
    expect(code).toBe(1);
    expect(io.err.join("\n")).toContain("孤儿巡检失败");
  });
});

// ============================================================
// provider 侧集合差（C05）
// ============================================================

const withRange = (body: unknown, contentRange: string) => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify(body),
  headers: { get: (name: string) => (name.toLowerCase() === "content-range" ? contentRange : null) },
});

const stored = (key: string, status = "active") => ({ bucket: "avatars", object_key: key, status });
const obj = (name: string) => ({ name, id: "22d3001f-cb76-411d-a608-53851ed84139", updated_at: "2026-09-23T00:39:55.257Z", metadata: { size: 12 } });

/** 假 fetch 的预置数据，四条链路各一路。 */
interface FakeRoutes {
  rpc?: unknown[];
  tracked?: Array<Record<string, string>>;
  trackedTotal?: number;
  buckets?: string[];
  listing?: Record<string, unknown[]>;
  /** 覆盖列目录那一路的响应，用来测 bucket 不存在 / 无权限。 */
  storageResponse?: () => unknown;
}

/** 元数据表的一页：按请求里的 offset/limit 切片，并如实带上 Content-Range。 */
function trackedPage(input: Pick<FakeRoutes, "tracked" | "trackedTotal">, url: string) {
  const query = new URL(url).searchParams;
  const offset = Number(query.get("offset"));
  const limit = Number(query.get("limit"));
  const page = (input.tracked ?? []).slice(offset, offset + limit);
  const total = input.trackedTotal ?? (input.tracked ?? []).length;
  // 空结果集 PostgREST 给的是 `*/0`，有结果才是 `首-尾/总数`。
  const range = page.length === 0 ? `*/${total}` : `${offset}-${offset + page.length - 1}/${total}`;
  return withRange(page, range);
}

/** 列目录的一页：按请求体里的 `prefix@offset` 找预置内容。 */
function listingPage(input: Pick<FakeRoutes, "listing" | "storageResponse">, init?: RequestInit) {
  if (input.storageResponse) return input.storageResponse();
  const body = JSON.parse(String(init?.body)) as { prefix?: string; offset?: number };
  return jsonResponse(input.listing?.[`${body.prefix ?? ""}@${body.offset ?? 0}`] ?? []);
}

/** 按 URL 分流的假 fetch：RPC、bucket 清单、元数据分页读、列目录。 */
function fakeProviderFetch(input: FakeRoutes) {
  const routes: Array<[RegExp, (url: string, init?: RequestInit) => unknown]> = [
    [/\/rest\/v1\/rpc\//, () => jsonResponse(input.rpc ?? [])],
    [/\/storage\/v1\/bucket$/, () => jsonResponse((input.buckets ?? ["avatars"]).map((name) => ({ name })))],
    [/\/rest\/v1\/upload_objects/, (url) => trackedPage(input, url)],
    [/\/storage\/v1\/object\/list\//, (_url, init) => listingPage(input, init)],
  ];
  const urls: string[] = [];
  const impl = async (url: string, init?: RequestInit) => {
    urls.push(url);
    const route = routes.find(([pattern]) => pattern.test(url));
    if (!route) throw new Error(`未预期的请求：${url}`);
    return route[1](url, init) as never;
  };
  return { urls, fetchImpl: asFetch(impl) };
}

describe("provider 侧端点与参数", () => {
  it("列目录与元数据表的端点都带上了分页必需的参数", () => {
    expect(storageListEndpoint("https://db.example.test", "avatars")).toBe(
      "https://db.example.test/storage/v1/object/list/avatars",
    );
    const url = new URL(uploadObjectsEndpoint("https://db.example.test", 1000, 500));
    expect(url.pathname).toBe("/rest/v1/upload_objects");
    expect(url.searchParams.get("select")).toBe("bucket,object_key,status");
    expect(url.searchParams.get("offset")).toBe("1000");
    // 没有全序的 offset 分页会漏行，所以 order 是端点契约的一部分。
    expect(url.searchParams.get("order")).toBe("bucket.asc,object_key.asc");
  });

  it("bucket 名走的是路径，必须拒绝一切能改写路径的输入", () => {
    expect(() => storageListEndpoint("https://x.test", "../evil")).toThrow(/bucket 名非法/);
    expect(() => storageListEndpoint("https://x.test", "a/b")).toThrow(/bucket 名非法/);
    expect(() => storageListEndpoint("https://x.test", "")).toThrow(/bucket 名非法/);
    expect(() => parseArgs(["--bucket", "../x"], {})).toThrow(/bucket 名非法/);
  });

  it("--provider-diff 默认关，--max-pages 只接受正整数", () => {
    expect(parseArgs([], {}).providerDiff).toBe(false);
    expect(parseArgs(["--provider-diff"], {}).providerDiff).toBe(true);
    expect(parseArgs(["--provider-diff"], {}).bucket).toBe("avatars");
    expect(() => parseArgs(["--max-pages", "0"], {})).toThrow(/正整数/);
  });

  it("Content-Range 解析：认 `0-1/2`，也认空集的 `*/0`，其它一律 null", () => {
    expect(parseContentRange("0-1/2")).toBe(2);
    expect(parseContentRange("*/0")).toBe(0);
    expect(parseContentRange(null)).toBeNull();
    expect(parseContentRange("nonsense")).toBeNull();
  });
});

describe("fetchTrackedObjects()", () => {
  const options = { url: "https://db.example.test", serviceRoleKey: "k", timeoutMs: 100 };

  it("按总数翻页读到最后一行，而不是读到短页就算完", async () => {
    const tracked = [stored("a"), stored("b"), stored("c")];
    const { urls, fetchImpl } = fakeProviderFetch({ tracked, trackedTotal: 3 });
    const result = await fetchTrackedObjects(options, fetchImpl, 2);
    expect(result.rows).toEqual([
      { bucket: "avatars", objectKey: "a", status: "active" },
      { bucket: "avatars", objectKey: "b", status: "active" },
      { bucket: "avatars", objectKey: "c", status: "active" },
    ]);
    expect(result.requests).toBe(2);
    expect(urls).toHaveLength(2);
  });

  it("服务端截断（总数比读到的多却先给了空页）时抛错", async () => {
    const { fetchImpl } = fakeProviderFetch({ tracked: [stored("a")], trackedTotal: 9 });
    await expect(fetchTrackedObjects(options, fetchImpl, 2)).rejects.toThrow(/但总数报的是 9/);
  });

  it("读到的行数反超总数时抛错（分页已经不可信，继续读只会更乱）", async () => {
    const { fetchImpl } = fakeProviderFetch({ tracked: [stored("a"), stored("b")], trackedTotal: 1 });
    await expect(fetchTrackedObjects(options, fetchImpl, 5)).rejects.toThrow(/分页已不可信/);
  });

  it("元数据表也有请求上限：一张意外大的表不能把巡检一路读下去", async () => {
    const tracked = Array.from({ length: 50 }, (_, i) => stored(`f${i}`));
    const { urls, fetchImpl } = fakeProviderFetch({ tracked });
    await expect(fetchTrackedObjects(options, fetchImpl, 2, 3)).rejects.toThrow(/分页已达上限 3 次/);
    // 触顶之后就必须停下，而不是又发一次。
    expect(urls).toHaveLength(3);
  });

  it("没有 Content-Range 就不假装读全了", async () => {
    await expect(
      fetchTrackedObjects(options, asFetch(async () => jsonResponse([stored("a")])), 2),
    ).rejects.toThrow(/Content-Range/);
  });

  it("不认识的 status 直接抛，不悄悄当成 active 或 deleted", async () => {
    const { fetchImpl } = fakeProviderFetch({ tracked: [{ bucket: "avatars", object_key: "a", status: "purged" }] });
    await expect(fetchTrackedObjects(options, fetchImpl, 2)).rejects.toThrow(/status 不认识/);
  });
});

describe("runStorageOrphanAudit() 的 --provider-diff", () => {
  const baseArgs = ["--url", "https://db.example.test", "--service-role-key", "k"];

  it("不带这个 flag 时一个列目录请求都不发（它要多走一整趟，默认不开）", async () => {
    const { urls, fetchImpl } = fakeProviderFetch({ rpc: RPC_ROWS, tracked: [stored("a")] });
    const io = collected();
    expect(await runStorageOrphanAudit(baseArgs, { ...io, env: {}, nowMs: NOW, fetchImpl })).toBe(0);
    // 注意别用裸 `upload_objects` 过滤：RPC 的名字里就含这个子串。
    expect(urls.filter((u) => u.includes("/storage/"))).toEqual([]);
    expect(urls.filter((u) => u.includes("/rest/v1/upload_objects"))).toEqual([]);
    expect(urls).toEqual(["https://db.example.test/rest/v1/rpc/find_orphan_upload_objects"]);
  });

  it("把「bucket 里有、元数据不认得」的存量对象报出来", async () => {
    const { fetchImpl } = fakeProviderFetch({
      tracked: [stored("known.png")],
      listing: { "@0": [obj("known.png"), obj("legacy-2021.png")] },
    });
    const io = collected();
    const code = await runStorageOrphanAudit([...baseArgs, "--provider-diff"], {
      ...io,
      env: {},
      nowMs: NOW,
      fetchImpl,
    });
    const text = [...io.out, ...io.err].join("\n");
    expect(code).toBe(0);
    expect(text).toContain("无元数据行");
    expect(text).toContain("avatars/legacy-2021.png");
    expect(text).not.toContain("· avatars/known.png");
  });

  it("同一形状写进 --json，供脚本消费", async () => {
    const { fetchImpl } = fakeProviderFetch({
      tracked: [stored("known.png")],
      listing: { "@0": [obj("known.png"), obj("legacy-2021.png")] },
    });
    const io = collected();
    await runStorageOrphanAudit([...baseArgs, "--provider-diff", "--json"], {
      ...io,
      env: {},
      nowMs: NOW,
      fetchImpl,
    });
    const payload = JSON.parse(io.out.join("\n"));
    expect(payload.providerDiff).toMatchObject({
      bucket: "avatars",
      providerCount: 2,
      trackedCount: 1,
    });
    expect(payload.providerDiff.untracked.map((o: { objectKey: string }) => o.objectKey)).toEqual([
      "legacy-2021.png",
    ]);
  });

  it("RPC 报零孤儿也不许盖住集合差的发现：--fail-on-findings 因此退出 2", async () => {
    const { fetchImpl } = fakeProviderFetch({
      rpc: [],
      tracked: [stored("here.png"), stored("gone.png")],
      listing: { "@0": [obj("here.png")] },
    });
    const io = collected();
    const code = await runStorageOrphanAudit([...baseArgs, "--provider-diff", "--fail-on-findings"], {
      ...io,
      env: {},
      nowMs: NOW,
      fetchImpl,
    });
    expect(code).toBe(2);
    expect(io.err.join("\n")).toContain("1 项 provider 集合差发现");
    expect(io.out.join("\n")).toContain("元数据为 active 但对象已不在 bucket：1 个");
  });

  it("列目录没走完就是失败，不是「没有孤儿」", async () => {
    const forever = Array.from({ length: 500 }, (_, i) => obj(`f${i}.png`));
    const { fetchImpl } = fakeProviderFetch({ rpc: [], tracked: [], listing: { "@0": forever } });
    const io = collected();
    const code = await runStorageOrphanAudit([...baseArgs, "--provider-diff", "--max-pages", "1"], {
      ...io,
      env: {},
      nowMs: NOW,
      fetchImpl,
    });
    expect(code).toBe(1);
    expect(io.err.join("\n")).toContain("列目录没有走完");
    expect(io.err.join("\n")).toContain("--max-pages");
    // 关键：失败时那份「0 条孤儿」的报告根本不该被打印出来。
    expect(io.out.join("\n")).not.toContain("孤儿对象：0 条");
  });

  it("列目录被拒时按失败退出，并把状态码说清楚", async () => {
    const { fetchImpl } = fakeProviderFetch({
      rpc: [],
      tracked: [],
      storageResponse: () => ({
        ok: false,
        status: 404,
        text: async () => "bucket not found",
      }),
    });
    const io = collected();
    const code = await runStorageOrphanAudit([...baseArgs, "--provider-diff"], {
      ...io,
      env: {},
      nowMs: NOW,
      fetchImpl,
    });
    expect(code).toBe(1);
    expect(io.err.join("\n")).toContain("列目录 返回 404");
    expect(io.err.join("\n")).toContain("bucket not found");
  });

  it("bucket 名拼错时必须失败，而不是报一次干净的零发现（实测：列不存在的 bucket 返回空集）", async () => {
    const { fetchImpl, urls } = fakeProviderFetch({
      rpc: [],
      tracked: [stored("a.png")],
      buckets: ["avatars", "covers"],
      listing: { "@0": [] },
    });
    const io = collected();
    const code = await runStorageOrphanAudit([...baseArgs, "--provider-diff", "--bucket", "avatar"], {
      ...io,
      env: {},
      nowMs: NOW,
      fetchImpl,
    });
    expect(code).toBe(1);
    const err = io.err.join("\n");
    expect(err).toContain("bucket avatar 在服务端不存在");
    expect(err).toContain("avatars, covers");
    // 一个都不该被报成发现，也不该有人去列那个不存在的目录。
    expect(io.out.join("\n")).not.toContain("无元数据行");
    expect(urls.filter((u) => u.includes("/object/list/"))).toEqual([]);
  });

  it("bucket 清单读不出来时同样按失败退出", async () => {
    const io = collected();
    const code = await runStorageOrphanAudit([...baseArgs, "--provider-diff"], {
      ...io,
      env: {},
      nowMs: NOW,
      fetchImpl: asFetch(async (url: string) =>
        String(url).endsWith("/storage/v1/bucket")
          ? { ok: true, status: 200, text: async () => '{"message":"nope"}' }
          : jsonResponse([]),
      ),
    });
    expect(code).toBe(1);
    expect(io.err.join("\n")).toContain("bucket 清单返回的不是数组");
  });
});
