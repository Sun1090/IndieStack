/**
 * cron 共享鉴权单测（v0.8.0）
 * 覆盖：未配置 secret、Bearer、x-cron-secret、错误值
 */
import { describe, expect, it } from "vitest";
import { CRON_SECRET_HEADER, isCronAuthorized } from "./cron-auth";

function headers(values: Record<string, string>) {
  return { get: (name: string) => values[name.toLowerCase()] ?? null };
}

describe("isCronAuthorized", () => {
  it("未配置或空 secret 一律拒绝", () => {
    expect(isCronAuthorized(headers({ authorization: "Bearer x" }), undefined)).toBe(false);
    expect(isCronAuthorized(headers({ [CRON_SECRET_HEADER]: "x" }), "")).toBe(false);
  });

  it("接受 Bearer 与 x-cron-secret 两种携带方式", () => {
    expect(isCronAuthorized(headers({ authorization: "Bearer s3cret" }), "s3cret")).toBe(true);
    expect(isCronAuthorized(headers({ [CRON_SECRET_HEADER]: "s3cret" }), "s3cret")).toBe(true);
  });

  it("拒绝错误或格式不符的凭据", () => {
    expect(isCronAuthorized(headers({ authorization: "Bearer wrong" }), "s3cret")).toBe(false);
    expect(isCronAuthorized(headers({ authorization: "s3cret" }), "s3cret")).toBe(false);
    expect(isCronAuthorized(headers({ [CRON_SECRET_HEADER]: "wrong" }), "s3cret")).toBe(false);
    expect(isCronAuthorized(headers({}), "s3cret")).toBe(false);
  });
});
