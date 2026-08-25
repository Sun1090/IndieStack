"use client";

/**
 * MFA 登录挑战页
 * 登录表单检测到已验证 TOTP 因子时跳转至此，输入验证码完成 aal2 升级后进入 dashboard
 */

export const dynamic = "force-dynamic";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getSafeRedirect } from "@/lib/safe-redirect";
import { ROUTES } from "@/lib/constants";
import { authErrorKey } from "@/lib/auth/errors";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { useSearchParams as useNextSearchParams } from "next/navigation";

function MfaForm() {
  const router = useRouter();
  const searchParams = useNextSearchParams();
  const redirect = getSafeRedirect(searchParams.get("redirect"), ROUTES.dashboard);

  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

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
    router.push(redirect);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="mfa-code" className="sr-only">
          verification code
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
        {loading ? "..." : "Verify"}
      </Button>
    </form>
  );
}

export default function MfaPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Suspense fallback={null}>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Two-Factor Authentication</CardTitle>
          <CardDescription>
            Enter the 6-digit code from your authenticator app.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MfaForm />
        </CardContent>
      </Card>
      </Suspense>
    </div>
  );
}
