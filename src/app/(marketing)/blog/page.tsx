/**
 * 博客列表页面（服务端组件）
 * 展示所有博客文章的列表，按发布日期排序
 * 内容由 next-intl 消息文件驱动，支持中英文
 */

import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getTranslations } from "next-intl/server";

type BlogPost = {
  title: string;
  excerpt: string;
  date: string;
  category: string;
  slug: string;
  author: string;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("blog");
  return {
    title: t("metaTitle"),
    description: t("metaDesc"),
  };
}

export default async function BlogPage() {
  const t = await getTranslations("blog");
  const posts = t.raw("posts") as BlogPost[];

  return (
    <div className="container py-12 lg:py-20">
      {/* Header */}
      <div className="mx-auto max-w-3xl text-center">
        <Badge variant="secondary" className="mb-4">
          {t("pageTitle")}
        </Badge>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{t("pageTitle")}</h1>
        <p className="mt-4 text-lg text-muted-foreground">{t("pageDesc")}</p>
      </div>

      {/* Posts */}
      {posts.length > 0 ? (
        <div className="mt-12 grid gap-8 md:grid-cols-2">
          {posts.map((post) => (
            <Link key={post.slug} href={`/blog/${post.slug}`}>
              <Card className="h-full transition-colors hover:border-primary/50">
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{post.category}</Badge>
                    <span className="text-xs text-muted-foreground">{post.date}</span>
                  </div>
                  <CardTitle className="mt-2 text-xl">{post.title}</CardTitle>
                  <CardDescription className="line-clamp-2">{post.excerpt}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span>{post.author}</span>
                    <span>·</span>
                    <span>{t("minRead", { count: "5" })}</span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <p className="mt-12 text-center text-muted-foreground">{t("noPosts")}</p>
      )}
    </div>
  );
}
