/**
 * 会话读取故障分类器测试（C09）
 * 覆盖：网络型故障与 5xx 判为「没读到」；「本来就没有会话」与 4xx 判为「没有」；
 *       认不出的形状一律落在拒绝侧（维持 main 的既有行为）。
 */
import { describe, expect, it } from "vitest";
import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
} from "@supabase/supabase-js";
import { isRetryableSessionReadFailure } from "./session-error";

describe("isRetryableSessionReadFailure()", () => {
  it("fetch 失败（网络断开 / 请求被丢弃）是「没读到」", () => {
    expect(isRetryableSessionReadFailure(new AuthRetryableFetchError("Failed to fetch", 0))).toBe(
      true,
    );
  });

  it("Auth 服务端 5xx 是「没读到」", () => {
    expect(isRetryableSessionReadFailure(new AuthApiError("bad gateway", 502, undefined))).toBe(
      true,
    );
  });

  it("匿名访客的 AuthSessionMissingError 不是故障", () => {
    expect(isRetryableSessionReadFailure(new AuthSessionMissingError())).toBe(false);
  });

  it("4xx 与没有状态码（令牌过期 / 无效凭据）不是故障，是要重新登录", () => {
    expect(
      isRetryableSessionReadFailure(new AuthApiError("invalid claim: exp", 401, undefined)),
    ).toBe(false);
    expect(isRetryableSessionReadFailure(new AuthApiError("no status", 0, undefined))).toBe(false);
  });

  it("空值与认不出的形状都落在拒绝侧", () => {
    expect(isRetryableSessionReadFailure(null)).toBe(false);
    expect(isRetryableSessionReadFailure(undefined)).toBe(false);
    expect(isRetryableSessionReadFailure({ message: "something" })).toBe(false);
    expect(isRetryableSessionReadFailure(new Error("boom"))).toBe(false);
  });
});
