/**
 * 联系我们页面（服务端组件）
 * 提供联系表单和联系方式信息（邮箱、GitHub、Twitter）
 * 表单使用 ContactForm 客户端组件实现提交功能
 */

import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ContactForm } from "./contact-form";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("contact");
  return {
    title: t("metaTitle"),
    description: t("metaDesc"),
  };
}

export default async function ContactPage() {
  const t = await getTranslations("contact");

  return (
    <div className="container py-12 lg:py-20">
      <div className="mx-auto max-w-3xl">
        <Badge variant="secondary" className="mb-4">{t("metaTitle")}</Badge>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{t("pageTitle")}</h1>
        <p className="mt-4 text-lg text-muted-foreground">{t("pageDesc")}</p>

        <div className="mt-12 grid gap-8 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t("form.title")}</CardTitle>
              <CardDescription>{t("form.desc")}</CardDescription>
            </CardHeader>
            <CardContent>
              <ContactForm />
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>{t("info.email")}</CardTitle>
                <CardDescription>hello@indiestack.dev</CardDescription>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{t("info.github")}</CardTitle>
                <CardDescription>github.com/indiestack</CardDescription>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{t("info.twitter")}</CardTitle>
                <CardDescription>@indiestack</CardDescription>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{t("info.responseTime")}</CardTitle>
                <CardDescription>{t("info.responseDesc")}</CardDescription>
              </CardHeader>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
