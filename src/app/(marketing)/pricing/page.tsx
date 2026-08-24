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
import { PricingCards } from "./pricing-cards";

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
        <Badge variant="secondary" className="mb-4">
          {t("metaTitle")}
        </Badge>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{t("pageTitle")}</h1>
        <p className="mt-4 text-lg text-muted-foreground">{t("pageDesc")}</p>
      </div>

      {/* Pricing Cards（客户端月/年切换） */}
      <PricingCards />
    </div>
  );
}
