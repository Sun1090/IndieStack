/**
 * 把「文档里那句读数个数 / 那条链」和「台账算出的结果」钉在一起。
 *
 * **与 `preflight.test.ts` 里那条元命令对账同一形态**：光有探测器不够，
 * 文档里的数字仍然是人抄的。本仓库第一次犯是在「5 条 psql 元命令」（真值 6），
 * 而这一行文档**当场复现了同一个错**：表头写「今天有四个读数」，
 * 同一行正文已经数到「第 6 个读数」——第 5、6 条是两次后续 commit 追加的，
 * **表头没人回头改**。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  QUOTA_READINGS,
  consecutivePassFromTail,
  consecutivePassPrsFromTail,
  liftStreakSpanHours,
  tailStreakMaxGapHours,
  longestPassStreak,
  readingChainText,
  readingCount,
  readingVerdict,
  type QuotaOutcome,
  type QuotaReading,
} from "./quota-readings";

const DOC = resolve(process.cwd(), "docs/operations/environments.md");
const ROW = readFileSync(DOC, "utf8")
  .split("\n")
  .find((line) => line.startsWith("| Vercel 构建配额 |"));

describe("台账本体", () => {
  it("每条读数都带来源说明（没有出处的读数等于没记）", () => {
    for (const reading of QUOTA_READINGS) {
      expect(reading.pr).toBeGreaterThan(0);
      expect(reading.note.trim().length).toBeGreaterThan(0);
      expect(reading.at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("PR 编号单调不减——台账是按时间追加的，插队会让「第 N 个」失去意义", () => {
    const prs = QUOTA_READINGS.map((reading) => reading.pr);
    expect(prs).toEqual([...prs].sort((a, b) => a - b));
  });

  it("同一个 PR 最多一条 preview + 一条 production", () => {
    for (const pool of ["preview", "production"] as const) {
      const seen = QUOTA_READINGS.filter((reading) => reading.pool === pool).map(
        (reading) => reading.pr,
      );
      expect(new Set(seen).size).toBe(seen.length);
    }
  });
});

describe("跨文件对账：文档里的那句话必须等于台账算出的结果", () => {
  it("文档里有这一行（扫不到东西的检查等于没有检查）", () => {
    expect(ROW).toBeTruthy();
  });

  it("表头那句「台账共 N 个读数」= 台账条数", () => {
    const claimed = Number(/台账共\s*(\d+)\s*个读数/.exec(ROW!)?.[1]);
    expect(claimed, "表头那句「台账共 N 个读数」的格式变了，对账失效").not.toBeNaN();
    expect(claimed).toBe(readingCount());
  });

  it("文档里那条链 = 台账生成的链（逐字）", () => {
    const chain = readingChainText();
    expect(ROW).toContain(chain);
    // **对照**：链里必须真的含最后一个 PR，否则「toContain 通过」
    // 可能只是因为生成的是一条更短的旧链
    expect(chain).toContain(`#${QUOTA_READINGS[QUOTA_READINGS.length - 1].pr}`);
  });

  it("结论词与台账形状一致：链里同时有 pass 与 fail ⇒ 只能说「会波动」", () => {
    expect(readingVerdict()).toBe("flapping");
    expect(ROW).toContain("会波动");
    // 而且文档**不得**出现「配额已解除」这种肯定句式
    expect(ROW).not.toMatch(/配额已解除(?!」?也不是|——|：|」)/);
  });

  it("文档里「按 PR 数只有 N」的 N = PR 级连击（判「解除」的那个门槛）", () => {
    // 这条是补的：门槛写的是「连续多个 **PR** 全过且生产跟上」，
    // 而尾部连击数的是**读数条数**——一个 PR 贡献两条读数，于是 10 条看着像 10 个 PR。
    // 不钉住 PR 级那个数，门槛就只能靠人脑换算，正是 #255/#256 被反例按回去那类错。
    const claimed = Number(/按 PR 数只有\s*(\d+)/.exec(ROW!)?.[1]);
    expect(claimed, "文档里「按 PR 数只有 N」的措辞变了，对账失效").not.toBeNaN();
    expect(claimed).toBe(consecutivePassPrsFromTail());
  });

  it("PR 级连击不会超过读数级（每个 PR 至少一条读数）", () => {
    expect(consecutivePassPrsFromTail()).toBeLessThanOrEqual(consecutivePassFromTail());
  });

  it("PR 级只数「有生产读数」的 PR——只过预览的不算", () => {
    const previewOnly: QuotaReading[] = [
      { pr: 1, pool: "preview", outcome: "pass", at: "2026-10-13", note: "x" },
      { pr: 2, pool: "preview", outcome: "pass", at: "2026-10-13", note: "x" },
    ];
    // #256 与 #288–#290 的形态：预览过了、生产没上去 ⇒ 一个都不计入门槛。
    expect(consecutivePassPrsFromTail(previewOnly)).toBe(0);
    expect(consecutivePassFromTail(previewOnly)).toBe(2); // 读数级会误报 2 连
  });

  it("PR 的两条读数里混进 mixed 就断（mixed 不是 pass）", () => {
    const mixedAtTail: QuotaReading[] = [
      { pr: 1, pool: "preview", outcome: "pass", at: "2026-10-13", note: "x" },
      { pr: 1, pool: "production", outcome: "pass", at: "2026-10-13", note: "x" },
      { pr: 2, pool: "preview", outcome: "mixed", at: "2026-10-13", note: "x" },
      { pr: 2, pool: "production", outcome: "pass", at: "2026-10-13", note: "x" },
    ];
    // mixed 落在**最末**那个 PR ⇒ 从尾数第一个就断，连 1 都不给（#289/#290 正是这形状）。
    expect(consecutivePassPrsFromTail(mixedAtTail)).toBe(0);

    const mixedEarlier: QuotaReading[] = [
      { pr: 1, pool: "preview", outcome: "mixed", at: "2026-10-13", note: "x" },
      { pr: 1, pool: "production", outcome: "pass", at: "2026-10-13", note: "x" },
      { pr: 2, pool: "preview", outcome: "pass", at: "2026-10-13", note: "x" },
      { pr: 2, pool: "production", outcome: "pass", at: "2026-10-13", note: "x" },
    ];
    // mixed 在更早的 PR ⇒ 只数它之后攒下的 1 个。
    expect(consecutivePassPrsFromTail(mixedEarlier)).toBe(1);
  });

  it("文档里「最长连击只有 N」的 N = 台账算出的最长连击", () => {
    const claimed = Number(/最长连击只有\s*(\d+)/.exec(ROW!)?.[1]);
    expect(claimed, "文档里「最长连击只有 N」的措辞变了，对账失效").not.toBeNaN();
    expect(claimed).toBe(longestPassStreak());
  });

  it("文档里「尾部连击 N」的 N = 台账算出的尾部连击", () => {
    // **这条是补的，不是原有的**：第一版这里只断言 `ROW).toContain("尾部")`，
    // 而把 `consecutivePassFromTail` 中性化成 99 时**只有那条硬编码的
    // `toBe(0)` 会红**——文档里「尾部连击 0」那个数字仍然是人抄的。
    // 只查关键词不查数字，等于给那个数字发了通行证。
    const claimed = Number(/尾部连击\s*(\d+)/.exec(ROW!)?.[1]);
    expect(claimed, "文档里「尾部连击 N」的措辞变了，对账失效").not.toBeNaN();
    expect(claimed).toBe(consecutivePassFromTail());
  });

  it("尾部连击与最长连击是两个不同的数——用合成链验，不抄今天的数", () => {
    /**
     * ⚠️ **这条原先写的是 `expect(...).toBe(0)` / `toBe(2)`**——那是**对今天数据的快照**，
     * 不是不变量。追加第 7 条读数（#257 pass）时尾部就从 0 变成 1，
     * 用例红的原因不是逻辑坏了，而是**我把一个会变的数钉进了测试里**。
     * 本仓库为「文档里的数字」付过三次学费，这是**第四次、换了个地方**：
     * **测试里的快照数一样会漂移**，而且它漂移时只会带来一次「顺手改掉」的噪音，
     * 久而久之人就学会忽略它红了。
     *
     * ⇒ 改成**合成链**：形状由我构造，所以「尾部 ≠ 最长」是**结构性事实**，
     * 与台账今天有几条无关。真实台账的那两个数仍由上面两条正则对账用例盯住文档那一侧。
     */
    const chain = (outcomes: readonly QuotaOutcome[]): QuotaReading[] =>
      outcomes.map((outcome, index) => ({
        pr: 900 + index,
        pool: "preview" as const,
        outcome,
        at: "2026-10-13",
        note: `合成链第 ${index + 1} 条`,
      }));

    // pass 在前、fail 收尾：最长 2、尾部 0——**不相等**，正是最容易被混的那个形状
    const flapped = chain(["pass", "pass", "fail"]);
    expect(longestPassStreak(flapped)).toBe(2);
    expect(consecutivePassFromTail(flapped)).toBe(0);
    expect(consecutivePassFromTail(flapped)).not.toBe(longestPassStreak(flapped));

    // 反过来：全 pass 时两个数**恰好相等**——这就是为什么必须用合成链断言不等，
    // 而不是拿真实台账断言：真实台账哪天真的解除了，两个数会合法地相等。
    const allPass = chain(["pass", "pass"]);
    expect(consecutivePassFromTail(allPass)).toBe(longestPassStreak(allPass));

    // `mixed` 不算 pass：一 fail 一 pass 的那次观察恰恰是配额在挡路的形态
    expect(consecutivePassFromTail(chain(["pass", "mixed"]))).toBe(0);
    expect(longestPassStreak(chain(["pass", "mixed"]))).toBe(1);
  });
});

describe("跨度读数（判「解除」的第二半，2026-10-26 新增）", () => {
  const iso = (h: number) => new Date(Date.UTC(2026, 9, 25, h)).toISOString();

  it("算出的是尾部达标 PR 的**首尾时刻差**", () => {
    const readings: QuotaReading[] = [
      { pr: 1, pool: "preview", outcome: "pass", at: "2026-10-25", atIso: iso(0), note: "x" },
      { pr: 1, pool: "production", outcome: "pass", at: "2026-10-25", atIso: iso(0.5), note: "x" },
      { pr: 2, pool: "preview", outcome: "pass", at: "2026-10-25", atIso: iso(1), note: "x" },
      { pr: 2, pool: "production", outcome: "pass", at: "2026-10-25", atIso: iso(2), note: "x" },
    ];
    expect(liftStreakSpanHours(readings)).toBeCloseTo(2, 6); // 0 → 2 点
  });

  it("连击外的 fail 不参与跨度（跨度只量达标段）", () => {
    const readings: QuotaReading[] = [
      { pr: 1, pool: "preview", outcome: "fail", at: "2026-10-25", atIso: iso(0), note: "x" },
      { pr: 1, pool: "production", outcome: "fail", at: "2026-10-25", atIso: iso(30), note: "x" },
      { pr: 2, pool: "preview", outcome: "pass", at: "2026-10-25", atIso: iso(10), note: "x" },
      { pr: 2, pool: "production", outcome: "pass", at: "2026-10-25", atIso: iso(11), note: "x" },
    ];
    expect(consecutivePassPrsFromTail(readings)).toBe(1);
    expect(liftStreakSpanHours(readings)).toBeCloseTo(1, 6); // 不把 30 点那次 fail 算进来
  });

  it("缺任一条 atIso ⇒ 报未知(null)，不假装跨度是 0", () => {
    const readings: QuotaReading[] = [
      { pr: 1, pool: "preview", outcome: "pass", at: "2026-10-25", atIso: iso(0), note: "x" },
      { pr: 1, pool: "production", outcome: "pass", at: "2026-10-25", note: "x" }, // 缺时刻
    ];
    // 这条是本轮的关键：**「没数据」不能读成「跨度 0 ⇒ 不达标」**，
    // 也不能读成「已知达标」；null 就是 null。
    expect(liftStreakSpanHours(readings)).toBeNull();
    expect(consecutivePassPrsFromTail(readings)).toBe(1); // PR 级计数不受影响
  });

  it("台账本体：**当下这条连击**的跨度必须是可读数（不能是未知）", () => {
    // 门槛是「连击要跨过 24h 窗口」。它立着却没有读数方式，就是本仓库反复治的那族错
    // ——所以这里钉的是**判当下用的那条连击**，不是历史上所有全过的 PR：
    // 10-13 那批按设计没有 atIso（字段是后加的），要求它们补时刻是这条测试最初的口径错误，
    // 已收窄。**缺时刻的老条目不参与跨度，但不得让当下连击变成未知。**
    expect(liftStreakSpanHours()).not.toBeNull();
    expect(consecutivePassPrsFromTail()).toBeGreaterThan(0);
  });
});

describe("空窗读数（跨度够 ≠ 覆盖够，2026-10-30 新增）", () => {
  const iso = (d: number, h: number) => new Date(Date.UTC(2026, 9, d, 0, Math.round(h * 60))).toISOString();
  const mk = (pr: number, pool: "preview" | "production", d: number, h: number): QuotaReading => ({
    pr, pool, outcome: "pass", at: "2026-10-30", atIso: iso(d, h), note: "x",
  });

  it("两次观测相隔很远 ⇒ 空隙就是那段没尝试的时间", () => {
    const readings: QuotaReading[] = [
      mk(1, "preview", 25, 0), mk(1, "production", 25, 0),
      mk(2, "preview", 30, 0), mk(2, "production", 30, 0),
    ];
    expect(liftStreakSpanHours(readings)).toBeCloseTo(120, 6);
    expect(tailStreakMaxGapHours(readings)).toBeCloseTo(120, 6);
  });

  it("正常节奏（每次相隔几小时）⇒ 空隙很小，跨度才真的覆盖了时间", () => {
    const readings: QuotaReading[] = [
      mk(1, "preview", 25, 0), mk(1, "production", 25, 0.5),
      mk(2, "preview", 26, 0), mk(2, "production", 26, 0.5),
    ];
    expect(liftStreakSpanHours(readings)).toBeCloseTo(24.5, 6);
    expect(tailStreakMaxGapHours(readings)).toBeCloseTo(23.5, 6);
  });

  it("只有一次观测或缺时刻 ⇒ 未知(null)，不假装空隙是 0", () => {
    expect(tailStreakMaxGapHours([mk(1, "preview", 25, 0), mk(1, "production", 25, 0)])).toBeNull();
    const missing: QuotaReading[] = [
      mk(1, "preview", 25, 0), mk(1, "production", 25, 0),
      { pr: 2, pool: "preview", outcome: "pass", at: "2026-10-30", note: "x" },
      { pr: 2, pool: "production", outcome: "pass", at: "2026-10-30", note: "x" },
    ];
    expect(tailStreakMaxGapHours(missing)).toBeNull();
  });

  it("台账本体：跨度 ≥ 最大空隙（结构不变量）", () => {
    const span = liftStreakSpanHours();
    const gap = tailStreakMaxGapHours();
    expect(span).not.toBeNull();
    expect(gap).not.toBeNull();
    expect(span!).toBeGreaterThanOrEqual(gap! - 1e-9);
  });

  it("文档必须指向两个函数（跨度与空隙都要现读，不写死）", () => {
    // 表格单元格跨多行（首行之外的解释在续行），所以扫整份文档而不是只看 ROW。
    const text = readFileSync(DOC, "utf8");
    expect(text).toContain("liftStreakSpanHours()");
    expect(text).toContain("tailStreakMaxGapHours()");
  });
});
