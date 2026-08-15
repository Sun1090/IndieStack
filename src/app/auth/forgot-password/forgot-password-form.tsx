/**
 * 忘记密码表单客户端组件
 * 输入邮箱地址，发送密码重置链接
 * 使用客户端 i18n
 */

"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { Mail, CheckCircle2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { authErrorKey } from "@/lib/auth/errors";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const ta = useTranslations("actions");
  const supabase = createClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    });

    if (error) {
      toast({
        title: t("forgotPassword.error"),
        description: ta(authErrorKey(error)),
        variant: "destructive",
      });
      setLoading(false);
      return;
    }

    setSent(true);
    setLoading(false);
  };

  if (sent) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <CheckCircle2 className="h-12 w-12 text-green-500" />
        <div>
          <p className="font-medium">{t("forgotPassword.success")}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("forgotPassword.sentTo")} <strong>{email}</strong>
          </p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
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
        <Button disabled={loading} type="submit" className="w-full">
          {loading ? t("forgotPassword.loading") : t("forgotPassword.submit")}
          <Mail className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </form>
  );
}
