/**
 * 首页页面组件（服务端组件）
 * 包含：Hero 区域、统计数据、功能特性、技术栈展示、CTA 区域
 * 所有文本通过 getTranslations 实现国际化
 */
import Link from "next/link";
import { ROUTES, SITE_CONFIG } from "@/lib/constants";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Zap,
  Shield,
  BarChart3,
  Users,
  Bot,
  Globe,
  Database,
  ArrowRight,
  Check,
  ChevronRight,
} from "lucide-react";
import { getTranslations } from "next-intl/server";

export default async function HomePage() {
  // 加载首页命名空间的翻译函数
  const t = await getTranslations("home");
  const tc = await getTranslations("common");

  // JSON-LD 结构化数据：帮助搜索引擎理解站点身份（SEO #81）
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_CONFIG.name,
    url: SITE_CONFIG.url,
    description: SITE_CONFIG.description,
    potentialAction: {
      "@type": "SearchAction",
      target: `${SITE_CONFIG.url}/blog?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };

  return (
    <div className="flex min-h-screen flex-col">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <SiteHeader />
      <main className="flex-1">
        {/* Hero 区域：品牌标语、描述和 CTA 按钮 */}
        <section className="relative overflow-hidden border-b">
          <div className="container py-20 lg:py-32">
            <div className="mx-auto flex max-w-[64rem] flex-col items-center gap-6 text-center">
              <Badge variant="secondary" className="mb-2">
                {t("hero.badge")}
              </Badge>
              <h1 className="text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl lg:text-7xl">
                {t("hero.title")}
                <span className="block text-primary">{t("hero.titleAccent")}</span>
              </h1>
              <p className="max-w-[42rem] leading-normal text-muted-foreground sm:text-xl sm:leading-8">
                {tc("appDesc")}
              </p>
              <div className="flex flex-wrap justify-center gap-4">
                <Button asChild size="lg">
                  <Link href={ROUTES.register}>
                    {t("hero.cta")} <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button variant="outline" size="lg" asChild>
                  <Link href={ROUTES.features}>{t("hero.ctaSecondary")}</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* 统计数据展示区：技术栈数量、页面组件数、API 路由数 */}
        <section className="border-b py-12">
          <div className="container">
            <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
              {[
                { value: "15+", label: t("stats.technologies") },
                { value: "30+", label: t("stats.pages") },
                { value: "10+", label: t("stats.apiRoutes") },
                { value: t("stats.zero"), label: t("stats.configTime") },
              ].map((stat: { value: string; label: string }) => (
                <div key={stat.label} className="text-center">
                  <div className="text-3xl font-bold">{stat.value}</div>
                  <div className="text-sm text-muted-foreground">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 功能特性区：6 个核心功能卡片 */}
        <section className="container space-y-6 py-16 md:py-20 lg:py-24">
          <div className="mx-auto flex max-w-[58rem] flex-col items-center space-y-4 text-center">
            <Badge variant="secondary">{t("featuresSection.badge")}</Badge>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              {t("featuresSection.title")}
            </h2>
            <p className="max-w-[85%] leading-normal text-muted-foreground sm:text-lg">
              {t("featuresSection.description")}
            </p>
          </div>

          {/* 功能卡片网格 */}
          <div className="mx-auto grid justify-center gap-6 sm:grid-cols-2 md:max-w-[64rem] md:grid-cols-3">
            {[
              { icon: Shield, title: t("features.0.title"), desc: t("features.0.description") },
              { icon: Database, title: t("features.1.title"), desc: t("features.1.description") },
              { icon: Users, title: t("features.2.title"), desc: t("features.2.description") },
              { icon: Zap, title: t("features.3.title"), desc: t("features.3.description") },
              { icon: Bot, title: t("features.4.title"), desc: t("features.4.description") },
              { icon: Globe, title: t("features.5.title"), desc: t("features.5.description") },
            ].map((feature) => (
              <div
                key={feature.title}
                className="relative overflow-hidden rounded-lg border bg-background p-6 transition-colors hover:border-primary/50"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                  <feature.icon className="h-6 w-6 text-primary" />
                </div>
                <h3 className="mt-4 font-bold">{feature.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{feature.desc}</p>
              </div>
            ))}
          </div>

          <div className="flex justify-center pt-4">
            <Button variant="link" asChild>
              <Link href={ROUTES.features}>
                {t("featuresSection.seeAll")} <ChevronRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </section>

        {/* 技术栈展示区：列出所有集成的技术项 */}
        <section className="border-t bg-muted/50 py-16 md:py-20">
          <div className="container">
            <div className="mx-auto flex max-w-[58rem] flex-col items-center space-y-4 text-center">
              <Badge variant="secondary">{t("techStackSection.badge")}</Badge>
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                {t("techStackSection.title")}
              </h2>
              <p className="max-w-[85%] leading-normal text-muted-foreground sm:text-lg">
                {t("techStackSection.description")}
              </p>
            </div>
            <div className="mx-auto mt-12 grid max-w-4xl grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              {(t.raw("techStackSection.items") as string[]).map((tech) => (
                <div
                  key={tech}
                  className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm"
                >
                  <Check className="h-3 w-3 shrink-0 text-green-500" />
                  <span>{tech}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA 区域：行动号召 */}
        <section className="container py-16 md:py-20">
          <div className="mx-auto max-w-3xl rounded-2xl bg-gradient-to-b from-muted/50 to-muted p-8 text-center md:p-12">
            <h2 className="text-3xl font-bold tracking-tight">{t("ctaSection.title")}</h2>
            <p className="mt-2 text-muted-foreground">{t("ctaSection.description")}</p>
            <div className="mt-8 flex flex-wrap justify-center gap-4">
              <Button asChild size="lg">
                <Link href={ROUTES.register}>{t("ctaSection.ctaPrimary")}</Link>
              </Button>
              <Button variant="outline" size="lg" asChild>
                <Link href={ROUTES.pricing}>{t("ctaSection.ctaSecondary")}</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
