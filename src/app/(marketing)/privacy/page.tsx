/**
 * 隐私政策页面（服务端组件）
 * 详细说明数据收集、使用、存储和安全保护措施
 * 使用服务端 i18n 渲染各语言版本
 */

import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("privacy");
  return {
    title: t("metaTitle"),
    description: t("metaDesc"),
  };
}

export default async function PrivacyPage() {
  const t = await getTranslations("privacy");
  const sections = t.raw("sections") as Array<{ title: string; content: string }>;

  return (
    <div className="container py-12 lg:py-20">
      <div className="mx-auto max-w-3xl">
        <Badge variant="secondary" className="mb-4">{t("metaTitle")}</Badge>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{t("pageTitle")}</h1>
        <p className="mt-4 text-muted-foreground">{t("lastUpdated")}</p>

        <div className="mt-12 space-y-8 leading-relaxed">
          {sections.map((section) => (
            <section key={section.title}>
              <h2 className="text-2xl font-semibold">{section.title}</h2>
              <p className="mt-2 text-muted-foreground">{section.content}</p>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
