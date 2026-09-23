/**
 * 「error 通道被抹掉」规则的单测（C08 断言 + C08-c 解构）。
 *
 * 两条约束互相拉扯：探测器必须真的能标出一段它该标的代码（否则它就是永不响的门禁），
 * 又必须不标那些与错误通道无关的写法（否则第一个 PR 就学会加 `// eslint-disable`）。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ERROR_CHANNEL_EXEMPTIONS,
  collectErrorChannelCasts,
  collectUnboundErrorChannels,
  inspectQueryErrorChannel,
  summarizeUnboundErrorChannels,
  type QueryErrorChannelSource,
} from "./query-error-channel";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const ROLE_QUERY = `
  const { data: profile } = (await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single()) as { data: { role: string } | null };
`;

function source(file: string, content: string): QueryErrorChannelSource {
  return { file, content };
}

function codes(sources: QueryErrorChannelSource[]): string[] {
  return inspectQueryErrorChannel(sources).map((issue) => issue.code);
}

/**
 * Codes about one file. The ledger covers the whole repo, so any partial scan also reports the
 * other files as stale — those are real signals for the full scan and noise for a fixture.
 */
function codesFor(sources: QueryErrorChannelSource[], file: string): string[] {
  return inspectQueryErrorChannel(sources)
    .filter((issue) => issue.file === file)
    .map((issue) => issue.code);
}

describe("collectErrorChannelCasts()", () => {
  it("标出把 awaited 查询结果断言成不含 error 的写法", () => {
    const stats = collectErrorChannelCasts([source("a.ts", `async function f() {${ROLE_QUERY}}`)]);
    expect(stats.judged).toBe(1);
    expect(stats.casts).toEqual([{ file: "a.ts", line: 2 }]);
  });

  it("断言里保留 error 的写法不算违规", () => {
    const kept = ROLE_QUERY.replace(
      "as { data: { role: string } | null }",
      "as { data: { role: string } | null; error: { message: string } | null }",
    );
    const stats = collectErrorChannelCasts([source("a.ts", `async function f() {${kept}}`)]);
    expect(stats.judged).toBe(1);
    expect(stats.casts).toEqual([]);
  });

  it("`as unknown as T` 只算一处，而不是两处", () => {
    const doubled = ROLE_QUERY.replace(") as { data:", ") as unknown as { data:");
    const stats = collectErrorChannelCasts([source("a.ts", `async function f() {${doubled}}`)]);
    expect(stats.judged).toBe(1);
    expect(stats.casts).toHaveLength(1);
  });

  it("未 await 的链式构造器断言不在射程内（那是给 builder 定形状，不是抹掉结果）", () => {
    const builder = `
      let query = admin
        .from("contact_messages")
        .select("id", { count: "exact" }) as unknown as FilterChain;
    `;
    const stats = collectErrorChannelCasts([source("a.ts", `async function f() {${builder}}`)]);
    expect(stats.judged).toBe(0);
    expect(stats.casts).toEqual([]);
  });

  it("`.rpc()` 的结果同样被判定", () => {
    const rpc = `
      const { data } = (await admin.rpc("get_team_member_count", { p_id: id })) as {
        data: number | null;
      };
    `;
    const stats = collectErrorChannelCasts([source("a.ts", `async function f() {${rpc}}`)]);
    expect(stats.judged).toBe(1);
    expect(stats.casts).toEqual([{ file: "a.ts", line: 2 }]);
  });

  it("断言明写 `error: null` 同样是抹掉：那句说的是「这次查询不可能出错」", () => {
    for (const spelling of [
      "error: null",
      "error: undefined",
      "error: never",
      "error: null | undefined",
      "error: (null)",
    ]) {
      const body = ROLE_QUERY.replace(
        "as { data: { role: string } | null }",
        `as { data: { role: string } | null; ${spelling} }`,
      );
      const stats = collectErrorChannelCasts([source("a.ts", `async function f() {${body}}`)]);
      expect(stats.judged, spelling).toBe(1);
      expect(stats.casts, spelling).toEqual([{ file: "a.ts", line: 2 }]);
    }
  });

  it("带真实形状的 `error` 成员仍然合规，包括可空与可选", () => {
    for (const spelling of [
      "error: { message: string } | null",
      "error?: { message: string } | null",
      "error: unknown",
      "error: PostgrestError",
      "error: (Error & { code: string }) | null",
    ]) {
      const body = ROLE_QUERY.replace(
        "as { data: { role: string } | null }",
        `as { data: { role: string } | null; ${spelling} }`,
      );
      const stats = collectErrorChannelCasts([source("a.ts", `async function f() {${body}}`)]);
      expect(stats.judged, spelling).toBe(1);
      expect(stats.casts, spelling).toEqual([]);
    }
  });

  it("只有嵌套里出现 `error` 不算保住通道：那一层描述的是载荷，不是查询结果", () => {
    const nested = ROLE_QUERY.replace(
      "as { data: { role: string } | null }",
      "as { data: { role: string; error: { message: string } } | null }",
    );
    const stats = collectErrorChannelCasts([source("a.ts", `async function f() {${nested}}`)]);
    expect(stats.judged).toBe(1);
    expect(stats.casts).toEqual([{ file: "a.ts", line: 2 }]);
  });

  it("`await Promise.all([chain as T])`：断言抹掉的通道同样判得到", () => {
    const body = `
      async function f(supabase: any) {
        const [{ data: rows }] = await Promise.all([
          supabase.from("notifications").select("*") as unknown as { data: Row[] | null },
        ]);
        return rows;
      }
    `;
    const stats = collectErrorChannelCasts([source("a.ts", body)]);
    expect(stats.judged).toBe(1);
    // 报的是断言写在哪一行（元素那一行），不是解构那一行
    expect(stats.casts).toEqual([{ file: "a.ts", line: 4 }]);
  });

  it("带 `error` 的 `Promise.all` 元素断言合规，但必须真的被判到过", () => {
    const body = `
      async function f(supabase: any) {
        const [{ data: rows }] = await Promise.all([
          supabase.from("notifications").select("*") as {
            data: Row[] | null;
            error: { message: string } | null;
          },
        ]);
        return rows;
      }
    `;
    const stats = collectErrorChannelCasts([source("a.ts", body)]);
    expect(stats.judged).toBe(1);
    expect(stats.casts).toEqual([]);
  });

  it("元素自己 await 过时只判一次，不双计", () => {
    const body = `
      async function f(supabase: any) {
        const [{ data: rows }] = await Promise.all([
          (await supabase.from("notifications").select("*")) as { data: Row[] | null },
        ]);
        return rows;
      }
    `;
    expect(collectErrorChannelCasts([source("a.ts", body)]).judged).toBe(1);
  });

  it("射程外仍然是射程外：`allSettled` 与未 await 的 `Promise.all` 都不判", () => {
    const body = `
      async function f(supabase: any) {
        const [{ data: a }] = await Promise.allSettled([
          supabase.from("notifications").select("*") as { data: Row[] | null },
        ]);
        const pending = Promise.all([supabase.from("teams").select("*") as { data: null }]);
        return [a, pending];
      }
    `;
    const stats = collectErrorChannelCasts([source("a.ts", body)]);
    expect(stats.judged).toBe(0);
    expect(stats.casts).toEqual([]);
  });

  it("`Promise.all` 里**不是**查询链的断言不判：射程跟着「awaited 的查询结果」走", () => {
    const body = `
      async function f(supabase: any) {
        const [{ data: a }, { data: b }] = await Promise.all([
          loadSomethingRemote() as { data: null },
          supabase.from("teams").select("*") as { data: null },
        ]);
        return [a, b];
      }
    `;
    const stats = collectErrorChannelCasts([source("a.ts", body)]);
    // 判到的是第 5 行那条链，第 4 行那个「不知道返回什么」的调用不算
    expect(stats.judged).toBe(1);
    expect(stats.casts).toEqual([{ file: "a.ts", line: 5 }]);
  });

  it("解析不动的文件会被点名，而不是安静地算作干净", () => {
    // `as` 换行会被 ASI 截断成另一条语句——这一份 fixture 本身就是这么写坏的。
    // 如果扫描器不报语法诊断，这类代码在门禁眼里等于不存在。
    const broken = `
      const { data } = (await admin.rpc("x"))
        as { data: number | null };
    `;
    const stats = collectErrorChannelCasts([source("a.ts", `async function f() {${broken}}`)]);
    expect(stats.judged).toBe(0);
    expect(stats.unparseable).toEqual([
      { file: "a.ts", line: 3, message: "Unexpected keyword or identifier." },
    ]);
    expect(
      codes([source("a.ts", `async function f() {${broken}}`), source("b.ts", ROLE_QUERY)]),
    ).toContain("QUERY_ERROR_CHANNEL_PARSE");
  });
});

describe("inspectQueryErrorChannel()", () => {
  it("真实仓库没有新增违规，且债务台账与实测数量一致", () => {
    const sources = readQuerySources();
    const stats = collectErrorChannelCasts(sources);
    // 地板值：断言扫描真的读到了 awaited 查询结果，否则「零违规」只是没在看。
    // 挂在台账总数上而不是写死的数字——债务每还一处，这个下限应当自动跟着降，
    // 一个「改进会让它红」的地板值迟早要学会被跳过。
    expect(stats.judged).toBeGreaterThanOrEqual(
      Object.values(ERROR_CHANNEL_EXEMPTIONS).reduce((total, entry) => total + entry.sites, 0),
    );
    expect(stats.unparseable).toEqual([]);
    expect(inspectQueryErrorChannel(sources)).toEqual([]);

    const ledger = Object.entries(ERROR_CHANNEL_EXEMPTIONS);
    const registered = ledger.reduce((total, [, entry]) => total + entry.sites, 0);
    expect(stats.casts).toHaveLength(registered);
    expect(ledger.length).toBe(new Set(stats.casts.map((cast) => cast.file)).size);
    for (const [file, entry] of ledger) {
      const found = stats.casts.filter((cast) => cast.file === file).length;
      // 逐文件对账，而不是只看总数：一处被修好、另一处新加，总数是不变的。
      expect(found, `${file} 实际 ${found} 处，台账登记 ${entry.sites} 处`).toBe(entry.sites);
      expect(entry.reason.length).toBeGreaterThan(0);
    }

    // 解构那一侧同样逐文件对账。总数在这里是 165，只有逐文件才看得见「哪一格被换掉了」
    const unbound = summarizeUnboundErrorChannels(collectUnboundErrorChannels(sources));
    const unboundRegistered = ledger.reduce(
      (total, [, entry]) => total + (entry.unboundSites ?? 0),
      0,
    );
    expect(unbound.total).toBeGreaterThanOrEqual(unboundRegistered);
    // 「绑了的」比「没绑的」多，才说明这条规则不是在把全库一锅端
    expect(unbound.total - unbound.unbound.length).toBeGreaterThan(unbound.unbound.length);
    // 两个收集器共用同一个解析调用：只要有文件被跳过，`unbound.total` 就是下界，绿灯不可信
    expect(unbound.skippedUnparseable).toBe(0);
    for (const [file, entry] of ledger) {
      const found = unbound.unbound.filter((site) => site.file === file).length;
      expect(found, `${file} 解构实际 ${found} 处，台账登记 ${entry.unboundSites ?? 0} 处`).toBe(
        entry.unboundSites ?? 0,
      );
    }
    // 台账之外的解构抹除必须为 0——这正是把判据接进门禁的依据
    const exempt = new Set(ledger.map(([file]) => file));
    expect(unbound.unbound.filter((site) => !exempt.has(site.file))).toEqual([]);
  });

  it("台账按数量对账：多一处就报，少一处也报（清理完不许留着旧条目）", () => {
    const file = "src/components/shared/permission-gate.tsx";
    expect(
      codesFor([source(file, `async function f() {${ROLE_QUERY}${ROLE_QUERY}}`)], file),
    ).toEqual([]);

    const three = `async function f() {${ROLE_QUERY}${ROLE_QUERY}${ROLE_QUERY}}`;
    expect(codesFor([source(file, three)], file)).toEqual(
      expect.arrayContaining(["QUERY_ERROR_CHANNEL_CAST_AWAY", "QUERY_ERROR_CHANNEL_EXEMPT_STALE"]),
    );

    const zero =
      "async function f() { const { data, error } = await supabase.from('profiles').select('role'); void data; void error; }";
    expect(codesFor([source(file, zero), source("other.ts", ROLE_QUERY)], file)).toContain(
      "QUERY_ERROR_CHANNEL_EXEMPT_STALE",
    );
  });

  it("一条语句同时抹掉断言与解构时，两条规则各报一次", () => {
    const issues = inspectQueryErrorChannel([
      source("src/lib/auth/guards.ts", `async function f() {${ROLE_QUERY}}`),
    ]);
    const flagged = issues.filter((issue) => issue.file === "src/lib/auth/guards.ts");

    expect(flagged.map((issue) => issue.code)).toEqual([
      "QUERY_ERROR_CHANNEL_CAST_AWAY",
      "QUERY_ERROR_CHANNEL_UNBOUND_AWAY",
    ]);
    expect(flagged.every((issue) => issue.line === 2)).toBe(true);
    // 解构那侧的报告要点名读的是哪张表，否则「第 2 行有问题」无法核对
    expect(flagged[1].message).toContain("profiles");
  });

  it("两条台账各自独立：断言那侧刚好、解构那侧多一处，仍然要报", () => {
    const file = "src/components/shared/permission-gate.tsx";
    const extraUnbound = `
      const { data: teams } = await supabase.from("teams").select("plan");
      void teams;
    `;
    const codes = codesFor(
      [source(file, `async function f() {${ROLE_QUERY}${ROLE_QUERY}${extraUnbound}}`)],
      file,
    );

    // 断言台账（2 处）仍然对得上——如果两条规则共用一个计数，这里会全绿
    expect(codes).not.toContain("QUERY_ERROR_CHANNEL_CAST_AWAY");
    expect(codes).not.toContain("QUERY_ERROR_CHANNEL_EXEMPT_STALE");
    // 逐站点各报一条（与断言那一侧同构），这里只看报了哪几种
    expect([...new Set(codes)]).toEqual([
      "QUERY_ERROR_CHANNEL_UNBOUND_AWAY",
      "QUERY_ERROR_CHANNEL_UNBOUND_STALE",
    ]);
    expect(codes).toHaveLength(4);
  });

  it("解构债务还清了却不删台账，同样要报", () => {
    const file = "src/components/shared/permission-gate.tsx";
    // 两条断言（各计一次 sites）、零处「没绑 error 的解构」：sites 对得上，unboundSites 已是旧数字。
    // 那条绑了 `error` 的读取不能省：它撑起的是「解构判据仍然在工作」，
    // 否则这条用例会撞上下面的空转地板值，量的就不是同一件事了。
    const castOnly = `
      async function f() {
        const a = (await supabase.from("profiles").select("role")) as { data: null };
        const b = (await supabase.from("teams").select("plan")) as { data: null };
        const { data: c, error } = await supabase.from("notifications").select("*");
        return [a, b, error ? null : c];
      }
    `;
    expect(codesFor([source(file, castOnly)], file)).toEqual([
      "QUERY_ERROR_CHANNEL_UNBOUND_STALE",
    ]);
  });

  it("解构判据自己被调空时不会安静地变成绿灯", () => {
    // 断言那一半仍然判到 1 处，所以既有的 VACUOUS 地板值不会响——这一格只有新地板值能占。
    // 同时真实的断言违规不许被这条早退吞掉：半个门禁坏了，不能连带藏起另一半的结论。
    const body = `
      async function f() {
        const profile = (await supabase.from("profiles").select("role")) as { data: null };
        return profile;
      }
    `;
    expect(codesFor([source("a.ts", body)], "a.ts")).toEqual([
      "QUERY_ERROR_CHANNEL_UNBOUND_VACUOUS",
      "QUERY_ERROR_CHANNEL_CAST_AWAY",
    ]);
  });

  it("未登记的违规文件直接报错", () => {
    const issues = inspectQueryErrorChannel([
      source("src/lib/auth/guards.ts", `async function f() {${ROLE_QUERY}}`),
    ]);
    const casts = issues.filter((issue) => issue.code === "QUERY_ERROR_CHANNEL_CAST_AWAY");
    expect(casts).toEqual([
      expect.objectContaining({
        code: "QUERY_ERROR_CHANNEL_CAST_AWAY",
        file: "src/lib/auth/guards.ts",
        line: 2,
      }),
    ]);
  });

  it("真实仓库：仪表盘 `Promise.all` 里那条断言现在在射程内", () => {
    // 接线前它**完全**看不见：`await` 落在 `Promise.all` 上，元素自己不带 await，
    // 而断言那侧的判据要求「awaited 的链」。这一处抹掉通道时门禁会一路绿到线上。
    const file = "src/app/dashboard/page.tsx";
    const real = readQuerySources().find((item) => item.file === file);
    expect(real, `${file} 不在扫描范围内`).toBeDefined();
    const original = real?.content ?? "";
    const erased = original.replace("error: { message: string } | null;", "error: null;");
    // 站点漂移到 replace 改不动时这条必须红，否则它会安静地变成空转
    expect(erased).not.toBe(original);

    expect(codesFor([{ file, content: original }], file)).toEqual([]);
    expect(codesFor([{ file, content: erased }], file)).toContain("QUERY_ERROR_CHANNEL_CAST_AWAY");
  });

  it("三条失败封闭：没有文件、文件全空、扫到了文件却一个 awaited 查询结果都没判", () => {
    expect(codes([])).toEqual(["QUERY_ERROR_CHANNEL_NO_SOURCES"]);
    expect(codes([source("a.ts", "   \n  ")])).toEqual(["QUERY_ERROR_CHANNEL_SOURCE_EMPTY"]);
    expect(codes([source("a.ts", "export const x = 1;")])).toEqual(["QUERY_ERROR_CHANNEL_VACUOUS"]);
  });
});

/** 与 IO 层同一套扫描口径：`src/**`，跳过测试文件。 */
function readQuerySources(): QueryErrorChannelSource[] {
  const files: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(path.join(REPO_ROOT, directory), { withFileTypes: true })) {
      const relative = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(relative);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name) || /\.(test|stories)\.tsx?$/.test(entry.name)) continue;
      files.push(relative.split(path.sep).join("/"));
    }
  };
  walk("src");
  return files.map((file) => ({
    file,
    content: fs.readFileSync(path.join(REPO_ROOT, file), "utf8"),
  }));
}

describe("collectUnboundErrorChannels()（C08-c 的采集侧，判据见上面）", () => {
  const src = (body: string): { file: string; content: string }[] => [
    { file: "src/lib/probe.ts", content: body },
  ];

  it("解构时压根不取 error 的那一处要被量到", () => {
    const summary = summarizeUnboundErrorChannels(
      collectUnboundErrorChannels(
        src(`
          async function read(supabase: any) {
            const { data: profile } = await supabase
              .from("profiles")
              .select("role")
              .eq("id", 1);
            return profile;
          }
        `),
      ),
    );
    expect(summary.total).toBe(1);
    expect(summary.unbound).toHaveLength(1);
    expect(summary.unbound[0]).toMatchObject({ source: "profiles", bindsError: false });
  });

  it("绑了 error 的不算，改名绑的也不算", () => {
    const summary = summarizeUnboundErrorChannels(
      collectUnboundErrorChannels(
        src(`
          async function read(supabase: any) {
            const { data, error } = await supabase.from("profiles").select("role");
            const { data: other, error: boom } = await supabase.from("teams").select("plan");
            if (boom) return null;
            return error ? null : other ?? data;
          }
        `),
      ),
    );
    expect(summary.total).toBe(2);
    expect(summary.unbound).toHaveLength(0);
  });

  it("断言里带着 error 也算绑了通道的那一侧：这里判的是解构，不是断言", () => {
    const summary = summarizeUnboundErrorChannels(
      collectUnboundErrorChannels(
        src(`
          async function read(supabase: any) {
            const { data } = (await supabase.from("profiles").select("role")) as {
              data: unknown;
              error: null;
            };
            return data;
          }
        `),
      ),
    );
    expect(summary.unbound).toHaveLength(1);
  });

  it("`.rpc()` 的链同样在射程内，表名取字面量参数", () => {
    const summary = summarizeUnboundErrorChannels(
      collectUnboundErrorChannels(src(`const { data } = await supabase.rpc("ping");`)),
    );
    expect(summary.unbound[0]).toMatchObject({ source: "ping" });
  });

  it("未 await 的构造器断言不算——那是给 builder 定形状", () => {
    const summary = summarizeUnboundErrorChannels(
      collectUnboundErrorChannels(
        src(`const query = supabase.from("contact_messages").select("*") as unknown as Chain;`),
      ),
    );
    expect(summary.total).toBe(0);
  });

  it("`await` 必须在位：解构一个还没执行的 builder 不是「抹掉 error」，是另一回事", () => {
    const summary = summarizeUnboundErrorChannels(
      collectUnboundErrorChannels(
        src(`async function read(supabase: any) { const { data } = supabase.from("profiles").select("role"); return data; }`),
      ),
    );
    expect(summary.total).toBe(0);
  });

  it("条件表达式包住的链同样判得到（清项目页时这一类是漏掉的）", () => {
    const summary = summarizeUnboundErrorChannels(
      collectUnboundErrorChannels(
        src(
          `async function read(supabase: any, ok: boolean) {
            const { data } = ok ? await supabase.from("projects").select("*") : { data: [], error: null };
            return data;
          }`,
        ),
      ),
    );
    expect(summary.total).toBe(1);
    expect(summary.unbound[0]).toMatchObject({ source: "projects", bindsError: false });
  });

  it("两支都是链时按两条读取判，绑了 error 的两支都不算抹除", () => {
    const summary = summarizeUnboundErrorChannels(
      collectUnboundErrorChannels(
        src(
          `async function read(supabase: any, ok: boolean) {
            const { data, error } = ok
              ? await supabase.from("projects").select("*")
              : await supabase.from("archived_projects").select("*");
            return error ? null : data;
          }`,
        ),
      ),
    );
    expect(summary.total).toBe(2);
    expect(summary.unbound).toHaveLength(0);
  });

  it("await 落在括号外时也认：`await (cond ? chainA : chainB)`", () => {
    const summary = summarizeUnboundErrorChannels(
      collectUnboundErrorChannels(
        src(
          `async function read(supabase: any, ok: boolean) {
            const { data } = await (ok ? supabase.from("projects").select("*") : supabase.from("teams").select("*"));
            return data;
          }`,
        ),
      ),
    );
    expect(summary.total).toBe(2);
    expect(summary.unbound).toHaveLength(2);
  });

  it("非字面量表名在射程内，只是标成 `<非字面量>`", () => {
    const summary = summarizeUnboundErrorChannels(
      collectUnboundErrorChannels(
        src(`async function read(supabase: any, TABLE: string) { const { data } = await supabase.from(TABLE).select("*"); return data; }`),
      ),
    );
    expect(summary.unbound[0]).toMatchObject({ source: "<非字面量>", bindsError: false });
  });

  it("`Promise.all` + 数组解构：按下标配对，只判对象解构的元素", () => {
    const summary = summarizeUnboundErrorChannels(
      collectUnboundErrorChannels(
        src(
          `async function read(supabase: any) {
            const [{ data: sessions }, { data: s2, error }, [nested]] = await Promise.all([
              supabase.from("user_sessions").select("*"),
              supabase.from("auth_sessions").select("*"),
              supabase.from("profiles").select("role"),
            ]);
            return [sessions, s2, error, nested];
          }`,
        ),
      ),
    );
    // 第三条的元素是数组解构，`error` 还挂在外层结果上，不在这一族的射程内（那是「绑了不用」那一档）
    expect(summary.total).toBe(2);
    expect(summary.unbound).toHaveLength(1);
    expect(summary.unbound[0]).toMatchObject({ source: "user_sessions", bindsError: false });
  });

  it("配对是按下标的，不是「这条解构附近有条链」", () => {
    const summary = summarizeUnboundErrorChannels(
      collectUnboundErrorChannels(
        src(
          `async function read(supabase: any) {
            const [{ data: a }, , { data: b }] = await Promise.all([
              supabase.from("user_sessions").select("*"),
              supabase.from("ignored_middle").select("*"),
              supabase.from("auth_sessions").select("*"),
            ]);
            return [a, b];
          }`,
        ),
      ),
    );
    expect(summary.total).toBe(2);
    expect(summary.unbound.map((site) => site.source)).toEqual(["user_sessions", "auth_sessions"]);
  });

  it("元素上再盖一层断言的链同样算一条读取（`error` 依旧没进作用域）", () => {
    const summary = summarizeUnboundErrorChannels(
      collectUnboundErrorChannels(
        src(
          `async function read(supabase: any) {
            const [{ data: notifications }] = await Promise.all([
              supabase.from("notifications").select("*").limit(5) as unknown as { data: Row[] | null },
            ]);
            return notifications;
          }`,
        ),
      ),
    );
    expect(summary.total).toBe(1);
    expect(summary.unbound[0]).toMatchObject({ source: "notifications", bindsError: false });
  });

  it("射程外只剩这几种：未 await 的三元、`Promise.allSettled`、`Promise.all` 之外的 helper", () => {
    const summary = summarizeUnboundErrorChannels(
      collectUnboundErrorChannels(
        src(`
          async function read(supabase: any, ok: boolean) {
            const a = ok ? supabase.from("projects").select("*") : supabase.from("teams").select("*");
            const [{ data: b }] = await Promise.allSettled([supabase.from("profiles").select("role")]);
            const [{ data: c }] = await Promise.all([ok ? supabase.from("teams").select("plan") : null]);
            return { a, b, c };
          }
        `),
      ),
    );
    expect(summary.total).toBe(0);
  });

  it("解析不动的文件计入 skipped，而不是安静地贡献 0 处", () => {
    const summary = summarizeUnboundErrorChannels(
      collectUnboundErrorChannels(src(`const { data } = await supabase.from("profiles") as`)),
    );
    expect(summary.skippedUnparseable).toBe(1);
  });

  it("真实仓库里这条规则不是空转，且两侧都有量到", () => {
    const summary = summarizeUnboundErrorChannels(
      collectUnboundErrorChannels(readQuerySources()),
    );
    expect(summary.total).toBeGreaterThan(0);
    expect(summary.unbound.length).toBeGreaterThan(0);
    // 「绑了的」比「没绑的」多，才说明这条规则不是在把全库一锅端
    expect(summary.total - summary.unbound.length).toBeGreaterThan(summary.unbound.length);
    expect(summary.skippedUnparseable).toBe(0);
  });
});
