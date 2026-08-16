/**
 * 常见问题页面（服务端组件）
 * 按分类展示用户常见问题及其答案
 * 使用服务端 i18n 渲染各语言版本
 */

import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ROUTES } from "@/lib/constants";
import { ChevronDown } from "lucide-react";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("faq");
  return {
    title: t("metaTitle"),
    description: t("metaDesc"),
  };
}

export default async function FAQPage() {
  const t = await getTranslations("faq");
  const categories = t.raw("categories") as Array<{
    name: string;
    questions: Array<{ q: string; a: string }>;
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
      </div>

      {/* FAQ Categories */}
      <div className="mx-auto mt-16 max-w-3xl space-y-12">
        {categories.map((category) => (
          <div key={category.name}>
            <h2 className="mb-6 text-2xl font-bold">{category.name}</h2>
            <div className="space-y-3">
              {category.questions.map((item) => (
                <details
                  key={item.q}
                  className="group rounded-lg border bg-card transition-colors hover:border-primary/50"
                >
                  <summary className="flex cursor-pointer items-center justify-between p-4 text-sm font-medium">
                    {item.q}
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="border-t px-4 py-3 text-sm text-muted-foreground">{item.a}</div>
                </details>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Still have questions? */}
      <div className="mx-auto mt-20 max-w-3xl rounded-2xl bg-muted/50 p-12 text-center">
        <h2 className="text-3xl font-bold">{t("ctaTitle")}</h2>
        <p className="mt-2 text-muted-foreground">{t("ctaDesc")}</p>
        <div className="mt-6 flex justify-center gap-4">
          <Button asChild size="lg">
            <Link href={ROUTES.contact}>{t("ctaButton")}</Link>
          </Button>
          <Button variant="outline" size="lg" asChild>
            <Link href={ROUTES.dashboard}>{t("dashboardButton")}</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
