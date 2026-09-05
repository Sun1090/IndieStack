"use client";

/**
 * 双因素认证（TOTP）设置卡
 * 流程：未启用 → [开始设置] → 扫码 → 输入 6 位验证码 → 已启用 → [解除]
 */

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { ShieldCheck, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { dashboardQueryOptions, QUERY_KEYS } from "@/lib/query-cache";
import {
  listTotpFactors,
  enrollTotp,
  verifyTotpEnrollment,
  unenrollTotp,
} from "@/lib/actions/mfa";
import {
  generateRecoveryCodes,
  hasRecoveryCodes,
} from "@/lib/actions/recovery-codes";

type Step = "idle" | "scanning" | "verifying" | "unenrolling";

export function TwoFactorSection() {
  const t = useTranslations("dashboard.settings.sections.twoFactor");
  const tc = useTranslations("common");
  const ta = useTranslations("actions");

  const [step, setStep] = useState<Step>("idle");
  const [enrollData, setEnrollData] = useState<{ factorId: string; qrCode: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // 查询当前因子状态
  const { data: factors = [], isLoading } = useQuery(
    dashboardQueryOptions({
    queryKey: QUERY_KEYS.mfaFactors,
    queryFn: async () => {
      const result = await listTotpFactors();
      if (!result.ok) throw new Error(result.error);
      return result.data ?? [];
    },
    }));

  const activeFactor = factors.find((f) => f.status === "verified");
  const enabled = Boolean(activeFactor);

  function startEnroll() {
    setError(null);
    startTransition(async () => {
      const result = await enrollTotp();
      if (!result.ok) {
        setError(ta(result.error));
        return;
      }
      setEnrollData(result.data!);
      setStep("scanning");
    });
  }

  function submitVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!enrollData) return;
    setError(null);
    startTransition(async () => {
      const result = await verifyTotpEnrollment(enrollData.factorId, code);
      if (!result.ok) {
        setError(ta(result.error));
        return;
      }
      setCode("");
      setEnrollData(null);
      setStep("idle");
    });
  }

  function submitUnenroll(e: React.FormEvent) {
    e.preventDefault();
    if (!activeFactor) return;
    setError(null);
    startTransition(async () => {
      const result = await unenrollTotp(activeFactor.id, code);
      if (!result.ok) {
        setError(ta(result.error));
        return;
      }
      setCode("");
      setStep("idle");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {enabled ? (
            <ShieldCheck className="h-5 w-5 text-emerald-500" />
          ) : (
            <ShieldAlert className="h-5 w-5 text-amber-500" />
          )}
          {t("title")}
          {enabled && (
            <Badge variant="success" className="ml-1">
              {t("enabledBadge")}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>{t("desc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? null : enabled ? (
          <>
            <p className="text-sm text-muted-foreground">{t("enabledDesc")}</p>
            <form onSubmit={submitUnenroll} className="flex items-end gap-2">
              <div className="space-y-1">
                <Input
                  inputMode="numeric"
                  maxLength={6}
                  placeholder={t("codePlaceholder")}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="w-36 font-mono tracking-[0.3em]"
                  aria-label={t("codeLabel")}
                />
              </div>
              <Button type="submit" variant="destructive" size="sm" disabled={pending}>
                {t("disable")}
              </Button>
            </form>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <RecoveryCodesSection />
          </>
        ) : step === "idle" ? (
          <>
            <p className="text-sm text-muted-foreground">{t("notEnabledDesc")}</p>
            <Button onClick={startEnroll} disabled={pending}>
              {t("start")}
            </Button>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </>
        ) : (
          <div className="space-y-4">
            {/* 二维码 + 密钥 */}
            <div className="flex items-start gap-4">
              {enrollData?.qrCode && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={enrollData.qrCode} alt={t("qrAlt")} className="h-40 w-40 rounded-lg border bg-white p-2" />
              )}
              <div className="space-y-2 text-sm">
                <p>{t("scanHint")}</p>
                <p className="text-xs text-muted-foreground">{t("manualHint")}</p>
                <code className="block rounded bg-muted px-2 py-1 font-mono text-xs break-all">
                  {enrollData?.secret}
                </code>
              </div>
            </div>

            <form onSubmit={submitVerify} className="flex items-end gap-2">
              <div className="space-y-1 flex-1 max-w-xs">
                <Input
                  inputMode="numeric"
                  autoFocus
                  maxLength={6}
                  placeholder={t("codePlaceholder")}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="font-mono tracking-[0.3em]"
                  aria-label={t("codeLabel")}
                />
              </div>
              <Button type="submit" disabled={pending || code.length !== 6}>
                {t("verifyBtn")}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setStep("idle")}>
                {tc("cancel")}
              </Button>
            </form>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Badge 导入补充（避免顶部重复整理）
import { Badge as _Badge } from "@/components/ui/badge";
void _Badge;

/**
 * 恢复码区块（独立组件：明文仅生成时展示一次；重新生成作废旧码）
 */
function RecoveryCodesSection() {
  const t = useTranslations("dashboard.settings.sections.twoFactor");
  const ta = useTranslations("actions");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const { data: hasCodes, refetch } = useQuery(
    dashboardQueryOptions({
    queryKey: QUERY_KEYS.recoveryStatus,
    queryFn: async () => {
      const result = await hasRecoveryCodes();
      if (!result.ok) throw new Error(result.error);
      return result.data?.has ?? false;
    },
    }));

  function startGenerate() {
    setError(null);
    setCopied(false);
    startTransition(async () => {
      const result = await generateRecoveryCodes();
      if (!result.ok) {
        setError(ta(result.error));
        return;
      }
      setCodes(result.data?.codes ?? []);
      void refetch();
    });
  }

  function copyCodes() {
    if (!codes) return;
    void navigator.clipboard.writeText(codes.join("\n")).then(() => setCopied(true));
  }

  return (
    <div className="space-y-2 border-t pt-4">
      <p className="text-sm font-medium">{t("recoveryTitle")}</p>
      <p className="text-sm text-muted-foreground">{t("recoveryDesc")}</p>
      {codes ? (
        <div className="space-y-2">
          <p className="text-sm font-medium text-amber-600">{t("recoveryShowOnce")}</p>
          <code className="block rounded bg-muted px-3 py-2 font-mono text-sm leading-7">
            {codes.map((c) => (
              <span key={c} className="block">
                {c}
              </span>
            ))}
          </code>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={copyCodes}>
              {copied ? t("recoveryCopied") : t("recoveryCopy")}
            </Button>
            <Button type="button" size="sm" onClick={() => setCodes(null)}>
              {t("recoveryDone")}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {hasCodes ? t("recoveryHasCodes") : t("recoveryNoCodes")}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={startGenerate} disabled={pending}>
            {hasCodes ? t("recoveryRegenerate") : t("recoveryGenerate")}
          </Button>
        </>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
