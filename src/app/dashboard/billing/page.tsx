/**
 * 账单页面
 * 管理订阅方案和支付历史
 * 显示当前方案详情和可选方案对比
 * 已接入国际化支持
 */

export const dynamic = "force-dynamic";

import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { SUBSCRIPTION_TIERS } from "@/lib/constants";
import { isStripeConfigured } from "@/lib/stripe";
import { CheckoutButton } from "@/components/dashboard/checkout-button";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard");
  return { title: t("billing.metaTitle"), description: t("billing.metaDesc") };
}

export default async function BillingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const t = await getTranslations("dashboard");
  const tc = await getTranslations("common");

  const { data: membership } = (await supabase
    .from("team_members")
    .select("team_id, teams!inner(plan, member_count)")
    .eq("user_id", user!.id)
    .limit(1)
    .single()) as unknown as {
    data: {
      team_id: string;
      teams: { plan: string; member_count: number } | { plan: string; member_count: number }[];
    } | null;
  };

  const teamRows = Array.isArray(membership?.teams) ? membership!.teams[0] : membership?.teams;
  const teamInfo = teamRows as { plan: string; member_count: number } | undefined;
  const currentPlan = teamInfo?.plan ?? "free";
  const stripeConfigured = isStripeConfigured();

  return (
    <div className="space-y-8">
      <PageHeader title={t("billing.title")} description={t("billing.desc")} />

      <Card>
        <CardHeader>
          <CardTitle>{t("billing.sectionTitle")}</CardTitle>
          <CardDescription>
            {t("billing.currentPlanDesc", {
              planName:
                SUBSCRIPTION_TIERS[currentPlan as keyof typeof SUBSCRIPTION_TIERS]?.name ?? "Free",
            })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">{t("billing.priceLabel")}</p>
              <p className="text-2xl font-bold">
                ${SUBSCRIPTION_TIERS[currentPlan as keyof typeof SUBSCRIPTION_TIERS]?.price ?? 0}
                <span className="text-sm font-normal text-muted-foreground">
                  {t("billing.perMonth")}
                </span>
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-4 text-xl font-semibold tracking-tight">{t("billing.availablePlans")}</h2>
        <div className="grid gap-6 md:grid-cols-3">
          {Object.entries(SUBSCRIPTION_TIERS).map(([key, tier]) => {
            const isCurrent = key === currentPlan;
            return (
              <Card key={key} className={isCurrent ? "border-primary" : ""}>
                <CardHeader>
                  <CardTitle>{tier.name}</CardTitle>
                  <CardDescription>
                    <span className="text-3xl font-bold text-foreground">${tier.price}</span>
                    <span className="text-muted-foreground">{t("billing.perMonth")}</span>
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <ul className="space-y-2">
                    {tier.features.map((feature: string) => (
                      <li key={feature} className="flex items-center gap-2 text-sm">
                        <Check className="h-4 w-4 shrink-0 text-green-500" />
                        {tc(`tierFeatures.${feature}`)}
                      </li>
                    ))}
                  </ul>
                  {isCurrent ? (
                    <Button className="w-full" variant="outline" disabled>
                      {t("billing.currentPlanBadge")}
                    </Button>
                  ) : !stripeConfigured || !tier.priceId ? (
                    <Button
                      className="w-full"
                      variant="default"
                      disabled
                      title={t("billing.stripeNotConfigured")}
                    >
                      {t("billing.stripeNotConfigured")}
                    </Button>
                  ) : (
                    <CheckoutButton
                      className="w-full"
                      priceId={tier.priceId}
                      label={t("billing.upgradeTo", { planName: tier.name })}
                    />
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("billing.paymentHistory.title")}</CardTitle>
          <CardDescription>{t("billing.paymentHistory.desc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t("billing.paymentHistory.empty")}</p>
        </CardContent>
      </Card>
    </div>
  );
}
