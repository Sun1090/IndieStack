/**
 * 设置页面
 * 管理通用设置、密码修改、外观主题和账户删除
 * 已接入国际化支持
 */

export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase/server";
import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NotificationSettingsForm } from "@/components/forms/notification-settings-form";
import { PasswordForm } from "@/components/forms/password-form";
import { PageHeader } from "@/components/shared/page-header";
import type { Database } from "@/lib/supabase/database.types";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard");
  return { title: t("settings.metaTitle"), description: t("settings.metaDesc") };
}

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const t = await getTranslations("dashboard");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user!.id)
    .single() as unknown as { data: Database["public"]["Tables"]["profiles"]["Row"] | null; error: null };

  return (
    <div className="space-y-8">
      <PageHeader title={t("settings.title")} description={t("settings.desc")} />

      <Tabs defaultValue="notifications" className="space-y-6">
        <TabsList>
          <TabsTrigger value="notifications">通知</TabsTrigger>
          <TabsTrigger value="security">{t("settings.sections.password.title")}</TabsTrigger>
          <TabsTrigger value="appearance">{t("settings.sections.appearance.title")}</TabsTrigger>
        </TabsList>

        <TabsContent value="notifications">
          <Card>
            <CardHeader>
              <CardTitle>通知偏好</CardTitle>
              <CardDescription>选择你想接收哪些通知。</CardDescription>
            </CardHeader>
            <CardContent>
              <NotificationSettingsForm
                settings={profile?.notification_settings as Record<string, boolean> ?? {}}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security">
          <Card>
            <CardHeader>
              <CardTitle>{t("settings.sections.password.title")}</CardTitle>
              <CardDescription>{t("settings.sections.password.desc")}</CardDescription>
            </CardHeader>
            <CardContent>
              <PasswordForm />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="appearance">
          <Card>
            <CardHeader>
              <CardTitle>{t("settings.sections.appearance.title")}</CardTitle>
              <CardDescription>{t("settings.sections.appearance.desc")}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {t("settings.sections.appearance.desc")}
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
