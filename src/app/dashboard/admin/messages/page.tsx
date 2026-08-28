import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/guards";
import { getTranslations } from "next-intl/server";
import { ContactMessagesPage } from "./contact-messages-page";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.messages");
  return { title: t("metaTitle"), description: t("metaDesc") };
}

export default async function Page() {
  await requireRole("admin");
  return <ContactMessagesPage />;
}
