/**
 * 重置密码表单客户端组件
 * 提供新密码和确认密码输入，更新用户密码
 * 仅在检测到有效的 recovery session 时显示表单，避免无会话时误改密码
 * 使用客户端 i18n 显示文本
 */

"use client";

import { useEffect, useState } from "react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { ROUTES } from "@/lib/constants";
import { Lock, Eye, EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { authErrorKey } from "@/lib/auth/errors";

type SessionStatus = "checking" | "ready" | "invalid";

export function ResetPasswordForm() {
  const router = useRouter();
  const t = useTranslations("auth");
  const ta = useTranslations("actions");
  const [status, setStatus] = useState<SessionStatus>("checking");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const supabase = createClient();

  // 仅当存在 recovery session（通过密码重置链接进入）时才允许修改密码
  useEffect(() => {
    let mounted = true;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event: AuthChangeEvent, session: Session | null) => {
        if (mounted && event === "PASSWORD_RECOVERY" && session) {
          setStatus("ready");
        }
      }
    );

    const params = new URLSearchParams(window.location.search);
    const hasRecoveryParams = params.has("code") || params.has("token_hash");

    supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => {
      if (!mounted) return;
      if (data.session && hasRecoveryParams) {
        setStatus("ready");
      } else {
        setStatus("invalid");
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    if (password !== confirmPassword) {
      toast({
        title: t("resetPassword.error"),
        description: t("resetPassword.error"),
        variant: "destructive",
      });
      setLoading(false);
      return;
    }

    if (password.length < 8) {
      toast({ title: t("resetPassword.error"), variant: "destructive" });
      setLoading(false);
      return;
    }

    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      toast({
        title: t("resetPassword.error"),
        description: ta(authErrorKey(error)),
        variant: "destructive",
      });
      setLoading(false);
      return;
    }

    toast({
      title: t("resetPassword.success"),
      description: t("resetPassword.success"),
    });
    router.push(ROUTES.login);
  };

  if (status === "checking") {
    return <p className="py-8 text-center text-sm text-muted-foreground">{t("resetPassword.checking")}</p>;
  }

  if (status === "invalid") {
    return (
      <div className="space-y-4 py-4 text-center">
        <p className="text-sm text-muted-foreground">{t("resetPassword.invalidSession")}</p>
        <Button asChild variant="outline" className="w-full">
          <Link href={ROUTES.forgotPassword}>{t("resetPassword.backToForgot")}</Link>
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="password">{t("resetPassword.passwordLabel")}</Label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("resetPassword.passwordPlaceholder")}
              autoComplete="new-password"
              disabled={loading}
              minLength={8}
              required
            />
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setShowPassword(!showPassword)}
              tabIndex={-1}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="confirmPassword">{t("resetPassword.confirmLabel")}</Label>
          <Input
            id="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder={t("resetPassword.confirmPlaceholder")}
            autoComplete="new-password"
            disabled={loading}
            minLength={8}
            required
          />
        </div>
        <Button disabled={loading} type="submit" className="w-full">
          {loading ? t("resetPassword.loading") : t("resetPassword.submit")}
          <Lock className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </form>
  );
}
