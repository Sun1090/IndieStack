"use client";

/**
 * 退出所有设备
 * Supabase global scope signOut：吊销全部 refresh token
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { ROUTES } from "@/lib/constants";

export function LogoutAllButton() {
  const t = useTranslations("dashboard.settings.sections.security");
  const tc = useTranslations("common");
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleLogoutAll() {
    startTransition(async () => {
      const supabase = createClient();
      const { error } = await supabase.auth.signOut({ scope: "global" });
      // 这个按钮承诺的是「所有设备都掉线」。signOut 把失败装在 `error` 里返回而不是抛，
      // 不读它就等于在没做到的时候把用户送去登录页——看到的界面就是那条假的「已登出」。
      if (error) {
        setFailed(true);
        return;
      }
      setFailed(false);
      router.push(ROUTES.login);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center justify-between gap-4">
      <p
        className={failed ? "text-sm text-destructive-text" : "text-sm text-muted-foreground"}
        role={failed ? "alert" : undefined}
      >
        {failed ? t("logoutAllFailed") : t("logoutAllDesc")}
      </p>
      {confirming ? (
        <div className="flex gap-2">
          <Button variant="destructive" size="sm" onClick={handleLogoutAll} disabled={pending}>
            <LogOut className="me-2 h-4 w-4" />
            {tc("confirm")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setConfirming(false)}>
            {tc("cancel")}
          </Button>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
          {t("logoutAll")}
        </Button>
      )}
    </div>
  );
}
