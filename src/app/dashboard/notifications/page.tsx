/**
 * 通知页面
 * 管理通知偏好设置和提醒方式
 * 已接入国际化支持
 */

export const dynamic = "force-dynamic";

import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { NotificationSettingsForm } from "@/components/forms/notification-settings-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard");
  return { title: t("notifications.metaTitle"), description: t("notifications.metaDesc") };
}

export default async function NotificationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const t = await getTranslations("dashboard");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user!.id)
    .single() as unknown as { data: Record<string, unknown> | null };

  return (
    <div className="space-y-8">
      <PageHeader
        title={t("notifications.title")}
        description={t("notifications.desc")}
      />

      <Card>
        <CardHeader>
          <CardTitle>{t("notifications.preferences.title")}</CardTitle>
          <CardDescription>{t("notifications.preferences.desc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <NotificationSettingsForm
            settings={profile?.notification_settings as Record<string, boolean> ?? {}}
          />
        </CardContent>
      </Card>
    </div>
  );
}
