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
import { PushNotificationForm } from "@/components/forms/push-notification-form";
import { NotificationSettingsForm } from "@/components/forms/notification-settings-form";
import { ThemeSettingsForm } from "@/components/forms/theme-settings-form";
import { PasswordForm } from "@/components/forms/password-form";
import { TwoFactorSection } from "@/components/dashboard/two-factor-section";
import { LogoutAllButton } from "@/components/dashboard/logout-all-button";
import { SignOutOthersButton } from "@/components/dashboard/sign-out-others-button";
import { RevokeSessionButton } from "@/components/dashboard/revoke-session-button";
import { PasskeySection } from "@/components/dashboard/passkey-section";
import { DeleteAccountSection } from "@/components/dashboard/delete-account-section";
import { listMyCredentials } from "@/lib/repositories/webauthn";
import { features } from "@/lib/feature-flags";
import { sessionIdFromAccessToken } from "@/lib/session-id";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { MonitorSmartphone } from "lucide-react";
import type { Database } from "@/lib/supabase/database.types";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard");
  return { title: t("settings.metaTitle"), description: t("settings.metaDesc") };
}

/**
 * 读「最近 20 台设备」与「哪一台是当前这台」。
 *
 * 抽出来是因为这两件事必须一起成立：列表里每台都可吊销，而认不出当前设备时
 * 把标记留空就等于递给用户一把可能砍到自己会话的刀——所以要么两个都拿到，要么在渲染前抛。
 * （`SettingsPage` 原本还要自己拆 `Promise.all` 的两个结果，complexity 也因此越线。）
 */
async function readDeviceList(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<{
  rows: Database["public"]["Tables"]["user_sessions"]["Row"][];
  currentSessionId: string | null;
}> {
  const [{ data: sessions, error: sessionsError }, { data: sessionData, error: sessionError }] =
    await Promise.all([
      supabase
        .from("user_sessions")
        .select("*")
        .eq("user_id", userId)
        .order("last_seen_at", { ascending: false })
        .limit(20),
      supabase.auth.getSession(),
    ]);
  if (sessionsError) {
    throw new Error(`读取登录设备失败：${sessionsError.message}`);
  }
  if (sessionError) {
    throw new Error(`读取当前会话失败：${sessionError.message}`);
  }
  return {
    rows: sessions ?? [],
    currentSessionId: sessionIdFromAccessToken(sessionData?.session?.access_token ?? ""),
  };
}

export default async function SettingsPage() {
  const supabase = await createClient();
  const tc = await getTranslations("common");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const t = await getTranslations("dashboard");

  // 断言里明写 `error: null`＝断言「这次查询不可能出错」。这里的后果是一张可点的列表：
  // 设备那一栏读失败会渲染成「你只有当前这台设备」，用户于是以为没有别的登录要收掉。
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user!.id)
    .maybeSingle();
  if (profileError) {
    throw new Error(`读取个人资料失败：${profileError.message}`);
  }

  // D02 设备列表：最近 20 台设备（含当前），配合 revokeSession 吊销
  const { rows: deviceRows, currentSessionId } = await readDeviceList(supabase, user!.id);
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
              <p className="text-muted-foreground text-sm">
                {t("settings.sections.security.currentSession", {
                  email: user?.email ?? "",
                  time: user?.last_sign_in_at
                    ? formatRelativeTime(user.last_sign_in_at, { locale: await getLocale() })
                    : "—",
                })}
              </p>
              <SignOutOthersButton />
              <LogoutAllButton />
              <PushNotificationForm />
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
                <EmptyState
                  icon={MonitorSmartphone}
                  title={t("settings.sections.security.devicesEmpty")}
                  className="py-6"
                />
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
                              <span className="bg-primary/10 text-primary ms-2 rounded px-1.5 py-0.5 text-xs">
                                {t("settings.sections.security.currentDevice")}
                              </span>
                            )}
                          </p>
                          <p className="text-muted-foreground text-xs">
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

      <DeleteAccountSection />
    </div>
  );
}
