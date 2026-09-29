/**
 * 任务池条目状态纪律的规则单测
 *
 * 覆盖三种合规写法（带日期的完成 / 定案 / 显式阻塞）、三种不合规写法，
 * 以及失败封闭那一格。**为什么要有这条规则**：2026-09-29 这一天里它抓出的不是设想，
 * 是两次真实的踩坑——C09 的「现在不动」其实早就能动了，C06 的「定夺」两天前就定完了。
 */
import { describe, expect, it } from "vitest";
import {
  extractTaskPool,
  formatRoadmapIssues,
  inspectRoadmapEntries,
  parseTaskPoolEntries,
  type RoadmapEntryIssueCode,
} from "./roadmap-entries";

const POOL = [
  "## 任务池",
  "",
  "1. A01 （**2026-09-22 已完成**：结论在这里）第一条",
  "2. A02 需要一个可牺牲的隔离账号，**外部权限**未到位",
  "3. A03 （**2026-09-25 定案并落地**：结论在这里）第三条",
  "4. A04 执行一次真实回滚演练",
  "",
  "## 里程碑",
  "",
  "1. A01–A04 完成：退出标准里也有编号，不能被当成任务池条目",
].join("\n");

function codes(markdown: string): RoadmapEntryIssueCode[] {
  return inspectRoadmapEntries(markdown).map((item) => item.code);
}

describe("extractTaskPool()", () => {
  it("只取「## 任务池」到下一个 ## 之间的正文", () => {
    const pool = extractTaskPool(POOL) ?? "";
    expect(pool).toContain("1. A01");
    // 退出标准那节里也有 `1. A01–A04`，进任务池就会多出一条「没人给它写状态」的条目。
    expect(pool).not.toContain("退出标准");
  });

  it("没有任务池这一节时返回 null（而不是空串）", () => {
    expect(extractTaskPool("# 别的\n\n正文")).toBeNull();
  });
});

describe("parseTaskPoolEntries()", () => {
  it("只认「数字 + 域前缀 + ID」这一种写法", () => {
    expect(parseTaskPoolEntries(POOL).map((e) => e.id)).toEqual(["A01", "A02", "A03", "A04"]);
  });

  it("读得到标题下面几行的状态标注（标注常写在第二行）", () => {
    const [a01] = parseTaskPoolEntries(POOL);
    expect(a01.opening).toContain("已完成");
  });

  it("不得借用下一条目的完成标注（第一版的窗口越过了下一条标题，量出来的）", () => {
    // 真实形状：某一条没有自己的状态标注，而下一条有。窗口越界时它会报绿。
    const markdown = [
      "## 任务池",
      "",
      "1. A01 这是一条没有状态标注的条目",
      "   它有正文，也有日期，但那是别人条目的日期。",
      "2. A02 （**2026-09-29 已完成**：结论在这里）第二条",
    ].join("\n");
    expect(inspectRoadmapEntries(markdown).map((i) => i.subject)).toEqual(["A01"]);
  });
});

describe("inspectRoadmapEntries()", () => {
  it("带日期的完成标注与写明的阻塞都算合规", () => {
    expect(codes(POOL)).toEqual(["ROADMAP_ENTRY_UNMARKED"]);
    expect(inspectRoadmapEntries(POOL).map((i) => i.subject)).toEqual(["A04"]);
  });

  it("「随 A01 完成」这种没有日期的说法不算完成标注（日期是判据）", () => {
    // A02 在真实 roadmap 里就是这个写法，日期挂在被它跟随的那一条上——
    // 于是「A01 做完了」这件事在这一行上没有自己的证据。
    const markdown = ["## 任务池", "", "1. A02 （随 A01 完成：门控移除）第二条"].join("\n");
    expect(codes(markdown)).toEqual(["ROADMAP_MARKER_UNDATED"]);
  });

  it("既没标注也没写明被什么挡住 = 红", () => {
    // A04 就是 2026-09-29 真实存在的形状：一句祈使句，没有结论也没有阻塞。
    expect(codes(POOL)).toContain("ROADMAP_ENTRY_UNMARKED");
  });

  it("完成标注缺日期 = 红，且理由说清为什么日期是判据", () => {
    const markdown = ["## 任务池", "", "1. A01 （**已完成**：结论在这里）第一条"].join("\n");
    const issues = inspectRoadmapEntries(markdown);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("ROADMAP_MARKER_UNDATED");
    expect(issues[0].message).toContain("日期");
  });

  it("「待决产品决策」算写明了阻塞", () => {
    const markdown = [
      "## 任务池",
      "",
      "1. A05 主体完成，余下「已读是否等于不必寄」是**待决产品决策**",
    ].join("\n");
    expect(codes(markdown)).toEqual([]);
  });

  it("日期格式坏了要红（2026/9/29 不是 YYYY-MM-DD）", () => {
    const markdown = ["## 任务池", "", "1. A01 （2026/9/29 已完成）第一条"].join("\n");
    // 匹配不上带日期的标注，又不是「看着像标注却缺日期」，所以落到 UNMARKED。
    expect(codes(markdown)).toEqual(["ROADMAP_ENTRY_UNMARKED"]);
  });

  it("一条条目都没解析出来时报红，不把空扫描读成全部合规", () => {
    const issues = inspectRoadmapEntries("# 没有任务池这一节\n\n正文");
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("ROADMAP_NO_ENTRIES");
  });

  it("豁免必须写理由，空理由等于没有豁免", () => {
    const markdown = ["## 任务池", "", "1. A04 执行一次真实回滚演练"].join("\n");
    expect(inspectRoadmapEntries(markdown, { A04: "" })).toHaveLength(1);
    expect(inspectRoadmapEntries(markdown, { A04: "它其实不是任务" })).toEqual([]);
  });

  it("空豁免表不会让任何条目过关（防止『开一张表就把门禁关掉』）", () => {
    expect(inspectRoadmapEntries(POOL, {})).toHaveLength(1);
  });

  it("合规与不合规混在一起时只点名不合规的那些", () => {
    const issues = inspectRoadmapEntries(POOL);
    expect(issues.map((i) => i.subject)).toEqual(["A04"]);
  });
});

describe("formatRoadmapIssues()", () => {
  it("每条都带机器可读的码，人和归因工具各取所需", () => {
    const text = formatRoadmapIssues([
      { code: "ROADMAP_ENTRY_UNMARKED", subject: "A04", message: "没写明" },
    ]);
    expect(text).toBe("  - [ROADMAP_ENTRY_UNMARKED] A04: 没写明");
  });

  it("空数组渲染成空串（不要打印一条假的分隔线）", () => {
    expect(formatRoadmapIssues([])).toBe("");
  });
});
