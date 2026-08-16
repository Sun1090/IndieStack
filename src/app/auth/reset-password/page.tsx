/**
 * 重置密码页面（Server Component）
 * 通过 ResetPasswordForm 组件设置新密码
 * 使用服务端 i18n 获取翻译文本
 */

export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { ResetPasswordForm } from "./reset-password-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return {
    title: t("resetPassword.metaTitle"),
    description: t("resetPassword.metaDesc"),
  };
}

export default async function ResetPasswordPage() {
  const t = await getTranslations("auth");

  return (
    <div className="container flex h-screen w-screen flex-col items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 text-center">
          <CardTitle className="text-2xl">{t("resetPassword.title")}</CardTitle>
          <CardDescription>{t("resetPassword.desc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <ResetPasswordForm />
        </CardContent>
      </Card>
    </div>
  );
}
