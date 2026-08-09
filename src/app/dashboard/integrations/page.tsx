/**
 * 集成页面
 * 管理第三方服务集成（Supabase、GitHub、Slack 等）
 * 已接入国际化支持
 */

export const dynamic = "force-dynamic";

import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/page-header";
import { Puzzle, Github, CreditCard, Bell, Database } from "lucide-react";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard");
  return { title: t("integrations.metaTitle"), description: t("integrations.metaDesc") };
}

const integrations = [
  { name: "GitHub", description: "Connect your repositories for automated deployments.", icon: Github, status: "connected", color: "text-[#333]" },
  { name: "Stripe", description: "Payment processing and subscription management.", icon: CreditCard, status: "connected", color: "text-[#635bff]" },
  { name: "Sentry", description: "Error monitoring and performance tracking.", icon: Bell, status: "connected", color: "text-[#362d59]" },
  { name: "Supabase", description: "Database, authentication, and realtime subscriptions.", icon: Database, status: "connected", color: "text-[#3ecf8e]" },
  { name: "Slack", description: "Receive deployment notifications and alerts.", icon: Puzzle, status: "available", color: "text-[#4A154B]" },
  { name: "Discord", description: "Send notifications to your Discord server.", icon: Puzzle, status: "available", color: "text-[#5865F2]" },
];

export default async function IntegrationsPage() {
  const t = await getTranslations("dashboard");

  return (
    <div className="space-y-8">
      <PageHeader title={t("integrations.title")} description={t("integrations.desc")} />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {integrations.map((integration) => {
          const Icon = integration.icon;
          return (
            <Card key={integration.name} className="transition-colors hover:border-primary/50">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                    <Icon className={`h-5 w-5 ${integration.color}`} />
                  </div>
                  <Badge variant={integration.status === "connected" ? "default" : "outline"}>
                    {integration.status === "connected" ? t("integrations.connected") : t("integrations.notConnected")}
                  </Badge>
                </div>
                <CardTitle className="mt-4 text-base">{integration.name}</CardTitle>
                <CardDescription>{integration.description}</CardDescription>
              </CardHeader>
            </Card>
          );
        })}
      </div>

      <p className="text-sm text-muted-foreground">{t("integrations.comingSoon")}</p>
    </div>
  );
}
