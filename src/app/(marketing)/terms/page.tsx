/**
 * 服务条款页面（服务端组件）
 * 详细说明服务的接受条件、账户责任、使用限制和知识产权
 * 使用服务端 i18n 渲染各语言版本
 */

import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("terms");
  return {
    title: t("metaTitle"),
    description: t("metaDesc"),
  };
}

export default async function TermsPage() {
  const t = await getTranslations("terms");
  const sections = t.raw("sections") as Array<{ title: string; content: string }>;

  return (
    <div className="container py-12 lg:py-20">
      <div className="mx-auto max-w-3xl">
        <Badge variant="secondary" className="mb-4">
          {t("metaTitle")}
        </Badge>
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
