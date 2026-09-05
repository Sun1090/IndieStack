"use client";
/**
 * 单设备吊销按钮（v0.5.0 D02）
 * 调用 revokeSession 删除设备会话并刷新列表；当前设备行不展示按钮。
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { revokeSession } from "@/lib/actions/sessions";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";

export function RevokeSessionButton({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const tc = useTranslations("common");
  const ta = useTranslations("actions");
  const ts = useTranslations("dashboard.settings.sections.security");
  const [revoking, setRevoking] = useState(false);

  async function handleRevoke() {
    setRevoking(true);
    const result = await revokeSession(sessionId);
    setRevoking(false);

    if (!result.ok) {
      toast({ title: tc("error"), description: ta(result.error), variant: "destructive" });
      return;
    }
    toast({ title: ts("deviceRevoked") });
    router.refresh();
  }

  return (
    <Button variant="outline" size="sm" disabled={revoking} onClick={handleRevoke}>
      {revoking ? tc("loading") : ts("revokeDevice")}
    </Button>
  );
}
