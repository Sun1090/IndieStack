import { describe, expect, it } from "vitest";
import { createPushProvider } from "./push-provider";

describe("createPushProvider", () => {
  it("reports missing configuration and fails explicitly", async () => {
    const provider = createPushProvider({});
    expect(provider.configured).toBe(false);
    await expect(
      provider.send({ endpoint: "e", p256dh: "p", auth: "a", title: "t" }),
    ).rejects.toThrow("not configured");
  });

  it("does not silently claim delivery when configured adapter is absent", async () => {
    const provider = createPushProvider({
      VAPID_PRIVATE_KEY: "secret",
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: "public",
    });
    expect(provider.configured).toBe(true);
    await expect(
      provider.send({ endpoint: "e", p256dh: "p", auth: "a", title: "t" }),
    ).rejects.toThrow("adapter is not installed");
  });
});
