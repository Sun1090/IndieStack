"use client";

/**
 * MFA 登录挑战页
 * 登录表单检测到已验证 TOTP 因子时跳转至此，输入验证码完成 aal2 升级后进入 dashboard；
 * 验证器丢失时可用恢复码自救（兑换即解除 2FA，需重新登录）。
 */

export const dynamic = "force-dynamic";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { getSafeRedirect } from "@/lib/safe-redirect";
import { ROUTES } from "@/lib/constants";
import { authErrorKey } from "@/lib/auth/errors";
import { redeemRecoveryCode } from "@/lib/actions/recovery-codes";
import { logAuthEvent } from "@/lib/actions/audit";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";

function MfaForm() {
  const t = useTranslations("auth.mfa");
  const ta = useTranslations("actions");
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = getSafeRedirect(searchParams.get("redirect"), ROUTES.dashboard);

  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");
  const supabase = createClient();

  // 直接访问缺 factor 参数：不渲染表单，给出回登录入口
  if (!searchParams.get("factor")) {
    return (
      <div className="space-y-6 text-center">
        <p className="text-sm text-muted-foreground">{t("missingFactor")}</p>
        <Button asChild className="w-full">
          <Link href={ROUTES.login}>{t("backToLogin")}</Link>
        </Button>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const factorId = searchParams.get("factor") ?? "";
    const cleaned = code.replace(/\s+/g, "");

    const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
      factorId,
    });

    if (challengeError || !challengeData) {
      toast({ title: "MFA", description: challengeError?.message, variant: "destructive" });
      setLoading(false);
      return;
    }

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challengeData.id,
      code: cleaned,
    });

    if (verifyError) {
      toast({
        title: "MFA",
        description: authErrorKey(verifyError),
        variant: "destructive",
      });
      setLoading(false);
      return;
    }

    // aal2 已达成，刷新会话后进入目标页
    await supabase.auth.refreshSession();
    void logAuthEvent("auth.mfa_verified", {});
    router.push(redirect);
    router.refresh();
  }

  async function handleRedeem(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const result = await redeemRecoveryCode(recoveryCode);
    setLoading(false);
    if (!result.ok) {
      toast({ title: "MFA", description: ta(result.error), variant: "destructive" });
      return;
    }
    // 兑换会登出所有会话，引导重新登录
    toast({ title: "MFA", description: t("redeemed") });
    router.push(ROUTES.login);
    router.refresh();
  }

  return recoveryMode ? (
    <form onSubmit={handleRedeem} className="space-y-6">
      <p className="text-sm text-muted-foreground">{t("recoveryDesc")}</p>
      <div className="space-y-2">
        <Label htmlFor="recovery-code" className="sr-only">
          {t("recoveryTitle")}
        </Label>
        <Input
          id="recovery-code"
          autoFocus
          value={recoveryCode}
          onChange={(e) => setRecoveryCode(e.target.value)}
          className="text-center font-mono text-xl tracking-[0.3em]"
          placeholder={t("recoveryPlaceholder")}
          required
        />
      </div>
      <Button type="submit" disabled={loading || recoveryCode.trim().length === 0} className="w-full">
        {loading ? "..." : t("recoverySubmit")}
      </Button>
      <Button
        type="button"
        variant="ghost"
        className="w-full"
        onClick={() => setRecoveryMode(false)}
      >
        {t("backToCode")}
      </Button>
    </form>
  ) : (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="mfa-code" className="sr-only">
          {t("codeLabel")}
        </Label>
        <Input
          id="mfa-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          className="text-center font-mono text-2xl tracking-[0.5em]"
          placeholder="000000"
          required
        />
      </div>
      <Button type="submit" disabled={loading || code.length !== 6} className="w-full">
        {loading ? "..." : t("submit")}
      </Button>
      <Button
        type="button"
        variant="ghost"
        className="w-full"
        onClick={() => setRecoveryMode(true)}
      >
        {t("useRecovery")}
      </Button>
    </form>
  );
}

export default function MfaPage() {
  const t = useTranslations("auth.mfa");
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Suspense fallback={null}>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("desc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <MfaForm />
        </CardContent>
      </Card>
      </Suspense>
    </div>
  );
}
