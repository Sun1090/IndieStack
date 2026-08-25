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
import { getTranslations } from "next-intl/server";
import { FaqList } from "./faq-list";

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

            {/* FAQ 列表（客户端搜索） */}
      <FaqList categories={categories} />
    </div>
  );
}
