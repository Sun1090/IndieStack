/**
 * B03/B04/B05 演练前置条件的单测。
 *
 * **这组用例量的是「判定逻辑对不对」，不是「演练做完了没」**——
 * 后者由执行器产出，而执行器还没写（见 `preflight.ts` 文件头）。
 *
 * 特意覆盖的几种读法：
 *  - 复合前置（VAPID 那一对）**缺一即不满足**，因为 `src/lib/env.ts` 会拒绝只给一半的启动；
 *  - 空字符串等价于「没有」，而不是「有」——`.env` 里写了 `KEY=` 是常见的踩法；
 *  - 只判一条时其余两条不出现，避免输出里混进没问的演练；
 *  - `summarize` 的措辞**永远不说「通过」**：这是这套输出最容易骗人的地方。
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DRILL_SPECS,
  evaluateAllDrills,
  evaluateDrill,
  fileRequirementPaths,
  summarize,
  type EnvProbe,
} from "./preflight";
import { findPsqlMetaCommands } from "./psql-meta";

const B03 = DRILL_SPECS.find((spec) => spec.id === "B03")!;
/** 擦除演练的正本——B04 缺口 (a) 说的就是这份文件里的元命令。 */
const ERASURE_SOURCE = resolve(
  process.cwd(),
  "docs/operations/drills/account-erasure.sql",
);
const B04 = DRILL_SPECS.find((spec) => spec.id === "B04")!;
const B05 = DRILL_SPECS.find((spec) => spec.id === "B05")!;

/** 把变量名数组变成「全部齐了」的探针。 */
const all = (...sources: string[]): EnvProbe =>
  Object.fromEntries(sources.map((source) => [source, true]));

describe("evaluateDrill", () => {
  it("B03 四项齐了才 ready；缺一项就不 ready", () => {
    const full = all(
      "NEXT_PUBLIC_SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "DRILL_ISOLATED_ACCOUNT_EMAIL",
    );
    expect(evaluateDrill(B03, full).ready).toBe(true);

    const missingEmail = { ...full, DRILL_ISOLATED_ACCOUNT_EMAIL: false };
    const verdict = evaluateDrill(B03, missingEmail);
    expect(verdict.ready).toBe(false);
    const unmet = verdict.requirements.filter((requirement) => !requirement.satisfied);
    expect(unmet).toHaveLength(1);
    // 缺什么必须连「怎么拿」一起给出来，否则这条前置等于只报了问题没给出了路。
    expect(unmet[0].source).toBe("DRILL_ISOLATED_ACCOUNT_EMAIL");
    // 这条 remedy 的要害是「别拿真人账号来删」，所以断言必须落在那句警告上。
    expect(unmet[0].remedy).toMatch(/不要用任何真实用户|专用账号/);
  });

  it("B03 缺 service_role 时点名它，并说明这是因为 anon key 调不动 RPC", () => {
    const verdict = evaluateDrill(
      B03,
      all(
        "NEXT_PUBLIC_SUPABASE_URL",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
        "DRILL_ISOLATED_ACCOUNT_EMAIL",
      ),
    );
    expect(verdict.ready).toBe(false);
    const unmet = verdict.requirements.find((r) => !r.satisfied)!;
    expect(unmet.source).toBe("SUPABASE_SERVICE_ROLE_KEY");
    expect(unmet.purpose).toContain("service_role");
  });

  it("B04 的文件型前置按键名判定（IO 层负责把文件存在解析成这个键）", () => {
    // 这条测的是机制，不是 B04 的内容：`file:` 前缀只看这个键有没有被点亮。
    const full = evaluateDrill(
      B04,
      all(
        "SUPABASE_ACCESS_TOKEN",
        "B04_AUTHORIZE_PRODUCTION_WRITE",
        "file:docs/operations/drills/account-erasure.single-do.sql",
        "file:docs/operations/drills/retention-cleanup.single-do.sql",
        "NEXT_PUBLIC_SUPABASE_URL",
      ),
    );
    expect(full.ready).toBe(true);

    // 两份都缺时，缺口指向**列在前面的那一份**（擦除）。
    const withoutArtifact = evaluateDrill(
      B04,
      all(
        "SUPABASE_ACCESS_TOKEN",
        "B04_AUTHORIZE_PRODUCTION_WRITE",
        "NEXT_PUBLIC_SUPABASE_URL",
      ),
    );
    expect(withoutArtifact.ready).toBe(false);
    const unmet = withoutArtifact.requirements.find((r) => !r.satisfied)!;
    expect(unmet.source).toContain("account-erasure.single-do.sql");
    expect(unmet.remedy).toContain("retention-cleanup.single-do.sql");
  });

  it("B04 的 SQL 型前置**必须覆盖两份**——只登记一份会让 ready 说谎", () => {
    /**
     * 这条用例是本轮补的，起因很具体：缺口 (a) 做完之后，我只登记了擦除那一份。
     * 而 B04 的正文写的是「把本地**两份** `docs/operations/drills/*.sql` 在云端跑一遍」。
     *
     * 只登记一份的后果：**有人给了人工授权，preflight 报 `ready=true`，
     * 执行器到第二份文件时才发现没东西可跑。**
     * 那是「把未满足的报成已满足」——比反过来危险，因为它会触发一次生产写。
     */
    const sqlSources = B04.requirements
      .map((requirement) => requirement.source)
      .filter((source) => source.startsWith("file:docs/operations/drills/"));
    expect(sqlSources).toHaveLength(2);
    expect(sqlSources).toContain(
      "file:docs/operations/drills/account-erasure.single-do.sql",
    );
    expect(sqlSources).toContain(
      "file:docs/operations/drills/retention-cleanup.single-do.sql",
    );

    // 只给一份文件时**不算 ready**——这条断言才是防重演的机关
    const onlyOne = evaluateDrill(
      B04,
      all(
        "SUPABASE_ACCESS_TOKEN",
        "B04_AUTHORIZE_PRODUCTION_WRITE",
        "file:docs/operations/drills/account-erasure.single-do.sql",
        "NEXT_PUBLIC_SUPABASE_URL",
      ),
    );
    expect(onlyOne.ready).toBe(false);
    const unmet = onlyOne.requirements.find((r) => !r.satisfied)!;
    expect(unmet.source).toContain("retention-cleanup.single-do.sql");
    // 而且 remedy 要指回**唯一那条正确的路**（重新转换并在本地栈跑通），
    // 不能让人就地复制一份——两份会各自漂移。
    expect(unmet.remedy).toContain("不要就地复制正本");
  });

  it("B04 不再需要数据库密码：那次读数否证了它（2026-10-13）", () => {
    // 这条用例存在的意义是**防止有人把「需要 DB 密码」再写回来**——
    // 它是 B04 第二版阻塞理由的墓碑，而那个版本害得「云端到了哪一版」
    // 被登记成查不了 21 天（最早可查 2026-09-22），代价是 034 从未 applied 直到线上出事。
    // 原写法「两年」已否证：仓库第一个 commit 是 2026-08-09，到 2026-10-13 只有 65 天。
    const sources = B04.requirements.map((requirement) => requirement.source);
    expect(sources).not.toContain("SUPABASE_DB_PASSWORD");
    expect(sources).toContain("SUPABASE_ACCESS_TOKEN");
    // 而且令牌现在被明说成「不是缺口」。
    const token = B04.requirements.find((r) => r.source === "SUPABASE_ACCESS_TOKEN")!;
    expect(token.purpose).toContain("否证");
  });

  it("B04 今天缺的是人工授权，不是凭据：只给令牌不算 ready", () => {
    // 这是本次更正的分寸所在。通道打通了 ≠ 可以往生产库写。
    const onlyToken = evaluateDrill(
      B04,
      all(
        "SUPABASE_ACCESS_TOKEN",
        "file:docs/operations/drills/account-erasure.single-do.sql",
        "NEXT_PUBLIC_SUPABASE_URL",
      ),
    );
    expect(onlyToken.ready).toBe(false);
    const unmet = onlyToken.requirements.find((r) => !r.satisfied)!;
    expect(unmet.source).toBe("B04_AUTHORIZE_PRODUCTION_WRITE");
    expect(unmet.purpose).toContain("人工授权");
    // 阻塞文案必须明说「别读成已解锁」，否则下一次又会当成能跑。
    // 用正则而不是整句：这句话随缺口进展会被改写（2026-10-13 缺口 (a) 做完时
    // 就把「这次更正」改成了「(a) 做完」），而**承重的是那个警告本身**。
    // 写成整句字面量的话，改文案会红——那不是用例在保护事实，是在保护措辞。
    expect(onlyToken.blockedReason).toMatch(/别把[^。]{0,24}读成「B04 已解锁」/);
  });

  it("仓库里真实存在的那份演练 SQL 能被解析出来（不依赖 cwd）", () => {
    // 上一条测的是纯函数的形状，这条测的是它对本仓库事实的判断对不对。
    // 2026-10-24 起四份都在 main 上（两份 .single-do 派生版随 #236/#237 落地），
    // 所以全部覆盖——旧写法「只取两份正本」是因为保留期派生版当时还没进 main。
    const repoRoot = resolve(__dirname, "../../..");
    for (const relative of [
      "docs/operations/drills/retention-cleanup.sql",
      "docs/operations/drills/account-erasure.sql",
      "docs/operations/drills/retention-cleanup.single-do.sql",
      "docs/operations/drills/account-erasure.single-do.sql",
    ]) {
      const [resolved] = fileRequirementPaths(`file:${relative}`, "/home/u", repoRoot);
      expect(resolved).toBe(resolve(repoRoot, relative));
      expect(existsSync(resolved)).toBe(true);
    }
  });

  it("`file:` 前置锚在仓库根，与当前目录无关", () => {
    // 这条盯的是 IO 层原先的写法：直接拿 `file:` 后面的字符串当路径，
    // 于是仓库相对的前置会随 cwd 变化——从仓库外面跑会把已满足的报成未满足。
    const paths = fileRequirementPaths(
      "file:docs/operations/drills/account-erasure.single-do.sql",
      "/home/u",
      "/repo",
    );
    expect(paths).toEqual(["/repo/docs/operations/drills/account-erasure.single-do.sql"]);
  });

  it("`~` 开头的前置仍锚到 HOME", () => {
    expect(fileRequirementPaths("file:~/.supabase/access-token", "/home/u", "/repo")).toEqual([
      "/home/u/.supabase/access-token",
    ]);
  });

  it("授权变量排在凭据之后：缺口顺序就是处置顺序", () => {
    const sources = B04.requirements.map((requirement) => requirement.source);
    expect(sources.indexOf("SUPABASE_ACCESS_TOKEN")).toBeLessThan(
      sources.indexOf("B04_AUTHORIZE_PRODUCTION_WRITE"),
    );
  });

  it("B04 的第三、四次纠正与第五次订正都要留在阻塞文案里", () => {
    // 第三次：把 retention-cleanup.sql 压成一条 DO 块在本地跑通（failures=0），
    // 否证「多语句 ⇒ 必须 psql」；第四次：Management API 用令牌就能执行 SQL，
    // 连「要数据库密码」也被否证。两个版本的读数与坑都必须留在 blockedReason 里，
    // 防止有人把「需要 DB 密码」再写回来。
    expect(B04.blockedReason).toContain("2026-10-13");
    expect(B04.blockedReason).toContain("DO 块");
    expect(B04.blockedReason).toContain("run 38334026946");
    expect(B04.blockedReason).toContain("22012");
    // 第五次（2026-10-24）：(a) 的两份都已进 main（#236 合入 917beb41，
    // `git ls-tree origin/main` 读数），缺口只剩 (b) 人工授权。
    // 钉「已闭合」而不是钉旧的「没进 main」——上一轮正是被后者反噬的：
    // 事实变了而文案没回头改，腐烂的却是生产写决策的输入。
    expect(B04.blockedReason).toContain("已于 2026-10-24 闭合");
  });

  it("B05 的 VAPID 是复合前置：缺一个就不满足", () => {
    const both = evaluateDrill(B05, all("RESEND_API_KEY", "VAPID_PRIVATE_KEY", "NEXT_PUBLIC_VAPID_PUBLIC_KEY", "SUPABASE_ACCESS_TOKEN"));
    expect(both.ready).toBe(true);

    const half = evaluateDrill(B05, all("RESEND_API_KEY", "VAPID_PRIVATE_KEY", "SUPABASE_ACCESS_TOKEN"));
    expect(half.ready).toBe(false);
    const unmet = half.requirements.find((r) => !r.satisfied)!;
    expect(unmet.source).toContain("NEXT_PUBLIC_VAPID_PUBLIC_KEY");
  });

  it("每条前置都必须带「怎么拿」——没有出路的阻塞等于把问题原样退回", () => {
    for (const spec of DRILL_SPECS) {
      for (const requirement of spec.requirements) {
        expect(requirement.remedy.trim().length).toBeGreaterThan(0);
        expect(requirement.purpose.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("每条演练都必须带首条命令与证据落点——临场回忆正是要消灭的东西", () => {
    for (const spec of DRILL_SPECS) {
      expect(spec.firstCommand.trim().length).toBeGreaterThan(0);
      // 证据落点指向的**文件必须真的存在**：文档改名后这一条会红，
      // 而「结论写到一个已经不存在的文件里」正是这类台账最常见的静默腐烂方式。
      const docPath = spec.evidenceTarget.match(/[\w./-]+\.md/)?.[0];
      expect(docPath, `${spec.id} 的 evidenceTarget 里没有 .md 路径`).toBeTruthy();
      expect(
        existsSync(resolve(process.cwd(), docPath!)),
        `${spec.id} 的证据落点 ${docPath} 不存在`,
      ).toBe(true);
    }
  });
});

describe("B04 的元命令条数——文档里的数字必须由代码量出来", () => {
  /**
   * 这条用例是**跨文件对账**，不是重复验证探测器自己。
   *
   * 起因：B04 的阻塞理由里写着「`account-erasure.sql` 有 5 条 psql 元命令」，
   * 那个数是**手数**的，而量法只看「行首是反斜杠」，于是漏了挂在语句末尾的
   * `select … from d \gset drill_`。真实条数是 6，漏掉的偏偏是唯一那条
   * **结构性**的（它供后面 16 处 `:'drill_*'` 引用）。
   *
   * 光加一个探测器**不能**防止这件事重演：文档里的数字仍然是人抄进去的。
   * 所以这里把「`preflight.ts` 正文里出现的那个数」和「探测器算出的条数」钉在一起——
   * **改正本里的 SQL 而不回头改这句话，就会红**。
   */
  it("preflight 正文里写的条数 = 探测器对正本算出的条数", async () => {
    const commands = findPsqlMetaCommands(readFileSync(ERASURE_SOURCE, "utf8"));
    const claimed = Number(B04.blockedReason.match(/有 (\d+) 条 psql 元命令/)?.[1]);
    expect(claimed, "B04 正文里那句「N 条 psql 元命令」的格式变了，对账失效").not.toBeNaN();
    expect(claimed).toBe(commands.length);
    // 只核对总数不够：还可能「数对了但**命令种类**说漏了」。
    // 所以把正文括号里列出的命令名，与探测器实际算出的种类对账。
    const listed = B04.blockedReason.match(/（(`\\[a-z]+`( \/ `\\[a-z]+`)*)）/)?.[1];
    expect(listed, "B04 正文里那串（`\\set` / …）的格式变了，种类对账失效").toBeTruthy();
    const listedNames = listed!.split("/").map((token) => token.trim().replace(/`/g, ""));
    const actualNames = [...new Set(commands.map((command) => `\\${command.command}`))].sort();
    expect([...listedNames].sort()).toEqual(actualNames);
    // 结构性的那条必须在列（它就是上次被漏掉的那条）
    expect(listedNames).toContain("\\gset");
  });
});

describe("evaluateAllDrills", () => {
  it("不指定时返回三条", () => {
    expect(evaluateAllDrills({})).toHaveLength(3);
  });

  it("指定 B04 时只返回 B04——输出里不该混进没问的那两条", () => {
    const verdicts = evaluateAllDrills({}, "B04");
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0].id).toBe("B04");
  });

  it("空环境（三条都没配）时三条全部 blocked", () => {
    const verdicts = evaluateAllDrills({});
    expect(summarize(verdicts).ready).toHaveLength(0);
    expect(summarize(verdicts).blocked).toEqual(["B03", "B04", "B05"]);
  });

  it("未知键不影响判定（多余环境变量不该让某条变成 ready）", () => {
    const verdict = evaluateDrill(B04, { "TOTALLY_UNRELATED": true });
    expect(verdict.ready).toBe(false);
  });
});

describe("summarize", () => {
  it("全阻塞时的措辞明确声明「不代表任何演练已通过」", () => {
    const { headline } = summarize(evaluateAllDrills({}));
    expect(headline).toContain("不代表任何演练已通过");
  });

  it("有 ready 时措辞是「可以跑」而不是「已通过」", () => {
    const verdicts = evaluateAllDrills(
      all("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "DRILL_ISOLATED_ACCOUNT_EMAIL"),
      "B03",
    );
    const { ready, headline } = summarize(verdicts);
    expect(ready).toEqual(["B03"]);
    expect(headline).toContain("前置齐了");
    expect(headline).toContain("执行器与实跑证据仍未产出");
    expect(headline).not.toContain("通过");
  });

  it("任何输入下 headline 都不会断言「演练通过/已完成/成功」", () => {
    // 注意这里匹配的是**正面断言**；阻塞时的措辞里含有「不代表任何演练已通过」，
    // 那句里的「已通过」是否定式，naive 的 /演练已通过/ 会把它一起误伤（第一版就误伤了）。
    const positiveClaim = /演练通过|演练已完成|演练成功|B0\d (?:已)?(?:通过|完成)/;
    for (const env of [{}, all("NEXT_PUBLIC_SUPABASE_URL")]) {
      for (const only of [undefined, "B03" as const, "B04" as const, "B05" as const]) {
        const { headline } = summarize(evaluateAllDrills(env, only));
        expect(headline).not.toMatch(positiveClaim);
        // 无论结论如何，都必须先声明「这只是前置判定」。
        expect(headline).toMatch(/演练|前置/);
      }
    }
  });
});
