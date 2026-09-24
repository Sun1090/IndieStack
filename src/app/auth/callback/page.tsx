"use client";

/**
 * 认证回调页面（客户端组件）
 * 处理 OAuth 登录回调，交换认证码获取会话
 * 支持 PKCE 流和 Hash 片段流（魔法链接、OTP）
 * 使用客户端 i18n 显示状态文本
 */

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ROUTES } from "@/lib/constants";
import { getSafeRedirect } from "@/lib/safe-redirect";
import { useTranslations } from "next-intl";
import { authErrorKey } from "@/lib/auth/errors";
import { LoadingIndicator } from "@/components/shared/page-loading";

function CallbackHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = getSafeRedirect(
    searchParams.get("redirect") ?? searchParams.get("next"),
    ROUTES.dashboard,
  );
  const t = useTranslations("auth");
  const ta = useTranslations("actions");
  const [status, setStatus] = useState(t("callback.completing"));
  /**
   * `reactStrictMode: true`（next.config.ts）在开发期会把 effect 跑两遍，而这一页花的是
   * **一次性**凭据：第二遍拿着同一枚已消费的 code 去换必被服务端拒，于是「登录成功」被
   * 自己随后写下的「登录失败」盖掉。所以这里按凭据本身去重，而不是给 effect 加取消标记——
   * 加了取消标记反而会把唯一一次真交换在 remount 时判死。
   * 定时器同一个 ref 记账：两遍里的第二遍没有自己的异步链，清理要落在第一遍排下的那个上。
   */
  const handledRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const clearPendingRedirect = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    const code = searchParams.get("code");
    const hash = window.location.hash?.substring(1);
    const credential = code ?? hash ?? "";
    if (handledRef.current === credential) return clearPendingRedirect;
    handledRef.current = credential;

    const handleAuthCallback = async () => {
      const supabase = createClient();
      let error = null;

      if (code) {
        const result = await supabase.auth.exchangeCodeForSession(code);
        error = result.error;
      } else if (hash) {
        const result = await supabase.auth.exchangeCodeForSession(hash);
        error = result.error;
      } else {
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();
        if (!session && sessionError) {
          error = sessionError;
        }
      }

      if (error) {
        // 使用本地化错误消息，避免向用户展示 Supabase 英文原始信息
        setStatus(`${t("callback.failed")} ${ta(authErrorKey(error))}`);
        timerRef.current = setTimeout(() => {
          router.push(ROUTES.login);
        }, 2000);
        return;
      }

      setStatus(t("callback.success"));
      router.push(redirect);
      router.refresh();
    };

    handleAuthCallback();
    return clearPendingRedirect;
  }, [router, redirect, searchParams, t, ta]);

  return <LoadingIndicator label={status} />;
}

export default function AuthCallbackPage() {
  const t = useTranslations("auth");
  return (
    <div className="container flex h-screen w-screen flex-col items-center justify-center">
      <Suspense fallback={<LoadingIndicator label={t("callback.loading")} />}>
        <CallbackHandler />
      </Suspense>
    </div>
  );
}
