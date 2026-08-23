import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/guards";
import { WebhookEventsPage } from "./webhook-events-page";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: "Webhook Logs" };
}

export default async function Page() {
  await requireRole("super_admin");
  return <WebhookEventsPage />;
}
