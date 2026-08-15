"use client";

/**
 * 登录表单组件
 * 提供邮箱密码登录和 OAuth 社交登录（GitHub、Google）
 * 使用 Supabase Auth 客户端实现用户认证
 * 使用客户端 i18n 显示文本
 */

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { Github, Mail } from "lucide-react";
import { ROUTES } from "@/lib/constants";
import { getSafeRedirect } from "@/lib/safe-redirect";
import { useTranslations } from "next-intl";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = getSafeRedirect(searchParams.get("redirect"), ROUTES.dashboard);
  const t = useTranslations("auth");
  const tc = useTranslations("common");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const supabase = createClient();

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      toast({ title: t("login.error"), description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }

    router.push(redirect);
    router.refresh();
  };

  const handleGitHubLogin = async () => {
    setLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?redirect=${redirect}`,
      },
    });
    if (error) {
      toast({ title: t("login.oauthError", { provider: "GitHub" }), description: error.message, variant: "destructive" });
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?redirect=${redirect}`,
      },
    });
    if (error) {
      toast({ title: t("login.oauthError", { provider: "Google" }), description: error.message, variant: "destructive" });
      setLoading(false);
    }
  };

  return (
    <div className="grid gap-6">
      <form onSubmit={handleEmailLogin}>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="email">{tc("email")}</Label>
            <Input
              id="email"
              type="email"
              placeholder={tc("email")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect="off"
              disabled={loading}
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">{tc("password")}</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              disabled={loading}
              required
            />
            <div className="flex justify-end">
              <Link
                href={ROUTES.forgotPassword}
                className="text-xs text-muted-foreground underline-offset-4 hover:text-primary hover:underline"
              >
                {t("login.forgotPassword")}
              </Link>
            </div>
          </div>
          <Button disabled={loading} type="submit" className="w-full">
            {loading ? t("login.loading") : t("login.submit")}
            <Mail className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </form>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background px-2 text-muted-foreground">
            {t("login.divider")}
          </span>
        </div>
      </div>

      <div className="grid gap-3">
        <Button variant="outline" onClick={handleGitHubLogin} disabled={loading}>
          <Github className="mr-2 h-4 w-4" /> {t("login.oauthGithub")}
        </Button>
        <Button variant="outline" onClick={handleGoogleLogin} disabled={loading}>
          <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#EA4335"
            />
          </svg>
          {t("login.oauthGoogle")}
        </Button>
      </div>
    </div>
  );
}
