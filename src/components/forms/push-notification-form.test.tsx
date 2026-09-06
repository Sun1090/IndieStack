import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PushNotificationForm } from "./push-notification-form";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
const subscribeMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/push-subscriptions", () => ({ subscribeToPush: subscribeMock }));
const toastMock = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ toast: toastMock }));

beforeEach(() => {
  vi.clearAllMocks();
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
});
