/**
 * 个人资料查看页面
 * 显示用户基本信息和账户注册时间
 * 已接入国际化支持
 */

export const dynamic = "force-dynamic";

import { getTranslations, getLocale } from "next-intl/server";
import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/constants";
import { PageHeader } from "@/components/shared/page-header";
import { formatDate } from "@/lib/date";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard");
  return { title: t("profile.view.metaTitle"), description: t("profile.view.metaDesc") };
}

export default async function ProfilePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const t = await getTranslations("dashboard");
  const locale = await getLocale();

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user!.id)
    .single() as unknown as { data: Record<string, unknown> | null };

  const memberSince = user?.created_at
    ? formatDate(user.created_at, { locale })
    : t("profile.view.notSet");

  return (
    <div className="space-y-8">
      <PageHeader title={t("profile.view.title")} description={t("profile.view.desc")}>
        <Button asChild>
          <Link href={ROUTES.dashboardProfileEdit}>{t("profile.view.editProfile")}</Link>
        </Button>
      </PageHeader>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="md:col-span-2">
          <CardHeader>
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16">
                <AvatarFallback className="text-lg">
                  {(profile?.full_name as string)?.charAt(0)?.toUpperCase() ?? user?.email?.charAt(0).toUpperCase() ?? "U"}
                </AvatarFallback>
              </Avatar>
              <div>
                <CardTitle>{(profile?.full_name as string) ?? t("profile.view.notSet")}</CardTitle>
                <CardDescription>{user?.email}</CardDescription>
                <Badge variant="outline" className="mt-1">{(profile?.role as string) ?? "user"}</Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="text-sm font-medium text-muted-foreground">{t("profile.view.email")}</p>
                <p className="text-sm">{user?.email}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">{t("profile.view.memberSince")}</p>
                <p className="text-sm">{memberSince}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">{t("profile.view.role")}</p>
                <p className="text-sm capitalize">{(profile?.role as string) ?? "user"}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">{t("profile.view.timezone")}</p>
                <p className="text-sm">{(profile?.timezone as string) ?? "UTC"}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">{t("profile.view.language")}</p>
                <p className="text-sm">
                  {(() => {
                    const lang = (profile?.language as string) ?? "en";
                    return t.has(`profile.view.languages.${lang}`)
                      ? t(`profile.view.languages.${lang}`)
                      : lang;
                  })()}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
