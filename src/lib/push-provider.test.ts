import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendNotification } = vi.hoisted(() => ({ sendNotification: vi.fn() }));
vi.mock("web-push", () => ({ default: { sendNotification } }));

import {
  createPushProvider,
  isPushSubscriptionGone,
  type WebPushTransport,
} from "./push-provider";

function transport(): WebPushTransport {
  return { sendNotification };
}

beforeEach(() => {
  vi.clearAllMocks();
  sendNotification.mockResolvedValue({ statusCode: 201 });
});

describe("createPushProvider", () => {
  it("reports missing configuration and fails explicitly", async () => {
    const provider = createPushProvider({}, transport());
    expect(provider.configured).toBe(false);
    await expect(
      provider.send({ endpoint: "e", p256dh: "p", auth: "a", title: "t" }),
    ).rejects.toThrow("not configured");
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("sends a structured notification with VAPID details", async () => {
    const provider = createPushProvider(
      {
        VAPID_PRIVATE_KEY: "private",
        NEXT_PUBLIC_VAPID_PUBLIC_KEY: "public",
        NEXT_PUBLIC_APP_URL: "https://app.example.com",
      },
      transport(),
    );

    await provider.send({
      endpoint: "https://push.example.com/sub",
      p256dh: "p",
      auth: "a",
      title: "Security alert",
      body: "Review your session",
      link: "/dashboard/settings",
      tag: "security-alert",
    });

    expect(sendNotification).toHaveBeenCalledWith(
      {
        endpoint: "https://push.example.com/sub",
        keys: { p256dh: "p", auth: "a" },
      },
      JSON.stringify({
        title: "Security alert",
        body: "Review your session",
        url: "/dashboard/settings",
        tag: "security-alert",
      }),
      expect.objectContaining({
        TTL: 3600,
        timeout: 10_000,
        urgency: "high",
        vapidDetails: {
          subject: "https://app.example.com",
          publicKey: "public",
          privateKey: "private",
        },
      }),
    );
  });

  it("uses a safe mailto subject when the app URL is not https", async () => {
    const provider = createPushProvider(
      {
        VAPID_PRIVATE_KEY: "private",
        NEXT_PUBLIC_VAPID_PUBLIC_KEY: "public",
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      },
      transport(),
    );
    await provider.send({ endpoint: "e", p256dh: "p", auth: "a", title: "t" });
    expect(sendNotification.mock.calls[0][2].vapidDetails.subject).toBe(
      "mailto:support@indiestack.dev",
    );
  });

  it("rethrows transport errors after recording failure", async () => {
    sendNotification.mockRejectedValue(Object.assign(new Error("gone"), { statusCode: 410 }));
    const provider = createPushProvider(
      { VAPID_PRIVATE_KEY: "private", NEXT_PUBLIC_VAPID_PUBLIC_KEY: "public" },
      transport(),
    );
    await expect(
      provider.send({ endpoint: "e", p256dh: "p", auth: "a", title: "t" }),
    ).rejects.toThrow("gone");
  });
});

describe("isPushSubscriptionGone", () => {
  it("recognizes permanent push-service responses only", () => {
    expect(isPushSubscriptionGone({ statusCode: 404 })).toBe(true);
    expect(isPushSubscriptionGone({ statusCode: 410 })).toBe(true);
    expect(isPushSubscriptionGone({ statusCode: 429 })).toBe(false);
    expect(isPushSubscriptionGone(new Error("network"))).toBe(false);
  });
});
