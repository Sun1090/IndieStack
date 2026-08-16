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

type IntegrationItem = {
  id: string;
  name: string;
  description: string;
};

type IntegrationConfig = {
  icon: typeof Github;
  color: string;
  status: "connected" | "available";
};

const integrationConfig: Record<string, IntegrationConfig> = {
  github: { icon: Github, color: "text-[#333]", status: "connected" },
  stripe: { icon: CreditCard, color: "text-[#635bff]", status: "connected" },
  sentry: { icon: Bell, color: "text-[#362d59]", status: "connected" },
  supabase: { icon: Database, color: "text-[#3ecf8e]", status: "connected" },
  slack: { icon: Puzzle, color: "text-[#4A154B]", status: "available" },
  discord: { icon: Puzzle, color: "text-[#5865F2]", status: "available" },
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard");
  return { title: t("integrations.metaTitle"), description: t("integrations.metaDesc") };
}

export default async function IntegrationsPage() {
  const t = await getTranslations("dashboard");
  const integrations = t.raw("integrations.items") as IntegrationItem[];

  return (
    <div className="space-y-8">
      <PageHeader title={t("integrations.title")} description={t("integrations.desc")} />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {integrations.map((integration) => {
          const config = integrationConfig[integration.id];
          if (!config) return null;
          const Icon = config.icon;
          return (
            <Card key={integration.id} className="transition-colors hover:border-primary/50">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                    <Icon className={`h-5 w-5 ${config.color}`} />
                  </div>
                  <Badge variant={config.status === "connected" ? "default" : "outline"}>
                    {config.status === "connected"
                      ? t("integrations.connected")
                      : t("integrations.notConnected")}
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
