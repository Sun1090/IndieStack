/**
 * 新建项目页面（服务端包装）
 * 提供页面 metadata，客户端表单见 create-project-page
 */

export const dynamic = "force-dynamic";

import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { CreateProjectPage } from "./create-project-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard");
  return { title: t("projects.create.metaTitle"), description: t("projects.create.metaDesc") };
}

export default function Page() {
  return <CreateProjectPage />;
}
