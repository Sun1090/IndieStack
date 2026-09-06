"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { subscribeToPush } from "@/lib/actions/push-subscriptions";

const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

function decodeVapidKey(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

export function PushNotificationForm() {
  const t = useTranslations("dashboard.notifications.push");
  const tc = useTranslations("common");
  const [loading, setLoading] = useState(false);
  const [enabled, setEnabled] = useState(false);

  async function toggle() {
    if (!vapidPublicKey) {
      toast({ title: tc("error"), description: t("unconfigured"), variant: "destructive" });
      return;
    }
    if (
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window)
    ) {
      toast({ title: tc("error"), description: t("unsupported"), variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const registration = await navigator.serviceWorker.register("/sw.js");
      if (Notification.permission === "denied") throw new Error("permission");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("permission");
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeVapidKey(vapidPublicKey),
      });
      const data = subscription.toJSON();
      const formData = new FormData();
      formData.set("endpoint", data.endpoint ?? "");
      formData.set("p256dh", data.keys?.p256dh ?? "");
      formData.set("auth", data.keys?.auth ?? "");
      const result = await subscribeToPush(formData);
      if (!result.ok) throw new Error(result.error);
      setEnabled(true);
      toast({ title: t("enabled") });
    } catch {
      toast({ title: tc("error"), description: t("failed"), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center justify-between rounded-lg border p-4">
      <div>
        <p className="font-medium">{t("title")}</p>
        <p className="text-muted-foreground text-sm">{t("desc")}</p>
      </div>
      <Button type="button" disabled={loading || enabled} onClick={toggle}>
        {enabled ? t("enabled") : t("enable")}
      </Button>
    </div>
  );
}
