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
import Link from "next/link";
import { cn } from "@/lib/utils";
import { MarkAllReadButton } from "@/components/dashboard/mark-all-read-button";
import { MarkReadAction } from "@/components/dashboard/mark-read-action";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { ROUTES } from "@/lib/constants";
import { Bell } from "lucide-react";
import { formatRelativeTime } from "@/lib/date";
import { getLocale } from "next-intl/server";
import type { Database } from "@/lib/supabase/database.types";
import { listRecentNotifications } from "@/lib/repositories/notifications";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard");
  return { title: t("notifications.metaTitle"), description: t("notifications.metaDesc") };
}

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const t = await getTranslations("dashboard");

  const { data: profile } = (await supabase
    .from("profiles")
    .select("*")
    .eq("id", user!.id)
    .single()) as unknown as { data: Record<string, unknown> | null };

  const notifications = await listRecentNotifications(user!.id, 10);

  const locale = await getLocale();
  const { filter } = await searchParams;
  const showUnreadOnly = filter === "unread";
  const visibleNotifications = (notifications ?? []).filter(
    (n) => !showUnreadOnly || !n.is_read,
  );

  const badgeVariant = (type: string) => {
    if (type === "success") return "success" as const;
    if (type === "warning") return "warning" as const;
    if (type === "error") return "destructive" as const;
    return "secondary" as const;
  };

  return (
    <div className="space-y-8">
      <PageHeader title={t("notifications.title")} description={t("notifications.desc")} />

      <Card>
        <CardHeader>
          <CardTitle>{t("notifications.preferences.title")}</CardTitle>
          <CardDescription>{t("notifications.preferences.desc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <NotificationSettingsForm
            settings={(profile?.notification_settings as Record<string, boolean>) ?? {}}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>{t("notifications.list.title")}</CardTitle>
            <CardDescription>{t("notifications.list.desc")}</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={ROUTES.dashboardNotifications}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm",
                !showUnreadOnly ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent",
              )}
            >
              {t("notifications.list.tabAll")}
            </Link>
            <Link
              href={`${ROUTES.dashboardNotifications}?filter=unread`}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm",
                showUnreadOnly ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent",
              )}
            >
              {t("notifications.list.tabUnread")}
            </Link>
            <MarkAllReadButton
              unreadCount={(notifications ?? []).filter((n) => !n.is_read).length}
            />
          </div>
        </CardHeader>
        <CardContent>
          {visibleNotifications.length === 0 ? (
            <EmptyState icon={Bell} title={t("notifications.list.empty")} />
          ) : (
            <div className="space-y-4">
              {visibleNotifications.map((notification) => (
                <div
                  key={notification.id}
                  className="flex items-start justify-between gap-4 border-b pb-4 last:border-0 last:pb-0"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{notification.title}</p>
                      <Badge variant={badgeVariant(notification.type)} className="capitalize">
                        {notification.type}
                      </Badge>
                      {!notification.is_read && (
                        <MarkReadAction notificationId={String(notification.id)} />
                      )}
                    </div>
                    {notification.body && (
                      <p className="text-sm text-muted-foreground">{notification.body}</p>
                    )}
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatRelativeTime(notification.created_at, { locale })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
