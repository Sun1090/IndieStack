/**
 * 谁往 Appark 队列里放事件，谁就必须负责把队列送出去。
 *
 * 起因（不是推测，是读出来的）：`src/lib/appark.ts` 的事件队列是**进程内**的，
 * 而全仓 `flushEvents()` 只有一个调用点——`src/app/api/cron/digest/route.ts` 的结尾。
 * 在 Vercel 上 cron 是一个独立的 serverless 函数，它的模块实例与结账那条路由**不共享内存**，
 * 于是 `src/lib/stripe/index.ts` 里那条 `checkout.session_created` 进了队列就再也出不去：
 * 配置了 APM 的模板用户看到的是「结账事件永远不上报」，而 `trackEvent` 那一侧一切正常、
 * 没有任何一行日志会说谎说它失败了。ADR-011 当初写的是「关键流程均在请求尾部主动 flush」，
 * 这条约束在结账那一处从来没有落地。
 *
 * 为什么做成一份测试而不是新的 `check:*` 门禁：它审的是源码文本，与
 * `src/lib/mock/auth-surface.test.ts`（替身表面）同一族；`pnpm test` 本来就是 push 的硬性前置
 * （AGENTS.md），再套一层 `scripts/check-*` + CI + 双语 docs-site 只是把同一条约束抄第三遍。
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(__dirname, "..", "..");

/** 事件生产者：`trackEvent(` 或 `trackError(` 的**调用**（注释里的举例不算）。 */
const PRODUCER_CALL = /\btrack(?:Event|Error)\s*\(/;
/** 把队列送出去的动作。`void flushEvents()` 与 `await flushEvents()` 都算。 */
const FLUSH_CALL = /\bflushEvents\s*\(/;

/**
 * 判断某一行是不是注释行。
 *
 * 这一层不是洁癖：`src/lib/i18n/dynamic-keys.ts` 的文档注释里有一句
 * `trackEvent(\`error.${name}\`)` 的**反例举例**（用来说明那种形状不该被当成翻译调用），
 * 不做区分的话扫描会把一份纯规则模块报成生产者。
 */
function isCommentLine(line: string): boolean {
  const trimmed = line.trimStart();
  return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
}

/** 一份源码文本里是否出现真实的生产者调用 / 真实的 flush 调用。 */
export function apparkFlushFacts(text: string): {
  produces: boolean;
  flushes: boolean;
} {
  let produces = false;
  let flushes = false;
  text.split("\n").forEach((line) => {
    if (isCommentLine(line)) return;
    if (!produces && PRODUCER_CALL.test(line)) produces = true;
    if (!flushes && FLUSH_CALL.test(line)) flushes = true;
  });
  return { produces, flushes };
}

/** 列出 `src/**` 下要参与对账的源文件（跳过测试、跳过 appark 自身的定义模块）。 */
export function collectApparkSources(root = REPO_ROOT): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      if (/\.test\.tsx?$/.test(entry.name)) continue;
      if (full.endsWith(join("lib", "appark.ts")) || full.endsWith(join("lib", "appark-config.ts"))) {
        continue;
      }
      out.push(relative(root, full).split("\\").join("/"));
    }
  };
  walk(join(root, "src"));
  return out.sort();
}

describe("Appark 埋点生产者必须自己负责 flush 队列", () => {
  it("真实仓库里每个生产者文件都调用 flushEvents", () => {
    const files = collectApparkSources();
    const producers: string[] = [];
    const missing: string[] = [];
    for (const file of files) {
      const facts = apparkFlushFacts(readFileSync(join(REPO_ROOT, file), "utf8"));
      if (!facts.produces) continue;
      producers.push(file);
      if (!facts.flushes) missing.push(file);
    }
    // 失败封闭：扫不出任何生产者就说明判据或仓库形状变了，不能让「0 个缺失」冒充通过。
    expect(producers.length, `在 ${files.length} 个源文件里没找到任何 Appark 生产者`).toBeGreaterThan(0);
    expect(missing, `这些文件放了事件却没 flush：${missing.join(", ")}`).toEqual([]);
  });

  it("只放了事件没 flush 的文件会被点名（正向对照）", () => {
    const text = [
      'import { trackEvent } from "@/lib/appark";',
      "export function pay(): void {",
      '  trackEvent("checkout.session_created");',
      "}",
    ].join("\n");
    expect(apparkFlushFacts(text)).toEqual({ produces: true, flushes: false });
  });

  it("同一文件里补上 flush 之后就不算缺失", () => {
    const text = [
      'import { flushEvents, trackEvent } from "@/lib/appark";',
      "export async function pay(): Promise<void> {",
      '  trackEvent("checkout.session_created");',
      "  void flushEvents();",
      "}",
    ].join("\n");
    expect(apparkFlushFacts(text)).toEqual({ produces: true, flushes: true });
  });

  it("注释里举例提到的 trackEvent 不算生产者", () => {
    const blockComment = [
      "/**",
      " * 这样 trackEvent(error.) 的举例不会被误当成翻译调用。",
      " */",
      "export const rule = 1;",
    ].join("\n");
    expect(apparkFlushFacts(blockComment).produces).toBe(false);
    expect(apparkFlushFacts("// trackEvent(\"x\"); flushEvents();").produces).toBe(false);
  });

  it("那份把 trackEvent 写在文档注释里的规则模块仍然不是生产者", () => {
    const file = "src/lib/i18n/dynamic-keys.ts";
    const facts = apparkFlushFacts(readFileSync(join(REPO_ROOT, file), "utf8"));
    expect(facts.produces).toBe(false);
  });
});
