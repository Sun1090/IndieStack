"use client";

/**
 * 注册表单组件
 * 提供邮箱注册和 OAuth 注册方式
 * 注册成功后自动跳转到登录页
 * 使用客户端 i18n 显示文本
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { Mail } from "lucide-react";
import { ROUTES } from "@/lib/constants";
import { useTranslations } from "next-intl";
import { authErrorKey } from "@/lib/auth/errors";

export function RegisterForm() {
  const router = useRouter();
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const ta = useTranslations("actions");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const supabase = createClient();

  const handleEmailRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      toast({
        title: t("register.error"),
        description: ta(authErrorKey(error)),
        variant: "destructive",
      });
      setLoading(false);
      return;
    }

    toast({
      title: tc("success"),
      description: t("register.success"),
    });
    router.push(ROUTES.login);
  };

  return (
    <form onSubmit={handleEmailRegister}>
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
            autoComplete="new-password"
            disabled={loading}
            minLength={6}
            required
          />
          <p className="text-xs text-muted-foreground">{t("register.desc")}</p>
        </div>
        <Button disabled={loading} type="submit" className="w-full">
          {loading ? t("register.loading") : t("register.submit")}
          <Mail className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </form>
  );
}
