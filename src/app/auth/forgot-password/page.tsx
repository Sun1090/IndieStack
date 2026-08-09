/**
 * 忘记密码页面（Server Component）
 * 通过 ForgotPasswordForm 组件发送密码重置邮件
 * 使用服务端 i18n 获取翻译文本
 */

export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "./forgot-password-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ROUTES } from "@/lib/constants";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return {
    title: t("forgotPassword.metaTitle"),
    description: t("forgotPassword.metaDesc"),
  };
}

export default async function ForgotPasswordPage() {
  const t = await getTranslations("auth");

  return (
    <div className="container flex h-screen w-screen flex-col items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 text-center">
          <CardTitle className="text-2xl">{t("forgotPassword.title")}</CardTitle>
          <CardDescription>{t("forgotPassword.desc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <ForgotPasswordForm />
        </CardContent>
        <CardFooter className="flex justify-center">
          <p className="text-sm text-muted-foreground">
            {t("forgotPassword.rememberPassword")}{" "}
            <Link
              href={ROUTES.login}
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              {t("forgotPassword.signIn")}
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
