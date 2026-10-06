/**
 * 趋势文案组装单测
 * 钉两件产品承诺：①「读数不足」必须说不知道，不能给一个像结论的标签；
 * ② 「需要人看一眼」必须有非颜色的标记。
 */
import { describe, it, expect } from "vitest";
import { describeEmailQueueTrend } from "./trend-copy";

/** 假翻译：直接把键与参数回显，这样断言看的是「选了哪个键」。 */
const t = (key: string, values?: Record<string, number>) =>
  values ? `${key}(${JSON.stringify(values)})` : key;

describe("describeEmailQueueTrend", () => {
  it("**数据不足时不显示任何结论标签**", () => {
    const out = describeEmailQueueTrend(
      { code: "INSUFFICIENT_DATA", attention: true },
      0,
      t,
    );
    expect(out.desc).toBe("overview.stats.trendInsufficient");
    // 不带「几天」——读数都没有，谈不上几天
    expect(out.desc).not.toContain("trendDays");
  });

  it("数据不足时标记是 `?` 而不是 `OK`——**没说看过了**", () => {
    // 这是最容易出错的一处：`attention=true` 时若回落到 `OK`，
    // 面板上就出现「OK + 读数不足」这种自相矛盾的读数。
    const out = describeEmailQueueTrend({ code: "INSUFFICIENT_DATA", attention: true }, 1, t);
    expect(out.marker).toBe("?");
    expect(out.marker).not.toBe("OK");
  });

  it("A05 按预期生效 → 明确说是 A05 在起作用", () => {
    const out = describeEmailQueueTrend({ code: "A05_DRAINING", attention: false }, 5, t);
    expect(out.desc).toContain("trendDraining");
    expect(out.desc).toContain('{"days":5}');
    expect(out.marker).toBe("OK");
  });

  it("跳过在涨但积压不降 → 与「拉满却一封没发」共用一句话", () => {
    const a = describeEmailQueueTrend({ code: "BACKLOG_NOT_DRAINING", attention: true }, 3, t);
    const b = describeEmailQueueTrend({ code: "QUEUE_STUCK", attention: true }, 3, t);
    expect(a.desc).toContain("trendNotDraining");
    // 两者都是「A05 没修掉症状」，不另造说法——多一个说法就多一处可能不一致
    expect(b.desc).toBe(a.desc);
    expect(a.marker).toBe("!");
  });

  it("积压不高 → OK", () => {
    const out = describeEmailQueueTrend({ code: "HEALTHY_LOW_BACKLOG", attention: false }, 9, t);
    expect(out.desc).toContain("trendHealthy");
    expect(out.marker).toBe("OK");
  });

  it("**未来新增的 code 落到 default：宁可说读数不足，也不给像结论的标签**", () => {
    // 用类型断言塞一个不存在的 code——这正是「以后有人加 code」时的样子。
    const out = describeEmailQueueTrend(
      { code: "SOME_FUTURE_CODE", attention: false } as never,
      4,
      t,
    );
    expect(out.desc).toBe("overview.stats.trendInsufficient");
  });
});
