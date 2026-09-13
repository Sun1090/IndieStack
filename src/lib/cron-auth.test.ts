/**
 * cron 共享鉴权单测（v0.8.0 / E03）
 * 覆盖：未配置 secret、Bearer、x-cron-secret、错误值，以及拒绝原因的区分
 */
import { describe, expect, it } from "vitest";
import { checkCronAuth, CRON_SECRET_HEADER, isCronAuthorized } from "./cron-auth";

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

describe("checkCronAuth", () => {
  it("未配置 secret 时归因到部署漏配，而不是调用方问题", () => {
    expect(checkCronAuth(headers({ authorization: "Bearer x" }), undefined)).toBe(
      "secret_unconfigured",
    );
    expect(checkCronAuth(headers({}), "")).toBe("secret_unconfigured");
  });

  it("完全没有携带凭据时与携带错误凭据区分开", () => {
    expect(checkCronAuth(headers({}), "s3cret")).toBe("missing_credentials");
    expect(checkCronAuth(headers({ authorization: "Bearer wrong" }), "s3cret")).toBe(
      "invalid_credentials",
    );
    // 携带了但值为空：算「凭据不对」，不算「没带凭据」
    expect(checkCronAuth(headers({ [CRON_SECRET_HEADER]: "" }), "s3cret")).toBe(
      "invalid_credentials",
    );
  });

  it("正确凭据返回 authorized，且不影响 isCronAuthorized 的行为", () => {
    expect(checkCronAuth(headers({ authorization: "Bearer s3cret" }), "s3cret")).toBe(
      "authorized",
    );
    expect(checkCronAuth(headers({ [CRON_SECRET_HEADER]: "s3cret" }), "s3cret")).toBe("authorized");
    expect(isCronAuthorized(headers({ [CRON_SECRET_HEADER]: "s3cret" }), "s3cret")).toBe(true);
  });

  it("空值头与 Bearer 前缀不匹配都算 invalid，不回显凭据", () => {
    const wrong = checkCronAuth(headers({ authorization: "Bearer " }), "s3cret");
    expect(wrong).toBe("invalid_credentials");
    expect(JSON.stringify(wrong)).not.toContain("s3cret");
  });
});
