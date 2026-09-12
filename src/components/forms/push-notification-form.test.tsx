import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PushNotificationForm } from "./push-notification-form";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
const { subscribeMock, unsubscribeMock } = vi.hoisted(() => ({
  subscribeMock: vi.fn(),
  unsubscribeMock: vi.fn(),
}));
vi.mock("@/lib/actions/push-subscriptions", () => ({
  subscribeToPush: subscribeMock,
  unsubscribeFromPush: unsubscribeMock,
}));
const toastMock = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ toast: toastMock }));

beforeEach(() => {
  vi.clearAllMocks();
  unsubscribeMock.mockResolvedValue({ ok: true });
});

afterEach(() => {
  Reflect.deleteProperty(navigator, "serviceWorker");
});

describe("PushNotificationForm", () => {
  it("does not attempt subscription when VAPID configuration is missing", async () => {
    render(<PushNotificationForm />);
    await userEvent.setup().click(screen.getByRole("button"));
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ description: "unconfigured" }),
    );
    expect(subscribeMock).not.toHaveBeenCalled();
  });

  it("detects and revokes an existing browser subscription", async () => {
    const browserUnsubscribe = vi.fn().mockResolvedValue(true);
    const getRegistration = vi.fn().mockResolvedValue({
      pushManager: {
        getSubscription: vi.fn().mockResolvedValue({
          endpoint: "https://push.example.com/sub",
          unsubscribe: browserUnsubscribe,
        }),
      },
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { getRegistration },
    });

    render(<PushNotificationForm />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "disable" }));

    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
    expect(browserUnsubscribe).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith({ title: "disabled" });
  });
});
