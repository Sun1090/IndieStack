/**
 * 测试共享工具：从 console.log spy 中提取结构化指标事件。
 *
 * 指标通过 `src/lib/metrics.ts` 以单行 JSON 打到 stdout，因此断言方式是
 * 「spy console.log → 解析 JSON → 只看 type=metric」。此前 digest 与
 * push-retry 两个路由测试各写了一份同样的实现，这里收敛为单一副本。
 */
export interface MetricLogEvent {
  type?: string;
  name?: string;
  value?: number;
  unit?: string;
  attributes?: Record<string, unknown>;
}

/** 只接受 vitest spy 形态的参数，避免依赖具体 spy 泛型。 */
export function metricEvents(log: { mock: { calls: unknown[][] } }): MetricLogEvent[] {
  return log.mock.calls
    .map((call) => {
      try {
        return JSON.parse(String(call[0])) as MetricLogEvent;
      } catch {
        // 非 JSON 的普通日志（例如调试输出）不参与指标断言。
        return null;
      }
    })
    .filter((event): event is MetricLogEvent => event?.type === "metric");
}
