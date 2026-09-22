/**
 * 平台侧保留期清理单测
 * 覆盖：清理清单与 RETENTION_POLICIES 双向对齐、逐个顺序执行、单点失败不中断整轮。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createAdminClientMock } = vi.hoisted(() => ({ createAdminClientMock: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));

import { RETENTION_CLEANUP_FUNCTIONS, runRetentionSweeps } from "./retention";
import { RETENTION_POLICIES } from "@/lib/privacy/data-policy";

type RpcMock = ReturnType<typeof vi.fn>;

/** 让指定函数报错，其余成功；返回 rpc mock 与每次调用的顺序记录。 */
function stubRpc(calls: string[], failing: ReadonlySet<string> = new Set()) {
  const rpcMock: RpcMock = vi.fn(async (name: string) => {
    calls.push(name);
    if (failing.has(name)) return { data: null, error: { message: `boom: ${name}` } };
    return { data: null, error: null };
  });
  createAdminClientMock.mockReturnValue({ rpc: rpcMock });
  return rpcMock;
}

describe("runRetentionSweeps", () => {
  beforeEach(() => {
    createAdminClientMock.mockReset();
  });

  it("迁移里的每条保留策略都被调用——新增策略忘接调度会在这里失败", async () => {
    const calls: string[] = [];
    stubRpc(calls);

    await runRetentionSweeps();

    expect([...calls].sort()).toEqual(
      RETENTION_POLICIES.map((policy) => policy.cleanupFunction).sort(),
    );
  });

  it("清单里的名字都来自 RETENTION_POLICIES，不会多删也不会有人绕过策略", async () => {
    const declared = new Set(RETENTION_POLICIES.map((policy) => policy.cleanupFunction));
    expect(RETENTION_CLEANUP_FUNCTIONS.every((name) => declared.has(name))).toBe(true);
    // 上面那条用例只证明「策略都在调用里」，这条补上反方向：清单不能夹带未登记的函数
    expect(new Set(RETENTION_CLEANUP_FUNCTIONS).size).toBe(RETENTION_POLICIES.length);
  });

  it("逐个顺序执行，不同时压六个全表删除", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const rpcMock: RpcMock = vi.fn(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return { data: null, error: null };
    });
    createAdminClientMock.mockReturnValue({ rpc: rpcMock });

    await runRetentionSweeps();

    expect(maxInFlight).toBe(1);
    expect(rpcMock).toHaveBeenCalledTimes(RETENTION_POLICIES.length);
  });

  it("单个函数失败只记录它自己，其余继续跑完", async () => {
    const calls: string[] = [];
    stubRpc(calls, new Set(["cleanup_old_api_usage"]));

    await expect(runRetentionSweeps()).resolves.toEqual({
      ran: RETENTION_POLICIES.length - 1,
      failures: [{ cleanupFunction: "cleanup_old_api_usage", message: "boom: cleanup_old_api_usage" }],
    });
    expect(calls).toHaveLength(RETENTION_POLICIES.length);
  });

  it("全部失败时如实报告，不伪造成功", async () => {
    const calls: string[] = [];
    stubRpc(
      calls,
      new Set(RETENTION_POLICIES.map((policy) => policy.cleanupFunction)),
    );

    const result = await runRetentionSweeps();

    expect(result.ran).toBe(0);
    expect(result.failures).toHaveLength(RETENTION_POLICIES.length);
  });
});
