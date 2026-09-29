/**
 * 生产构型下 mock 不得整块留在客户端图里（2026-09-29 实测出来的）
 *
 * **量到的那一半（浏览器级）**：修之前，生产首页的 HTML 直接 `<script src>` 引用了一个
 * 742 KB 的 chunk（**gzip 后 246 kB**），内容是 mock 种子数据 + 整包 faker——
 * 占首页 JS 总量（506 kB）的 **48%**。成因：`src/lib/supabase/client.ts` 用**静态**
 * `import { …, createMockSupabaseClient } from "@/lib/mock"`，而 `@/lib/mock` 静态引入
 * `./data`（faker）与 `./store`。于是任何 `"use client"` 模块碰一下
 * `@/lib/supabase/client`（本仓库 12 处），整块假数据就进了客户端图。
 *
 * **为什么 `check:bundle` 看不见它**：它量的是 `.next/static` 总量与基线的比值，
 * 而**基线是在泄漏已经存在的时候立的**——一块「本来就多余」的代码不会让总量变大，
 * 5% 的预算永远看不到它。同一族的先例仓库里已经记过一次（构建期折叠那 24.9 kB
 * 「只占基线的 0.9%」）；那次的死代码在**源码**里看得见所以有形状用例，
 * 这次的只在**产物**里看得见，所以只能从产物量——而产物量恰好是体积门禁唯一量不出的维度。
 *
 * **本文件判的是「形状」，不是「产物」**，因为产物侧有一个诚实的分界：
 * 修完之后 `.next/static` 里**仍然**留着一块 741 kB 的死 chunk（被 5 个 auth 页面的
 * client-reference manifest 列出），但用 Playwright 实测 8 个页面的**网络请求**，
 * **没有任何一个页面去取它**（修之前首页取）。「产物里存在」与「用户会下载」是两件事，
 * 门禁只判后者能判定的那一半，前者交给本文件顶部的注释记账——
 * **一条靠「产物里不许出现」的红门禁会把这条如实记账的事变成一条没人修的假红。**
 *
 * 判据两条：
 * 1. **除 `supabase/client.ts` 以外，任何 `"use client"` 模块都不得静态 import
 *    `@/lib/mock` 桶**。要判的是纯配置就用零依赖的 `@/lib/mock/config`；
 *    要真拿 mock 客户端只能走动态 `import()`，那样它在生产图里是独立 chunk。
 * 2. `supabase/client.ts` 那唯一的一处**必须**写在可被构建期折成 `false` 的三元里——
 *    静态 import 本身不是问题，「它被一个折不掉的条件守着」才是问题。
 *    与 `mock/config.test.ts` 钉 `isMockEnabled` 的折叠形状是同一个机制。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_ROOT = resolve(__dirname, "../..");
/** 唯一被允许静态 import mock 桶的客户端模块，以及它被允许的理由。 */
const SANCTIONED_CLIENT_IMPORTERS = ["lib/supabase/client.ts"] as const;
/** 客户端模块里判断「这是不是一个客户端模块」的标记。 */
const CLIENT_DIRECTIVE = /^\s*["']use client["'];?\s*$/m;
const MOCK_BARREL = /from\s*["']@\/lib\/mock["']/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

function toPosix(repoRelative: string): string {
  return repoRelative.split("\\").join("/");
}

const SOURCE_FILES = walk(SRC_ROOT).map((full) => {
  const content = readFileSync(full, "utf8");
  return { path: toPosix(relative(SRC_ROOT, full)), content };
});
/** 只读文件不改写，所以 statSync 只是为了让「目录真的被扫到」可断言——见下面的分母。 */
const SOURCE_FILE_COUNT = SOURCE_FILES.length;

function isClientModule(file: { content: string }): boolean {
  return CLIENT_DIRECTIVE.test(file.content);
}

function clientImportersOfMockBarrel() {
  return SOURCE_FILES.filter(
    (file) => isClientModule(file) && MOCK_BARREL.test(file.content) && !isCommentedOut(file),
  ).map((file) => file.path);
}

/**
 * 注释里写 `from "@/lib/mock"` 不算——否则这条规则会教人把说明写到别处。
 * 粗判：只看代码里那一行前面有没有行注释标记或处于块注释之内（这里刻意不写出块注释的
 * 结束符——它会把本文件顶部的 JSDoc 提前关掉，语法错误会报在下一行字符串上，
 * 而报错位置离真凶隔了六十行）。
 */
function isCommentedOut(file: { path: string; content: string }): boolean {
  return file.content
    .split("\n")
    .filter((line) => MOCK_BARREL.test(line))
    .every((line) => /^\s*(\/\/|\*|\/\*)/.test(line));
}

describe("生产构型下 mock 不得整块留在客户端图里", () => {
  it("分母不为空：扫到的源文件真的被读到了", () => {
    // 规则坏掉的方式就是「扫空了」，而空扫描与「没有违规」长得一模一样。
    expect(SOURCE_FILE_COUNT).toBeGreaterThan(200);
    expect(statSync(SRC_ROOT).isDirectory()).toBe(true);
  });

  it("除已登记的一处外，没有任何客户端模块静态 import mock 桶", () => {
    const offenders = clientImportersOfMockBarrel().filter(
      (path) => !(SANCTIONED_CLIENT_IMPORTERS as readonly string[]).includes(path),
    );
    const why =
      "客户端模块要判配置就用零依赖的 @/lib/mock/config；要真拿 mock 客户端只能走动态 import()，" +
      "那样它在生产图里是独立 chunk 而不是静态并进主图。已登记的一处是 " +
      "src/lib/supabase/client.ts，它的正确性由下一条钉住。";
    expect(offenders, why).toEqual([]);
  });

  it("已登记的那一处存在且确实 import 了桶（防空转：登记本身被删了也会红）", () => {
    const sanctioned = SOURCE_FILES.filter((file) =>
      (SANCTIONED_CLIENT_IMPORTERS as readonly string[]).includes(file.path),
    );
    expect(sanctioned).toHaveLength(SANCTIONED_CLIENT_IMPORTERS.length);
    expect(sanctioned.filter((file) => MOCK_BARREL.test(file.content))).toHaveLength(1);
  });

  it("那一处必须被一个可被构建期折成 false 的三元守着", () => {
    // 这就是让 246 kB 从首页消失的那一行。写成 `if (shouldUseMock())` 时，
    // Turbopack 折的是 `isMockEnabled` 这个常量，**函数调用**把链断掉了，
    // 于是分支活着、静态 import 活着、整块 faker 跟着活着。
    const client = SOURCE_FILES.find((file) => file.path === "lib/supabase/client.ts");
    expect(client).toBeDefined();
    const guarded = /process\.env\.NODE_ENV\s*===\s*["']production["']\s*\?\s*false\s*:\s*shouldUseMock\(\)/;
    const howToFix =
      '把 if (shouldUseMock()) 改成 ' +
      'if (process.env.NODE_ENV === "production" ? false : shouldUseMock())；' +
      "不折掉这个分支，静态 import 的 mock 桶就留在客户端图里（实测占首页 JS 的 48%）。";
    expect(client?.content.replace(/\/\*[\s\S]*?\*\//g, "").match(guarded), howToFix).not.toBeNull();
  });

  it("注释里提到 mock 桶不算违规（否则这条规则会教人把说明写到别处）", () => {
    expect(
      isCommentedOut({
        path: "synthetic.tsx",
        content: '"use client";\n// 旧写法：import { createMockSupabaseClient } from "@/lib/mock";\n',
      }),
    ).toBe(true);
  });
});
