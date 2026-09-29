/**
 * 「服务端不得对会话用户做非空断言」的门禁（roadmap C09 后半）
 *
 * 为什么是源码形状而不是运行时用例：缺陷本身是**类型上的**一句谎（`user!` 宣称
 * 「这里不可能是 null」），而 `auth.getUser()` 把失败装在 `error` 里返回——在 jsdom 里
 * 把 `getUser` 桩成永远返回一个用户，任何运行时用例都分不出「写对了」与「又写错了」。
 * 所以这里读源码，判据也只在源码上成立。
 *
 * 为什么不并进 `check:query-errors`：那条门禁判的是 PostgREST 链的错误通道，
 * 语义与登记面都是「查询」；会话读取的数据源是 Auth，扩进去要把它的台账模型一起改，
 * 而这里的判断只有一句话、零登记面。两个门禁的失败信息各自指向自己那件事。
 *
 * 为什么不接成新的 `check:*` 脚本：判据只有一个记号，`pnpm test` 在 pre-push 与 CI
 * 都跑，注册一条新门禁要多维护四处接线（package.json / check-all.sh / 工作流 / 豁免表），
 * 代价大于收益。仓库里已有同一形态的先例（`mock/config.test.ts` 钉构建期折叠、
 * `feature-flags.test.ts` 钉静态读法表）。
 *
 * **判据没有白名单，这是有意的**。真出现一个合法的可空局部变量也叫 `user` 时，
 * 修法是把它改名（比如 `owner`）——一次五分钟的编辑，从此这条判据再也不会有歧义。
 * 开一个白名单等于把「谁都可以把自己排除在外」写进规则，而门禁的价值恰恰在于没有那一格。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = resolve(__dirname, "../../app");
const DASHBOARD_ROOT = join(APP_ROOT, "dashboard");
/** 会话用户的本地绑定名。规则只认这一个名字：它正是 C09 量到 15 处的那种写法。 */
const SESSION_BINDING = "user";
/** 仪表盘里被认可的会话读取入口。两者都不会在页面里再调一次 `auth.getUser()`。 */
const SANCTIONED_HELPERS = [
  "@/lib/auth/session-user",
  "@/lib/auth/guards",
] as const;

function walk(directory: string, files: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (/\.(?:ts|tsx)$/.test(entry.name) && !/\.test\.[jt]sx?$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

function readAll(root: string) {
  return walk(root).map((full) => ({
    path: relative(APP_ROOT, full).split("\\").join("/"),
    content: readFileSync(full, "utf8"),
  }));
}

/** 去掉注释与字符串字面量，免得文档里写一句 `user!` 就报红。 */
function stripComments(content: string): string {
  return content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function assertionsOf(file: { path: string; content: string }): string[] {
  // 刻意每行新建一条正则：`g` 标志的 lastIndex 是**跨调用保留**的，
  // 复用同一条会让同一个文件里的第二处违规被跳过——那正是「规则漏掉一半现场」的样子。
  const source = `\\b${SESSION_BINDING}!\\s*(?:\\.|\\[|\\)|,|;|$)`;
  return stripComments(file.content)
    .split("\n")
    .filter((line) => new RegExp(source).test(line))
    .map((line) => line.trim());
}

const APP_FILES = readAll(APP_ROOT);
const DASHBOARD_FILES = readAll(DASHBOARD_ROOT);
const SESSIONS_IMPORTED = APP_FILES.filter((file) =>
  file.content.includes('from "@/lib/auth/session-user"'),
);

describe("服务端不得对会话用户做非空断言（C09）", () => {
  it("src/app 下没有一处 user! 非空断言", () => {
    // 先确认扫到的范围不为空，否则下面那句 [] 只是「没扫到」的另一种写法。
    expect(APP_FILES.length).toBeGreaterThan(0);
    const offenders = APP_FILES.flatMap((file) =>
      assertionsOf(file).map((line) => `${file.path}: ${line}`),
    );
    expect(
      offenders,
      "读到了会话就用 requireSessionUser(supabase)（它把「没登录」与「没读到」分成两条出口），" +
        "不要用 `!` 把两者压成同一个 TypeError",
    ).toEqual([]);
  });

  it("注释里写 user! 不算违规（否则这条规则会教人把说明写在别处）", () => {
    expect(
      assertionsOf({
        path: "synthetic.tsx",
        content: "// 旧写法是 user!.id，抛的是 TypeError\n/* 以及 user!.id 这种 */\n",
      }),
    ).toEqual([]);
  });

  it("仪表盘页面确实在用 requireSessionUser（反向证据：不是「碰巧没有 user!」）", () => {
    // 地板值 8 = 本次改掉的那 8 个页面。新增仪表盘页面不受影响（>= 即可），
    // 但如果哪天这个数掉到 0，说明整条链路被搬走了而规则还在报绿。
    const dashboardPages = SESSIONS_IMPORTED.filter((file) => file.path.startsWith("dashboard/"));
    expect(dashboardPages.length).toBeGreaterThanOrEqual(8);
  });

  it("规则本身认得 user! 仍然是违规（防空转：扫描器坏了也要红）", () => {
    expect(assertionsOf({ path: "synthetic.tsx", content: "  const id = user!.id;\n" })).not.toEqual(
      [],
    );
  });

  it("同一个文件里的多处违规一处都不漏（防 lastIndex 让第二处逃掉）", () => {
    expect(
      assertionsOf({
        path: "synthetic.tsx",
        content: "  const a = user!.id;\n  const b = user!.email;\n  const c = user!.id;\n",
      }),
    ).toHaveLength(3);
  });
});

/**
 * 4 个 layout / 页面收完之后，仪表盘里已经没有一处直接 `auth.getUser()` 了，
 * 于是「谁在读会话」也变成一句可以核对的话。
 *
 * **这一条比上一条强**：上一条只判「非空断言」这个症状，这一条判「绕开了唯一入口」这个成因。
 * 症状判据有个盲区——一个新页面写 `const { data: { user } } = await supabase.auth.getUser()`
 * 再配一个 `if (!user) redirect(...)`，`user!` 那条判据全绿，而缺陷原封不动地又来了一遍
 * （读失败被答成「你没登录」，而重新登录走的正是同一条读取）。这一条把它也挡住。
 *
 * 范围只到 `src/app/dashboard/**`：仓库里其余读会话的地方各有各的正确形状
 * （`proxy.ts` 重定向是对的、`api/auth/callback` 要区分 error、route handler 走 guards），
 * 拿一条规则去覆盖它们就是把判据做成噪音。仪表盘是「layout 已经重定向过一次、页面却又读一次」
 * 的那一片，也正是同型缺陷密集的地方。
 */
describe("仪表盘不得绕开唯一入口自己读会话", () => {
  it("src/app/dashboard 下没有一处直接 auth.getUser()", () => {
    expect(DASHBOARD_FILES.length).toBeGreaterThan(0);
    const offenders = DASHBOARD_FILES.filter((file) => file.content.includes("auth.getUser()"));
    expect(
      offenders.map((file) => file.path),
      "读会话只有两条被认可的入口：requireSessionUser（只要用户）或 requireAuth（还要角色）；" +
        "自己解构 auth.getUser() 会把「没读到」和「没登录」压成同一个 redirect",
    ).toEqual([]);
  });

  it("反向证据：仪表盘确实在用被认可的入口（不是「碰巧没读会话」）", () => {
    // 地板值 12 = 8 个页面 + 4 个 layout/页面。新增仪表盘页面不受影响（>= 即可），
    // 但如果这个数掉到 0，说明整条链路被搬走了而规则还在报绿。
    const using = DASHBOARD_FILES.filter((file) =>
      SANCTIONED_HELPERS.some((helper) => file.content.includes(`from "${helper}"`)),
    );
    expect(using.length).toBeGreaterThanOrEqual(12);
  });

  it("getSession() 不在这条规则内：认「当前这台设备」不是授权判定", () => {
    // 逐个查过消费方：settings 页用它算 currentSessionId，只用于**显示**「这台」标记，
    // 不参与任何权限判断，且解析不出 token 时返回 null（fail-closed，标记留空而不是乱标）。
    // 把它一并禁掉就是拿一条造假的规则换一次改动。
    const offenders = DASHBOARD_FILES.filter((file) => file.content.includes("auth.getSession("));
    expect(offenders.map((file) => file.path)).toEqual(["dashboard/settings/page.tsx"]);
  });
});
