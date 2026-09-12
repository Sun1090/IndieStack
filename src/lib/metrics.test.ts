import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_ATTRIBUTE_VALUE_LENGTH,
  MAX_METRIC_ATTRIBUTES,
  recordMetric,
  sanitizeMetricAttributes,
  startMetricTimer,
} from "./metrics";

afterEach(() => vi.restoreAllMocks());

describe("metrics", () => {
  it("emits one structured JSON line", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(recordMetric("email.send.completed", 12, {
      unit: "ms",
      attributes: { provider: "resend", outcome: "success", status: 200 },
    })).toBe(true);

    expect(log).toHaveBeenCalledOnce();
    const event = JSON.parse(String(log.mock.calls[0][0]));
    expect(event).toMatchObject({
      type: "metric",
      name: "email.send.completed",
      value: 12,
      unit: "ms",
      attributes: { provider: "resend", outcome: "success", status: 200 },
    });
    expect(Number.isNaN(Date.parse(event.timestamp))).toBe(false);
  });

  it("drops invalid metric observations without throwing", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(recordMetric("bad name", 1)).toBe(false);
    expect(recordMetric("valid", Number.NaN)).toBe(false);
    expect(log).not.toHaveBeenCalled();
  });

  it("sanitizes sensitive and oversized dimensions", () => {
    const attributes: Record<string, unknown> = { token: "secret", userId: "u1", nested: { a: 1 }, ok: "x".repeat(300) };
    for (let index = 0; index < MAX_METRIC_ATTRIBUTES + 5; index += 1) {
      attributes[`extra_${index}`] = index;
    }

    expect(sanitizeMetricAttributes(attributes)).toEqual({
      nested: null,
      ok: "x".repeat(MAX_ATTRIBUTE_VALUE_LENGTH),
      extra_0: 0,
      extra_1: 1,
      extra_2: 2,
      extra_3: 3,
      extra_4: 4,
      extra_5: 5,
      extra_6: 6,
      extra_7: 7,
      extra_8: 8,
      extra_9: 9,
      extra_10: 10,
      extra_11: 11,
      extra_12: 12,
      extra_13: 13,
      extra_14: 14,
      extra_15: 15,
      extra_16: 16,
      extra_17: 17,
    });
  });

  it("emits a timer once", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const timer = startMetricTimer("storage.upload.completed", { provider: "supabase" });
    timer.end({ outcome: "success" });
    timer.end({ outcome: "failure" });

    expect(log).toHaveBeenCalledOnce();
    const event = JSON.parse(String(log.mock.calls[0][0]));
    expect(event.name).toBe("storage.upload.completed");
    expect(event.unit).toBe("ms");
    expect(event.value).toBeGreaterThanOrEqual(0);
    expect(event.attributes).toEqual({ provider: "supabase", outcome: "success" });
  });
});
