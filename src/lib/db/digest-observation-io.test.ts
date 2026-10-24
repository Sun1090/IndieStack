/**
 * digest 端到端读数的 IO 层单测。
 * 判据住在判定层，这里管的是「读不到时以什么退出码收场」——未知绝不能压成 0。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  exitCodeFor,
  nextDigestUtcIso,
  observationSql,
  parseArgs,
  runDigestObservation,
} from "../../../scripts/lib/digest-observation-check.js";

type ParsedArgs = { error?: string; options?: Record<string, unknown> };

function optionsOf(parsed: ParsedArgs): Record<string, unknown> {
  expect(parsed.error).toBeUndefined();
  return parsed.options as Record<string, unknown>;
}

const baseOptions = {
  since: "2026-10-24T10:42:42Z",
  firstExpected: "",
  projectRef: "abc123defg",
  token: "sbp_token_placeholder",
  supabaseUrl: "",
  timeoutMs: 1000,
  help: false,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("parseArgs", () => {
  it("--since 与 --first-expected 覆盖锚点；非法时间报错", () => {
    const options = optionsOf(parseArgs(["--since", "2026-01-01T00:00:00Z", "--first-expected", "2026-01-02T09:00:00Z"]) as ParsedArgs);
    expect(options.since).toBe("2026-01-01T00:00:00Z");
    expect(options.firstExpected).toBe("2026-01-02T09:00:00Z");
    expect((parseArgs(["--since", "nonsense"]) as ParsedArgs).error).toContain("--since");
  });

  it("默认 since 是 405 修复的部署时刻（时间锚可被 env 覆盖）", () => {
    // `gh api`/CI 之外这台机器没有该 env，传空对象让默认值接受测试。
    const options = optionsOf(parseArgs([], {} as NodeJS.ProcessEnv) as ParsedArgs);
    expect(options.since).toBe("2026-10-24T10:42:42Z");
  });
});

describe("nextDigestUtcIso", () => {
  it("09:00 前部署 ⇒ 当天 09:00；之后 ⇒ 次日 09:00", () => {
    expect(nextDigestUtcIso("2026-10-25T06:00:00Z")).toBe("2026-10-25T09:00:00.000Z");
    expect(nextDigestUtcIso("2026-10-24T10:42:42Z")).toBe("2026-10-25T09:00:00.000Z");
    expect(nextDigestUtcIso("2026-10-25T09:00:00.000Z")).toBe("2026-10-26T09:00:00.000Z");
  });
});

describe("observationSql", () => {
  it("只读 SELECT，单引号被转义", () => {
    const sql = observationSql("2026-10-24T10:42:42Z");
    expect(sql).toContain("from public.email_worker_runs");
    expect(sql).toMatch(/^select /);
    expect(observationSql("x'y")).toContain("'x''y'::timestamptz");
  });
});

describe("runDigestObservation", () => {
  it("缺 token ⇒ 退出码 2（未知不算通过，也不算坏）", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = await runDigestObservation({ ...baseOptions, token: "" });
    expect(code).toBe(2);
    spy.mockRestore();
  });

  it("响应形状不认识 ⇒ 2（不返回空数组冒充『没有行』）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ unexpected: true }), { status: 200 })));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = await runDigestObservation(baseOptions);
    expect(code).toBe(2);
    spy.mockRestore();
  });

  it("落表行存在 ⇒ 0 并打印 verdict 证据", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify([{ created_at: "2026-10-25T09:00:05Z", pulled: 2, sent: 2, failed: 0, backlog: 5, skipped: 0 }]), { status: 200 }),
      ),
    );
    const log: string[] = [];
    vi.spyOn(console, "log").mockImplementation((m) => log.push(String(m)));
    // now 一定晚于 firstExpected，所以能判跑通——把两个锚点都钉在过去。
    const code = await runDigestObservation({
      ...baseOptions,
      since: "2020-01-01T00:00:00Z",
      firstExpected: "2020-01-01T09:00:00.000Z",
    });
    vi.mocked(console.log).mockRestore();
    expect(code).toBe(0);
    expect(log.some((line) => line.includes("COMPLETED_OK"))).toBe(true);
  });

  it("窗口未开 ⇒ TOO_EARLY 退出码 2", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
    const log: string[] = [];
    vi.spyOn(console, "log").mockImplementation((m) => log.push(String(m)));
    const code = await runDigestObservation({
      ...baseOptions,
      since: "2999-01-01T00:00:00Z",
      firstExpected: "2999-01-02T09:00:00Z",
    });
    vi.mocked(console.log).mockRestore();
    expect(code).toBe(2);
    expect(log.some((line) => line.includes("TOO_EARLY"))).toBe(true);
  });
});

describe("exitCodeFor", () => {
  it("跑通（含失败侧读数）= 0；未落表 = 1；太早 = 2", () => {
    expect(exitCodeFor("COMPLETED_FAILING")).toBe(0);
    expect(exitCodeFor("NOT_TRIGGERED")).toBe(1);
    expect(exitCodeFor("TOO_EARLY")).toBe(2);
  });
});
