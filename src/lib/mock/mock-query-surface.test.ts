/**
 * Mock 查询链的表面必须盖住代码里**真的会链到**的每一个方法。
 *
 * 这一族的第一个实例是 `storage.from(...).remove`（见 `src/lib/storage/mock-parity.test.ts`），
 * 第二个就是这里的 `.gt`：`src/lib/repositories/marketing.ts:89` 的 token 过期闸门是
 * `.update(...).eq("token_hash", …).gt("token_expires_at", now).select("id")`，而 Mock 的构建器只有
 * `gte / lt / lte`——`.gt(...)` 在 mock 模式下同步抛 `TypeError`，一路冒出 `confirmSubscription`，
 * 被路由的 catch 变成 **HTTP 500**：mock 模式（E2E 与 `pnpm dev:mock`）里确认/退订链接点了就是服务器错误。
 * 仓储层单测（`marketing.test.ts`）抓不到，因为它用的是 `test-helpers.ts` 里那个手搓 `chainMock`，
 * **那份替身自带 `gt`**。两条缺陷的共同点不是「谁少了个方法」，而是没有任何东西把
 * 「调用点用到的方法」和「替身有的方法」放在一起比过。
 *
 * 所以这里不手写「我们用了哪些算子」——那份清单自己就会腐烂——而是用 TypeScript AST 从 `src/**` 现取：
 * 凡挂在查询构建器（`<客户端>.from("<表>")` / `.rpc(...)` 之后那一段链）上的方法名，
 * Mock 的构建器实例上必须可调用。将来谁在链上用了 Mock 没实现的方法（`.neq()`、`.filter()` 都行），
 * 红的是这条用例，解法是给 Mock 补表面，而不是把名字从某份清单里删掉。
 *
 * 范围只到**查询构建器那一段**：`.auth.*`、`.storage.*`、realtime 的 `.channel()` 是别的表面
 * （storage 由 `mock-parity.test.ts` 管，auth 与 realtime 的清单写在双语 mock 文档里）。
 * 混进来的代价是假阳性——第一版就把 `Array.from(...).join()`、`Buffer.from(...).subarray()`、
 * `supabase.removeChannel?.bind(supabase)` 当成链上的算子，报了 9 个「缺失」，其中真的只有 1 个。
 * 「哪些 `.from(` 被当成不是查询」由第二条用例钉住：只允许认识得的 JS 原生 `from` 与 `.storage`，
 * 出现认不出来的客户端拿法就红并且点名，不会安静地少扫一条链。
 */
import ts from "typescript";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createMockSupabaseClient } from "@/lib/mock";

const SRC_ROOT = path.resolve(process.cwd(), "src");
const MOCK_DIR = path.join(SRC_ROOT, "lib", "mock");

/** 客户端工厂名：`createAdminClient()` / `createClient()` / `getSupabaseClient()` 这一类。 */
const FACTORY = /^(create|get)[A-Za-z]*Client$/;
/** 挂在客户端上、但不是查询构建器的成员。 */
const CLIENT_SURFACE_MEMBER = new Set(["auth", "storage", "rpc", "channel", "removeChannel"]);
/** 与 supabase 无关的 `.from(`：JS 自带的静态方法。 */
const JS_STATIC_FROM = new Set(["Array", "Buffer", "Object", "String", "Uint8Array", "URL", "URLSearchParams"]);

/** 递归列出 src 下的生产源码：排除 mock 自身与所有测试文件（测试用的是手搓替身，不构成对 mock 的要求）。 */
function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (full.startsWith(MOCK_DIR)) continue;
    if (statSync(full).isDirectory()) {
      sourceFiles(full, acc);
      continue;
    }
    const rel = path.relative(process.cwd(), full).split(path.sep).join("/");
    if (!/\.(ts|tsx)$/.test(rel)) continue;
    if (/\.test\.(ts|tsx)$/.test(rel) || /test-helpers\.ts$/.test(rel)) continue;
    acc.push(full);
  }
  return acc;
}

function isFactoryCall(node: ts.Node): node is ts.CallExpression {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && FACTORY.test(node.expression.text);
}

/** `createXxxClient()` 或 `await createXxxClient()`。 */
function makesClient(init: ts.Expression): boolean {
  return isFactoryCall(init) || (ts.isAwaitExpression(init) && isFactoryCall(init.expression));
}

function isClientIdentifier(name: string, roots: { clients: Set<string>; builders: Set<string> }): boolean {
  return roots.clients.has(name) || roots.builders.has(name);
}

/** 接收者是不是「一个客户端」（工厂调用本身，或装着客户端的变量）。 */
function receiverIsClient(receiver: ts.Expression, roots: { clients: Set<string>; builders: Set<string> }): boolean {
  if (makesClient(receiver)) return true;
  return ts.isIdentifier(receiver) && roots.clients.has(receiver.text);
}

/** 这条调用是不是「客户端上的查询起点」：`.from(表名)` 或 `.rpc(函数名)`，且不是 `storage.from()`。 */
function isQueryStart(node: ts.Node, roots: { clients: Set<string>; builders: Set<string> }): boolean {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return false;
  const member = node.expression.name.text;
  if (member !== "from" && member !== "rpc") return false;
  const owner = node.expression.expression;
  if (ts.isPropertyAccessExpression(owner) && CLIENT_SURFACE_MEMBER.has(owner.name.text)) return false;
  return receiverIsClient(owner, roots) || (ts.isIdentifier(owner) && roots.builders.has(owner.text));
}

/** 遍历一个文件里所有节点（带 parent 指针，所以能往外爬链）。 */
function eachDescendant(root: ts.Node, fn: (node: ts.Node) => void): void {
  root.forEachChild(function visit(node) {
    fn(node);
    eachDescendant(node, fn);
  });
}

function collectClientNames(sf: ts.SourceFile): Set<string> {
  const clients = new Set<string>();
  eachDescendant(sf, (node) => {
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name) && makesClient(node.initializer)) {
      clients.add(node.name.text);
    }
    // 形参上的注入：`supabase: UploadClient`（= SupabaseClient<Database> 的本地别名），
    // 没有类型检查器解析不了别名，按仓库约定收「以 Client 结尾」的标注；认不出的写法由第二条用例报错。
    if (ts.isParameter(node) && node.type && /Client(\s*<[^>]*>)?$/.test(node.type.getText(sf))) {
      clients.add(node.name.getText(sf));
    }
  });
  return clients;
}

/** 链的终点若挂在 `const base = admin.from("t")` 上，就把这个变量名记成构建器句柄。 */
function collectBuilderHandles(sf: ts.SourceFile, roots: { clients: Set<string>; builders: Set<string> }): Set<string> {
  const builders = new Set<string>();
  eachDescendant(sf, (node) => {
    if (!isQueryStart(node, roots)) return;
    const decl = node.parent && ts.isVariableDeclaration(node.parent) ? node.parent : null;
    if (decl && ts.isIdentifier(decl.name)) builders.add(decl.name.text);
  });
  return builders;
}

/**
 * 从一个查询起点往外爬链，把每一环的方法名交给 emit。
 * 环的形状固定：CallExpression → PropertyAccessExpression（名字在这里）→ 再往外是调用或被赋值/被 await。
 */
function eachChainMethod(start: ts.Node, emit: (call: ts.CallExpression, name: string) => void): void {
  let cur: ts.Node = start;
  for (;;) {
    const parent = cur.parent;
    if (!parent || !ts.isPropertyAccessExpression(parent)) return;
    if (parent.name.text === "auth" || parent.name.text === "storage") return;
    const grand = parent.parent;
    if (!grand || !ts.isCallExpression(grand) || grand.expression !== parent) return;
    emit(grand, parent.name.text);
    cur = grand;
  }
}

function scanFile(full: string) {
  const used = new Map<string, { at: string; count: number }>();
  const rejected: { at: string; receiver: string }[] = [];
  const rel = path.relative(process.cwd(), full).split(path.sep).join("/");
  const sf = ts.createSourceFile(full, readFileSync(full, "utf8"), ts.ScriptTarget.Latest, true);
  const roots = { clients: collectClientNames(sf), builders: new Set<string>() };
  for (const handle of collectBuilderHandles(sf, roots)) roots.builders.add(handle);

  const record = (name: string, at: string) => {
    const hit = used.get(name);
    if (hit) hit.count += 1;
    else used.set(name, { at, count: 1 });
  };
  const lineOf = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

  eachDescendant(sf, (node) => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
    const member = node.expression.name.text;
    const owner = node.expression.expression;
    if (member === "from" || member === "rpc") {
      if (isQueryStart(node, roots)) {
        eachChainMethod(node, (call, name) => record(name, `${rel}:${lineOf(call)}`));
        return;
      }
      if (ts.isIdentifier(owner) && !JS_STATIC_FROM.has(owner.text) && !roots.builders.has(owner.text)) {
        rejected.push({ at: `${rel}:${lineOf(node)}`, receiver: owner.text });
      } else if (!ts.isIdentifier(owner) && !makesClient(owner)) {
        const text = owner.getText(sf).replace(/\s+/g, "");
        if (!/\.storage$/.test(text)) rejected.push({ at: `${rel}:${lineOf(node)}`, receiver: text });
      }
      return;
    }
    if (ts.isIdentifier(owner) && roots.builders.has(owner.text)) {
      record(member, `${rel}:${lineOf(node)}`);
      eachChainMethod(node, (call, name) => call !== node && record(name, `${rel}:${lineOf(call)}`));
    }
  });
  return { used, rejected };
}

function scanAll(files: string[]) {
  const used = new Map<string, { at: string; count: number }>();
  const rejected: { at: string; receiver: string }[] = [];
  for (const full of files) {
    const one = scanFile(full);
    rejected.push(...one.rejected);
    for (const [name, hit] of one.used) {
      const seen = used.get(name);
      if (seen) seen.count += hit.count;
      else used.set(name, { ...hit });
    }
  }
  return { used, rejected };
}

const files = sourceFiles(SRC_ROOT);
const { used, rejected } = scanAll(files);
const totalHits = [...used.values()].reduce((sum, v) => sum + v.count, 0);

describe("Mock 查询链与调用点的表面对账", () => {
  it("扫描本身要有效：文件数、命中数、已知算子都要在场（扫空了这条先红）", () => {
    // 正向对照：`eq` / `select` 这种到处都是的算子必须在结果里，否则是解析器坏了，而不是代码干净。
    expect(files.length).toBeGreaterThan(200);
    expect(totalHits).toBeGreaterThan(200);
    expect(used.has("eq")).toBe(true);
    expect(used.has("select")).toBe(true);
    // 反向对照：这些名字在 src 里确实以 `.xxx(` 的形式出现过，但它们挂在数组/Buffer/客户端上，
    // 一条都不许进结果集——进来说明分类器又把 JS 原生方法当算子报了。
    for (const noise of ["map", "join", "find", "subarray", "bind", "channel", "subscribe"]) {
      expect(used.has(noise)).toBe(false);
    }
  });

  it("每一处 `.from(` 都要么是客户端上的查询，要么是明确认识的原生 from / storage", () => {
    // 失败封闭：出现本文件认不出来的客户端拿法（新工厂名、`useMemo` 里造的客户端……）时，
    // 红的是这条并点名是哪一处，而不是安静地少扫一条链、把下面那条对账扫成空洞。
    expect(rejected).toEqual([]);
  });

  it(`链上真被调到的 ${used.size} 个方法，Mock 的构建器都得有`, () => {
    const builder = createMockSupabaseClient().from("profiles") as unknown as Record<string, unknown>;
    const missing = [...used.keys()]
      .filter((name) => typeof builder[name] !== "function")
      .sort()
      .map((name) => `${name}()：${used.get(name)!.count} 处，例如 ${used.get(name)!.at}`);
    expect(missing).toEqual([]);
  });
});
