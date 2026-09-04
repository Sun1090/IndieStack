/**
 * Auth 错误映射单元测试
 * 验证 Supabase Auth 错误码 → i18n actions 命名空间错误码的映射
 */
import { describe, it, expect } from "vitest";
import { authErrorKey } from "./errors";

describe("authErrorKey()", () => {
  it("映射已知错误码", () => {
    expect(authErrorKey({ code: "invalid_credentials" })).toBe("authInvalidCredentials");
    expect(authErrorKey({ code: "email_not_confirmed" })).toBe("authEmailNotConfirmed");
    expect(authErrorKey({ code: "user_already_exists" })).toBe("authUserExists");
    expect(authErrorKey({ code: "weak_password" })).toBe("authWeakPassword");
    expect(authErrorKey({ code: "over_email_send_rate_limit" })).toBe("authRateLimit");
    expect(authErrorKey({ code: "otp_expired" })).toBe("authOtpExpired");
  });

  it("映射 OAuth/回调交换错误", () => {
    expect(authErrorKey({ code: "access_denied" })).toBe("authOauthDenied");
    expect(authErrorKey({ code: "bad_oauth_state" })).toBe("authOauthDenied");
    expect(authErrorKey({ code: "server_error" })).toBe("authUnexpectedFailure");
    expect(authErrorKey({ code: "invalid_grant" })).toBe("authOtpExpired");
  });

  it("映射 PKCE 会话丢失错误", () => {
    expect(authErrorKey({ code: "flow_state_not_found" })).toBe("authSessionExpired");
    expect(authErrorKey({ code: "flow_state_expired" })).toBe("authSessionExpired");
  });

  it("映射 MFA 验证错误", () => {
    expect(authErrorKey({ code: "mfa_challenge_expired" })).toBe("authOtpExpired");
    expect(authErrorKey({ code: "mfa_verification_failed" })).toBe("authMfaFailed");
    expect(authErrorKey({ code: "mfa_verification_rejected" })).toBe("authMfaFailed");
    expect(authErrorKey({ code: "mfa_factor_not_found" })).toBe("authMfaFailed");
  });

  it("未知错误码回退到通用 authError", () => {
    expect(authErrorKey({ code: "some_unknown_code" })).toBe("authError");
  });

  it("无 code 时回退到 authError", () => {
    expect(authErrorKey({ message: "random" })).toBe("authError");
  });

  it("null / undefined 输入回退到 authError", () => {
    expect(authErrorKey(null)).toBe("authError");
    expect(authErrorKey(undefined)).toBe("authError");
  });
});
