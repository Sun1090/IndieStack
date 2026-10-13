import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_LAG_MINUTES,
  auditDeploymentLedger,
  deployExitCode,
  diagnoseNeverDeployed,
  toObservations,
  type DeployObservation,
  type RawDeployment,
  type RawPull,
} from "./deployment-ledger";

const NOW = "2026-10-13T13:00:00Z";

function observation(overrides: Partial<DeployObservation> & { pr: number }): DeployObservation {
  return {
    sha: `sha${overrides.pr}`,
    mergedAt: "2026-10-13T12:00:00Z",
    deployedAt: "2026-10-13T12:02:00Z",
    coveredByPr: null,
    ...overrides,
  };
}

describe("auditDeploymentLedger() 的三态", () => {
  it("全部有部署记录 ⇒ CONSISTENT 且通过", () => {
    const audit = auditDeploymentLedger(
      [observation({ pr: 1 }), observation({ pr: 2 })],
      NOW,
    );
    expect(audit.code).toBe("CONSISTENT");
    expect(audit.passed).toBe(true);
    expect(audit.neverDeployed).toHaveLength(0);
  });

  it("无记录**但被后续部署覆盖** ⇒ 不算故障（这条是判据的核心）", () => {
    // 2026-10-13 实测：226 个已合并 PR 里 111 个无生产记录，
    // 其中绝大多数是被 Vercel 的合并部署跳过的。**把它们判红会让这条检查天天误报**。
    const audit = auditDeploymentLedger(
      [
        observation({ pr: 251, deployedAt: null, coveredByPr: 255 }),
        observation({ pr: 252, deployedAt: null, coveredByPr: 255 }),
        observation({ pr: 255 }),
      ],
      NOW,
    );
    expect(audit.code).toBe("CONSISTENT");
    expect(audit.skippedCount).toBe(2);
    expect(audit.neverDeployed).toHaveLength(0);
  });

  it("无记录**且无后续部署包含它**、超阈值 ⇒ NEVER_DEPLOYED 且不通过", () => {
    // 本轮实测到的真实形态：#257 合并于 09:00:58Z，13:00 仍无记录，且它是 main HEAD
    const audit = auditDeploymentLedger(
      [observation({ pr: 257, mergedAt: "2026-10-13T09:00:58Z", deployedAt: null })],
      NOW,
    );
    expect(audit.code).toBe("NEVER_DEPLOYED");
    expect(audit.passed).toBe(false);
    expect(audit.neverDeployed.map((item) => item.pr)).toEqual([257]);
    expect(audit.message).toContain("从未上线");
  });

  it("同样无记录，但在窗口内 ⇒ PENDING 且通过（**部署排队不该判红**）", () => {
    const audit = auditDeploymentLedger(
      [observation({ pr: 258, mergedAt: "2026-10-13T12:30:00Z", deployedAt: null })],
      NOW,
    );
    expect(audit.code).toBe("PENDING");
    expect(audit.passed).toBe(true);
    expect(audit.pending.map((item) => item.pr)).toEqual([258]);
  });

  it("一条观察都没有 ⇒ NO_OBSERVATIONS 且**不通过**（未知不算通过）", () => {
    const audit = auditDeploymentLedger([], NOW);
    expect(audit.code).toBe("NO_OBSERVATIONS");
    expect(audit.passed).toBe(false);
    expect(audit.message).toContain("不该被印成绿色");
  });

  it("有观察但**零条部署记录** ⇒ NO_DEPLOYMENT_RECORDS（不判「全部从未上线」）", () => {
    // 实测到的形态：环境名写错时 API 回 200 + 空数组。
    // 没有这条判据的话，本工具会把 226 个提交全报成「从未上线」——
    // 一个自信而完全错误的结论，比「不知道」危险得多。
    const rows = [observation({ pr: 257, deployedAt: null })];
    const audit = auditDeploymentLedger(rows, NOW, undefined, 0);
    expect(audit.code).toBe("NO_DEPLOYMENT_RECORDS");
    expect(audit.passed).toBe(false);
    // **关键**：它不得把观察塞进 neverDeployed——否则报告仍会逐条点名「从未上线」
    expect(audit.neverDeployed).toHaveLength(0);
    expect(audit.message).toContain("按未知处理");
  });

  it("部署记录条数**没传**时不触发该判据（默认按「有记录」处理）", () => {
    // 这条盯的是那个默认值：如果默认成 0，上面所有纯观察的用例都会变成未知。
    const audit = auditDeploymentLedger([observation({ pr: 1 })], NOW);
    expect(audit.code).toBe("CONSISTENT");
  });

  it("退出码分三档：0 通过 / 1 判出故障 / 2 读不出（**未知不与失败同码**）", () => {
    // 把 1 和 2 压成一个码，会让「环境名写错」看起来像「生产真的坏了」——
    // 而这两种情况的处理人和处理方向完全不同。
    expect(deployExitCode(auditDeploymentLedger([observation({ pr: 1 })], NOW))).toBe(0);
    // ⚠️ 第一版这里漏写 `mergedAt`，用的是 fixture 默认的「1 小时前」——
    // 没超过 90 分钟窗口，于是进了 PENDING 而判 0。**用例自己算错了窗口**。
    expect(
      deployExitCode(
        auditDeploymentLedger(
          [observation({ pr: 2, mergedAt: "2026-10-13T06:00:00Z", deployedAt: null })],
          NOW,
          undefined,
          5,
        ),
      ),
    ).toBe(1);
    expect(deployExitCode(auditDeploymentLedger([], NOW))).toBe(2);
    expect(
      deployExitCode(auditDeploymentLedger([observation({ pr: 3 })], NOW, undefined, 0)),
    ).toBe(2);
  });
});

describe("toObservations()：API 字段映射", () => {
  /**
   * 这些用例盯的是**会读错而不报错**的那类事实：字段在哪一层、
   * 同一 sha 多条记录取哪条、什么算「后续」。
   * 出处见 `src/lib/ops/deployment-ledger.ts` 里 `toObservations` 的注释
   * （CodeQL 那次就是在 IO 层写了一份没有测试的映射）。
   */
  const pull = (
    number: number,
    sha: string,
    mergedAt: string,
    baseRef = "main",
  ): RawPull => ({ number, merge_commit_sha: sha, merged_at: mergedAt, base: { ref: baseRef } });
  const deployment = (sha: string, createdAt: string): RawDeployment => ({ sha, created_at: createdAt });

  it("有部署记录的 ⇒ `deployedAt` 取到时间；没有的 ⇒ null", () => {
    const rows = toObservations(
      [deployment("aaa", "2026-10-13T07:00:11Z")],
      [pull(255, "aaa", "2026-10-13T06:59:07Z"), pull(256, "bbb", "2026-10-13T07:49:50Z")],
    );
    expect(rows.map((row) => [row.pr, row.deployedAt])).toEqual([
      [255, "2026-10-13T07:00:11Z"],
      [256, null],
    ]);
  });

  it("同一 sha 多条记录 ⇒ 取**最早**那条（第一次上线）", () => {
    const rows = toObservations(
      [deployment("aaa", "2026-10-13T09:00:00Z"), deployment("aaa", "2026-10-13T07:00:11Z")],
      [pull(255, "aaa", "2026-10-13T06:59:07Z")],
    );
    expect(rows[0].deployedAt).toBe("2026-10-13T07:00:11Z");
  });

  it("base 不是 main 的 PR 不参与（否则会把未上线的分支提交算成故障）", () => {
    const rows = toObservations(
      [deployment("aaa", "2026-10-13T07:00:11Z")],
      [pull(255, "aaa", "2026-10-13T06:59:07Z"), pull(999, "zzz", "2026-10-13T08:00:00Z", "feat/x")],
    );
    expect(rows.map((row) => row.pr)).toEqual([255]);
  });

  it("未 merged 的 PR（无 `merged_at`）不参与", () => {
    const rows = toObservations(
      [],
      [{ number: 300, base: { ref: "main" } } as RawPull, pull(255, "aaa", "2026-10-13T06:59:07Z")],
    );
    expect(rows.map((row) => row.pr)).toEqual([255]);
  });

  it("无记录但**有**更晚且已上线的提交 ⇒ `coveredByPr` 指向那个 PR", () => {
    // 本轮实测到的正常形态：#251–#254 都没单独上线，被 #255 的部署带走了
    const rows = toObservations(
      [deployment("e5", "2026-10-13T07:00:11Z")],
      [
        pull(251, "b1", "2026-10-13T03:41:57Z"),
        pull(252, "b2", "2026-10-13T04:08:00Z"),
        pull(255, "e5", "2026-10-13T06:59:07Z"),
      ],
    );
    expect(rows[0].coveredByPr).toBe(255);
    expect(rows[1].coveredByPr).toBe(255);
    expect(rows[2].coveredByPr).toBeNull();
  });

  it("`coveredByPr` 取**最近**的那个后续部署，不是最晚的", () => {
    const rows = toObservations(
      [deployment("e5", "2026-10-13T07:00:11Z"), deployment("f6", "2026-10-13T09:00:00Z")],
      [
        pull(250, "a0", "2026-10-13T02:00:00Z"),
        pull(255, "e5", "2026-10-13T06:59:07Z"),
        pull(258, "f6", "2026-10-13T08:50:00Z"),
      ],
    );
    expect(rows[0].coveredByPr).toBe(255);
  });

  it("乱序输入也能正确配对（内部按合并时间排序）", () => {
    const rows = toObservations(
      [deployment("e5", "2026-10-13T07:00:11Z")],
      [
        pull(255, "e5", "2026-10-13T06:59:07Z"),
        pull(251, "b1", "2026-10-13T03:41:57Z"),
        pull(252, "b2", "2026-10-13T04:08:00Z"),
      ],
    );
    expect(rows.map((row) => row.pr)).toEqual([251, 252, 255]);
    expect(rows[0].coveredByPr).toBe(255);
  });

  it("缺字段的脏响应被跳过而**不会**造出假观察", () => {
    const rows = toObservations(
      [{ sha: "aaa" } as RawDeployment, { created_at: "x" } as RawDeployment, deployment("aaa", "t")],
      [
        { number: 1, base: { ref: "main" } } as RawPull, // 没有 merge_commit_sha
        { number: 2, merge_commit_sha: "aaa", merged_at: "t", base: {} } as RawPull, // 没有 base.ref
        pull(255, "aaa", "2026-10-13T06:59:07Z"),
      ],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].pr).toBe(255);
  });

  it("端到端：本轮实测到的形态（#256 / #257 从未上线）判 NEVER_DEPLOYED", () => {
    const rows = toObservations(
      [deployment("a5b38466", "2026-10-13T07:00:11Z"), deployment("b2ffab71", "2026-10-13T00:39:20Z")],
      [
        pull(250, "b2ffab71", "2026-10-13T00:37:58Z"),
        pull(251, "b584b2ce", "2026-10-13T03:41:57Z"),
        pull(255, "a5b38466", "2026-10-13T06:59:07Z"),
        pull(256, "16c23e15", "2026-10-13T07:49:50Z"),
        pull(257, "75b011ba", "2026-10-13T09:00:58Z"),
      ],
    );
    const audit = auditDeploymentLedger(rows, "2026-10-13T13:00:00Z");
    expect(audit.code).toBe("NEVER_DEPLOYED");
    expect(audit.neverDeployed.map((row) => row.pr)).toEqual([256, 257]);
    // #251 被 #255 的部署带走 ⇒ 正常跳过，不算故障
    expect(audit.skippedCount).toBe(1);
  });
});

describe("阈值与 lag 计算", () => {
  it("阈值 90 分钟：历史最大 lag 57.2min 判正常，本轮实测的 4 小时停滞判红", () => {
    // 这两个数都来自 2026-10-13 的实测样本（73 个可配对，中位 1.5min、最大 57.2min）
    expect(DEFAULT_MAX_LAG_MINUTES).toBe(90);
    const historic = auditDeploymentLedger(
      [observation({ pr: 238, mergedAt: "2026-10-13T11:00:00Z", deployedAt: "2026-10-13T11:57:12Z" })],
      NOW,
    );
    expect(historic.slow).toHaveLength(0);
    expect(historic.code).toBe("CONSISTENT");

    const stalled = auditDeploymentLedger(
      [observation({ pr: 257, mergedAt: "2026-10-13T09:00:00Z", deployedAt: null })],
      NOW,
    );
    expect(stalled.code).toBe("NEVER_DEPLOYED");
  });

  it("`lagMinutes` 对已部署的用「部署时间」，对未部署的用「当前时间」", () => {
    const audit = auditDeploymentLedger(
      [
        observation({ pr: 1, mergedAt: "2026-10-13T10:00:00Z", deployedAt: "2026-10-13T10:30:00Z" }),
        observation({ pr: 2, mergedAt: "2026-10-13T10:00:00Z", deployedAt: null }),
      ],
      NOW,
    );
    // ⚠️ 第一版这里写的是 `audit.pending[0]`——**是我对分档的假设错了**：
    // 无记录且已超 90 分钟窗口的观察进的是 `neverDeployed`，不是 `pending`。
    // （这条用例红得有价值：它说明「超窗口的无记录」和「窗口内的无记录」
    // 是两个不同的桶，而读代码的人很容易把它们混成一个。）
    expect(audit.neverDeployed).toHaveLength(1);
    expect(audit.lagMinutes(audit.neverDeployed[0])).toBe(180);
    const deployed = observation({
      pr: 1,
      mergedAt: "2026-10-13T10:00:00Z",
      deployedAt: "2026-10-13T10:30:00Z",
    });
    expect(audit.lagMinutes(deployed)).toBe(30);
  });

  it("时间读不出 ⇒ 不判红，落进 PENDING（**坏数据不该被读成故障**）", () => {
    const audit = auditDeploymentLedger(
      [observation({ pr: 9, mergedAt: "不是时间", deployedAt: null })],
      NOW,
    );
    expect(audit.code).toBe("PENDING");
    expect(audit.passed).toBe(true);
    expect(audit.lagMinutes(audit.pending[0])).toBeNull();
  });

  it("已部署但 lag 超阈值 ⇒ 记进 `slow` 但**不判红**（部署最终发生了）", () => {
    const audit = auditDeploymentLedger(
      [observation({ pr: 40, mergedAt: "2026-10-13T06:00:00Z", deployedAt: "2026-10-13T11:00:00Z" })],
      NOW,
    );
    expect(audit.slow.map((item) => item.pr)).toEqual([40]);
    expect(audit.passed).toBe(true);
    expect(audit.code).toBe("CONSISTENT");
  });
});


describe("diagnoseNeverDeployed()：跨环境对比", () => {
  const MAIN = "Production – indie-stack";
  const DOCS = "Production – indie-stack-docs-site";
  const dep = (sha: string, environment: string, created: string) => ({ sha, environment, created_at: created });

  it("同一 sha 在**别的环境**上线了 ⇒ projectSpecific（不是配额）", () => {
    // 本轮实测到的形态：#256 / #257 主应用零记录，docs-site 都在 30 秒内上线
    const rows = [observation({ pr: 257, sha: "75b011ba", deployedAt: null })];
    const [item] = diagnoseNeverDeployed(
      rows,
      [dep("75b011ba", DOCS, "2026-10-13T09:01:33Z")],
      MAIN,
    );
    expect(item.projectSpecific).toBe(true);
    expect(item.otherEnvironments[DOCS]).toBe("2026-10-13T09:01:33Z");
  });

  it("同一 sha 在**任何**环境都没记录 ⇒ 不是 projectSpecific（该先看配额）", () => {
    const rows = [observation({ pr: 260, sha: "deadbeef", deployedAt: null })];
    const [item] = diagnoseNeverDeployed(rows, [dep("cafe1234", DOCS, "2026-10-13T09:01:33Z")], MAIN);
    expect(item.projectSpecific).toBe(false);
    expect(item.otherEnvironments).toEqual({});
  });

  it("目标环境自己的记录**不算**对比（否则永远判不出 projectSpecific）", () => {
    const rows = [observation({ pr: 257, sha: "75b011ba", deployedAt: null })];
    const [item] = diagnoseNeverDeployed(rows, [dep("75b011ba", MAIN, "2026-10-13T09:01:33Z")], MAIN);
    expect(item.projectSpecific).toBe(false);
  });

  it("同 sha 同环境多条 ⇒ 取最早那条（与 `toObservations` 同一口径）", () => {
    const rows = [observation({ pr: 257, sha: "75b011ba", deployedAt: null })];
    const [item] = diagnoseNeverDeployed(
      rows,
      [dep("75b011ba", DOCS, "2026-10-13T09:30:00Z"), dep("75b011ba", DOCS, "2026-10-13T09:01:33Z")],
      MAIN,
    );
    expect(item.otherEnvironments[DOCS]).toBe("2026-10-13T09:01:33Z");
  });

  it("缺字段的脏响应被跳过而不造出假对比", () => {
    const rows = [observation({ pr: 257, sha: "75b011ba", deployedAt: null })];
    const [item] = diagnoseNeverDeployed(
      rows,
      [
        { sha: "75b011ba", created_at: "t" } as never, // 没有 environment
        { environment: DOCS, created_at: "t" } as never, // 没有 sha
        dep("75b011ba", DOCS, "2026-10-13T09:01:33Z"),
      ],
      MAIN,
    );
    expect(Object.keys(item.otherEnvironments)).toEqual([DOCS]);
  });

  it("多条 neverDeployed 各自配对，不互相串", () => {
    const rows = [
      observation({ pr: 256, sha: "16c23e15", deployedAt: null }),
      observation({ pr: 257, sha: "75b011ba", deployedAt: null }),
    ];
    const items = diagnoseNeverDeployed(
      rows,
      [
        dep("16c23e15", DOCS, "2026-10-13T07:50:18Z"),
        dep("75b011ba", DOCS, "2026-10-13T09:01:33Z"),
      ],
      MAIN,
    );
    expect(items.map((item) => [item.pr, item.projectSpecific])).toEqual([
      [256, true],
      [257, true],
    ]);
  });
});