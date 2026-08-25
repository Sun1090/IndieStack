/**
 * 站点地图配置
 * 自动生成 sitemap.xml，帮助搜索引擎索引页面
 * 包含静态营销页与博客文章（数据来自 next-intl 消息文件）
 */

import type { MetadataRoute } from "next";
import { SITE_CONFIG, ROUTES } from "@/lib/constants";
import blogZh from "../../messages/zh-CN/blog.json";
import blogEn from "../../messages/en/blog.json";

type BlogMessage = {
  posts?: Array<{ slug: string; date?: string }>;
};

interface BlogEntry {
  slug: string;
  date?: string;
}

/** 聚合中英文博客文章（slug 去重，保留日期用于 lastmod） */
function getBlogEntries(): BlogEntry[] {
  const posts = [
    ...((blogZh as BlogMessage).posts ?? []),
    ...((blogEn as BlogMessage).posts ?? []),
  ];
  const seen = new Map<string, BlogEntry>();
  for (const p of posts) {
    if (p.slug && !seen.has(p.slug)) seen.set(p.slug, p);
  }
  return [...seen.values()];
}

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = SITE_CONFIG.url;

  const staticRoutes = [
    { url: ROUTES.home, changeFrequency: "monthly" as const, priority: 1.0 },
    { url: ROUTES.features, changeFrequency: "monthly" as const, priority: 0.9 },
    { url: ROUTES.pricing, changeFrequency: "monthly" as const, priority: 0.9 },
    { url: ROUTES.faq, changeFrequency: "monthly" as const, priority: 0.6 },
    { url: ROUTES.changelog, changeFrequency: "weekly" as const, priority: 0.6 },
    { url: ROUTES.about, changeFrequency: "yearly" as const, priority: 0.7 },
    { url: ROUTES.blog, changeFrequency: "weekly" as const, priority: 0.8 },
    { url: ROUTES.privacy, changeFrequency: "yearly" as const, priority: 0.3 },
    { url: ROUTES.terms, changeFrequency: "yearly" as const, priority: 0.3 },
    { url: ROUTES.contact, changeFrequency: "yearly" as const, priority: 0.5 },
  ];

  const blogRoutes = getBlogEntries().map((post) => ({
    url: `${baseUrl}${ROUTES.blog}/${post.slug}`,
    lastModified: post.date ? new Date(post.date) : new Date(),
    changeFrequency: "weekly" as const,
    priority: 0.7,
  }));

  return [
    ...staticRoutes.map((route) => ({
      url: `${baseUrl}${route.url}`,
      lastModified: new Date(),
      changeFrequency: route.changeFrequency,
      priority: route.priority,
    })),
    ...blogRoutes,
  ];
}
