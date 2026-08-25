"use client";

/**
 * 定价卡片（客户端）
 * 支持月付/年付切换：年付显示 8 折等效月价与节省提示
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SUBSCRIPTION_TIERS, ROUTES } from "@/lib/constants";

export function PricingCards() {
  const t = useTranslations("pricing");
  const [yearly, setYearly] = useState(false);

  return (
    <>
      {/* 月付/年付切换 */}
      <div className="mt-10 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => setYearly(false)}
          className={!yearly ? "font-semibold text-foreground" : "text-muted-foreground"}
        >
          {t("monthly")}
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={yearly}
          onClick={() => setYearly((v) => !v)}
          className={`relative h-6 w-11 rounded-full transition-colors ${yearly ? "bg-primary" : "bg-muted"}`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
              yearly ? "translate-x-[22px]" : "translate-x-0.5"
            }`}
          />
        </button>
        <button
          type="button"
          onClick={() => setYearly(true)}
          className={yearly ? "font-semibold text-foreground" : "text-muted-foreground"}
        >
          {t("yearly")}
        </button>
        <Badge variant="secondary">{t("save20")}</Badge>
      </div>

      {/* Pricing Cards */}
      <div className="mt-12 grid gap-8 md:grid-cols-3">
        {Object.entries(SUBSCRIPTION_TIERS).map(([key, tier]) => {
          const price = yearly ? Math.round(tier.price * 12 * 0.8) : tier.price;
          return (
            <Card key={key} className={key === "pro" ? "relative border-primary shadow-lg" : ""}>
              {key === "pro" && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge>{t("popular")}</Badge>
                </div>
              )}

              <CardHeader className="text-center">
                <CardTitle className="text-2xl">{tier.name}</CardTitle>
                <CardDescription>
                  <span className="text-4xl font-bold text-foreground">${price}</span>
                  <span className="text-muted-foreground">
                    {yearly ? t("perYear") : t("perMonth")}
                  </span>
                </CardDescription>
                {yearly && tier.price > 0 && (
                  <p className="text-xs text-emerald-600">
                    {t("youSave", { amount: Math.round(tier.price * 12 * 0.2) })}
                  </p>
                )}
              </CardHeader>

              <CardContent className="space-y-6">
                <ul className="space-y-3">
                  {tier.features.map((featureKey: string) => (
                    <li key={featureKey} className="flex items-start gap-2 text-sm">
                      <span className="text-primary">✓</span>
                      <span>{t(`features.${featureKey}`)}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  className="w-full"
                  variant={key === "free" ? "outline" : "default"}
                  asChild
                >
                  <Link href={key === "free" ? "/auth/register" : `${ROUTES.dashboardBilling}?plan=${key}`}>
                    {key === "free" ? t("startFree") : t("choosePro")}
                  </Link>
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}
