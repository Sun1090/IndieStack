/**
 * 关于页面（服务端组件）
 * 介绍 IndieStack 的项目背景、团队价值观和技术栈
 * 使用服务端 i18n 渲染各语言版本
 */

import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ROUTES } from "@/lib/constants";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("about");
  return {
    title: t("metaTitle"),
    description: t("metaDesc"),
  };
}

export default async function AboutPage() {
  const t = await getTranslations("about");
  const storyParagraphs = t.raw("story.paragraphs") as string[];
  const values = t.raw("values.items") as Array<{ title: string; description: string }>;
  const techStack = t.raw("techStack.items") as Array<{ name: string; desc: string }>;

  return (
    <div className="container py-12 lg:py-20">
      {/* Hero */}
      <div className="mx-auto max-w-3xl">
        <Badge variant="secondary" className="mb-4">
          {t("metaTitle")}
        </Badge>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{t("pageTitle")}</h1>
        <p className="mt-4 text-lg leading-relaxed text-muted-foreground">{t("pageDesc")}</p>
      </div>

      {/* Story */}
      <div className="mx-auto mt-16 max-w-3xl">
        <h2 className="mb-6 text-2xl font-bold">{t("story.title")}</h2>
        <div className="space-y-4 leading-relaxed text-muted-foreground">
          {storyParagraphs.map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </div>
      </div>

      {/* Tech Stack */}
      <div className="mx-auto mt-16 max-w-5xl">
        <h2 className="mb-8 text-2xl font-bold">{t("techStack.title")}</h2>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {techStack.map((tech) => (
            <Card key={tech.name}>
              <CardHeader>
                <CardTitle className="text-lg">{tech.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{tech.desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Values */}
      <div className="mx-auto mt-16 max-w-5xl">
        <h2 className="mb-8 text-2xl font-bold">{t("values.title")}</h2>
        <div className="grid gap-6 sm:grid-cols-2">
          {values.map((value) => (
            <div key={value.title} className="rounded-lg border p-6">
              <h3 className="font-semibold">{value.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{value.description}</p>
            </div>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div className="mx-auto mt-16 max-w-3xl rounded-2xl bg-muted/50 p-12 text-center">
        <h2 className="text-3xl font-bold">{t("ctaTitle")}</h2>
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
