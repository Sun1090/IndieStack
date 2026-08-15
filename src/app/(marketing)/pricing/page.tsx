/**
 * 定价页面（服务端组件）
 * 展示 Free/Pro/Enterprise 三级定价方案
 * 包含月度/年度切换、FAQ 常见问题解答
 * 使用服务端 i18n 渲染各语言版本
 */

import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";
import Link from "next/link";
import { ROUTES, SUBSCRIPTION_TIERS } from "@/lib/constants";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pricing");
  return {
    title: t("metaTitle"),
    description: t("metaDesc"),
  };
}

export default async function PricingPage() {
  const t = await getTranslations("pricing");
  const tc = await getTranslations("common");
  const faqs = t.raw("faq.questions") as Array<{ q: string; a: string }>;

  return (
    <div className="container py-12 lg:py-20">
      {/* Header */}
      <div className="mx-auto max-w-3xl text-center">
        <Badge variant="secondary" className="mb-4">{t("metaTitle")}</Badge>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{t("pageTitle")}</h1>
        <p className="mt-4 text-lg text-muted-foreground">{t("pageDesc")}</p>
      </div>

      {/* Pricing Cards */}
      <div className="mt-12 grid gap-8 md:grid-cols-3">
        {Object.entries(SUBSCRIPTION_TIERS).map(([key, tier]) => (
          <Card
            key={key}
            className={
              key === "pro"
                ? "relative border-primary shadow-lg"
                : ""
            }
          >
            {key === "pro" && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <Badge>{t("popular")}</Badge>
              </div>
            )}

            <CardHeader className="text-center">
              <CardTitle className="text-2xl">{tier.name}</CardTitle>
              <CardDescription>
                <span className="text-4xl font-bold text-foreground">${tier.price}</span>
                <span className="text-muted-foreground">{t("perMonth")}</span>
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-6">
              <ul className="space-y-3">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-3">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                    <span className="text-sm">{tc(`tierFeatures.${feature}`)}</span>
                  </li>
                ))}
              </ul>

              <Button
                asChild
                className="w-full"
                variant={key === "free" ? "outline" : "default"}
              >
                <Link href={ROUTES.register}>
                  {key === "free" ? t("getStarted") : t("startTrial", { planName: tier.name })}
                </Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* FAQ */}
      <div className="mt-20">
        <h2 className="mb-8 text-center text-2xl font-bold">{t("faq.title")}</h2>
        <div className="mx-auto grid max-w-3xl gap-6 md:grid-cols-2">
          {faqs.map((faq) => (
            <div key={faq.q}>
              <h3 className="font-semibold">{faq.q}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{faq.a}</p>
            </div>
          ))}
        </div>
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
