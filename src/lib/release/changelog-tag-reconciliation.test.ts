import { describe, expect, it } from "vitest";
import {
  DISCLOSURE_POINTER,
  auditChangelogTags,
  formatChangelogTagIssues,
  formatChangelogTagSummary,
  versionsFromTags,
  type ReleasedVersion,
} from "./changelog-tag-reconciliation.ts";

function v(version: string, entries = 3): ReleasedVersion {
  return { version, date: "2026-09-22", entries };
}

/** 一段合规的开头说明（含披露指针）。 */
const INTRO = `All notable changes... See \`${DISCLOSURE_POINTER}\`.`;

const LEDGER = {
  "0.11.0": "生产已部署，但账户删除端到端演练与 commit 归属证据未闭合（B01/B02/B03，外部权限）",
};

describe("versionsFromTags", () => {
  it("剥掉 v 前缀，只留 x.y.z", () => {
    expect([...versionsFromTags(["v0.6.0", "v0.11.0"])]).toEqual(["0.6.0", "0.11.0"]);
  });

  it("忽略非 v 前缀与非版本形状的 tag", () => {
    expect([...versionsFromTags(["release-1", "v1.2", "nightly", "v0.1.0-rc1"])]).toEqual([]);
  });

  it("前缀可注入", () => {
    expect([...versionsFromTags(["ver0.6.0"], "ver")]).toEqual(["0.6.0"]);
  });
});

describe("auditChangelogTags — 全部对得上时不报错", () => {
  it("每个版本都有 tag", () => {
    const report = auditChangelogTags({
      versions: [v("0.6.0"), v("0.5.0")],
      tags: ["v0.6.0", "v0.5.0"],
      ledger: {},
      intro: INTRO,
    });
    expect(report.errors).toEqual([]);
    expect(report.stats).toEqual({ versions: 2, tagged: 2, staleLedger: 0, ledgerSize: 0 });
  });
});

describe("auditChangelogTags — 缺 tag", () => {
  it("未登记 → 报错并点名版本", () => {
    const report = auditChangelogTags({
      versions: [v("0.6.0"), v("0.11.0")],
      tags: ["v0.6.0"],
      ledger: {},
      intro: INTRO,
    });
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].code).toBe("VERSION_WITHOUT_TAG");
    expect(report.errors[0].subject).toBe("0.11.0");
  });

  it("已登记理由 → 不报错（缺口是显式的，不是遗漏）", () => {
    const report = auditChangelogTags({
      versions: [v("0.6.0"), v("0.11.0")],
      tags: ["v0.6.0"],
      ledger: LEDGER,
      intro: INTRO,
    });
    expect(report.errors).toEqual([]);
    expect(report.stats.ledgerSize).toBe(1);
  });

  it("登记理由为空串也算没登记", () => {
    const report = auditChangelogTags({
      versions: [v("0.11.0")],
      tags: [],
      ledger: { "0.11.0": "" },
      intro: INTRO,
    });
    expect(report.errors.map((e) => e.code)).toEqual(["VERSION_WITHOUT_TAG"]);
  });
});

describe("auditChangelogTags — 反方向的分叉", () => {
  it("有 tag 但 CHANGELOG 没章节 → 报错", () => {
    const report = auditChangelogTags({
      versions: [v("0.6.0")],
      tags: ["v0.6.0", "v0.12.0"],
      ledger: {},
      intro: INTRO,
    });
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].code).toBe("TAG_WITHOUT_VERSION");
    expect(report.errors[0].subject).toBe("v0.12.0");
  });
});

describe("auditChangelogTags — 登记过期", () => {
  it("版本已经有 tag 了，登记还在 → 报错（别让做完的事继续看起来没做完）", () => {
    const report = auditChangelogTags({
      versions: [v("0.11.0")],
      tags: ["v0.11.0"],
      ledger: LEDGER,
      intro: INTRO,
    });
    expect(report.errors.map((e) => e.code)).toEqual(["STALE_LEDGER_ENTRY"]);
    expect(report.stats.staleLedger).toBe(1);
  });

  it("CHANGELOG 里根本没有的版本被登记 → 不算过期（不产生噪音）", () => {
    const report = auditChangelogTags({
      versions: [v("0.6.0")],
      tags: ["v0.6.0"],
      ledger: { "9.9.9": "还没写进 changelog" },
      intro: INTRO,
    });
    expect(report.errors).toEqual([]);
  });
});

describe("auditChangelogTags — 失败封闭", () => {
  it("一条版本都没解析出来时报红", () => {
    const report = auditChangelogTags({ versions: [], tags: ["v0.6.0"], ledger: {}, intro: INTRO });
    expect(report.errors.map((e) => e.code)).toContain("NO_VERSIONS_PARSED");
  });
});

describe("auditChangelogTags — 披露本身", () => {
  it("开头没有指向台账的指针 → 报错（最省事的「整理」就是删掉那段说明）", () => {
    const report = auditChangelogTags({
      versions: [v("0.6.0")],
      tags: ["v0.6.0"],
      ledger: {},
      intro: "All notable changes to IndieStack will be documented in this file.",
    });
    expect(report.errors.map((e) => e.code)).toEqual(["DISCLOSURE_MISSING"]);
  });

  it("说明文字缺失/为空 → 同样报错，不留「undefined 就跳过」的后门", () => {
    const report = auditChangelogTags({
      versions: [v("0.6.0")],
      tags: ["v0.6.0"],
      ledger: {},
      intro: "",
    });
    expect(report.errors.map((e) => e.code)).toEqual(["DISCLOSURE_MISSING"]);
  });

  it("指针在 → 不报错", () => {
    const report = auditChangelogTags({
      versions: [v("0.6.0")],
      tags: ["v0.6.0"],
      ledger: {},
      intro: INTRO,
    });
    expect(report.errors).toEqual([]);
  });
});

describe("formatChangelogTagSummary", () => {
  it("分母与分子都是数字，不许出现 NaN", () => {
    // 回归：这一行曾经写成 `versions - tagged`，而 versions 是那个数组——
    // 规则与单测全绿、门禁 exit 0，只有这行自报「NaN 个」。
    const report = auditChangelogTags({
      versions: [v("0.6.0"), v("0.11.0"), v("0.5.0")],
      tags: ["v0.6.0"],
      ledger: { "0.11.0": "证据未闭合", "0.5.0": "纪律还不存在" },
      intro: INTRO,
    });
    const text = formatChangelogTagSummary(report);
    expect(text).not.toContain("NaN");
    expect(text).toContain("3 个已发布版本");
    expect(text).toContain("1 个有 tag");
    expect(text).toContain("2 个在 MISSING_TAG_LEDGER");
    expect(text).toContain("台账 2 条");
  });

  it("全部有 tag 时差集是 0 而不是负数", () => {
    const report = auditChangelogTags({ versions: [v("0.6.0")], tags: ["v0.6.0"], ledger: {}, intro: INTRO });
    expect(formatChangelogTagSummary(report)).toContain("0 个在 MISSING_TAG_LEDGER");
  });
});

describe("formatChangelogTagIssues", () => {
  it("逐条打印", () => {
    const report = auditChangelogTags({ versions: [v("0.11.0")], tags: [], ledger: {}, intro: INTRO });
    const text = formatChangelogTagIssues(report.errors);
    expect(text).toContain("VERSION_WITHOUT_TAG");
    expect(text).toContain("0.11.0");
  });

  it("没有问题时输出空字符串", () => {
    expect(formatChangelogTagIssues([])).toBe("");
  });
});
