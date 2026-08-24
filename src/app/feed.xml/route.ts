import { getTranslations } from "next-intl/server";
import { SITE_CONFIG } from "@/lib/constants";

export const dynamic = "force-dynamic";

/** 博客 RSS 2.0 订阅源（数据与 /blog 页面同源：i18n blog.posts） */
export async function GET() {
  const t = await getTranslations("blog");
  const posts = (t.raw("posts") as Array<{
    slug: string;
    title: string;
    excerpt?: string;
    date?: string;
  }>) ?? [];

  const items = posts
    .map((post) => {
      const url = `${SITE_CONFIG.url}/blog/${post.slug}`;
      return `    <item>
      <title><![CDATA[${post.title}]]></title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      ${post.date ? `<pubDate>${new Date(post.date).toUTCString()}</pubDate>` : ""}
      ${post.excerpt ? `<description><![CDATA[${post.excerpt}]]></description>` : ""}
    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${SITE_CONFIG.name} Blog</title>
    <link>${SITE_CONFIG.url}/blog</link>
    <description>${SITE_CONFIG.description}</description>
    <language>en</language>
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
