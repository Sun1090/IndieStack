/**
 * **集成用例**（不是单测）：用应用自己的存储驱动往真实 bucket 建对象、读回、删除、再读。
 *
 * 为什么这一格此前是空的（2026-10-25 核对）：
 *   - `docs/operations/drills/*.single-do.sql` 只动数据库（`upload_objects` 元数据行），
 *     它连的是 SQL，**碰不到 storage provider**；
 *   - `pnpm smoke:supabase-identity` 的 13 项 storage 检查验的是**原始 REST + RLS 策略**
 *     （本轮实跑 20/20 全绿）——它自己发 HTTP，**不经过 `src/lib/storage` 那层驱动**；
 *   - `e2e/uploads.spec.ts` 跑的是 mock 后端（`playwright.config.ts` 里 mock 模式替换传输层）。
 *   ⇒ 「`cleanupStorageObject` 这条擦除链路能不能真把字节从 bucket 删掉」从来没有被自动化答过，
 *     而三份绿着的证据让它**看起来像答过了**。
 *
 * 为什么它是 .test.ts 而不是 `scripts/` 下的 CLI：
 *   node 直接 import 带 `@/` 别名的应用模块会挂（`Cannot find package '@/lib'`，本轮实测），
 *   而 vitest 通过 `resolve.alias` 能解析。**只有在 vitest 里才能引到真驱动代码**——
 *   做成 CLI 就得把存储调用重写一遍，那样测的是复制品，不是应用代码。
 *
 * 两条闸，缺一不可：
 *   1. `assertLocalOnlyTarget`：本机 `.env.local` 的 `NEXT_PUBLIC_SUPABASE_URL` 指向**生产**
 *      （本轮实测确认）。目标不是本机就**当场失败**，一个写请求都不发；
 *   2. `DRILL_STORAGE_REQUIRE=1`（由 `pnpm test:storage-erasure` 设置）：
 *      没有本地栈时**判失败而不是跳过**。缺了这条，它就会变成一个在 CI 里天天静默跳过、
 *      谁也不知道它到底跑没跑过的「检查」——**扫不到东西的检查等于没有检查**。
 *      不带该变量时（普通 `pnpm test` / CI）**整组不执行**：单测套件不该依赖 docker。
 */
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  assertLocalOnlyTarget,
  exitCodeForStorageErasure,
  judgeStorageErasure,
} from "./storage-erasure-drill";

const LOCAL_DEFAULT = "http://127.0.0.1:54321";
const AUTH_CONTAINER = "supabase_auth_indiestack";
const REQUIRE = process.env.DRILL_STORAGE_REQUIRE === "1";
const TARGET = process.env.DRILL_STORAGE_URL || LOCAL_DEFAULT;

function b64url(object: unknown) {
  return Buffer.from(JSON.stringify(object)).toString("base64url");
}

/** 用本地栈自己的 HS256 密钥签一个 service_role JWT——不是生产凭据，也不读生产 env。 */
function mintLocalServiceJwt(): string {
  const secret = execFileSync("docker", ["exec", AUTH_CONTAINER, "printenv", "GOTRUE_JWT_SECRET"], { encoding: "utf8" }).trim();
  const now = Math.floor(Date.now() / 1000);
  const header = b64url({ alg: "HS256", typ: "JWT" });
  const payload = b64url({ aud: "service_role", role: "service_role", iss: TARGET, iat: now, exp: now + 3600 });
  const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function stackReachable(): boolean {
  try {
    execFileSync("docker", ["exec", AUTH_CONTAINER, "printenv", "GOTRUE_JWT_SECRET"], { encoding: "utf8", stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

const reachable = stackReachable();

describe("存储擦除链路（真实 bucket，仅本地栈）", () => {
  it("目标闸：不给生产留任何写法", () => {
    const guard = assertLocalOnlyTarget(TARGET);
    // 这一条**无条件跑**：即使本地栈没起、下面整组被跳过，闸本身也必须被验证。
    // 有人把 DRILL_STORAGE_URL 指到生产时，这里直接红，而不是等到写下去才发现。
    expect(guard.ok, guard.reason).toBe(true);
  });

  // 真写只在**显式要求**时发生：默认 `pnpm test`（与 CI）不该依赖 docker，
  // 否则「栈没起」会变成全绿套件里一格与代码无关的红——那种红没人会信。
  // 而 `pnpm drills:storage-erasure` 会带上 DRILL_STORAGE_REQUIRE=1：那条命令声明了要验，
  // 环境没栈就必须**判失败**，不能 skip。
  describe.skipIf(!REQUIRE)("driver 建对象 → 可见 → 删除 → 不可见", () => {
    it("经应用驱动删除后对象真的没了", async () => {
      if (!reachable) {
        // 命令声明要验，环境却没东西可验 ⇒ fail 而不是 skip。
        throw new Error(`本地栈不可达（${TARGET}）却要求执行（DRILL_STORAGE_REQUIRE=1）——**未知不算通过**`);
      }
      // 闸必须在**任何写请求之前**生效：`reachable()` 只证明容器在跑，
      // 与 URL 指向无关——少了这一道，把 DRILL_STORAGE_URL 指到生产时，
      // 内层会先拿本地签的 key 往生产发一次 PUT（虽然会被 401 拒掉），
      // 而「一个写请求都不发」是我在判定层写下的承诺，不能只靠事后判据兑现。
      const earlyGuard = assertLocalOnlyTarget(TARGET);
      if (!earlyGuard.ok) throw new Error(`目标闸拒绝，未发出任何请求：${earlyGuard.reason}`);
      const key = `drill-storage-${Date.now()}-probe.png`;
      const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z1xkAAAAASUVORK5CYII=",
        "base64",
      );
      // 让应用代码走它自己的路径：createAdminClient 在调用时读 env，所以这里先把 env 钉到本机。
      process.env.NEXT_PUBLIC_SUPABASE_URL = TARGET;
      process.env.SUPABASE_SERVICE_ROLE_KEY = mintLocalServiceJwt();
      const { getStorageDriver, cleanupStorageObject } = await import("@/lib/storage");
      const driver = getStorageDriver();

      let removed = false;
      try {
        let putOk = false;
        let publicUrl = "";
        try {
          publicUrl = await driver.put(key, png, "image/png");
          putOk = typeof publicUrl === "string" && publicUrl.length > 0;
        } catch {
          putOk = false;
        }

        let visibleOk = false;
        if (putOk) {
          const read = await fetch(publicUrl);
          visibleOk = read.ok;
        }

        // 删除走**擦除链路用的同一个函数**，不是驱动裸调用——否则测的还是另一条路径。
        removed = putOk
          ? await cleanupStorageObject(key, { operation: "drill", resourceId: "storage-erasure" })
          : false;

        let goneAfterRemove = false;
        if (removed && publicUrl.length > 0) {
          const after = await fetch(publicUrl);
          goneAfterRemove = !after.ok;
        }

        const report = judgeStorageErasure({
          guard: earlyGuard,
          provider: driver.provider,
          supportsRemove: driver.capabilities.remove === true,
          readings: { putOk, visibleOk, removeOk: removed, goneAfterRemove },
        });
        expect(exitCodeForStorageErasure(report.step), report.evidence).toBe(0);
        expect(report.step).toBe("PASSED");
      } finally {
        // 失败路径也要尽力清掉探针对象：判据失败时留在 bucket 里，
        // 下次跑会多一个孤儿，而孤儿巡检会把它们报成真问题。
        if (!removed) {
          try {
            await driver.remove(key);
          } catch {
            // 清理失败不改变结论——它只是卫生动作。
          }
        }
      }
    });
  });
});
