/**
 * 个人资料编辑页面
 * 通过 ProfileEditForm 组件更新姓名、简介和头像
 * 已接入国际化支持
 */

export const dynamic = "force-dynamic";

import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ROUTES } from "@/lib/constants";
import { ProfileEditForm } from "@/components/forms/profile-edit-form";
import { AvatarUploadForm } from "@/components/forms/avatar-upload-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard");
  return { title: t("profile.edit.metaTitle"), description: t("profile.edit.metaDesc") };
}

export default async function ProfileEditPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const t = await getTranslations("dashboard");

  if (!user) redirect(ROUTES.login);

  const { data: profile } = (await supabase
    .from("profiles")
    .select("full_name, bio, timezone, language, avatar_url")
    .eq("id", user.id)
    .single()) as unknown as {
    data: {
      full_name: string | null;
      bio: string | null;
      timezone: string | null;
      language: string | null;
      avatar_url: string | null;
    } | null;
  };

  return (
    <div className="space-y-8">
      <PageHeader title={t("profile.edit.title")} description={t("profile.edit.desc")} />

      <Card>
        <CardHeader>
          <CardTitle>{t("profile.edit.title")}</CardTitle>
          <CardDescription>{t("profile.edit.desc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileEditForm
            fullName={profile?.full_name ?? ""}
            bio={profile?.bio ?? ""}
            timezone={profile?.timezone ?? "UTC"}
            language={profile?.language ?? "en"}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("profile.edit.avatarLabel")}</CardTitle>
          <CardDescription>{t("profile.edit.avatarDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <AvatarUploadForm />
        </CardContent>
      </Card>
    </div>
  );
}
