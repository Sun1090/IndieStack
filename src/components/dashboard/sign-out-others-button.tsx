"use client";

/**
 * 退出其他设备（保留当前会话）
 * Supabase others scope signOut：吊销除当前外全部 refresh token
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { MonitorSmartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export function SignOutOthersButton() {
  const t = useTranslations("dashboard.settings.sections.security");
  const tc = useTranslations("common");
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleSignOutOthers() {
    startTransition(async () => {
      const supabase = createClient();
      await supabase.auth.signOut({ scope: "others" });
      setConfirming(false);
      setDone(true);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center justify-between gap-4">
      <p className="text-sm text-muted-foreground">{done ? t("signOutOthersDone") : t("signOutOthersDesc")}</p>
      {confirming ? (
        <div className="flex gap-2">
          <Button size="sm" onClick={handleSignOutOthers} disabled={pending}>
            <MonitorSmartphone className="mr-2 h-4 w-4" />
            {tc("confirm")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setConfirming(false)}>
            {tc("cancel")}
          </Button>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setConfirming(true)} disabled={done}>
          {t("signOutOthers")}
        </Button>
      )}
    </div>
  );
}
