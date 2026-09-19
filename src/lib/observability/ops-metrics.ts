/**
 * 运维恢复链路的指标契约（v0.6.0 E07）。
 *
 * `/api/ops/supabase-restore` 是保活失败后的兜底入口，原本只在“成功读取项目状态”
 * 之后上报一次 `ops.supabase.restore`，而且把 `action=restore` 映射为 `1`、其余动作
 * 映射为 `0`。这会产生两个告警盲区：
 *
 *   1. 配置缺失与状态查询失败直接返回，连一条样本都没有，无法从指标看出兜底层失效；
 *   2. `action=escalate|skipped` 的样本值恒为 `0`，按“计数 > 0”配置的告警永远不会触发。
 *
 * 这里把动作取值和上报语义集中为单一事实源：每完成一轮检查都上报一条
 * `value=1` 的计数，用 `action` 维度区分正常 noop、恢复、等待、人工升级与跳过。
 * 这样告警规则可以分别对 restore/escalate/skipped 做计数，不会被值 0 静默吞掉。
 */
import { recordMetric } from "@/lib/metrics";

/** 每轮 Supabase 恢复检查的计数指标。 */
export const OPS_SUPABASE_RESTORE_METRIC = "ops.supabase.restore";

/** 路由可能上报的全部动作；与 `RestoreCycleAction` 保持同源语义。 */
export const OPS_SUPABASE_RESTORE_ACTIONS = [
  "noop",
  "restore",
  "wait",
  "escalate",
  "skipped",
] as const;

export type OpsSupabaseRestoreAction = (typeof OPS_SUPABASE_RESTORE_ACTIONS)[number];

export interface OpsSupabaseRestoreMetricInput {
  action: OpsSupabaseRestoreAction;
  /** Management API 报告的状态；配置缺失或状态查询失败时为未知。 */
  projectStatus?: string;
}

/** 上报一轮恢复检查；每个终态恰好一条样本，action 是告警分流维度。 */
export function recordSupabaseRestoreCycle(input: OpsSupabaseRestoreMetricInput): boolean {
  return recordMetric(OPS_SUPABASE_RESTORE_METRIC, 1, {
    unit: "count",
    attributes: {
      action: input.action,
      projectStatus: input.projectStatus?.trim() || "unknown",
    },
  });
}
