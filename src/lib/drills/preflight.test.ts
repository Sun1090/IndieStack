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
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DRILL_SPECS,
  evaluateAllDrills,
  evaluateDrill,
  summarize,
  type EnvProbe,
} from "./preflight";

const B03 = DRILL_SPECS.find((spec) => spec.id === "B03")!;
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
    const full = evaluateDrill(
      B04,
      all("SUPABASE_DB_PASSWORD", "file:~/.supabase/access-token", "NEXT_PUBLIC_SUPABASE_URL"),
    );
    expect(full.ready).toBe(true);

    // 只缺 CLI 登录态时，缺口应指向 token，而不是含糊地说「缺凭据」
    const withoutToken = evaluateDrill(B04, all("SUPABASE_DB_PASSWORD", "NEXT_PUBLIC_SUPABASE_URL"));
    expect(withoutToken.ready).toBe(false);
    const unmet = withoutToken.requirements.find((r) => !r.satisfied)!;
    expect(unmet.source).toContain("access-token");
    expect(unmet.remedy).toContain("supabase login");
  });

  it("B04 的真正缺口是 DB 密码，不是平台令牌（2026-10-05 实测纠正）", () => {
    // CI 里那个 SUPABASE_ACCESS_TOKEN 每天都在用，所以「缺管理凭据」是错的说法。
    // 演练 SQL 与 migration list 都要真 Postgres 连接，平台令牌替代不了。
    const onlyPlatformToken = evaluateDrill(
      B04,
      all("file:~/.supabase/access-token", "NEXT_PUBLIC_SUPABASE_URL"),
    );
    expect(onlyPlatformToken.ready).toBe(false);
    const unmet = onlyPlatformToken.requirements.find((r) => !r.satisfied)!;
    expect(unmet.source).toBe("SUPABASE_DB_PASSWORD");
    expect(unmet.purpose).toContain("真正的缺口");
    // 阻塞原因本身也要说清「平台层从来不是阻塞」，否则下一个人又会去要一个已有的令牌
    expect(onlyPlatformToken.blockedReason).toContain("平台层从来不是阻塞");
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