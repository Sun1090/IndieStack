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

  it("表头那句「今天有 N 个读数」= 台账条数", () => {
    const claimed = Number(/今天有\s*(\d+)\s*个读数/.exec(ROW!)?.[1]);
    expect(claimed, "表头那句「今天有 N 个读数」的格式变了，对账失效").not.toBeNaN();
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
