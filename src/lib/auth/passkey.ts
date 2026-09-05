/**
 * Passkey（WebAuthn）服务端配置与 challenge 传递（v0.5.0 D01，ADR-012）
 * - RP ID / origin 由 NEXT_PUBLIC_APP_URL 推导，避免额外环境变量
 * - challenge 经短时 httpOnly cookie 传递（无状态、serverless 友好），5 分钟过期
 */
import type { NextRequest, NextResponse } from "next/server";

export const PASSKEY_CHALLENGE_COOKIE = "pk_challenge";
const CHALLENGE_TTL_SEC = 300;

/** 站点 URL（与邮件/存储等模块同一兜底口径） */
export function siteUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

/** WebAuthn RP ID = 站点域名（不含端口与协议） */
export function rpId(): string {
  return new URL(siteUrl()).hostname;
}

/** 验证时的期望 origin（含协议，本地允许 http） */
export function expectedOrigin(): string {
  return siteUrl();
}

/** 把 challenge 写入响应 cookie（httpOnly + SameSite=Lax + 5 分钟） */
export function setChallengeCookie(response: NextResponse, challenge: string): NextResponse {
  response.cookies.set(PASSKEY_CHALLENGE_COOKIE, challenge, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: CHALLENGE_TTL_SEC,
    path: "/",
  });
  return response;
}

/** 读取并校验请求中的 challenge cookie（供 verify 流程比对） */
export function readChallengeCookie(request: NextRequest): string | null {
  return request.cookies.get(PASSKEY_CHALLENGE_COOKIE)?.value ?? null;
}

/** 验证完成后清除 challenge cookie */
export function clearChallengeCookie(response: NextResponse): NextResponse {
  response.cookies.delete(PASSKEY_CHALLENGE_COOKIE);
  return response;
}
