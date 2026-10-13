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

  it("尾部连击与最长连击是两个不同的数，不能互相顶替", () => {
    // 今天：尾部 0（最近一次是 #256 fail）、最长 2（#255 那两条 pass）
    expect(consecutivePassFromTail()).toBe(0);
    expect(longestPassStreak()).toBe(2);
    // **两者不相等本身就是这条用例存在的理由**：
    // 如果哪天它们相等，用其中一个数冒充另一个就会静默通过。
    expect(consecutivePassFromTail()).not.toBe(longestPassStreak());
  });
});
