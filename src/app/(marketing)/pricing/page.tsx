/** * 定价页面（服务端组件） * 展示 Free/Pro/Enterprise 三级定价方案 * 包含功能对比、月度/年度切换、FAQ 常见问题解答 */

import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";
import Link from "next/link";
import { ROUTES, SUBSCRIPTION_TIERS } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Simple, transparent pricing for teams of all sizes",
};

export default function PricingPage() {
  return (
    <div className="container py-12 lg:py-20">
      {/* Header */}
      <div className="mx-auto max-w-3xl text-center">
        <Badge variant="secondary" className="mb-4">Pricing</Badge>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Simple, transparent pricing
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Start for free, upgrade when you grow. No hidden fees, no surprises.
        </p>
      </div>

      {/* Pricing Cards */}
      <div className="mt-12 grid gap-8 md:grid-cols-3">
        {Object.entries(SUBSCRIPTION_TIERS).map(([key, tier]) => (
          <Card
            key={key}
            className={
              key === "pro"
                ? "relative border-primary shadow-lg"
                : ""
            }
          >
            {key === "pro" && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <Badge>Most Popular</Badge>
              </div>
            )}

            <CardHeader className="text-center">
              <CardTitle className="text-2xl">{tier.name}</CardTitle>
              <CardDescription>
                <span className="text-4xl font-bold text-foreground">${tier.price}</span>
                <span className="text-muted-foreground">/month</span>
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-6">
              <ul className="space-y-3">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-3">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                    <span className="text-sm">{feature}</span>
                  </li>
                ))}
              </ul>

              <Button
                asChild
                className="w-full"
                variant={key === "free" ? "outline" : "default"}
              >
                <Link href={ROUTES.register}>
                  {key === "free" ? "Get Started Free" : `Start ${tier.name} Trial`}
                </Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* FAQ */}
      <div className="mt-20">
        <h2 className="mb-8 text-center text-2xl font-bold">Frequently Asked Questions</h2>
        <div className="mx-auto grid max-w-3xl gap-6 md:grid-cols-2">
          {[
            {
              q: "Can I upgrade or downgrade anytime?",
              a: "Yes, you can change your plan at any time. Changes take effect immediately.",
            },
            {
              q: "What payment methods do you accept?",
              a: "We accept all major credit cards and PayPal. Enterprise plans can be invoiced.",
            },
            {
              q: "Is there a free trial for paid plans?",
              a: "Yes, all paid plans come with a 14-day free trial. No credit card required.",
            },
            {
              q: "What happens when I hit my usage limits?",
              a: "We'll notify you before you hit any limits. You can upgrade anytime.",
            },
          ].map((faq) => (
            <div key={faq.q}>
              <h3 className="font-semibold">{faq.q}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{faq.a}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
