/**
 * 审计日志页面（服务端包装）
 * 提供页面 metadata，客户端列表见 audit-logs-page
 */

export const dynamic = "force-dynamic";

import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { AdminAuditLogsPage } from "./audit-logs-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin");
  return { title: t("auditLogs.metaTitle"), description: t("auditLogs.metaDesc") };
}

export default function Page() {
  return <AdminAuditLogsPage />;
}
