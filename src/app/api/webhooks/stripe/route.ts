/**
 * Stripe Webhook API 路由
 * 处理 Stripe 支付事件回调（订阅成功、失败、取消等）
 */

import { NextResponse } from "next/server";

/**
 * POST /api/webhooks/stripe - Handle Stripe webhook events
 *
 * This route handles incoming webhooks from Stripe for subscription lifecycle events.
 * In production, you should verify the Stripe webhook signature.
 */
import { rateLimit } from "@/lib/rate-limit";
export async function POST(request: Request) {
   const limits = await rateLimit.check(request);
   if (!limits.allowed) {
     return NextResponse.json({ error: "Too Many Requests", retryAfter: Math.ceil(limits.resetIn / 1000) }, { status: 429 });
   }
  try {
    const body = await request.text();
    const signature = request.headers.get("stripe-signature");

    if (!signature) {
      return NextResponse.json({ error: "Missing signature" }, { status: 400 });
    }

    // In production, verify webhook signature with stripe.webhooks.constructEvent()
    // const event = stripe.webhooks.constructEvent(body, signature, webhookSecret);

    // Parse the event
    const event = JSON.parse(body);

    // Handle specific event types
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object;
        // Update subscription in database
        // await supabase.from("subscriptions").upsert({ ... });
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        // Mark subscription as canceled
        // await supabase.from("subscriptions").update({ status: "canceled" }).eq("provider_id", subscription.id);
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object;
        // Handle successful payment
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object;
        // Handle failed payment
        break;
      }

      default:
        // Unknown event type - log and acknowledge
        console.log(`Unhandled Stripe event: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Stripe webhook error:", error);
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }
}
