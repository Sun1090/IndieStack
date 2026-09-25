import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { features } from "./feature-flags";

const SOURCE = readFileSync(join(process.cwd(), "src/lib/feature-flags.ts"), "utf8");

describe("feature-flags", () => {
  it("导出已知的功能开关集合", () => {
    expect(Object.keys(features).sort()).toEqual(["auditLogExport", "avatarUpload", "passkey", "passkeyLogin", "webhookDebugPage"]);
  });

  it("开关值为布尔类型", () => {
    for (const value of Object.values(features)) {
      expect(typeof value).toBe("boolean");
    }
  });

  it("环境变量 true 解析为开启", async () => {
    vi.stubEnv("NEXT_PUBLIC_FEATURE_WEBHOOK_DEBUG_PAGE", "true");
    vi.resetModules();
    const { features: refreshed } = await import("./feature-flags");
    expect(refreshed.webhookDebugPage).toBe(true);
    vi.unstubAllEnvs();
  });

  it("显式 false 关得掉（默认开的 auditLogExport 是唯一能证伪这一格的位置）", async () => {
    vi.stubEnv("NEXT_PUBLIC_FEATURE_AUDIT_LOG_EXPORT", "false");
    vi.resetModules();
    const { features: refreshed } = await import("./feature-flags");
    expect(refreshed.auditLogExport).toBe(false);
    vi.unstubAllEnvs();
  });

  it("未设置时使用默认值", async () => {
    vi.stubEnv("NEXT_PUBLIC_FEATURE_AVATAR_UPLOAD", "");
    vi.resetModules();
    const { features: refreshed } = await import("./feature-flags");
    expect(refreshed.avatarUpload).toBe(false);
    vi.unstubAllEnvs();
  });
});

/**
 * 形状断言：为什么不是运行时用例。
 *
 * 上面那几条都跑在 Node / jsdom 里，那里 `process.env` 是**真的**，所以整个这一族缺陷
 * （计算式 `process.env[key]` 在浏览器产物里读不到值）在这里结构性看不见——
 * 修复前的源码在这四条用例下同样全绿。浏览器那一侧的证据只能来自构建产物：
 * 见本文件的 `RAW_FLAGS` 注释与 docs/progress.md 的实测读数
 * （`NEXT_PUBLIC_FEATURE_AUDIT_LOG_EXPORT=false` 的生产构建里，`.next/static` 只剩模板前缀字符串，
 * 而对照组 `NEXT_PUBLIC_SUPABASE_URL` 的值是内联进去的；浏览器里 `typeof process === "undefined"`）。
 */
describe("开关必须写成可被构建期内联的静态读取", () => {
  /** 只判代码，不判解释缺陷的那个注释块（里面必然写着被禁的写法）。
   *  残留的窄口：行尾 `//` 注释里出现这个模式会**假红**——红得看得见原因，比假绿好。 */
  const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "");

  it("整个文件里不允许出现 process.env 的计算式访问", () => {
    expect(CODE).not.toMatch(/process\.env\s*\[/);
  });

  it("每个 flag(「NAME」) 都有一个同名的 process.env.NEXT_PUBLIC_FEATURE_NAME 静态读法", () => {
    const used = [...CODE.matchAll(/flag\("([A-Z_]+)"/g)].map((m) => m[1]);
    const declared = [...CODE.matchAll(/process\.env\.NEXT_PUBLIC_FEATURE_([A-Z_]+)/g)].map((m) => m[1]);
    expect(used.length, "flag(...) 调用点为 0，说明判定被搬走了，这条断言就失效了").toBeGreaterThan(0);
    expect(declared.length, `静态读法(${declared.length}) 少于调用点(${used.length})，新增开关没登记静态读法`).toBe(used.length);
    expect(used.filter((n) => !declared.includes(n))).toEqual([]);
    expect(declared.filter((n) => !used.includes(n))).toEqual([]);
  });
});
