/**
 * `e2eBearerAuthorized` 契约 + 一条防腐化扫描。
 * 扫描那条的价值全在分母上：它必须先证明「自己真的读到了路由文件」，
 * 否则一个走错目录的 walker 会让它永远绿。
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { e2eBearerAuthorized } from "./e2e-bearer";

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...routeFiles(full));
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

describe("e2eBearerAuthorized()", () => {
  it("凭据未配置时拒绝一切请求，包括那把旧钥匙 `Bearer `", () => {
    expect(e2eBearerAuthorized("Bearer ", undefined)).toBe(false);
    expect(e2eBearerAuthorized("Bearer ", "")).toBe(false);
    expect(e2eBearerAuthorized(null, undefined)).toBe(false);
    expect(e2eBearerAuthorized("Bearer anything", "")).toBe(false);
  });

  it("配置了凭据时只接受整串等值的请求", () => {
    expect(e2eBearerAuthorized("Bearer s3cret", "s3cret")).toBe(true);
    expect(e2eBearerAuthorized("Bearer s3cret ", "s3cret")).toBe(false);
    expect(e2eBearerAuthorized("Bearer s3cre", "s3cret")).toBe(false);
    expect(e2eBearerAuthorized("Bearer ", "s3cret")).toBe(false);
  });

  it("不给大小写和前缀匹配留门", () => {
    expect(e2eBearerAuthorized("bearer s3cret", "s3cret")).toBe(false);
    expect(e2eBearerAuthorized("Bearer s3cret-extra", "s3cret")).toBe(false);
    expect(e2eBearerAuthorized("Basic s3cret", "s3cret")).toBe(false);
  });

  it("默认从环境变量取凭据，未设置即拒绝", () => {
    const previous = process.env.E2E_BEARER_TOKEN;
    delete process.env.E2E_BEARER_TOKEN;
    expect(e2eBearerAuthorized("Bearer ")).toBe(false);
    process.env.E2E_BEARER_TOKEN = "from-env";
    expect(e2eBearerAuthorized("Bearer from-env")).toBe(true);
    if (previous === undefined) delete process.env.E2E_BEARER_TOKEN;
    else process.env.E2E_BEARER_TOKEN = previous;
  });
});

describe("防腐化：路由不得再自己拼 expected 头", () => {
  const APP_DIR = join(process.cwd(), "src", "app");
  const files = routeFiles(APP_DIR);
  const offenders: string[] = [];
  for (const file of files) {
    const body = readFileSync(file, "utf8");
    if (/Bearer \$\{process\.env\.E2E_BEARER_TOKEN/.test(body)) {
      offenders.push(relative(process.cwd(), file).split(sep).join("/"));
    }
  }

  it("扫描器真的读到了路由文件（分母不为零，否则这条断言是空的）", () => {
    expect(files.length).toBeGreaterThan(8);
  });

  it("没有任何路由内联拼 Bearer 头，一律走 e2eBearerAuthorized", () => {
    expect(offenders).toEqual([]);
  });
});
