/**
 * `scripts/check-production-version.js` 的入参契约（B01 / B02 证据链）。
 *
 * 这个脚本是每天 02:17 UTC 的定时漂移检查，跑在无人盯着的调度里，所以它的参数解析
 * 必须自己站得住：期望 commit 太短等于没有断言（任何构建都能匹配），而不传它时
 * 必须保持「只记录、不新增失败面」——定时检查红应当只意味着生产落后于仓库版本。
 */
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const drift = require("../../scripts/check-production-version.js") as {
  DEFAULT_BASE_URL: string;
  parseArgs: (argv: string[]) => {
    baseUrl?: string;
    output: string;
    timeoutMs: number;
    expectedCommit?: string;
  };
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("check-production-version CLI", () => {
  it("keeps the scheduled defaults and accepts an explicit base URL", () => {
    expect(drift.parseArgs(["--base-url", "https://example.com"])).toMatchObject({
      baseUrl: "https://example.com",
      output: "production-smoke.json",
      timeoutMs: expect.any(Number),
    });
    expect(drift.parseArgs(["--base-url=https://example.com"]).expectedCommit).toBeUndefined();
  });

  it("reads the expected commit from the flag or the environment", () => {
    expect(drift.parseArgs(["--base-url", "https://example.com", "--expected-commit", "a322a4ed"]).expectedCommit).toBe(
      "a322a4ed",
    );
    vi.stubEnv("EXPECTED_APP_COMMIT", "23a2677fc");
    expect(drift.parseArgs(["--base-url", "https://example.com"]).expectedCommit).toBe("23a2677fc");
    expect(
      drift.parseArgs(["--base-url", "https://example.com", "--expected-commit=a322a4ed"]).expectedCommit,
    ).toBe("a322a4ed");
  });

  it("rejects a meaningless commit expectation instead of silently passing", () => {
    expect(() => drift.parseArgs(["--base-url", "https://example.com", "--expected-commit", "abc"])).toThrow(
      /at least 7 characters/,
    );
    vi.stubEnv("EXPECTED_APP_COMMIT", "abc");
    expect(() => drift.parseArgs(["--base-url", "https://example.com"])).toThrow(/at least 7 characters/);
    expect(() => drift.parseArgs(["--expected-commit", "a322a4ed"])).toThrow(/--base-url requires a value/);
  });
});
