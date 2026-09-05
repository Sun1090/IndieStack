"use client";
/**
 * 通行密钥管理区块（v0.5.0 D01，ADR-012）
 * 注册：register-options → 浏览器 WebAuthn → register-verify；
 * 列表/删除由服务端组件注入数据、Server Action 执行。
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { startRegistration } from "@simplewebauthn/browser";
import { deletePasskey } from "@/lib/actions/passkey";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";

export interface PasskeyItem {
  id: string;
  device_name: string | null;
  created_at: string;
  last_used_at: string | null;
}

export function PasskeySection({ credentials }: { credentials: PasskeyItem[] }) {
  const router = useRouter();
  const t = useTranslations("dashboard.settings.sections.security");
  const tc = useTranslations("common");
  const ta = useTranslations("actions");
  const [registering, setRegistering] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleRegister() {
    setRegistering(true);
    try {
      const optionsRes = await fetch("/api/auth/passkey/register-options", { method: "POST" });
      if (!optionsRes.ok) throw new Error("options failed");
      const options = await optionsRes.json();

      const attestation = await startRegistration({ optionsJSON: options });
      const verifyRes = await fetch("/api/auth/passkey/register-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: attestation }),
      });
      if (!verifyRes.ok) throw new Error("verify failed");

      toast({ title: t("passkeyRegistered") });
      router.refresh();
    } catch {
      toast({ title: tc("error"), description: ta("internalError"), variant: "destructive" });
    } finally {
      setRegistering(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    const result = await deletePasskey(id);
    setDeletingId(null);
    if (!result.ok) {
      toast({ title: tc("error"), description: ta(result.error), variant: "destructive" });
      return;
    }
    toast({ title: t("passkeyDeleted") });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("passkeyDesc")}</p>
      {credentials.length > 0 && (
        <ul className="divide-y">
          {credentials.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-4 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {c.device_name ?? t("passkeyUnnamed")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {c.last_used_at ? t("passkeyLastUsed") : t("passkeyNeverUsed")}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={deletingId === c.id}
                onClick={() => handleDelete(c.id)}
              >
                {t("passkeyDelete")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Button disabled={registering} onClick={handleRegister}>
        {registering ? t("passkeyRegistering") : t("passkeyRegister")}
      </Button>
    </div>
  );
}
