"use client";

/**
 * 认证回调页面（客户端组件）
 * 处理 OAuth 登录回调，交换认证码获取会话
 * 支持 PKCE 流和 Hash 片段流（魔法链接、OTP）
 * 使用客户端 i18n 显示状态文本
 */

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ROUTES } from "@/lib/constants";
import { getSafeRedirect } from "@/lib/safe-redirect";
import { useTranslations } from "next-intl";
import { authErrorKey } from "@/lib/auth/errors";

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

  useEffect(() => {
    const handleAuthCallback = async () => {
      const supabase = createClient();
      const code = searchParams.get("code");
      let error = null;

      if (code) {
        const result = await supabase.auth.exchangeCodeForSession(code);
        error = result.error;
      } else {
        const hash = window.location.hash?.substring(1);
        if (hash) {
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
      }

      if (error) {
        // 使用本地化错误消息，避免向用户展示 Supabase 英文原始信息
        setStatus(`${t("callback.failed")} ${ta(authErrorKey(error))}`);
        setTimeout(() => {
          router.push(ROUTES.login);
        }, 2000);
        return;
      }

      setStatus(t("callback.success"));
      router.push(redirect);
      router.refresh();
    };

    handleAuthCallback();
  }, [router, redirect, searchParams, t, ta]);

  return (
    <div className="text-center">
      <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      <p className="mt-4 text-muted-foreground">{status}</p>
    </div>
  );
}

export default function AuthCallbackPage() {
  const t = useTranslations("auth");
  return (
    <div className="container flex h-screen w-screen flex-col items-center justify-center">
      <Suspense
        fallback={
          <div className="text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            <p className="mt-4 text-muted-foreground">{t("callback.loading")}</p>
          </div>
        }
      >
        <CallbackHandler />
      </Suspense>
    </div>
  );
}
