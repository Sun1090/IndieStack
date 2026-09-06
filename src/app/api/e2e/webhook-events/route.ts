/** Mock-only read/reset endpoint for webhook E2E assertions. */
import { NextRequest } from "next/server";
import { jsonNoStore } from "@/lib/api-response";
import { isMockEnabled } from "@/lib/mock";
import { listRecentWebhookEvents } from "@/lib/repositories/webhook-events";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function authorized(request: NextRequest): boolean {
  return request.headers.get("authorization") === `Bearer ${process.env.E2E_BEARER_TOKEN ?? ""}`;
}

export async function GET(request: NextRequest) {
  if (!isMockEnabled) return jsonNoStore({ error: "Not found" }, { status: 404 });
  if (!authorized(request)) return jsonNoStore({ error: "Unauthorized" }, { status: 401 });
  const eventId = request.nextUrl.searchParams.get("event_id");
  const events = await listRecentWebhookEvents(100);
  return jsonNoStore({
    total: eventId ? events.filter((event) => event.event_id === eventId).length : events.length,
    events: eventId ? events.filter((event) => event.event_id === eventId) : events,
  });
}

export async function DELETE(request: NextRequest) {
  if (!isMockEnabled) return jsonNoStore({ error: "Not found" }, { status: 404 });
  if (!authorized(request)) return jsonNoStore({ error: "Unauthorized" }, { status: 401 });
  const { error } = await createAdminClient().from("webhook_events").delete();
  if (error) return jsonNoStore({ error: error.message }, { status: 500 });
  return jsonNoStore({ ok: true });
}
