/**
 * 登录页面（Server Component）
 * 通过 LoginForm 组件提供邮箱密码登录和 OAuth 社交登录
 * 使用服务端 i18n 获取翻译文本
 */

export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "@/components/auth/login-form";
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
    title: t("login.metaTitle"),
    description: t("login.metaDesc"),
  };
}

export default async function LoginPage() {
  const t = await getTranslations("auth");

  return (
    <div className="container flex h-screen w-screen flex-col items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 text-center">
          <CardTitle className="text-2xl">{t("login.title")}</CardTitle>
          <CardDescription>{t("login.desc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm />
        </CardContent>
        <CardFooter className="flex justify-center">
          <p className="text-sm text-muted-foreground">
            {t("login.noAccount")}{" "}
            <Link
              href={ROUTES.register}
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              {t("login.signUp")}
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
