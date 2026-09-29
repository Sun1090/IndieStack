/**
 * 「守卫失败不许被压成两种说法」的常驻检查
 *
 * 判据很短：**`src/**` 里不得出现对 `auth.error.code` 的就地三元**。也就是
 * `code === "UNAUTHORIZED" ? "notAuthenticated" : "forbidden"` 这种两出口写法。
 *
 * **为什么禁的是「就地三元」而不是「某个具体的错法」**：8 处调用点当年各写各的，
 * 修一处不改另外七处，于是同一个缺陷有八份。真正要守的形状是
 * 「一个四值的判别联合被一个两出口的三元吃掉两个」——只钉具体字符串的话，
 * 下一个作者写成三元套三元照样绿。唯一出口是 `guardFailureKey()`：三种失败三种说法，
 * 改判据时只改一处。
 *
 * 失败封闭的那一半：一条都没扫到匹配时报红，而不是返回空数组——
 * 「没扫到」和「没有违规」长得一模一样（与 `RATE_LIMIT_NOTHING_MEASURED`、
 * `inspectProductionMockSettings` 的 `no production surface` 同一纪律）。
 *
 * 同时钉住**出口真的被用上了**：地板值 8 处调用点。不加这一条的话，
 * 判据会因为「规则自己坏了」而全绿——仓库里有前例（`query-error-channel` 的
 * `QUERY_ERROR_CHANNEL_PARSE` 就是解析不动的文件被当成干净）。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const LIB_ROOT = resolve(__dirname, "..");
/** 只认这一种标识符：守卫结果的变量名在本仓库里统一是 `auth`。 */
const GUARD_RESULT = "auth";

/** 就地三元：`auth.error.code === "X" ? … : …`（引号可有可无，条件里也可以是 `!==`）。 */
const INLINE_TERNARY =
  /auth\s*\.\s*error\s*\.\s*code\s*[!=]==?\s*["'][A-Z_]+["'][\s\S]{0,80}?\?/g;
/** 合法的出口：调用 `guardFailureKey`。 */
const SANCTIONED = /\bguardFailureKey\s*\(/;

function walk(directory: string, files: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = join(directory, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) files.push(full);
  }
  return files;
}

function stripComments(content: string): string {
  return content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const LIB_FILES = walk(LIB_ROOT).map((full) => ({
  path: relative(LIB_ROOT, full).split("\\").join("/"),
  content: readFileSync(full, "utf8"),
}));
/** `guards.ts` 本身是判据的所在地，它当然要写 `code === …`；只排这一个文件。 */
const CALL_SITES = LIB_FILES.filter((file) => file.path !== "auth/guards.ts");

function violationsOf(file: { path: string; content: string }): string[] {
  const source = stripComments(file.content);
  // 每行新建一条正则：`g` 标志的 lastIndex 跨调用保留，复用会让第二处逃掉。
  return source
    .split("\n")
    .filter((line) => new RegExp(INLINE_TERNARY.source).test(line) && !SANCTIONED.test(line))
    .map((line) => `${file.path}: ${line.trim()}`);
}

describe("守卫失败不许被压成两种说法", () => {
  it("src/lib 下没有一处就地三元（guards.ts 自身除外）", () => {
    expect(CALL_SITES.length).toBeGreaterThan(0);
    const offenders = CALL_SITES.flatMap(violationsOf);
    expect(
      offenders,
      "三种守卫失败有三种说法，走 guardFailureKey(auth.error)；就地二元三元会把 " +
        "SERVICE_UNAVAILABLE（我们自己没读到）答成 forbidden / notAuthenticated，",
    ).toEqual([]);
  });

  it("出口真的被用上了：至少 8 处调用点在调 guardFailureKey", () => {
    // 地板值 = 本次收掉的那 8 处（admin 4 / contact-messages 3 / webhooks 1）。
    // 少了它，判据可能在「规则坏了」的状态下全绿。
    const total = CALL_SITES.reduce(
      (sum, file) => sum + (stripComments(file.content).match(/\bguardFailureKey\s*\(/g) ?? []).length,
      0,
    );
    expect(total).toBeGreaterThanOrEqual(8);
  });

  it("判据认得它自己的形状（防空转：扫描器坏了也要红）", () => {
    expect(
      violationsOf({
        path: "synthetic.ts",
        content: '  return fail(auth.error.code === "UNAUTHORIZED" ? "notAuthenticated" : "forbidden");\n',
      }),
    ).toHaveLength(1);
  });

  it("走 guardFailureKey 的写法不算违规", () => {
    expect(
      violationsOf({
        path: "synthetic.ts",
        content: "  return fail(guardFailureKey(auth.error));\n",
      }),
    ).toEqual([]);
  });

  it("注释里写那个三元不算违规（否则这条规则会教人把说明写到别处）", () => {
    expect(
      violationsOf({
        path: "synthetic.ts",
        content:
          '// 旧写法：fail(auth.error.code === "UNAUTHORIZED" ? "notAuthenticated" : "forbidden")\n' +
          "/* 以及 fail(auth.error.code === 'UNAUTHORIZED' ? 'a' : 'b') */\n",
      }),
    ).toEqual([]);
  });
});
