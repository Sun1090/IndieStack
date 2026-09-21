"use client";

/**
 * 危险区域：删除账户（v0.6.0 H08）
 *
 * 输入确认短语才允许提交，服务端仍会独立校验（`@/lib/privacy/data-policy`）——
 * 这里的门控只是防误触，不是安全边界。删除成功后立即离开 dashboard，
 * 因为账户与个人数据都已经不存在，留在原地只会让下一次请求报 401。
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deleteAccountAction } from "@/lib/actions/account";
import { ROUTES } from "@/lib/constants";

export function DeleteAccountSection() {
  const t = useTranslations("dashboard.settings.sections.danger");
  const tc = useTranslations("common");
  const ta = useTranslations("actions");
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteAccountAction({ confirm: phrase });
      if (!result.ok) {
        setError(ta(result.error));
        return;
      }
      router.push(ROUTES.home);
      router.refresh();
    });
  }

  return (
    <Card className="border-destructive">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive-text">
          <AlertTriangle className="h-5 w-5" />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("desc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <p className="text-sm font-medium">{t("deleteAccount")}</p>
          <p className="text-sm text-muted-foreground">{t("deleteDesc")}</p>
          <p className="text-xs text-muted-foreground">{t("eraseSummary")}</p>
        </div>

        {confirming ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              handleDelete();
            }}
            className="flex flex-wrap items-end gap-2"
          >
            <Input
              autoFocus
              maxLength={32}
              value={phrase}
              onChange={(event) => setPhrase(event.target.value)}
              placeholder={t("confirmPhrase")}
              aria-label={t("confirmPhrase")}
              className="max-w-xs"
            />
            <Button type="submit" variant="destructive" size="sm" disabled={pending || !phrase.trim()}>
              {pending ? t("deleting") : t("deleteConfirm")}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(false)}>
              {tc("cancel")}
            </Button>
          </form>
        ) : (
          <Button variant="destructive" size="sm" onClick={() => setConfirming(true)}>
            {t("deleteAccount")}
          </Button>
        )}

        {error && (
          <p className="text-sm text-destructive-text" role="alert">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
