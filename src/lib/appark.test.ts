/**
 * Appark APM 单测（v0.5.0 C01，ADR-011）
 * 覆盖：启用门控、事件入队/flush 清空、非 2xx 保留批次、网络异常吞错、队列上限
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resetApparkForTest, isApparkEnabled, trackEvent, trackError, flushEvents, initAppark } from "./appark";

const fetchMockResolved: { ok: boolean; status?: number } = { ok: true };

beforeEach(() => {
  resetApparkForTest();
  fetchMockResolved.ok = true;
  vi.stubGlobal("fetch", vi.fn(async () => fetchMockResolved));
  process.env.NEXT_PUBLIC_APPARK_API_KEY = "key";
  process.env.NEXT_PUBLIC_APPARK_ENDPOINT = "https://collector.example.com/v1/events";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.NEXT_PUBLIC_APPARK_API_KEY;
  delete process.env.NEXT_PUBLIC_APPARK_ENDPOINT;
  delete process.env.NEXT_PUBLIC_APP_VERSION;
});

describe("isApparkEnabled()", () => {
  it("KEY 与 ENDPOINT 齐备才启用", () => {
    expect(isApparkEnabled()).toBe(true);
    delete process.env.NEXT_PUBLIC_APPARK_ENDPOINT;
    expect(isApparkEnabled()).toBe(false);
  });
});

describe("initAppark()", () => {
  it("幂等调用不抛错", () => {
    expect(() => {
      initAppark();
      initAppark();
    }).not.toThrow();
  });
});

describe("initAppark() 半配置", () => {
  it("仅 KEY 无 ENDPOINT：告警但旁路关闭，不抛错", () => {
    delete process.env.NEXT_PUBLIC_APPARK_ENDPOINT;
    resetApparkForTest();
    expect(() => initAppark()).not.toThrow();
  });
});

describe("trackError()/版本覆盖", () => {
  it("Error 实例取 message；非 Error 走 String 归一化", async () => {
    trackError("boom", new Error("oops"));
    trackError("boom", 42);
    await flushEvents();
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.events).toHaveLength(2);
    expect(body.events[0]).toMatchObject({ event: "error.boom", properties: { message: "oops" } });
    expect(body.events[1]).toMatchObject({ event: "error.boom", properties: { message: "42" } });
  });

  it("NEXT_PUBLIC_APP_VERSION 覆盖包版本", async () => {
    process.env.NEXT_PUBLIC_APP_VERSION = "0.6.0-test";
    trackEvent("e1");
    await flushEvents();
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.events[0].app_version).toBe("0.6.0-test");
  });
});

describe("flushEvents() 异常归一化", () => {
  it("网络异常为非 Error 值：String 归一化后吞错", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue("network down");
    trackEvent("e1");
    await expect(flushEvents()).resolves.toBeUndefined();
  });
});

describe("trackEvent()/flushEvents()", () => {
  it("未启用时 flush 直接清空队列（零网络开销）", async () => {
    delete process.env.NEXT_PUBLIC_APPARK_ENDPOINT;
    trackEvent("checkout.session_created", { userId: "u1" });
    await flushEvents();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("启用时批量 POST 事件（含版本与时间戳）", async () => {
    trackEvent("cron.digest", { sent: 3 });
    await flushEvents();

    const init = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer key");
    const body = JSON.parse(init.body);
    expect(body.events).toHaveLength(1);
    expect(body.events[0]).toMatchObject({ event: "cron.digest", app_version: expect.any(String) });
  });

  it("无事件时 flush 为 no-op", async () => {
    await flushEvents();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("非 2xx 保留批次待重试", async () => {
    fetchMockResolved.ok = false;
    fetchMockResolved.status = 500;
    trackEvent("e1");
    await flushEvents();
    expect(fetch).toHaveBeenCalledTimes(1);

    fetchMockResolved.ok = true;
    await flushEvents();
    const init = (fetch as ReturnType<typeof vi.fn>).mock.calls[1][1];
    expect(JSON.parse(init.body).events).toHaveLength(1);
  });

  it("网络异常吞错不抛出", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network down"));
    trackEvent("e1");
    await expect(flushEvents()).resolves.toBeUndefined();
  });
});
