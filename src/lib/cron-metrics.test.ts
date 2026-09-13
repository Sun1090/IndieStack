import { afterEach, describe, expect, it, vi } from "vitest";
import { CRON_REJECTED_METRIC, recordCronRejected } from "./cron-metrics";

afterEach(() => vi.restoreAllMocks());

describe("recordCronRejected", () => {
  it("按 worker + reason 上报一条计数指标，不含任何凭据内容", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    recordCronRejected("digest", "secret_unconfigured");

    expect(log).toHaveBeenCalledOnce();
    expect(JSON.parse(String(log.mock.calls[0][0]))).toMatchObject({
      type: "metric",
      name: CRON_REJECTED_METRIC,
      value: 1,
      unit: "count",
      attributes: { worker: "digest", reason: "secret_unconfigured" },
    });
  });

  it("每个 worker 与拒绝原因都落在允许的维度取值内", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    recordCronRejected("push-retry", "invalid_credentials");
    recordCronRejected("push-retry", "missing_credentials");

    const [{ attributes }] = log.mock.calls.map(
      (call) => JSON.parse(String(call[0])) as { attributes: Record<string, string> },
    );
    expect(attributes).toEqual({ worker: "push-retry", reason: "invalid_credentials" });
  });
});
