import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  orphanRpcEndpoint,
  parseArgs,
  runStorageOrphanAudit,
  fetchOrphanRows,
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
