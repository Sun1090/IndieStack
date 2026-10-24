import { describe, expect, it } from "vitest";
import {
  exitCodeForEquivalence,
  judgeAuthDeletionEquivalence,
  type DeletionProbeResult,
} from "./auth-deletion-equivalence";

function probe(partial: Partial<DeletionProbeResult> & { gotrueVersion?: string }): DeletionProbeResult {
  return {
    residue: { sessions: "0", refresh_tokens: "0", identities: "0" },
    refreshStatus: 400,
    accessStatus: 403,
    gotrueVersion: "v2.195.0",
    ...partial,
  };
}

describe("judgeAuthDeletionEquivalence", () => {
  it("读数齐全且行为相同、版本一致 ⇒ EQUIVALENT", () => {
    const report = judgeAuthDeletionEquivalence(probe({}), probe({}), "v2.195.0");
    expect(report.verdict).toBe("EQUIVALENT");
    expect(report.differences).toEqual([]);
  });

  it("任一侧没跑成 ⇒ UNVERIFIABLE，**不压成「等价」**", () => {
    expect(judgeAuthDeletionEquivalence(null, probe({}), "v2.195.0").verdict).toBe("UNVERIFIABLE");
    expect(judgeAuthDeletionEquivalence(probe({}), null, "v2.195.0").verdict).toBe("UNVERIFIABLE");
  });

  it("残留有一项不同 ⇒ DIFFERS 并点名差异项", () => {
    const report = judgeAuthDeletionEquivalence(
      probe({ residue: { sessions: "3", refresh_tokens: "0" } }),
      probe({ residue: { sessions: "0", refresh_tokens: "0" } }),
      "v2.195.0",
    );
    expect(report.verdict).toBe("DIFFERS");
    expect(report.differences.join()).toContain("sessions");
  });

  it("旧凭据可用性不同 ⇒ DIFFERS（等价替代漏清会话的形态就在这）", () => {
    const report = judgeAuthDeletionEquivalence(
      probe({ refreshStatus: 200 }),
      probe({ refreshStatus: 400 }),
      "v2.195.0",
    );
    expect(report.verdict).toBe("DIFFERS");
    expect(report.differences.join()).toContain("refresh_token");
  });

  it("生产版本不同版 ⇒ EQUIVALENT_LOCAL_ONLY，不冒充「生产也这样」", () => {
    const report = judgeAuthDeletionEquivalence(probe({}), probe({}), "v2.197.0");
    expect(report.verdict).toBe("EQUIVALENT_LOCAL_ONLY");
    expect(report.evidence).toContain("不同版");
  });

  it("没给生产版本读数 ⇒ 同样降级为只在本地成立", () => {
    expect(judgeAuthDeletionEquivalence(probe({}), probe({})).verdict).toBe("EQUIVALENT_LOCAL_ONLY");
  });

  it("两个变体打到的本地版本不一致 ⇒ UNVERIFIABLE（同轮必须同版）", () => {
    const report = judgeAuthDeletionEquivalence(probe({}), probe({ gotrueVersion: "v2.194.0" }), "v2.195.0");
    expect(report.verdict).toBe("UNVERIFIABLE");
  });

  it("残留键集合不同也算差异（一边少一张表不能被读成「相同」）", () => {
    const report = judgeAuthDeletionEquivalence(
      probe({ residue: { sessions: "0" } }),
      probe({ residue: { sessions: "0", identities: "0" } }),
      "v2.195.0",
    );
    expect(report.verdict).toBe("DIFFERS");
    expect(report.differences.join()).toContain("identities");
  });
});

describe("exitCodeForEquivalence", () => {
  it("等价（含只在本地成立）= 0；有差异 = 1；读不到 = 2", () => {
    expect(exitCodeForEquivalence("EQUIVALENT")).toBe(0);
    expect(exitCodeForEquivalence("EQUIVALENT_LOCAL_ONLY")).toBe(0);
    expect(exitCodeForEquivalence("DIFFERS")).toBe(1);
    expect(exitCodeForEquivalence("UNVERIFIABLE")).toBe(2);
  });
});
