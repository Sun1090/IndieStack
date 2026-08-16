/**
 * 分析页面（服务端包装）
 * 提供页面 metadata，客户端图表见 analytics-page
 */

export const dynamic = "force-dynamic";

import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { AnalyticsPage } from "./analytics-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard");
  return { title: t("analytics.metaTitle"), description: t("analytics.metaDesc") };
}

export default function Page() {
  return <AnalyticsPage />;
}
