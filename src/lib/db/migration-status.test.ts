import { describe, expect, it } from "vitest";
import {
  filterToExpectedVersions,
  inspectMigrationStatus,
  normalizeMigrationVersion,
  parseAppliedMigrations,
  parseManifestEntries,
  parseManifestVersions,
  planVersionShapeFix,
  type AppliedMigration,
} from "./migration-status";

function applied(...versions: string[]): AppliedMigration[] {
  return versions.map((version) => ({ raw: version, version: normalizeMigrationVersion(version) }));
}

describe("normalizeMigrationVersion", () => {
  it("剥掉序号的前导零", () => {
    expect(normalizeMigrationVersion("001")).toBe("1");
    expect(normalizeMigrationVersion("034")).toBe("34");
  });

  it("取时间戳形态的前导数字段", () => {
    expect(normalizeMigrationVersion("20240101120000_add_x")).toBe("20240101120000");
  });

  it("没有前导数字时返回 null，而不是猜一个键", () => {
    expect(normalizeMigrationVersion("initial")).toBeNull();
    expect(normalizeMigrationVersion("")).toBeNull();
    expect(normalizeMigrationVersion("v2")).toBeNull();
  });
});

describe("parseAppliedMigrations", () => {
  it("认 `[{version, name?}]` 这一种形状", () => {
    const parsed = parseAppliedMigrations([
      { version: "001", name: "initial" },
      { version: "002" },
    ]);
    expect(parsed).toEqual([
      { raw: "001", version: "1", name: "initial" },
      { raw: "002", version: "2" },
    ]);
  });

  it("空数组是合法的「一条都没应用」，不是 null", () => {
    expect(parseAppliedMigrations([])).toEqual([]);
  });

  it("形状不认识时返回 null（= 读不到），绝不返回空数组冒充「线上是空的」", () => {
    expect(parseAppliedMigrations({ applied: ["001"] })).toBeNull();
    expect(parseAppliedMigrations(null)).toBeNull();
    expect(parseAppliedMigrations("001")).toBeNull();
    expect(parseAppliedMigrations([{ name: "no version" }])).toBeNull();
    expect(parseAppliedMigrations([{ version: 34 }])).toBeNull();
    expect(parseAppliedMigrations([null])).toBeNull();
  });
});

describe("parseManifestVersions", () => {
  it("读出登记的版本号", () => {
    expect(parseManifestVersions(JSON.stringify({ migrations: [{ version: "001" }] }))).toEqual(["001"]);
  });

  it("坏 JSON / 缺字段 / 类型不对都返回 null，不返回空数组", () => {
    expect(parseManifestVersions("{ not json")).toBeNull();
    expect(parseManifestVersions("{}")).toBeNull();
    expect(parseManifestVersions('{"migrations":[]}')).toEqual([]);
    expect(parseManifestVersions('{"migrations":[{"fileName":"x"}]}')).toBeNull();
    expect(parseManifestVersions('{"migrations":[null]}')).toBeNull();
  });
});

describe("inspectMigrationStatus", () => {
  it("读不到云端 ⇒ 只报未知，不产出任何 pending 结论", () => {
    const report = inspectMigrationStatus(["001", "002"], null);
    expect(report.issues.map((issue) => issue.code)).toEqual(["MIGRATION_LIVE_UNREADABLE"]);
    expect(report.pendingVersions).toEqual([]);
    expect(report.stats.declared).toBe(2);
  });

  it("读不到 manifest ⇒ 报基准缺失，而不是「0 条迁移」", () => {
    const report = inspectMigrationStatus(null, applied("001"));
    expect(report.issues.map((issue) => issue.code)).toEqual(["MIGRATION_MANIFEST_UNREADABLE"]);
  });

  it("两边一致 ⇒ 无 issue，并报告最高已应用版本", () => {
    const report = inspectMigrationStatus(["001", "002"], applied("001", "002"));
    expect(report.issues).toEqual([]);
    expect(report.stats.highestApplied).toBe("002");
  });

  it("比较是数值意义而非字符串意义：001 与 1 算同一条", () => {
    const report = inspectMigrationStatus(["001", "010"], [{ raw: "1", version: "1" }, { raw: "10", version: "10" }]);
    expect(report.issues).toEqual([]);
  });

  it("报出未应用的版本号，并保留原始形状", () => {
    // 033 只出现在云端、不在 manifest 里，所以它同时是「本地不认识」——两个方向的差集都要报。
    const report = inspectMigrationStatus(["001", "034", "035"], applied("001", "033"));
    expect(report.pendingVersions).toEqual(["034", "035"]);
    expect(report.issues.map((issue) => issue.code)).toEqual([
      "MIGRATION_NOT_APPLIED",
      "MIGRATION_NOT_APPLIED",
      "MIGRATION_UNKNOWN_TO_REPO",
    ]);
    expect(report.issues[0].message).toContain("034");
  });

  it("云端有、本地没有也报：那说明有人在别处推过或本地少了文件", () => {
    const report = inspectMigrationStatus(["001"], applied("001", "099"));
    expect(report.unknownToRepo).toEqual(["099"]);
    expect(report.issues.map((issue) => issue.code)).toEqual(["MIGRATION_UNKNOWN_TO_REPO"]);
  });

  it("两边都空 ⇒ 判「此刻不构成证据」，而不是绿", () => {
    const report = inspectMigrationStatus([], []);
    expect(report.issues.map((issue) => issue.code)).toEqual(["MIGRATION_LIVE_EMPTY"]);
  });

  it("云端为空但本地有登记 ⇒ 照常报未应用，不被形状不一致分支吞掉", () => {
    const report = inspectMigrationStatus(["001", "002"], applied());
    expect(report.pendingVersions).toEqual(["001", "002"]);
  });

  it("两边版本号完全不相交 ⇒ 先怀疑不可比，绝不产出 68 条差集结论", () => {
    // 2026-10-13 用本地 mock 实测到的形态：云端 14 位时间戳、本地 3 位序号。
    const report = inspectMigrationStatus(
      ["001", "002"],
      applied("20240101120000_a", "20240102120000_b"),
    );
    expect(report.issues.map((issue) => issue.code)).toEqual(["MIGRATION_VERSION_SHAPE_MISMATCH"]);
    expect(report.pendingVersions).toEqual([]);
    expect(report.unknownToRepo).toEqual([]);
  });

  it("归一化不了的版本号不会被凭空判成未应用", () => {
    const report = inspectMigrationStatus(["001", "weird"], applied("001"));
    expect(report.pendingVersions).toEqual([]);
  });
});

describe("点名单断言（--expect-applied）", () => {
  const pending = inspectMigrationStatus(["001", "033", "034"], applied("001"));

  it("只保留点名的未应用项，别人正在做的迁移不会把 CI 天天弄红", () => {
    const report = filterToExpectedVersions(pending, ["001", "033", "034"], ["034"]);
    expect(report.pendingVersions).toEqual(["034"]);
    expect(report.issues.filter((issue) => issue.code === "MIGRATION_NOT_APPLIED")).toHaveLength(1);
  });

  it("点名的版本号在 manifest 里不存在 ⇒ 判「无法求值」，不算通过", () => {
    const report = filterToExpectedVersions(pending, ["001", "033", "034"], ["099"]);
    expect(report.issues.map((issue) => issue.code)).toEqual(["MIGRATION_EXPECTED_NOT_IN_REPO"]);
  });

  it("点名的版本号已应用 ⇒ 无 issue", () => {
    const ok = inspectMigrationStatus(["001", "034"], applied("001", "034"));
    expect(filterToExpectedVersions(ok, ["001", "034"], ["034"]).issues).toEqual([]);
  });

  it("收窄不隐藏「云端多出来」与「形状不一致」：那两类与点名无关", () => {
    const extra = inspectMigrationStatus(["001"], applied("001", "099"));
    expect(filterToExpectedVersions(extra, ["001"], ["001"]).issues.map((i) => i.code)).toEqual([
      "MIGRATION_UNKNOWN_TO_REPO",
    ]);
    const mismatch = inspectMigrationStatus(["001"], applied("20240101120000_a"));
    expect(
      filterToExpectedVersions(mismatch, ["001"], ["001"]).issues.map((i) => i.code),
    ).toEqual(["MIGRATION_VERSION_SHAPE_MISMATCH"]);
  });

  it("inspectMigrationStatus 传 expected 与手动过滤等价", () => {
    expect(inspectMigrationStatus(["001", "033", "034"], applied("001"), ["034"]).pendingVersions).toEqual([
      "034",
    ]);
  });
});

describe("parseManifestEntries", () => {
  it("读出版本号与文件名，失败形状返回 null（与 parseManifestVersions 同一口径）", () => {
    const manifest = JSON.stringify({
      migrations: [
        { version: "034", fileName: "034_email_skip_reason.sql" },
        { version: "035", fileName: "035_worker_run_backlog_skipped.sql" },
      ],
    });
    expect(parseManifestEntries(manifest)).toEqual([
      { version: "034", fileName: "034_email_skip_reason.sql" },
      { version: "035", fileName: "035_worker_run_backlog_skipped.sql" },
    ]);
    expect(parseManifestEntries("{ not json")).toBeNull();
    expect(parseManifestEntries("{}")).toBeNull();
    expect(parseManifestEntries('{"migrations":[{"version":"001"}]}')).toEqual([{ version: "001" }]);
  });
});

describe("planVersionShapeFix（版本号形状订正计划）", () => {
  const entries = [
    { version: "034", fileName: "034_email_skip_reason.sql" },
    { version: "035", fileName: "035_worker_run_backlog_skipped.sql" },
  ];

  it("按迁移文件名把时间戳形状的行映射回序号", () => {
    const live = [
      { raw: "2026102409000000", version: normalizeMigrationVersion("2026102409000000"), name: "034_email_skip_reason" },
    ];
    const plan = planVersionShapeFix(live, entries);
    expect(plan.updates).toEqual([
      { fromRaw: "2026102409000000", toVersion: "034", matchedBy: "name=034_email_skip_reason" },
    ]);
    expect(plan.unmapped).toEqual([]);
  });

  it("对不上文件名的行一律不动——不拿猜测当证据", () => {
    const live = [
      { raw: "2026102409000000", version: "2026102409000000", name: "036_not_in_repo" },
      { raw: "2026102509000000", version: "2026102509000000" },
    ];
    const plan = planVersionShapeFix(live, entries);
    expect(plan.updates).toEqual([]);
    expect(plan.unmapped.map((entry) => entry.raw)).toEqual(["2026102409000000", "2026102509000000"]);
  });

  it("已在 manifest 里的行（正常形状）不参与订正", () => {
    const plan = planVersionShapeFix(applied("034", "035"), entries);
    expect(plan.updates).toEqual([]);
    expect(plan.unmapped).toEqual([]);
  });

  it("两行认领同一个目标版本号 = 计划自相矛盾，涉及的行全部拒判", () => {
    const live = [
      { raw: "2026102409000000", version: "2026102409000000", name: "034_email_skip_reason" },
      { raw: "2026102409000001", version: "2026102409000001", name: "034_email_skip_reason" },
    ];
    const plan = planVersionShapeFix(live, entries);
    expect(plan.updates).toEqual([]);
    expect(plan.unmapped.map((entry) => entry.raw)).toEqual(["2026102409000000", "2026102409000001"]);
  });
});
