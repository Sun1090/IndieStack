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

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("full_name, bio, timezone, language, avatar_url")
    .eq("id", user.id)
    // 缺行是「这个账户还没有 profiles 记录」，表单按空值预填是对的；查询失败不是同一件事。
    .maybeSingle();

  if (profileError) {
    // 抛给错误边界而不是继续渲染：下面的表单会把 `""` / `UTC` / `en` 当现值预填，
    // 用户看不出任何异常地点一次「保存」，就把真实的姓名、简介、时区全部覆盖掉。
    throw new Error(`读取个人资料失败：${profileError.message}`);
  }

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
