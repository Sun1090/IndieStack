/**
 * 服务器身份判据的单测，外加一条「它确实被接上了」的接线断言。
 *
 * 第二条不是形式主义：一个纯函数可以永远绿着，而 globalSetup 里早就没人调用它了——
 * 那正是本模块要防的那种绿（证明不了任何事的通过）。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertOurServer,
  describeForeignServer,
  serverIdentityError,
} from "./e2e-server-identity";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const EXPECTED = { version: "0.11.0" };

/** `/api/health` 在 mock 模式下的真实形状（字段取自一次实际响应，多余的字段照抄）。 */
const OURS = {
  status: "ok",
  timestamp: "2026-09-23T06:16:17.226Z",
  uptime: 75,
  uptimeFormatted: "1m 15s",
  version: "0.11.0",
  commit: null,
  environment: "development",
  mockMode: true,
  checks: { supabase: { required: false, configured: true } },
  allConfigured: true,
};

describe("describeForeignServer()", () => {
  it("本仓库自己的健康响应算通过", () => {
    expect(describeForeignServer(OURS, EXPECTED)).toBeUndefined();
  });

  it("缺字段的对象也算通过？不：mockMode 与 version 必须都在位", () => {
    expect(describeForeignServer({ version: "0.11.0" }, EXPECTED)).toContain("mockMode");
    expect(describeForeignServer({ mockMode: true }, EXPECTED)).toContain("version");
  });

  it("mockMode 只要不是布尔 true 就拒绝：字符串、0、缺省都不行", () => {
    for (const value of [false, "true", 1, 0, null, undefined]) {
      const reason = describeForeignServer({ ...OURS, mockMode: value }, EXPECTED);
      expect(reason, JSON.stringify(value)).toContain("mockMode");
    }
  });

  it("版本不一致时拒绝，并把两边都写进理由", () => {
    const reason = describeForeignServer({ ...OURS, version: "0.9.4" }, EXPECTED);
    expect(reason).toContain("0.9.4");
    expect(reason).toContain("0.11.0");
  });

  it("拿不到对象（null / 数组 / 字符串 / 非 JSON）一律拒绝，而不是放行", () => {
    for (const body of [null, undefined, [], ["mockMode"], "ok", 42]) {
      expect(
        describeForeignServer(body, EXPECTED),
        JSON.stringify(body) ?? "undefined",
      ).toContain("JSON");
    }
  });

  it("多余的字段不影响判定（健康检查以后还会加东西）", () => {
    expect(describeForeignServer({ ...OURS, quota: "unlimited" }, EXPECTED)).toBeUndefined();
  });
});

describe("serverIdentityError()", () => {
  it("错误里必须带端口、排查命令与换端口的出路", () => {
    const message = serverIdentityError("http://localhost:3100", "mockMode 不是 true", 3100);
    expect(message).toContain(":3100");
    expect(message).toContain("lsof -nP -iTCP:3100");
    expect(message).toContain("E2E_BASE_PORT=3400");
    expect(message).toContain("mockMode 不是 true");
  });
});

describe("assertOurServer()", () => {
  const origin = "http://localhost:3100";

  it("健康响应是我们的服务器时静默通过", async () => {
    await expect(
      assertOurServer(origin, 3100, EXPECTED, async () => OURS),
    ).resolves.toBeUndefined();
  });

  it("拿不到证据也算不是我们的服务器：读失败必须抛，不许静默放行", async () => {
    await expect(
      assertOurServer(origin, 3100, EXPECTED, async () => {
        throw new Error("socket hang up");
      }),
    ).rejects.toThrow("socket hang up");
    await expect(
      assertOurServer(origin, 3100, EXPECTED, async () => {
        throw new Error("socket hang up");
      }),
    ).rejects.toThrow(/lsof -nP -iTCP:3100/);
  });

  it("别人的服务器：抛出的错误点名端口，并给出换端口的出路", async () => {
    await expect(
      assertOurServer(
        origin,
        3100,
        EXPECTED,
        async () => ({ status: "ok", version: "1.2.3", mockMode: false }),
      ),
    ).rejects.toThrow(/E2E_BASE_PORT=3400/);
  });

  it("取的是 `<origin>/api/health`，不是别的路径", async () => {
    const seen: string[] = [];
    await assertOurServer(origin, 3100, EXPECTED, async (url) => {
      seen.push(url);
      return OURS;
    });
    expect(seen).toEqual(["http://localhost:3100/api/health"]);
  });
});

describe("接线", () => {
  const read = (relative: string) => fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");

  it("globalSetup 真的调用了这条判据", () => {
    const warmUp = read("e2e/support/warm-up.ts");
    expect(warmUp).toContain("e2e-server-identity");
    // 要的是**调用**，不是 import：只查名字的话，把整段检查删掉也照样绿
    expect(warmUp).toContain("await assertOurServer(");
  });

  it("身份核对在「只在并行时预热」那句早退**之前**：串行是最常用的模式", () => {
    const warmUp = read("e2e/support/warm-up.ts");
    // 只算调用点：按名字找会先撞上 import 那一行，比较就成了假绿
    const identity = warmUp.indexOf("await assertOurServer(");
    const earlyReturn = warmUp.indexOf("if (SERVERS < 2) return;");
    expect(identity).toBeGreaterThan(-1);
    expect(earlyReturn).toBeGreaterThan(-1);
    expect(identity).toBeLessThan(earlyReturn);
  });

  for (const config of ["playwright.config.ts", "playwright.visual.config.ts"]) {
    it(`${config} 不再静默复用已有服务器`, () => {
      const text = read(config);
      expect(text).toContain("reuseExistingServer: false");
      expect(text).not.toContain("reuseExistingServer: !process.env.CI");
    });
  }
});
