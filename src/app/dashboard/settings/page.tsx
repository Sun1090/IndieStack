/**
 * 设置页面
 * 管理通用设置、密码修改、外观主题和账户删除
 * 已接入国际化支持
 */

export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase/server";
import { getLocale, getTranslations } from "next-intl/server";
import { formatRelativeTime } from "@/lib/date";
import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NotificationSettingsForm } from "@/components/forms/notification-settings-form";
import { ThemeSettingsForm } from "@/components/forms/theme-settings-form";
import { PasswordForm } from "@/components/forms/password-form";
import { TwoFactorSection } from "@/components/dashboard/two-factor-section";
import { LogoutAllButton } from "@/components/dashboard/logout-all-button";
import { SignOutOthersButton } from "@/components/dashboard/sign-out-others-button";
import { RevokeSessionButton } from "@/components/dashboard/revoke-session-button";
import { PasskeySection } from "@/components/dashboard/passkey-section";
import { listMyCredentials } from "@/lib/repositories/webauthn";
import { features } from "@/lib/feature-flags";
import { sessionIdFromAccessToken } from "@/lib/session-id";
import { PageHeader } from "@/components/shared/page-header";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import type { Database } from "@/lib/supabase/database.types";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard");
  return { title: t("settings.metaTitle"), description: t("settings.metaDesc") };
}

export default async function SettingsPage() {
  const supabase = await createClient();
  const tc = await getTranslations("common");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const t = await getTranslations("dashboard");

  const { data: profile } = (await supabase
    .from("profiles")
    .select("*")
    .eq("id", user!.id)
    .single()) as unknown as {
    data: Database["public"]["Tables"]["profiles"]["Row"] | null;
    error: null;
  };

  // D02 设备列表：最近 20 台设备（含当前），配合 revokeSession 吊销
  const [{ data: sessions }, { data: sessionData }] = await Promise.all([
    supabase
      .from("user_sessions")
      .select("*")
      .eq("user_id", user!.id)
      .order("last_seen_at", { ascending: false })
      .limit(20),
    supabase.auth.getSession(),
  ]);
  const currentSessionId = sessionIdFromAccessToken(sessionData?.session?.access_token ?? "");
  const deviceRows = (sessions ?? []) as unknown as Database["public"]["Tables"]["user_sessions"]["Row"][];
  const locale = await getLocale();
  const passkeyCredentials = features.passkey ? await listMyCredentials() : [];

  return (
    <div className="space-y-8">
      <Breadcrumbs
        items={[{ label: tc("dashboard"), href: "/dashboard" }, { label: t("settings.title") }]}
      />
      <PageHeader title={t("settings.title")} description={t("settings.desc")} />

      <Tabs defaultValue="notifications" className="space-y-6">
        <TabsList>
          <TabsTrigger value="notifications">{t("settings.sections.general.title")}</TabsTrigger>
          <TabsTrigger value="security">{t("settings.sections.password.title")}</TabsTrigger>
          <TabsTrigger value="appearance">{t("settings.sections.appearance.title")}</TabsTrigger>
        </TabsList>

        <TabsContent value="notifications">
          <Card>
            <CardHeader>
              <CardTitle>{t("notifications.preferences.title")}</CardTitle>
              <CardDescription>{t("notifications.preferences.desc")}</CardDescription>
            </CardHeader>
            <CardContent>
              <TwoFactorSection />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("settings.sections.security.title")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {t("settings.sections.security.currentSession", {
                  email: user?.email ?? "",
                  time: user?.last_sign_in_at
                    ? formatRelativeTime(user.last_sign_in_at, { locale: await getLocale() })
                    : "—",
                })}
              </p>
              <SignOutOthersButton />
              <LogoutAllButton />
              <NotificationSettingsForm
                settings={(profile?.notification_settings as Record<string, boolean>) ?? {}}
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

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>{t("settings.sections.security.devicesTitle")}</CardTitle>
              <CardDescription>{t("settings.sections.security.devicesDesc")}</CardDescription>
            </CardHeader>
            <CardContent>
              {deviceRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("settings.sections.security.devicesEmpty")}
                </p>
              ) : (
                <ul className="divide-y">
                  {deviceRows.map((device) => {
                    const isCurrent = device.id === currentSessionId;
                    return (
                      <li key={device.id} className="flex items-center justify-between gap-4 py-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {device.user_agent ?? "—"}
                            {isCurrent && (
                              <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
                                {t("settings.sections.security.currentDevice")}
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {String(device.ip_address ?? "")}
                            {device.ip_address ? " · " : ""}
                            {t("settings.sections.security.lastSeen")}:{" "}
                            {formatRelativeTime(String(device.last_seen_at), { locale })}
                          </p>
                        </div>
                        {!isCurrent && <RevokeSessionButton sessionId={device.id} />}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          {features.passkey && (
            <Card className="mt-6">
              <CardHeader>
                <CardTitle>{t("settings.sections.security.passkeyTitle")}</CardTitle>
              </CardHeader>
              <CardContent>
                <PasskeySection credentials={passkeyCredentials} />
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="appearance">
          <Card>
            <CardHeader>
              <CardTitle>{t("settings.sections.appearance.title")}</CardTitle>
              <CardDescription>{t("settings.sections.appearance.desc")}</CardDescription>
            </CardHeader>
            <CardContent>
              <ThemeSettingsForm />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
