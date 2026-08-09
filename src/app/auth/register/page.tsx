/**
 * 注册页面（Server Component）
 * 通过 RegisterForm 组件提供邮箱注册和 OAuth 注册
 * 使用服务端 i18n 获取翻译文本
 */

export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { RegisterForm } from "@/components/auth/register-form";
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
    title: t("register.metaTitle"),
    description: t("register.metaDesc"),
  };
}

export default async function RegisterPage() {
  const t = await getTranslations("auth");

  return (
    <div className="container flex h-screen w-screen flex-col items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 text-center">
          <CardTitle className="text-2xl">{t("register.title")}</CardTitle>
          <CardDescription>{t("register.desc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <RegisterForm />
        </CardContent>
        <CardFooter className="flex justify-center">
          <p className="text-sm text-muted-foreground">
            {t("register.hasAccount")}{" "}
            <Link
              href={ROUTES.login}
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              {t("register.signIn")}
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
