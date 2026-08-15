"use client";
/**
 * 通知设置表单组件
 * 通过开关控制不同类型通知的邮件推送偏好
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { updateNotificationSettings } from "@/lib/actions/settings";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";

interface NotificationSettingsFormProps {
  settings: Record<string, boolean>;
}

export function NotificationSettingsForm({ settings }: NotificationSettingsFormProps) {
  const router = useRouter();
  const t = useTranslations("dashboard.notifications.preferences");
  const tc = useTranslations("common");
  const ta = useTranslations("actions");
  const [loading, setLoading] = useState(false);
  const [localSettings, setLocalSettings] = useState({
    emailNotifications: settings.emailNotifications ?? true,
    marketingEmails: settings.marketingEmails ?? false,
    productUpdates: settings.productUpdates ?? true,
    securityAlerts: settings.securityAlerts ?? true,
  });

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    formData.set("emailNotifications", localSettings.emailNotifications ? "on" : "off");
    formData.set("marketingEmails", localSettings.marketingEmails ? "on" : "off");
    formData.set("productUpdates", localSettings.productUpdates ? "on" : "off");
    formData.set("securityAlerts", localSettings.securityAlerts ? "on" : "off");

    const result = await updateNotificationSettings(formData);

    if (result.error) {
      toast({ title: tc("error"), description: ta(result.error), variant: "destructive" });
      setLoading(false);
      return;
    }

    toast({ title: t("success"), description: t("successDesc") });
    router.refresh();
    setLoading(false);
  }

  const toggles = [
    { id: "emailNotifications", label: t("emailLabel"), desc: t("emailDesc") },
    { id: "marketingEmails", label: t("marketingLabel"), desc: t("marketingDesc") },
    { id: "productUpdates", label: t("productLabel"), desc: t("productDesc") },
    { id: "securityAlerts", label: t("securityLabel"), desc: t("securityDesc") },
  ] as const;

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-4">
        {toggles.map((toggle) => (
          <div key={toggle.id} className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
              <Label htmlFor={toggle.id}>{toggle.label}</Label>
              <p className="text-sm text-muted-foreground">{toggle.desc}</p>
            </div>
            <Switch
              id={toggle.id}
              checked={localSettings[toggle.id]}
              onCheckedChange={(checked: boolean) =>
                setLocalSettings((prev) => ({ ...prev, [toggle.id]: checked }))
              }
            />
          </div>
        ))}
      </div>

      <Button type="submit" disabled={loading}>
        {loading ? t("saving") : t("submit")}
      </Button>
    </form>
  );
}
