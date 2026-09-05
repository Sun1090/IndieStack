/**
 * worker-runs repository 单测（v0.5.0 C02，迁移 017）
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { chainMock, dbClientMock } from "./test-helpers";

const { createAdminClientMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));

import { recordWorkerRun } from "./worker-runs";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("recordWorkerRun()", () => {
  it("写入计数与耗时", async () => {
    const chain = chainMock({});
    createAdminClientMock.mockReturnValue(dbClientMock(() => chain));
    await expect(
      recordWorkerRun({ pulled: 10, sent: 8, groups: 3, failed: 2, durationMs: 1234 }),
    ).resolves.toBeUndefined();
    expect(chain.insert).toHaveBeenCalledWith({
      pulled: 10,
      sent: 8,
      groups: 3,
      failed: 2,
      duration_ms: 1234,
      error: null,
    });
  });

  it("数据库错误抛错", async () => {
    createAdminClientMock.mockReturnValue(dbClientMock(() => chainMock({ error: { message: "db" } })));
    await expect(
      recordWorkerRun({ pulled: 0, sent: 0, groups: 0, failed: 0, durationMs: 0, error: "boom" }),
    ).rejects.toThrow("db");
  });
});
