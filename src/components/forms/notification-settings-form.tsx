"use client";
/**
 * 通知设置表单组件
 * 通过开关控制不同类型通知的邮件推送偏好
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
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
      toast({ title: "Error", description: result.error, variant: "destructive" });
      setLoading(false);
      return;
    }

    toast({ title: "Settings saved", description: "Your notification preferences have been updated." });
    router.refresh();
    setLoading(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="space-y-0.5">
            <Label htmlFor="emailNotifications">Email Notifications</Label>
            <p className="text-sm text-muted-foreground">
              Receive email notifications for account activity.
            </p>
          </div>
            <Switch
              id="emailNotifications"
              checked={localSettings.emailNotifications}
              onCheckedChange={(checked: boolean) =>
                setLocalSettings((prev) => ({ ...prev, emailNotifications: checked }))
              }
            />
        </div>

        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="space-y-0.5">
            <Label htmlFor="marketingEmails">Marketing Emails</Label>
            <p className="text-sm text-muted-foreground">
              Receive emails about new features and promotions.
            </p>
          </div>
            <Switch
              id="marketingEmails"
              checked={localSettings.marketingEmails}
              onCheckedChange={(checked: boolean) =>
                setLocalSettings((prev) => ({ ...prev, marketingEmails: checked }))
              }
            />
        </div>

        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="space-y-0.5">
            <Label htmlFor="productUpdates">Product Updates</Label>
            <p className="text-sm text-muted-foreground">
              Receive emails about product updates and changelogs.
            </p>
          </div>
            <Switch
              id="productUpdates"
              checked={localSettings.productUpdates}
              onCheckedChange={(checked: boolean) =>
                setLocalSettings((prev) => ({ ...prev, productUpdates: checked }))
              }
            />
        </div>

        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="space-y-0.5">
            <Label htmlFor="securityAlerts">Security Alerts</Label>
            <p className="text-sm text-muted-foreground">
              Receive emails about security alerts and login attempts.
            </p>
          </div>
            <Switch
              id="securityAlerts"
              checked={localSettings.securityAlerts}
              onCheckedChange={(checked: boolean) =>
                setLocalSettings((prev) => ({ ...prev, securityAlerts: checked }))
              }
            />
        </div>
      </div>

      <Button type="submit" disabled={loading}>
        {loading ? "Saving..." : "Save Preferences"}
      </Button>
    </form>
  );
}
