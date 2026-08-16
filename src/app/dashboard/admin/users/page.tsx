/**
 * 用户管理页面（服务端包装）
 * 提供页面 metadata，客户端列表见 admin-users-page
 */

export const dynamic = "force-dynamic";

import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { AdminUsersPage } from "./admin-users-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin");
  return { title: t("users.metaTitle"), description: t("users.metaDesc") };
}

export default function Page() {
  return <AdminUsersPage />;
}
