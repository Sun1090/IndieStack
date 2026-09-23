/**
 * Passkey 的 RP ID / origin 推导与 challenge cookie（v0.5.0 D01，ADR-012）
 *
 * 这里钉的是「浏览器实际送来的那个字符串能不能对上」。WebAuthn 的 `authData.origin`
 * 永远是 `scheme://host[:port]`——不带路径、不带尾斜杠——而 @simplewebauthn 用的是**严格
 * 相等**比较（`node_modules/@simplewebauthn/server/esm/registration/verifyRegistrationResponse.js:83`
 * 的 `origin !== expectedOrigin`）。所以推导多留一个斜杠，注册和登录就会稳定失败，
 * 而客户端看到的只是「Verification failed」，看不出是环境变量写错了。
 * 路由测试（`src/app/api/auth/passkey/passkey.test.ts`）把 `@simplewebauthn/server` 整个 mock 掉，
 * 所以这条相等比较在那里永远不会真的跑——它只能在这里钉。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import {
  PASSKEY_CHALLENGE_COOKIE,
  clearChallengeCookie,
  expectedOrigin,
  readChallengeCookie,
  rpId,
  setChallengeCookie,
  siteUrl,
} from "./passkey";

const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_APP_URL;
});

afterEach(() => {
  if (originalAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
});

describe("siteUrl / rpId / expectedOrigin", () => {
  it("没配 NEXT_PUBLIC_APP_URL 时回落到本地开发地址", () => {
    expect(siteUrl()).toBe("http://localhost:3000");
    expect(rpId()).toBe("localhost");
    expect(expectedOrigin()).toBe("http://localhost:3000");
  });

  it("规范写法（只有协议和域名）原样通过", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
    expect(expectedOrigin()).toBe("https://app.example.com");
    expect(rpId()).toBe("app.example.com");
  });

  it("尾斜杠不会跟着进 origin", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com/";
    expect(expectedOrigin()).toBe("https://app.example.com");
  });

  it("带 basePath 的部署不会把它当成 origin 的一部分", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com/console";
    expect(expectedOrigin()).toBe("https://app.example.com");
    expect(rpId()).toBe("app.example.com");
  });

  it("非默认端口是 origin 的一部分，必须留着", () => {
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3100";
    expect(expectedOrigin()).toBe("http://localhost:3100");
    expect(rpId()).toBe("localhost");
  });
});

describe("challenge cookie", () => {
  it("写入的是 httpOnly + SameSite=Lax + 5 分钟过期的全站 cookie", () => {
    const cookie = setChallengeCookie(NextResponse.json({ ok: true }), "challenge-value").headers.get(
      "set-cookie",
    );

    expect(cookie).toContain(`${PASSKEY_CHALLENGE_COOKIE}=challenge-value`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=lax");
    expect(cookie).toContain("Max-Age=300");
    expect(cookie).toContain("Path=/");
  });

  it("生产环境外不加 Secure（本地 http 才能用）", () => {
    const cookie = setChallengeCookie(NextResponse.json({ ok: true }), "challenge-value").headers.get(
      "set-cookie",
    );

    expect(process.env.NODE_ENV).not.toBe("production");
    expect(cookie).not.toContain("Secure");
  });

  it("验证完成后清掉 challenge", () => {
    const cookie = clearChallengeCookie(NextResponse.json({ ok: true })).headers.get("set-cookie");

    expect(cookie).toContain(`${PASSKEY_CHALLENGE_COOKIE}=`);
    expect(cookie).toContain("Expires=Thu, 01 Jan 1970");
  });

  it("challenge 读得到就用，读不到给出 null 而不是 undefined", () => {
    expect(readChallengeCookie(withCookie(`${PASSKEY_CHALLENGE_COOKIE}=abc`))).toBe("abc");
    expect(readChallengeCookie(withCookie("other=1"))).toBeNull();
  });
});

function withCookie(cookie: string) {
  return new NextRequest("https://app.example.com/api/auth/passkey/auth-verify", {
    method: "POST",
    headers: { cookie },
  });
}
