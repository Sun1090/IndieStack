/**
 * Mock 客户端的 auth 表面积必须覆盖应用真正调用的那些方法。
 *
 * 起因（C03）：挑战页在 verify 成功后 `await supabase.auth.refreshSession()`，而 mock 客户端
 * 根本没有这个方法——浏览器里就是一次 TypeError，被页面的 catch 兜成「登录失败，请稍后重试」，
 * 于是「验证码明明是对的，页面却说失败」。组件级用例把整个 client 桩掉，看不见这类缺口。
 *
 * 这里只做静态扫描 + 一次对象探测，不接 CI 门禁：它跑在 `pnpm test` 里，而 `pnpm test` 本来就是
 * push 的硬性前置（AGENTS.md），再套一层 scripts/check-* 只是把同一条约束抄第三遍。
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { MockSupabaseClient } from "./index";

const AUTH_CALL = /[A-Za-z_$][\w$]*\.auth\.((?:[A-Za-z][\w$]*\.)*[A-Za-z][\w$]*)\s*\(/g;

/**
 * 已知的未实现路径，每条带理由。**这里不是allowlist的垃圾桶**：
 * 有人把某个方法补上之后，下面那条就会因为「不再缺失」而变红，必须顺手删行——
 * 静默生效的豁免清单正是这次 refreshSession 那类缺口能活这么久的原因。
 */
const KNOWN_GAPS: Record<string, string> = {
  "admin.generateLink":
    "passkey 登录需要 service-role 铸造 magiclink；在有了 Chromium 虚拟 WebAuthn 认证器、" +
    "能真跑 passkey E2E 之前，这条路径在本仓库不可达",
  "admin.getUserById": "同上：passkey 会话签发链路读账号邮箱的另一端",
};

/** 从源码文本里取出 `<client>.auth.<路径>(` 的完整路径（如 `getUser`、`mfa.challenge`）。 */
export function collectAuthCallPaths(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(AUTH_CALL)) {
    found.add(match[1]);
  }
  return [...found].sort();
}

/** 沿路径逐段走对象；返回第一个不存在的段，全部存在则返回 null。 */
export function findMissingPath(root: unknown, path: string): string | null {
  let cursor: unknown = root;
  for (const segment of path.split(".")) {
    if (typeof cursor !== "object" || cursor === null || !(segment in cursor)) {
      return segment;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return null;
}

function listSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...listSourceFiles(full));
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      files.push(full);
    }
  }
  return files;
}

describe("Mock auth 表面积必须覆盖应用调用的方法", () => {
  it("只抽取真实的调用点，字符串里的指标名不算", () => {
    const code = `
      const a = await supabase.auth.getUser();
      const b = await supabase.auth.mfa.challenge({ factorId });
      const c = await supabase.auth.mfa.verify({ factorId, challengeId, code });
      const d = admin.auth.admin.generateLink({ type: "magiclink" });
      export const METRIC = "cron.auth.rejected"; // 指标名，不是调用
    `;
    expect(collectAuthCallPaths(code)).toEqual([
      "admin.generateLink",
      "getUser",
      "mfa.challenge",
      "mfa.verify",
    ]);
  });

  it("缺方法时报出缺失的那一段，存在时报 null", () => {
    const root = { getUser: () => {}, mfa: { challenge: () => {} } };
    expect(findMissingPath(root, "getUser")).toBeNull();
    expect(findMissingPath(root, "mfa.challenge")).toBeNull();
    expect(findMissingPath(root, "refreshSession")).toBe("refreshSession");
    expect(findMissingPath(root, "mfa.verify")).toBe("verify");
  });

  it("应用里每一处 supabase.auth.* 调用，mock 客户端都有对应实现", () => {
    const auth = new MockSupabaseClient().auth as unknown as Record<string, unknown>;
    const missing: string[] = [];

    for (const file of listSourceFiles(join(process.cwd(), "src"))) {
      if (file.includes(".test.") || file.endsWith("mock/index.ts")) {
        continue;
      }
      for (const path of collectAuthCallPaths(readFileSync(file, "utf8"))) {
        const gap = findMissingPath(auth, path);
        if (gap && !(path in KNOWN_GAPS)) {
          missing.push(`${relative(process.cwd(), file)} → auth.${path}（缺 ${gap}）`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  it("每条已知缺口都还确实是缺口，补上就删行", () => {
    const auth = new MockSupabaseClient().auth as unknown as Record<string, unknown>;
    const stillMissing = Object.keys(KNOWN_GAPS).filter(
      (path) => findMissingPath(auth, path) !== null,
    );
    expect(stillMissing).toEqual(Object.keys(KNOWN_GAPS));
  });
});
