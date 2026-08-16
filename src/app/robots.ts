/**
 * robots.txt 配置
 * 控制搜索引擎爬虫的访问权限
 */

import type { MetadataRoute } from "next";
import { SITE_CONFIG } from "@/lib/constants";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/dashboard/", "/auth/"],
    },
    sitemap: `${SITE_CONFIG.url}/sitemap.xml`,
  };
}
