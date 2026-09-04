/**
 * Supabase Auth 错误 → i18n 错误码映射
 * 客户端安全：不依赖服务端 API，可在 "use client" 组件中直接使用。
 * 返回的 key 均存在于 messages/{locale}/actions.json 中。
 */

export type AuthLikeError = {
  code?: string | null;
  message?: string | null;
};

/** Supabase AuthError.code → actions 命名空间错误码 */
const AUTH_ERROR_CODE_MAP: Record<string, string> = {
  invalid_credentials: "authInvalidCredentials",
  email_not_confirmed: "authEmailNotConfirmed",
  user_already_exists: "authUserExists",
  weak_password: "authWeakPassword",
  over_email_send_rate_limit: "authRateLimit",
  invalid_email: "authInvalidEmail",
  otp_expired: "authOtpExpired",
  same_password: "authSamePassword",
  user_not_found: "authUserNotFound",
  validation_failed: "authValidationFailed",
  signup_disabled: "authSignupDisabled",
  provider_disabled: "authProviderDisabled",
  unexpected_failure: "authUnexpectedFailure",
  // OAuth / 回调交换
  access_denied: "authOauthDenied",
  bad_oauth_state: "authOauthDenied",
  bad_oauth_callback: "authOauthDenied",
  server_error: "authUnexpectedFailure",
  temporarily_unavailable: "authUnexpectedFailure",
  invalid_grant: "authOtpExpired",
  invalid_request: "authValidationFailed",
  // PKCE 会话丢失（需重新登录）
  flow_state_not_found: "authSessionExpired",
  flow_state_expired: "authSessionExpired",
  session_not_found: "authSessionExpired",
  // MFA 验证
  mfa_challenge_expired: "authOtpExpired",
  mfa_verification_failed: "authMfaFailed",
  mfa_verification_rejected: "authMfaFailed",
  mfa_factor_not_found: "authMfaFailed",
};

/**
 * 将 Supabase Auth 错误映射为 actions 命名空间的 i18n 错误码。
 * 无法识别的错误回退到通用 authError，避免向用户展示英文原始信息。
 */
export function authErrorKey(error: AuthLikeError | null | undefined): string {
  const code = error?.code;
  if (code && AUTH_ERROR_CODE_MAP[code]) {
    return AUTH_ERROR_CODE_MAP[code];
  }
  return "authError";
}
