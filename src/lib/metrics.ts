/**
 * Lightweight structured metrics for log-based dashboards and alerts.
 *
 * Emits one JSON line per observation. This intentionally avoids a vendor SDK:
 * Vercel/Sentry can ingest the lines, and tests can assert the contract without
 * a network dependency. Attributes are sanitized so credentials and user data
 * cannot accidentally become metric dimensions.
 */
export const METRIC_TYPE = "metric";
export const MAX_METRIC_ATTRIBUTES = 20;
export const MAX_ATTRIBUTE_VALUE_LENGTH = 120;

export type MetricUnit = "count" | "ms" | "bytes" | "ratio";

export interface MetricOptions {
  unit?: MetricUnit;
  attributes?: Record<string, unknown>;
}

export interface MetricEvent extends Required<MetricOptions> {
  type: typeof METRIC_TYPE;
  name: string;
  value: number;
  timestamp: string;
}

const SENSITIVE_ATTRIBUTE = /(authorization|cookie|email|key|password|secret|token|user_?id)/i;

function sanitizeValue(value: unknown): string | number | boolean | null {
  if (typeof value === "string") return value.slice(0, MAX_ATTRIBUTE_VALUE_LENGTH);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  return null;
}

export function sanitizeMetricAttributes(
  attributes: Record<string, unknown> = {},
): Record<string, string | number | boolean | null> {
  const sanitized: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (Object.keys(sanitized).length >= MAX_METRIC_ATTRIBUTES) break;
    if (!/^[a-z][a-z0-9_.-]{0,63}$/i.test(key) || SENSITIVE_ATTRIBUTE.test(key)) continue;
    sanitized[key] = sanitizeValue(value);
  }
  return sanitized;
}

/** Emit a metric. Invalid names/values are ignored so observability cannot break business flow. */
export function recordMetric(name: string, value: number, options: MetricOptions = {}): boolean {
  if (!/^[a-z][a-z0-9_.-]{0,127}$/i.test(name) || !Number.isFinite(value)) return false;
  const event: MetricEvent = {
    type: METRIC_TYPE,
    name,
    value,
    unit: options.unit ?? "count",
    attributes: sanitizeMetricAttributes(options.attributes),
    timestamp: new Date().toISOString(),
  };
  console.log(JSON.stringify(event));
  return true;
}

/** Start a monotonic timer that emits one duration metric when ended. */
export function startMetricTimer(name: string, attributes: Record<string, unknown> = {}) {
  const startedAt = performance.now();
  let ended = false;
  return {
    end(extraAttributes: Record<string, unknown> = {}): void {
      if (ended) return;
      ended = true;
      recordMetric(name, Math.max(0, Math.round(performance.now() - startedAt)), {
        unit: "ms",
        attributes: { ...attributes, ...extraAttributes },
      });
    },
  };
}
