/**
 * 更新日志页面（服务端组件）
 * 按时间线展示版本发布历史
 * 分类标注：新功能 ✨、改进 🔧、Bug 修复 🐛、重大发布 🚀
 * 内容由 next-intl 消息文件驱动，支持中英文
 */

import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ROUTES } from "@/lib/constants";
import { ChevronRight } from "lucide-react";
import { getTranslations } from "next-intl/server";

type ChangeItem = {
  type: string;
  text: string;
};

type Release = {
  version: string;
  date: string;
  category: string;
  changes: ChangeItem[];
};

const typeStyles: Record<string, string> = {
  feature: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  improvement: "bg-green-500/10 text-green-500 border-green-500/20",
  fix: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  major: "bg-purple-500/10 text-purple-500 border-purple-500/20",
};

const changeEmojis: Record<string, string> = {
  feature: "✨",
  improvement: "🔧",
  fix: "🐛",
  major: "🚀",
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("changelog");
  return {
    title: t("metaTitle"),
    description: t("metaDesc"),
  };
}

export default async function ChangelogPage() {
  const t = await getTranslations("changelog");
  const releases = t.raw("releases") as Release[];
  const typeLabels = t.raw("typeLabels") as Record<string, string>;

  return (
    <div className="container py-12 lg:py-20">
      {/* Header */}
      <div className="mx-auto max-w-3xl">
        <Badge variant="secondary" className="mb-4">{t("pageTitle")}</Badge>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{t("pageTitle")}</h1>
        <p className="mt-4 text-lg text-muted-foreground">{t("pageDesc")}</p>
      </div>

      {/* Timeline */}
      <div className="relative mx-auto mt-16 max-w-3xl">
        {/* Timeline line */}
        <div className="absolute left-0 top-0 h-full w-px bg-border md:left-8" />

        {releases.map((release) => (
          <div key={release.version} className="relative pb-12 pl-8 last:pb-0 md:pl-20">
            {/* Timeline dot */}
            <div className="absolute left-[-4px] top-1 h-2.5 w-2.5 rounded-full border-2 border-primary bg-background md:left-[calc(2rem-4px)]" />

            {/* Version badge */}
            <div className="mb-3 flex items-center gap-3">
              <span className="text-lg font-bold">{release.version}</span>
              <span className="text-sm text-muted-foreground">{release.date}</span>
              <Badge variant="outline" className={typeStyles[release.category]}>
                {typeLabels[release.category] ?? release.category}
              </Badge>
            </div>

            {/* Changes */}
            <div className="space-y-2">
              {release.changes.map((change, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <span className="mt-1 shrink-0">{changeEmojis[change.type] ?? "•"}</span>
                  <span>{change.text}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* CTA */}
      <div className="mx-auto mt-20 max-w-3xl rounded-2xl bg-muted/50 p-12 text-center">
        <h2 className="text-3xl font-bold">{t("stayUpdated.title")}</h2>
        <p className="mt-2 text-muted-foreground">{t("stayUpdated.desc")}</p>
        <div className="mt-6 flex justify-center gap-4">
          <Button asChild size="lg">
            <Link href={ROUTES.register}>
              {t("stayUpdated.cta")} <ChevronRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
