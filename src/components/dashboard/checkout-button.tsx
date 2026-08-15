"use client";

/**
 * Stripe Checkout 按钮
 * 通过服务端结账 API 创建订阅会话并跳转
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";

interface CheckoutButtonProps {
  priceId: string;
  label: string;
  className?: string;
}

export function CheckoutButton({ priceId, label, className }: CheckoutButtonProps) {
  const t = useTranslations("dashboard");
  const ta = useTranslations("actions");
  const [loading, setLoading] = useState(false);

  async function handleCheckout() {
    if (!priceId) return;
    setLoading(true);
    try {
      const response = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priceId }),
      });

      const payload = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !payload.url) {
        toast({
          title: t("billing.checkoutError"),
          description: ta(payload.error ?? "checkoutError"),
          variant: "destructive",
        });
        setLoading(false);
        return;
      }

      window.location.href = payload.url;
    } catch {
      toast({
        title: t("billing.checkoutError"),
        description: ta("checkoutError"),
        variant: "destructive",
      });
      setLoading(false);
    }
  }

  return (
    <Button className={className} onClick={handleCheckout} disabled={loading}>
      {loading ? t("billing.checkoutLoading") : label}
    </Button>
  );
}
