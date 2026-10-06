/**
 * A05 观察窗口判定的单测。
 *
 * **这个判定最容易做错的地方是把「跳过率上升」当成故障。**
 * A05 落地后跳过率**必然**上升（那些行原来卡在队列里，现在被判定出队），
 * 所以每条用例都在钉这件事：跳涨本身不告警，跳涨**且积压不降**才告警。
 */
import { describe, expect, it } from "vitest";
import { judgeDigestRound, judgeDigestSeries, type DigestRoundReading } from "./digest-verdict";

/** 构造一轮读数，默认值给的是「一切正常」的那一轮。 */
function round(over: Partial<DigestRoundReading> = {}): DigestRoundReading {
  return {
    date: "2026-10-06",
    pulled: 10,
    sent: 8,
    backlog: 20,
    skipped: 0,
    ...over,
  };
}

describe("judgeDigestRound", () => {
  it("正常的轮次不告警", () => {
    const verdict = judgeDigestRound(round());
    expect(verdict.attention).toBe(false);
    expect(verdict.code).toBe("HEALTHY_LOW_BACKLOG");
  });

  it("**跳过 5 条但队列清空 = A05 按预期生效**，且消息里必须点明「跳过上升是预期」", () => {
    const verdict = judgeDigestRound(round({ backlog: 0, skipped: 5, pulled: 5, sent: 0 }));
    expect(verdict.code).toBe("A05_DRAINING");
    expect(verdict.attention).toBe(false);
    // 这句说明是这条判定的核心：不做出来，读者会以为跳过率上涨是坏事
    expect(verdict.reason).toContain("预期");
    expect(verdict.reason).toContain("卡在队首");
  });

  it("拉满 100 条却一封没发 → 判队首被占死", () => {
    const verdict = judgeDigestRound(round({ pulled: 100, sent: 0, backlog: 240 }));
    expect(verdict.code).toBe("QUEUE_STUCK");
    expect(verdict.attention).toBe(true);
    // 消息要指向真正的处置方向，而不是只说「异常」
    expect(verdict.reason).toContain("034");
  });

  it("读数不可信时告警——**未知不算健康**", () => {
    for (const over of [
      { sent: 11, pulled: 10 }, // sent > pulled：口径坏了
      { backlog: -1 }, // 负数
      { pulled: Number.NaN },
      { date: "10/06" }, // 日期格式不对
    ]) {
      const verdict = judgeDigestRound(round(over));
      expect(verdict.code).toBe("INSUFFICIENT_DATA");
      expect(verdict.attention).toBe(true);
    }
  });

  it("不可信的读数要说清「不等于健康」", () => {
    const verdict = judgeDigestRound(round({ sent: 11, pulled: 10 }));
    expect(verdict.reason).toContain("不等于");
    expect(verdict.reason).not.toContain("undefined");
  });
});

describe("judgeDigestSeries", () => {
  it("积压下降 + 跳过上升 = A05 预期形态，不告警", () => {
    const verdict = judgeDigestSeries([
      round({ date: "2026-10-05", backlog: 300, skipped: 0 }),
      round({ date: "2026-10-06", backlog: 120, skipped: 40 }),
    ]);
    expect(verdict.code).toBe("A05_DRAINING");
    expect(verdict.attention).toBe(false);
    // 消息里要把两个数字都写出来，读者要能自己核对
    expect(verdict.reason).toContain("300");
    expect(verdict.reason).toContain("120");
  });

  it("**跳过上升但积压不降 → 告警**（这才是 A05 没修掉的形态）", () => {
    const verdict = judgeDigestSeries([
      round({ date: "2026-10-05", backlog: 300, skipped: 10 }),
      round({ date: "2026-10-06", backlog: 300, skipped: 50 }),
    ]);
    expect(verdict.code).toBe("BACKLOG_NOT_DRAINING");
    expect(verdict.attention).toBe(true);
    expect(verdict.reason).toContain("没真的离开队列");
  });

  it("积压下降但跳过没涨 = 普通健康，不误报成 A05 形态", () => {
    const verdict = judgeDigestSeries([
      round({ date: "2026-10-05", backlog: 300, skipped: 5 }),
      round({ date: "2026-10-06", backlog: 100, skipped: 5 }),
    ]);
    expect(verdict.code).toBe("HEALTHY_LOW_BACKLOG");
    expect(verdict.attention).toBe(false);
  });

  it("序列里只要有一轮卡死就整体告警，不被其他轮的平均掩盖", () => {
    const verdict = judgeDigestSeries([
      round({ date: "2026-10-04", backlog: 300, skipped: 0 }),
      round({ date: "2026-10-05", backlog: 300, skipped: 0 }),
      round({ date: "2026-10-06", pulled: 100, sent: 0, backlog: 300, skipped: 0 }),
    ]);
    expect(verdict.code).toBe("QUEUE_STUCK");
    expect(verdict.attention).toBe(true);
  });

  it("**空序列告警**——没人在看不等于队列健康", () => {
    const verdict = judgeDigestSeries([]);
    expect(verdict.code).toBe("INSUFFICIENT_DATA");
    expect(verdict.attention).toBe(true);
    expect(verdict.reason).toContain("空序列不等于健康");
  });

  it("**日期重复时拒绝判趋势**——同一天两次读数的抖动不是趋势", () => {
    const verdict = judgeDigestSeries([
      round({ date: "2026-10-06", backlog: 300, skipped: 0 }),
      round({ date: "2026-10-06", backlog: 100, skipped: 40 }),
    ]);
    expect(verdict.code).toBe("INSUFFICIENT_DATA");
    expect(verdict.attention).toBe(true);
    expect(verdict.reason).toContain("重复日期");
  });

  it("输入顺序打乱也能判（按日期排序后再比首尾）", () => {
    const verdict = judgeDigestSeries([
      round({ date: "2026-10-06", backlog: 120, skipped: 40 }),
      round({ date: "2026-10-05", backlog: 300, skipped: 0 }),
    ]);
    expect(verdict.code).toBe("A05_DRAINING");
  });

  it("单轮序列退化为单轮判定，不硬造「趋势」", () => {
    const verdict = judgeDigestSeries([round({ date: "2026-10-06", pulled: 100, sent: 0 })]);
    expect(verdict.code).toBe("QUEUE_STUCK");
  });

  it("序列里有坏读数时，先让人修取数，别急着谈 A05 结论", () => {
    const verdict = judgeDigestSeries([
      round({ date: "2026-10-05", backlog: 300, skipped: 0 }),
      round({ date: "2026-10-06", sent: 999, pulled: 1 }),
    ]);
    expect(verdict.code).toBe("INSUFFICIENT_DATA");
    expect(verdict.reason).toContain("先修取数");
  });
});