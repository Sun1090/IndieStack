/**
 * 「生产落后 main 多少个提交」的单测。
 *
 * **这个判定最容易做错的地方是阈值语义**，所以三态都钉住：
 * 「落后但在阈值内」必须**判通过**——部署滞后是常态，
 * 断言相等会让任务每天在正常时段红几次，而**天天误报的检查等于没有检查**。
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_BEHIND, evaluateFreshness } from "../../../scripts/lib/deploy-freshness.js";

const DEPLOYED = "08dd6f17d2c754db688b516934dcfdfeadaf9b8a";
const MAIN = "30f8e8964834be9254610f31e3daba111e553d7d";

describe("evaluateFreshness", () => {
  it("生产就是 main 时判 fresh 且通过", () => {
    const verdict = evaluateFreshness({ deployedCommit: MAIN, mainSha: MAIN, commitsBehind: 0 });
    expect(verdict.status).toBe("fresh");
    expect(verdict.passed).toBe(true);
    expect(verdict.message).toContain(MAIN.slice(0, 8));
  });

  it("落后 4 个提交（在阈值内）判通过，但必须记下距离", () => {
    // 这是 2026-10-05 实测到的真实状态：Vercel 配额限流导致生产落后 4 个提交。
    const verdict = evaluateFreshness({ deployedCommit: DEPLOYED, mainSha: MAIN, commitsBehind: 4 });
    expect(verdict.status).toBe("lagging");
    expect(verdict.passed).toBe(true);
    expect(verdict.commitsBehind).toBe(4);
    // 消息里必须同时出现两个短 SHA，否则读日志的人不知道「谁落后于谁」
    expect(verdict.message).toContain(DEPLOYED.slice(0, 8));
    expect(verdict.message).toContain(MAIN.slice(0, 8));
    expect(verdict.message).toContain("落后 main 4 个提交");
  });

  it("超过阈值判 stale 且不通过，并指向最可能的原因", () => {
    const verdict = evaluateFreshness({
      deployedCommit: DEPLOYED,
      mainSha: MAIN,
      commitsBehind: DEFAULT_MAX_BEHIND + 1,
    });
    expect(verdict.status).toBe("stale");
    expect(verdict.passed).toBe(false);
    expect(verdict.message).toContain("Deployment rate limited");
  });

  it("阈值本身可覆盖（不同项目对滞后的容忍度不同）", () => {
    const inputs = { deployedCommit: DEPLOYED, mainSha: MAIN, commitsBehind: 8 };
    expect(evaluateFreshness({ ...inputs, maxBehind: 10 }).passed).toBe(true);
    expect(evaluateFreshness({ ...inputs, maxBehind: 2 }).passed).toBe(false);
  });

  it("算不出落后数时判 unknown 且**不通过**——未知不等于通过", () => {
    for (const commitsBehind of [null, undefined]) {
      const verdict = evaluateFreshness({ deployedCommit: DEPLOYED, mainSha: MAIN, commitsBehind });
      expect(verdict.status).toBe("unknown");
      expect(verdict.passed).toBe(false);
      expect(verdict.message).toContain("不等于通过");
    }
  });

  it("落后的提交数不合法时不通过，且不把它当成 0（否则等于静默判 fresh）", () => {
    for (const commitsBehind of [-1, Number.NaN]) {
      const verdict = evaluateFreshness({ deployedCommit: DEPLOYED, mainSha: MAIN, commitsBehind });
      expect(verdict.status).toBe("unknown");
      expect(verdict.passed).toBe(false);
    }
  });

  it("生产没上报 commit 时**不能**报 fresh，即使调用方说距离是 0", () => {
    // 这是第一版的真 bug：commit 读不出来、距离又恰好传 0 时，会印出
    // 「生产跑的就是 main（unknown）」——一句没有依据、且最容易让人放心的话。
    for (const deployedCommit of [null, undefined, "", "   "]) {
      const verdict = evaluateFreshness({ deployedCommit, mainSha: MAIN, commitsBehind: 0 });
      expect(verdict.status).toBe("unknown");
      expect(verdict.passed).toBe(false);
      expect(verdict.message).not.toContain("undefined");
      expect(verdict.message).toContain("没有上报 commit");
    }
  });
});
