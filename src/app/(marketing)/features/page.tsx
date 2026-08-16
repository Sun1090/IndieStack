/**
 * 功能特性页面（服务端组件）
 * 展示 IndieStack 提供的所有功能模块，按分类展示
 * 使用服务端 i18n 渲染各语言版本
 */

import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Shield, Database, Users, Bot, Lock, Cloud } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/constants";
import { getTranslations } from "next-intl/server";

const categoryIcons = [Shield, Database, Users, Bot, Lock, Cloud];

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("features");
  return {
    title: t("metaTitle"),
    description: t("metaDesc"),
  };
}

export default async function FeaturesPage() {
  const t = await getTranslations("features");
  const categories = t.raw("categories") as Array<{
    title: string;
    description: string;
    features: Array<{ title: string; description: string }>;
  }>;

  return (
    <div className="container py-12 lg:py-20">
      {/* Header */}
      <div className="mx-auto max-w-3xl text-center">
        <Badge variant="secondary" className="mb-4">
          {t("metaTitle")}
        </Badge>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{t("pageTitle")}</h1>
        <p className="mt-4 text-lg text-muted-foreground">{t("pageDesc")}</p>
        <div className="mt-8 flex justify-center gap-4">
          <Button asChild size="lg">
            <Link href={ROUTES.register}>{t("ctaButton")}</Link>
          </Button>
          <Button variant="outline" size="lg" asChild>
            <Link href={ROUTES.pricing}>{t("viewPricing")}</Link>
          </Button>
        </div>
      </div>

      {/* Features by Category */}
      <div className="mt-20 space-y-16">
        {categories.map((category, categoryIndex) => {
          const Icon = categoryIcons[categoryIndex % categoryIcons.length];
          return (
            <div key={category.title}>
              <div className="mb-8 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold">{category.title}</h2>
                  <p className="text-sm text-muted-foreground">{category.description}</p>
                </div>
              </div>
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
                {category.features.map((feature) => (
                  <Card key={feature.title} className="transition-colors hover:border-primary/50">
                    <CardHeader>
                      <CardTitle className="text-lg">{feature.title}</CardTitle>
                      <CardDescription>{feature.description}</CardDescription>
                    </CardHeader>
                  </Card>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* CTA */}
      <div className="mt-20 rounded-2xl bg-muted/50 p-12 text-center">
        <h2 className="text-3xl font-bold">{t("cta")}</h2>
        <p className="mt-2 text-muted-foreground">{t("ctaDesc")}</p>
        <div className="mt-6 flex justify-center gap-4">
          <Button asChild size="lg">
            <Link href={ROUTES.register}>{t("ctaButton")}</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
