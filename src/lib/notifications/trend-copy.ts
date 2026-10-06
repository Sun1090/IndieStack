/**
 * 趋势结论在面板上的**文案组装**（纯函数，不碰 IO）。
 *
 * 为什么不写在页面组件里：那份 switch 有 4 个分支，
 * 放进 `AdminPage` 会把它的复杂度顶到 16（上限 15）。
 * 而且这段逻辑本身值得单独测——「数据不足时必须说不知道」
 * 是一条产品承诺，不该藏在 JSX 附近靠人读代码发现。
 *
 * **全静态翻译键，不用模板拼接**：本仓库有门禁禁止动态翻译键
 * （missing-key 检查只在静态调用上工作），而且拼错的键不会报错，
 * 只会静默回退成键名本身。`switch` 的 `default` 分支因此必须
 * 处理「未知 code」——宁可显示「读数不足」，也不显示一个像结论的字符串。
 */
import type { DigestVerdict } from "./digest-verdict";

/** 与 `messages/*\/admin.json` 的 `overview.stats.*` 对应的最小翻译函数签名。 */
type Translate = (key: string, values?: Record<string, number>) => string;

export interface EmailQueueTrendCopy {
  /** 需要人看一眼时是 `!`，否则 `OK`——**不用颜色区分**，颜色不是唯一信息通道。 */
  marker: string;
  desc: string;
}

export function describeEmailQueueTrend(
  trend: Pick<DigestVerdict, "code" | "attention">,
  trendRounds: number,
  t: Translate,
): EmailQueueTrendCopy {
  // 「这个趋势建立在几天的读数上」必须一起显示：
  // 一个只基于两天的「趋势」不该被当成趋势看。
  const days = t("overview.stats.trendDays", { days: trendRounds });
  const marker = trend.attention ? "!" : "OK";

  switch (trend.code) {
    case "A05_DRAINING":
      return { marker, desc: `${t("overview.stats.trendDraining")} · ${days}` };
    case "BACKLOG_NOT_DRAINING":
    // 「拉满取数上限却一封没发」在面板上与「跳过在涨但积压不降」是同一件事：
    // 两者都是「A05 没把症状修掉」，所以共用一句话，不另造一个说法。
    case "QUEUE_STUCK":
      return { marker, desc: `${t("overview.stats.trendNotDraining")} · ${days}` };
    case "HEALTHY_LOW_BACKLOG":
      return { marker, desc: `${t("overview.stats.trendHealthy")} · ${days}` };
    default:
      // 数据不足（含未来新增的 code）：**不给结论标签**，只说读数不够。
      // 数据不足时**不给结论**：`marker` 也回 `OK` 是错的——那等于说「看过了，没问题」。
      return { marker: "?", desc: t("overview.stats.trendInsufficient") };
  }
}
