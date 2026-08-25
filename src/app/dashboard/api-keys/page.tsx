/**
 * API 密钥页面（服务端包装）
 * 提供页面 metadata，客户端列表见 api-keys-page
 */

export const dynamic = "force-dynamic";

import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { ApiKeysPage } from "./api-keys-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard");
  const tc = await getTranslations("common");
  return { title: t("apiKeys.metaTitle"), description: t("apiKeys.metaDesc") };
}

export default function Page() {
  return <ApiKeysPage />;
}
