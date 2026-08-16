/**
 * 创建团队页面（服务端包装）
 * 提供页面 metadata，客户端表单见 create-team-page
 */

export const dynamic = "force-dynamic";

import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { CreateTeamPage } from "./create-team-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard");
  return { title: t("team.create.metaTitle"), description: t("team.create.metaDesc") };
}

export default function Page() {
  return <CreateTeamPage />;
}
