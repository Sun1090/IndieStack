/**
 * 邀请成员页面
 * 通过邮箱邀请新成员加入团队
 * 已接入国际化支持
 */

export const dynamic = "force-dynamic";

import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InviteMemberForm } from "@/components/forms/invite-member-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard");
  return { title: t("team.invite.metaTitle"), description: t("team.invite.metaDesc") };
}

export default async function InviteMemberPage() {
  const t = await getTranslations("dashboard");

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t("team.invite.title")}</h1>
        <p className="text-muted-foreground">{t("team.invite.desc")}</p>
      </div>

      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>{t("team.invite.title")}</CardTitle>
          <CardDescription>{t("team.invite.desc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <InviteMemberForm />
        </CardContent>
      </Card>
    </div>
  );
}
